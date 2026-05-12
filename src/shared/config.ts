// Defines shared game constants used by both the authoritative server and browser client.
import { NET_TIMING } from './net/timing.js';

// ---- Tile & world ----
export const TILE_SIZE = 128;
export const TEST_MAP_WIDTH = 100;
export const TEST_MAP_HEIGHT = 100;
export const GENERATOR_VERSION = 1;

// ---- Physics & collision ----
export const PLAYER_RADIUS = 34;
export const NPC_RADIUS = 34;
export const PROJECTILE_RADIUS = 10;

// ---- Movement ----
export const PLAYER_MOVE_SPEED = 360;
export const NPC_MOVE_SPEED = 250;
export const PROJECTILE_SPEED = 900;

// ---- Combat ----
export const MELEE_RANGE = 110;
export const MELEE_DAMAGE = 25;
export const PROJECTILE_DAMAGE = 35;
export const CHARACTER_MAX_HEALTH = 100;
export const BASE_ATTACK_DELAY_MS = 200;
export const MIN_ATTACK_DELAY_MS = 50;
export const ATTACK_RATE_LIMIT_MS = BASE_ATTACK_DELAY_MS;

// ---- AI ----
export const NPC_DECISION_INTERVAL_SECONDS = 0.2;
export const NPC_RESPAWN_SECONDS = 30;
export const NPC_TARGET_ACQUIRE_RANGE = 700;
export const NPC_TARGET_LOSE_RANGE_FACTOR = 1.35;
export const NPC_REPATH_INTERVAL_MS = 900;
export const NPC_REPATH_DISTANCE_TILES = 2;
export const NPC_MAX_REPATHS_PER_TICK = 48;
export const NPC_PATH_POINT_REACHED_EPSILON = TILE_SIZE * 0.2;

// ---- AI scheduler ----
export const AI_MAX_SENSE_PER_TICK = 320;
export const AI_MAX_PLAN_PER_TICK = 220;
export const AI_WAKE_GRACE_MS = 900;

// ---- Area activation ----
export const AREA_ACTIVATION_RADIUS_CHUNKS = 1;
export const AREA_DEACTIVATION_GRACE_TICKS = 90;

// ---- Spatial query ----
export const SPATIAL_CELL_SIZE_TILES = 4;

// ---- AOI ----
export const DEFAULT_AOI_WIDTH = 3200;
export const DEFAULT_AOI_HEIGHT = 2400;

// ---- Derived ----
export const DEFAULT_TICK_RATE = NET_TIMING.serverTickRate;
export const DEFAULT_SNAPSHOT_RATE = NET_TIMING.snapshotRate;
export const FIXED_DELTA_SECONDS = 1 / DEFAULT_TICK_RATE;
