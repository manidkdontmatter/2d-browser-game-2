// Defines shared inventory and hotbar data structures used by server and client.
export interface InventorySlot {
  readonly slotIndex: number;
  readonly itemId: string;
  readonly stackCount: number;
}

export interface InventoryState {
  readonly slots: ReadonlyMap<number, InventorySlot>;
  readonly maxSlots: number;
}

export function createEmptyInventory(maxSlots: number): InventoryState {
  return { slots: new Map(), maxSlots };
}

export function inventoryToArray(state: InventoryState): InventorySlot[] {
  return Array.from(state.slots.values());
}

export function inventoryFromArray(slots: InventorySlot[], maxSlots: number): InventoryState {
  const map = new Map<number, InventorySlot>();
  for (const slot of slots) {
    map.set(slot.slotIndex, slot);
  }
  return { slots: map, maxSlots };
}

export interface InventorySlotPayload {
  readonly slotIndex: number;
  readonly itemId: string;
  readonly stackCount: number;
}

export interface InventoryStatePayload {
  readonly slots: readonly InventorySlotPayload[];
  readonly maxSlots: number;
}

export function inventoryToPayload(state: InventoryState): InventoryStatePayload {
  return {
    slots: inventoryToArray(state),
    maxSlots: state.maxSlots,
  };
}

export function inventoryFromPayload(payload: InventoryStatePayload): InventoryState {
  return inventoryFromArray(payload.slots as InventorySlot[], payload.maxSlots);
}

// ---- Hotbar ----

export const HOTBAR_SLOT_COUNT = 12;

export interface HotbarSlotPayload {
  readonly slotIndex: number;
  readonly inventorySlotIndex: number | null;
  readonly abilityId: string | null;
}

export interface HotbarStatePayload {
  readonly slots: readonly HotbarSlotPayload[];
}

export function createEmptyHotbarPayload(): HotbarStatePayload {
  const slots: HotbarSlotPayload[] = [];
  for (let i = 0; i < HOTBAR_SLOT_COUNT; i += 1) {
    slots.push({ slotIndex: i, inventorySlotIndex: null, abilityId: null });
  }
  return { slots };
}
