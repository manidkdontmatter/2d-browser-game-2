// Defines shared game constants used by both the authoritative server and browser client.
import { NET_TIMING } from './net/timing.js';

export const TILE_SIZE = 128;
export const DEFAULT_TICK_RATE = NET_TIMING.serverTickRate;
export const DEFAULT_SNAPSHOT_RATE = NET_TIMING.snapshotRate;
export const DEFAULT_AOI_WIDTH = 3200;
export const DEFAULT_AOI_HEIGHT = 2400;
export const FIXED_DELTA_SECONDS = 1 / DEFAULT_TICK_RATE;
export const TEST_MAP_WIDTH = 100;
export const TEST_MAP_HEIGHT = 100;
export const GENERATOR_VERSION = 1;
export const PLAYER_RADIUS = 34;
export const NPC_RADIUS = 34;
export const PROJECTILE_RADIUS = 10;
export const PLAYER_MOVE_SPEED = 360;
export const NPC_MOVE_SPEED = 250;
export const PROJECTILE_SPEED = 900;
export const MELEE_RANGE = 110;
export const MELEE_DAMAGE = 25;
export const PROJECTILE_DAMAGE = 35;
export const CHARACTER_MAX_HEALTH = 100;
export const ATTACK_RATE_LIMIT_MS = 180;
export const NPC_DECISION_INTERVAL_SECONDS = 0.2;
export const NPC_RESPAWN_SECONDS = 30;
