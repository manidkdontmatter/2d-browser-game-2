// Defines bounded debug request payloads shared by the browser client and authoritative server.
export const DEBUG_NPC_SPAWN_DEFAULT_COUNT = 5;

export interface DebugSpawnNpcsRequest {
  count?: number;
}

export interface DebugSpawnNpcsResponse {
  spawned: number;
  requested: number;
}

export interface DebugSetInvincibleRequest {
  enabled?: boolean;
}

export interface DebugSetInvincibleResponse {
  enabled: boolean;
}

export function parseDebugNpcSpawnCount(payload: unknown): number {
  if (!payload || typeof payload !== 'object') {
    return DEBUG_NPC_SPAWN_DEFAULT_COUNT;
  }

  const count = Number((payload as DebugSpawnNpcsRequest).count);
  if (!Number.isFinite(count)) {
    return DEBUG_NPC_SPAWN_DEFAULT_COUNT;
  }

  return Math.max(0, Math.floor(count));
}

export function parseDebugInvincibleEnabled(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') {
    return false;
  }

  return Boolean((payload as DebugSetInvincibleRequest).enabled);
}
