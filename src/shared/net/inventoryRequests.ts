// Defines shared inventory and hotbar request/response payloads for client-server communication.
import type { HotbarStatePayload, InventoryStatePayload } from '../items/inventoryTypes.js';

export interface PickupItemRequestBody {
  readonly pickupEntityId: number;
}

export interface DropItemRequestBody {
  readonly slotIndex: number;
}

export interface MoveItemRequestBody {
  readonly fromSlotIndex: number;
  readonly toSlotIndex: number;
}

export interface SetHotbarSlotRequestBody {
  readonly slotIndex: number;
  readonly inventorySlotIndex: number | null;
  readonly abilityId: string | null;
}

export interface InventoryOperationResponse {
  readonly success: boolean;
  readonly inventory: InventoryStatePayload | null;
}

export interface HotbarOperationResponse {
  readonly success: boolean;
  readonly hotbar: HotbarStatePayload | null;
}
