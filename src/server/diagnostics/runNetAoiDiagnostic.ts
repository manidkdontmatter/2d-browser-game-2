// Measures nengi ChannelAABB2D visibility behavior with fake users and gameplay-like spatial entities.
import { performance } from 'node:perf_hooks';
import { ChannelAABB2D, Instance } from 'nengi';
import { DEFAULT_AOI_HEIGHT, DEFAULT_AOI_WIDTH, TILE_SIZE } from '../../shared/config.js';
import { NetEntityKind } from '../../shared/domain/snapshots.js';
import { ncontext } from '../../shared/net/context.js';
import { NType } from '../../shared/net/nType.js';
import { createWorldIdentity } from '../../shared/world/generateMap.js';

interface DiagnosticEntity {
  nid: number;
  ntype: NType.NetEntity;
  entityId: number;
  kind: NetEntityKind;
  x: number;
  y: number;
  health: number;
  facing: number;
}

interface FakeUser {
  id: number;
  subscriptions: Map<number, unknown>;
  subscribe(channel: { nid: number }): void;
  unsubscribe(channel: { nid: number }): void;
}

const users = readInt('AOI_USERS', 100);
const entityCount = readInt('AOI_ENTITIES', 1000);
const snapshots = readInt('AOI_SNAPSHOTS', 30);
const aoiWidth = readInt('AOI_WIDTH', DEFAULT_AOI_WIDTH);
const aoiHeight = readInt('AOI_HEIGHT', DEFAULT_AOI_HEIGHT);
const p95ThresholdMs = readNumber('AOI_P95_MS', 20);
const maxThresholdMs = readNumber('AOI_MAX_MS', 60);

const identity = createWorldIdentity();
const worldWidth = identity.settings.width * TILE_SIZE;
const worldHeight = identity.settings.height * TILE_SIZE;
const instance = new Instance(ncontext);
const spatialChannel = new ChannelAABB2D(instance.localState);
const fakeUsers = createUsers(users);
const entities = createEntities(entityCount, worldWidth, worldHeight);

for (const entity of entities) {
  spatialChannel.addEntity(entity);
}

for (const user of fakeUsers) {
  const center = deterministicPoint(user.id, worldWidth, worldHeight);
  spatialChannel.subscribe(user, {
    x: center.x,
    y: center.y,
    halfWidth: aoiWidth / 2,
    halfHeight: aoiHeight / 2,
  });
}

const visibleCounts: number[] = [];
const queryTimesMs: number[] = [];
const startMs = performance.now();

for (let snapshot = 0; snapshot < snapshots; snapshot += 1) {
  for (const user of fakeUsers) {
    const center = deterministicPoint(user.id + snapshot * 17, worldWidth, worldHeight);
    spatialChannel.subscribe(user, {
      x: center.x,
      y: center.y,
      halfWidth: aoiWidth / 2,
      halfHeight: aoiHeight / 2,
    });

    const queryStartMs = performance.now();
    const visible = spatialChannel.getVisibleEntities(user.id);
    queryTimesMs.push(performance.now() - queryStartMs);
    visibleCounts.push(visible.length);
  }
}

const elapsedSeconds = (performance.now() - startMs) / 1000;
const estimatedPointChecks = snapshots * users * entityCount;
const pointChecksPerSecond = estimatedPointChecks / Math.max(elapsedSeconds, 0.000001);
const visibleStats = summarize(visibleCounts);
const queryStats = summarize(queryTimesMs);

console.log('Net AOI diagnostic');
console.log('Measuring nengi ChannelAABB2D.getVisibleEntities as implemented; this is AABB culling behavior, not an assumed spatial index.');
console.log(`entities=${entityCount} users=${users} snapshots=${snapshots} world=${worldWidth}x${worldHeight} aoi=${aoiWidth}x${aoiHeight}`);
console.log(`visible/user min=${visibleStats.min.toFixed(0)} avg=${visibleStats.avg.toFixed(2)} p95=${visibleStats.p95.toFixed(0)} max=${visibleStats.max.toFixed(0)}`);
console.log(`query ms p50=${queryStats.p50.toFixed(4)} p95=${queryStats.p95.toFixed(4)} max=${queryStats.max.toFixed(4)}`);
console.log(`estimated point checks/s=${pointChecksPerSecond.toFixed(0)}`);

if (queryStats.p95 > p95ThresholdMs || queryStats.max > maxThresholdMs) {
  console.error(`AOI diagnostic failed: p95 ${queryStats.p95.toFixed(4)}ms > ${p95ThresholdMs}ms or max ${queryStats.max.toFixed(4)}ms > ${maxThresholdMs}ms.`);
  process.exitCode = 1;
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

function createEntities(count: number, width: number, height: number): DiagnosticEntity[] {
  return Array.from({ length: count }, (_, index) => {
    const point = deterministicPoint(index + 101, width, height);
    return {
      nid: 0,
      ntype: NType.NetEntity,
      entityId: index + 1,
      kind: NetEntityKind.Body,
      x: point.x,
      y: point.y,
      health: 100,
      facing: 1,
    };
  });
}

function deterministicPoint(index: number, width: number, height: number): { x: number; y: number } {
  return {
    x: ((index * 7919) % Math.max(1, Math.floor(width - 1))) + 0.5,
    y: ((index * 104729) % Math.max(1, Math.floor(height - 1))) + 0.5,
  };
}

function summarize(values: number[]): { min: number; avg: number; p50: number; p95: number; max: number } {
  const sorted = [...values].sort((a, b) => a - b);
  const sum = values.reduce((total, value) => total + value, 0);
  return {
    min: sorted[0] ?? 0,
    avg: sum / Math.max(values.length, 1),
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    max: sorted[sorted.length - 1] ?? 0,
  };
}

function percentile(sortedValues: number[], fraction: number): number {
  if (sortedValues.length === 0) {
    return 0;
  }

  const index = Math.min(sortedValues.length - 1, Math.floor(sortedValues.length * fraction));
  return sortedValues[index];
}

function readInt(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function readNumber(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
