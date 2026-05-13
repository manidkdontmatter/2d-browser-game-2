// Stress-tests authoritative server simulation and AOI query workload at production-scale entity counts with pass/fail budgets and profiler-friendly output.
import { performance } from 'node:perf_hooks';
import { ChannelAABB2D, Instance } from 'nengi';
import { DEFAULT_AOI_HEIGHT, DEFAULT_AOI_WIDTH, DEFAULT_TICK_RATE } from '../../shared/config.js';
import { AttackIntent } from '../../shared/domain/commands.js';
import { NetEntityKind, type NetEntityRecord } from '../../shared/domain/snapshots.js';
import { ncontext } from '../../shared/net/context.js';
import { NType } from '../../shared/net/nType.js';
import { NET_TIMING } from '../../shared/net/timing.js';
import { GameSimulation } from '../simulation/gameSimulation.js';

interface FakeUser {
  id: number;
  subscriptions: Map<number, unknown>;
  subscribe(channel: { nid: number }): void;
  unsubscribe(channel: { nid: number }): void;
}

interface SpatialEntity {
  nid: number;
  ntype: NType.NetEntity;
  entityId: number;
  kind: NetEntityKind;
  x: number;
  y: number;
  health: number;
  facing: number;
}

const players = readInt('SCALE_PLAYERS', 100);
const npcs = readInt('SCALE_NPCS', 1000);
const durationSeconds = readInt('SCALE_DURATION_SECONDS', 30);
const warmupSeconds = readInt('SCALE_WARMUP_SECONDS', 5);
const tickRate = readInt('SCALE_TICK_RATE', DEFAULT_TICK_RATE);
const aoiWidth = readInt('SCALE_AOI_WIDTH', DEFAULT_AOI_WIDTH);
const aoiHeight = readInt('SCALE_AOI_HEIGHT', DEFAULT_AOI_HEIGHT);

const tickBudgetMs = 1000 / tickRate;
const totalTicks = durationSeconds * tickRate;
const warmupTicks = warmupSeconds * tickRate;
const simulation = new GameSimulation();
const playerEntityIds = Array.from({ length: players }, () => simulation.spawnPlayer());
simulation.spawnHostileNpcs(npcs);

const instance = new Instance(ncontext);
const spatialChannel = new ChannelAABB2D(instance.localState);
const users = createUsers(players);
const playerEntityByUserId = new Map<number, number>();

for (let i = 0; i < users.length; i += 1) {
  playerEntityByUserId.set(users[i].id, playerEntityIds[i]);
}

const spatialByEntityId = new Map<number, SpatialEntity>();
const tickTimesMs: number[] = [];
const simTimesMs: number[] = [];
const netSyncTimesMs: number[] = [];
const aoiTimesMs: number[] = [];
const visibleCounts: number[] = [];
let peakRssBytes = process.memoryUsage().rss;
let peakHeapUsedBytes = process.memoryUsage().heapUsed;

const startedAtMs = performance.now();
for (let tick = 1; tick <= totalTicks + warmupTicks; tick += 1) {
  const tickStartMs = performance.now();
  queueMovementCommands(simulation, playerEntityIds, tick);

  const simStartMs = performance.now();
  simulation.step(1 / tickRate);
  const simDurationMs = performance.now() - simStartMs;

  const netSyncStartMs = performance.now();
  syncSpatialEntities(simulation.getNetworkRecords(), spatialByEntityId, spatialChannel);
  refreshAoiSubscriptions(users, playerEntityByUserId, spatialByEntityId, spatialChannel, aoiWidth, aoiHeight);
  const netSyncDurationMs = performance.now() - netSyncStartMs;

  for (const user of users) {
    const queryStartMs = performance.now();
    const visible = spatialChannel.getVisibleEntities(user.id);
    const queryDurationMs = performance.now() - queryStartMs;
    if (tick > warmupTicks) {
      aoiTimesMs.push(queryDurationMs);
      visibleCounts.push(visible.length);
    }
  }

  const tickDurationMs = performance.now() - tickStartMs;
  const memory = process.memoryUsage();
  peakRssBytes = Math.max(peakRssBytes, memory.rss);
  peakHeapUsedBytes = Math.max(peakHeapUsedBytes, memory.heapUsed);

  if (tick > warmupTicks) {
    tickTimesMs.push(tickDurationMs);
    simTimesMs.push(simDurationMs);
    netSyncTimesMs.push(netSyncDurationMs);
  }
}

const elapsedSeconds = (performance.now() - startedAtMs) / 1000;
const statsTick = summarize(tickTimesMs);
const statsSim = summarize(simTimesMs);
const statsNetSync = summarize(netSyncTimesMs);
const statsAoi = summarize(aoiTimesMs);
const visibleStats = summarize(visibleCounts);
const throughputTicksPerSecond = tickTimesMs.length / Math.max(elapsedSeconds, 0.000001);

const pass = {
  tickP95WithinBudget: statsTick.p95 <= tickBudgetMs,
  tickMaxWithinTwoXBudget: statsTick.max <= tickBudgetMs * 2,
  achievedTpsAtOrAboveTarget: throughputTicksPerSecond >= tickRate,
};

console.log(
  JSON.stringify(
    {
      scenario: {
        players,
        npcs,
        ticksMeasured: tickTimesMs.length,
        warmupTicks,
        tickRate,
        tickBudgetMs: Number(tickBudgetMs.toFixed(3)),
        aoiWidth,
        aoiHeight,
      },
      timingMs: {
        tick: toRoundedStats(statsTick),
        simulation: toRoundedStats(statsSim),
        netSyncAndSubscriptions: toRoundedStats(statsNetSync),
        aoiQueryPerUser: toRoundedStats(statsAoi),
      },
      visibility: {
        min: Math.round(visibleStats.min),
        p50: Math.round(visibleStats.p50),
        p95: Math.round(visibleStats.p95),
        max: Math.round(visibleStats.max),
      },
      throughput: {
        measuredTicksPerSecond: Number(throughputTicksPerSecond.toFixed(2)),
      },
      memory: {
        peakRssMb: Number((peakRssBytes / (1024 * 1024)).toFixed(2)),
        peakHeapUsedMb: Number((peakHeapUsedBytes / (1024 * 1024)).toFixed(2)),
      },
      pass,
      recommendations: [
        'If tick p95 exceeds budget, capture CPU profile with npm run diagnose:scale:cpu and inspect hottest functions by self time.',
        'If AOI query dominates time, reduce visible entity counts per user or replace broad-phase query strategy.',
        'If simulation dominates time, inspect AI/combat/physics system hotspots under production NPC counts.',
      ],
    },
    null,
    2,
  ),
);

if (!Object.values(pass).every(Boolean)) {
  process.exitCode = 1;
}

function queueMovementCommands(simulationWorld: GameSimulation, playerIds: readonly number[], tick: number): void {
  const commandIntervalMs = 1000 / NET_TIMING.movementCommandRate;
  for (let i = 0; i < playerIds.length; i += 1) {
    const strideX = (tick + i) % 3;
    const moveX = strideX === 0 ? -1 : strideX === 1 ? 0 : 1;
    const moveY = ((tick + i * 2) % 3) - 1;
    simulationWorld.queueCommand(playerIds[i], {
      moveX,
      moveY,
      aimX: 5000 + i * 7,
      aimY: 5000 + tick * 3,
      attack: AttackIntent.None,
      interact: false,
      sequence: tick,
      clientTick: tick,
      clientTimeMs: tick * commandIntervalMs,
      hotbarSlotActivated: -1,
    });
  }
}

function syncSpatialEntities(records: readonly NetEntityRecord[], byEntityId: Map<number, SpatialEntity>, channel: ChannelAABB2D): void {
  const seen = new Set<number>();
  for (const record of records) {
    seen.add(record.entityId);
    const existing = byEntityId.get(record.entityId);
    if (!existing) {
      const added: SpatialEntity = {
        nid: 0,
        ntype: NType.NetEntity,
        entityId: record.entityId,
        kind: normalizeKind(record.kind),
        x: record.x,
        y: record.y,
        health: record.health,
        facing: record.facing,
      };
      byEntityId.set(record.entityId, added);
      channel.addEntity(added);
      continue;
    }

    existing.x = record.x;
    existing.y = record.y;
    existing.health = record.health;
    existing.facing = record.facing;
    existing.kind = normalizeKind(record.kind);
  }

  for (const [entityId, entity] of byEntityId.entries()) {
    if (seen.has(entityId)) {
      continue;
    }

    channel.removeEntity(entity);
    byEntityId.delete(entityId);
  }
}

function refreshAoiSubscriptions(
  usersForAoi: readonly FakeUser[],
  playerByUserId: ReadonlyMap<number, number>,
  entitiesById: ReadonlyMap<number, SpatialEntity>,
  channel: ChannelAABB2D,
  width: number,
  height: number,
): void {
  for (const user of usersForAoi) {
    const playerEntityId = playerByUserId.get(user.id);
    if (playerEntityId === undefined) {
      continue;
    }

    const anchor = entitiesById.get(playerEntityId);
    if (!anchor) {
      continue;
    }

    channel.subscribe(user, {
      x: anchor.x,
      y: anchor.y,
      halfWidth: width / 2,
      halfHeight: height / 2,
    });
  }
}

function createUsers(count: number): FakeUser[] {
  return Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    subscriptions: new Map<number, unknown>(),
    subscribe(channel: { nid: number }): void {
      this.subscriptions.set(channel.nid, channel);
    },
    unsubscribe(channel: { nid: number }): void {
      this.subscriptions.delete(channel.nid);
    },
  }));
}

function normalizeKind(kind: number): NetEntityKind {
  if (kind === NetEntityKind.Projectile) {
    return NetEntityKind.Projectile;
  }
  if (kind === NetEntityKind.Portal) {
    return NetEntityKind.Portal;
  }
  return NetEntityKind.Body;
}

function summarize(values: readonly number[]): { min: number; p50: number; p95: number; max: number; avg: number } {
  if (values.length === 0) {
    return { min: 0, p50: 0, p95: 0, max: 0, avg: 0 };
  }

  const sorted = [...values].sort((a, b) => a - b);
  const total = values.reduce((sum, value) => sum + value, 0);
  return {
    min: sorted[0],
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    max: sorted[sorted.length - 1],
    avg: total / values.length,
  };
}

function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) {
    return 0;
  }

  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * fraction));
  return sorted[index];
}

function toRoundedStats(stats: { min: number; p50: number; p95: number; max: number; avg: number }): { min: number; p50: number; p95: number; max: number; avg: number } {
  return {
    min: Number(stats.min.toFixed(4)),
    p50: Number(stats.p50.toFixed(4)),
    p95: Number(stats.p95.toFixed(4)),
    max: Number(stats.max.toFixed(4)),
    avg: Number(stats.avg.toFixed(4)),
  };
}

function readInt(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}
