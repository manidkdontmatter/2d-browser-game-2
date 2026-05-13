// Holds client-side inventory and hotbar state, shared between the inventory panel and hotbar UI.
// Inventory is server-authoritative via request/response; hotbar is likewise server-authoritative.
// The store caches server payloads locally so the UI can render synchronously.
import type { HotbarSlotPayload, HotbarStatePayload, InventorySlot, InventoryState, InventoryStatePayload } from '../../shared/items/inventoryTypes.js';
import { createEmptyHotbarPayload, HOTBAR_SLOT_COUNT, inventoryFromPayload } from '../../shared/items/inventoryTypes.js';
import type { ItemDefinition } from '../../shared/items/itemDefinitions.js';
import { getItemDefinition } from '../../shared/items/itemDefinitions.js';

export { HOTBAR_SLOT_COUNT };

export interface HotbarSlot {
  slotIndex: number;
  inventorySlotIndex: number | null;
  abilityId: string | null;
}

export class InventoryStore {
  private inventory: InventoryState = { slots: new Map(), maxSlots: 0 };
  private hotbar: HotbarStatePayload = createEmptyHotbarPayload();
  private readonly listeners = new Set<() => void>();

  getInventory(): InventoryState {
    return this.inventory;
  }

  getHotbar(): readonly HotbarSlotPayload[] {
    return this.hotbar.slots;
  }

  getHotbarSlot(slotIndex: number): HotbarSlotPayload | null {
    return this.hotbar.slots[slotIndex] ?? null;
  }

  getItemDefinition(itemId: string): ItemDefinition | undefined {
    return getItemDefinition(itemId);
  }

  applyInventoryPayload(payload: InventoryStatePayload): void {
    this.inventory = inventoryFromPayload(payload);
    this.notifyListeners();
  }

  applyHotbarPayload(payload: HotbarStatePayload): void {
    this.hotbar = payload;
    this.notifyListeners();
  }

  getHotbarItem(slotIndex: number): { slot: InventorySlot; definition: ItemDefinition } | null {
    const hotbarSlot = this.hotbar.slots[slotIndex];
    if (!hotbarSlot || hotbarSlot.inventorySlotIndex === null) {
      return null;
    }

    const inventorySlot = this.inventory.slots.get(hotbarSlot.inventorySlotIndex);
    if (!inventorySlot) {
      return null;
    }

    const definition = getItemDefinition(inventorySlot.itemId);
    if (!definition) {
      return null;
    }

    return { slot: inventorySlot, definition };
  }

  addListener(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}
