// Defines request/response payloads for character stat allocation actions between
// the client UI and the authoritative server. The server validates allocations
// against the shared budget and derivation rules before applying them.
import type { AllocatedStats, DerivedStats } from '../stats/characterStats.js';

export interface CharacterStatsResponse {
  allocations: AllocatedStats;
  derived: DerivedStats;
  remainingPoints: number;
}

export interface AllocateStatRequest {
  statId: string;
}

export interface RemoveStatRequest {
  statId: string;
}
