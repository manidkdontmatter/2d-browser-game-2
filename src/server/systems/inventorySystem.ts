// Manages authoritative player inventory state: pickup, drop, move, and slot initialization.
import { addComponent, hasComponent } from 'bitecs';
import { entityRecipeIds } from '../../shared/entities/entityRecipes.js';
import type { ItemDefinition } from '../../shared/items/itemDefinitions.js';
import { getItemDefinition } from '../../shared/items/itemDefinitions.js';
import {
  createEmptyHotbarPayload,
  createEmptyInventory,
  type HotbarStatePayload,
  type InventorySlot,
  type InventoryState,
} from '../../shared/items/inventoryTypes.js';
import { PLAYER_RADIUS, PLAYER_MOVE_SPEED } from '../../shared/config.js';
import { Identity, PickupItem, Position } from '../simulation/components.js';
import type { EntityComposer } from '../simulation/entityComposer.js';
import type { SimulationWorld } from '../simulation/simulationWorld.js';

const DEFAULT_INVENTORY_SLOTS = 28;
const PICKUP_RANGE = 64;

export class InventorySystem {
  constructor(
    private readonly world: SimulationWorld,
    private readonly composer: EntityComposer,
  ) {}

  ensureInventory(entityId: number): InventoryState {
    const existing = this.world.inventories.get(entityId);
    if (existing) {
      return existing;
    }

    const inventory = createEmptyInventory(DEFAULT_INVENTORY_SLOTS);
    this.world.inventories.set(entityId, inventory);
    return inventory;
  }

  getInventory(entityId: number): InventoryState | null {
    return this.world.inventories.get(entityId) ?? null;
  }

  pickupItem(entityId: number, pickupEntityId: number): { success: boolean } {
    const inventory = this.getInventory(entityId);
    if (!inventory) {
      return { success: false };
    }

    const pickupEid = this.world.eidByEntityId.get(pickupEntityId);
    if (pickupEid === undefined || !hasComponent(this.world.ecs, pickupEid, PickupItem)) {
      return { success: false };
    }

    const itemId = this.world.pickupItemIds.get(pickupEntityId);
    const stackCount = PickupItem.stackCount[pickupEid];
    if (!itemId || stackCount <= 0) {
      return { success: false };
    }

    const definition = getItemDefinition(itemId);
    if (!definition) {
      return { success: false };
    }

    const playerPos = this.world.getEntityPosition(entityId);
    const pickupPos = this.world.getEntityPosition(pickupEntityId);
    if (!playerPos || !pickupPos) {
      return { success: false };
    }

    if (Math.hypot(playerPos.x - pickupPos.x, playerPos.y - pickupPos.y) > PICKUP_RANGE + PLAYER_RADIUS) {
      return { success: false };
    }

    const remaining = this.addToInventory(inventory, itemId, stackCount, definition);
    if (remaining > 0) {
      PickupItem.stackCount[pickupEid] = remaining;
      return { success: true };
    }

    this.composer.removeEntity(pickupEntityId);
    return { success: true };
  }

  dropItem(entityId: number, slotIndex: number): { success: boolean } {
    const inventory = this.getInventory(entityId);
    if (!inventory) {
      return { success: false };
    }

    const slot = inventory.slots.get(slotIndex);
    if (!slot) {
      return { success: false };
    }

    const position = this.world.getEntityPosition(entityId);
    if (!position) {
      return { success: false };
    }

    const dropX = position.x + (Math.random() * 40 - 20);
    const dropY = position.y + (Math.random() * 40 - 20);

    this.removeFromInventorySlot(inventory, slotIndex);
    this.spawnGroundItem(slot.itemId, slot.stackCount, dropX, dropY);
    return { success: true };
  }

  moveItem(entityId: number, fromSlotIndex: number, toSlotIndex: number): { success: boolean } {
    const inventory = this.getInventory(entityId);
    if (!inventory) {
      return { success: false };
    }

    if (fromSlotIndex === toSlotIndex) {
      return { success: false };
    }

    if (fromSlotIndex < 0 || fromSlotIndex >= inventory.maxSlots || toSlotIndex < 0 || toSlotIndex >= inventory.maxSlots) {
      return { success: false };
    }

    const fromSlot = inventory.slots.get(fromSlotIndex);
    const toSlot = inventory.slots.get(toSlotIndex);

    if (!fromSlot) {
      return { success: false };
    }

    if (toSlot) {
      if (toSlot.itemId === fromSlot.itemId) {
        const definition = getItemDefinition(toSlot.itemId);
        const maxStack = definition?.stackSize ?? 1;
        const combined = toSlot.stackCount + fromSlot.stackCount;
        if (combined <= maxStack) {
          this.setSlot(inventory, toSlotIndex, toSlot.itemId, combined);
          this.removeFromInventorySlot(inventory, fromSlotIndex);
          return { success: true };
        }
        this.setSlot(inventory, toSlotIndex, toSlot.itemId, maxStack);
        this.setSlot(inventory, fromSlotIndex, fromSlot.itemId, combined - maxStack);
        return { success: true };
      }

      this.setSlot(inventory, fromSlotIndex, toSlot.itemId, toSlot.stackCount);
      this.setSlot(inventory, toSlotIndex, fromSlot.itemId, fromSlot.stackCount);
      return { success: true };
    }

    this.setSlot(inventory, toSlotIndex, fromSlot.itemId, fromSlot.stackCount);
    this.removeFromInventorySlot(inventory, fromSlotIndex);
    return { success: true };
  }

  spawnGroundItem(itemId: string, stackCount: number, x: number, y: number): number {
    const entityId = this.composer.createFromRecipe(entityRecipeIds.groundPickup, { x, y });
    const eid = this.world.eidByEntityId.get(entityId);
    if (eid !== undefined) {
      this.world.pickupItemIds.set(entityId, itemId);
      PickupItem.stackCount[eid] = stackCount;
    }
    this.composer.activateEntity(entityId);
    return entityId;
  }

  ensureHotbar(entityId: number): HotbarStatePayload {
    const existing = this.world.hotbars.get(entityId);
    if (existing) {
      return existing;
    }

    const hotbar = createEmptyHotbarPayload();
    this.world.hotbars.set(entityId, hotbar);
    return hotbar;
  }

  getHotbar(entityId: number): HotbarStatePayload | null {
    return this.world.hotbars.get(entityId) ?? null;
  }

  setHotbarSlot(entityId: number, slotIndex: number, inventorySlotIndex: number | null, abilityId: string | null): boolean {
    const hotbar = this.getHotbar(entityId);
    if (!hotbar) {
      return false;
    }

    if (slotIndex < 0 || slotIndex >= hotbar.slots.length) {
      return false;
    }

    (hotbar.slots as unknown as { slotIndex: number; inventorySlotIndex: number | null; abilityId: string | null }[])[slotIndex] = {
      slotIndex,
      inventorySlotIndex,
      abilityId,
    };
    return true;
  }

  removeInventory(entityId: number): void {
    this.world.inventories.delete(entityId);
    this.world.hotbars.delete(entityId);
  }

  private addToInventory(inventory: InventoryState, itemId: string, count: number, definition: ItemDefinition): number {
    let remaining = count;
    const maxStack = definition.stackSize;

    for (const [slotIndex, slot] of inventory.slots) {
      if (slot.itemId === itemId && slot.stackCount < maxStack) {
        const canAdd = maxStack - slot.stackCount;
        const adding = Math.min(canAdd, remaining);
        this.setSlot(inventory, slotIndex, itemId, slot.stackCount + adding);
        remaining -= adding;
        if (remaining <= 0) {
          return 0;
        }
      }
    }

    while (remaining > 0 && inventory.slots.size < inventory.maxSlots) {
      const freeSlot = this.findFreeSlot(inventory);
      const adding = Math.min(maxStack, remaining);
      this.setSlot(inventory, freeSlot, itemId, adding);
      remaining -= adding;
    }

    return remaining;
  }

  private findFreeSlot(inventory: InventoryState): number {
    for (let i = 0; i < inventory.maxSlots; i += 1) {
      if (!inventory.slots.has(i)) {
        return i;
      }
    }
    return -1;
  }

  private setSlot(inventory: InventoryState, slotIndex: number, itemId: string, stackCount: number): void {
    (inventory.slots as Map<number, InventorySlot>).set(slotIndex, {
      slotIndex,
      itemId,
      stackCount,
    });
  }

  private removeFromInventorySlot(inventory: InventoryState, slotIndex: number): void {
    (inventory.slots as Map<number, InventorySlot>).delete(slotIndex);
  }
}
