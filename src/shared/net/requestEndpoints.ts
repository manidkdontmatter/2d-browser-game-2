// Names nengi request/response endpoints used for explicit client-to-server actions.
export const enum RequestEndpoint {
  DebugSpawnNpcs = 1,
  DebugSetInvincible = 2,
  GetCharacterStats = 3,
  AllocateStat = 4,
  RemoveStat = 5,
  ResetStats = 6,
  PickupItem = 7,
  DropItem = 8,
  MoveItem = 9,
  GetInventory = 10,
  SetHotbarSlot = 11,
  GetHotbar = 12,
}
