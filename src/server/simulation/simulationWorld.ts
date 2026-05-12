// Owns authoritative ECS, physics, tilemap, and lookup indexes shared by simulation systems.
import { createWorld, type EntityId, type World as EcsWorld } from 'bitecs';
import { Body, World as PhysicsWorld } from 'skale-physics';
import { TILE_SIZE } from '../../shared/config.js';
import { NetEntityKind, NetEntityRecord } from '../../shared/domain/snapshots.js';
import { createWorldIdentity, generateMap } from '../../shared/world/generateMap.js';
import type { GeneratedMap, TileMutation, WorldGenerationIdentity } from '../../shared/world/mapTypes.js';
import { tileIndex } from '../../shared/world/mapTypes.js';
import { TileMapView } from '../../shared/world/tileMap.js';
import { NType } from '../../shared/net/nType.js';
import { GridPoint } from '../../shared/pathfinding/aStar.js';
import { SpawnPoint } from './types.js';
import { Position } from './components.js';
import { TileCollisionSystem } from '../systems/tileCollisionSystem.js';

export interface NpcPathCache {
  path: GridPoint[];
  goal: GridPoint;
  nextRepathAtMs: number;
}

export class SimulationWorld {
  readonly ecs: EcsWorld = createWorld();
  readonly identity: WorldGenerationIdentity;
  readonly generated: GeneratedMap;
  readonly tileMap: TileMapView;
  readonly physics: PhysicsWorld;
  readonly tileCollision: TileCollisionSystem;

  readonly eidByEntityId = new Map<number, EntityId>();
  readonly bodyByEntityId = new Map<number, Body>();
  readonly entityIdByBodyId = new Map<number, number>();
  readonly netEntities = new Map<number, NetEntityRecord>();
  readonly npcPaths = new Map<number, NpcPathCache>();
  readonly spawnCandidates: SpawnPoint[];
  private readonly spawnCandidateIndexByTileIndex = new Map<number, number>();

  private nextEntityId = 1;
  playerSpawn: SpawnPoint | null = null;

  constructor(identity = createWorldIdentity(), mutations: TileMutation[] = []) {
    this.identity = identity;
    this.generated = generateMap(this.identity);
    this.tileMap = new TileMapView(this.identity.settings.width, this.identity.settings.height, this.generated.tiles, mutations);
    this.physics = new PhysicsWorld({
      width: this.identity.settings.width * TILE_SIZE,
      height: this.identity.settings.height * TILE_SIZE,
      bounds: true,
    });
    this.tileCollision = new TileCollisionSystem(this.tileMap, this.physics);
    this.spawnCandidates = this.collectSpawnCandidates();
  }

  allocateEntityId(): number {
    const entityId = this.nextEntityId;
    this.nextEntityId += 1;
    return entityId;
  }

  worldToTile(x: number, y: number): GridPoint {
    return this.tileMap.worldToTile(x, y);
  }

  createNetworkRecord(entityId: number, kind: NetEntityKind): NetEntityRecord {
    return {
      nid: 0,
      ntype: NType.NetEntity,
      entityId,
      kind,
      x: 0,
      y: 0,
      health: 1,
      facing: 1,
    };
  }

  removePhysicsBody(entityId: number): void {
    const body = this.bodyByEntityId.get(entityId);
    if (body) {
      this.entityIdByBodyId.delete(body.id);
      this.physics.removeBody(body);
    }
    this.bodyByEntityId.delete(entityId);
  }

  findPlayerSpawnPoint(): SpawnPoint {
    const center = { x: this.tileMap.width / 2, y: this.tileMap.height / 2 };
    return this.spawnCandidates.reduce((best, candidate) => {
      const candidateDistance = Math.hypot(candidate.tileX - center.x, candidate.tileY - center.y);
      const bestDistance = Math.hypot(best.tileX - center.x, best.tileY - center.y);
      return candidateDistance < bestDistance ? candidate : best;
    }, this.spawnCandidates[0] ?? { ...this.tileMap.tileToWorldCenter(1, 1), tileX: 1, tileY: 1 });
  }

  findNpcSpawnPoints(count: number): SpawnPoint[] {
    const playerSpawn = this.playerSpawn ?? this.findPlayerSpawnPoint();
    const minimumDistanceTiles = 18;
    const distantCandidates = this.spawnCandidates.filter((candidate) => {
      return Math.hypot(candidate.tileX - playerSpawn.tileX, candidate.tileY - playerSpawn.tileY) >= minimumDistanceTiles;
    });
    const source = distantCandidates.length >= count ? distantCandidates : this.spawnCandidates;
    if (source.length === 0) {
      return [];
    }

    const stride = Math.max(1, Math.floor(source.length / Math.max(1, count)));
    const offset = Math.floor(source.length / 3);
    const selected: SpawnPoint[] = [];
    const used = new Set<number>();

    for (let i = 0; i < source.length && selected.length < count; i += 1) {
      const index = (offset + i * stride) % source.length;
      if (used.has(index)) {
        continue;
      }
      used.add(index);
      selected.push(source[index]);
    }

    return selected;
  }

  findPortalSpawnPoint(): SpawnPoint {
    const playerSpawn = this.playerSpawn ?? this.findPlayerSpawnPoint();
    const minimumDistanceTiles = 2;
    const maximumDistanceTiles = 4;
    const candidate = this.spawnCandidates.find((spawn) => {
      const distanceTiles = Math.hypot(spawn.tileX - playerSpawn.tileX, spawn.tileY - playerSpawn.tileY);
      return distanceTiles >= minimumDistanceTiles && distanceTiles <= maximumDistanceTiles;
    });

    return candidate ?? this.findNpcSpawnPoints(1)[0] ?? playerSpawn;
  }

  getEntityPosition(entityId: number): { x: number; y: number } | null {
    const eid = this.eidByEntityId.get(entityId);
    if (eid === undefined) {
      return null;
    }

    return { x: Position.x[eid], y: Position.y[eid] };
  }

  syncSpawnCandidateForTile(x: number, y: number): void {
    const index = tileIndex(this.tileMap.width, x, y);
    const existingIndex = this.spawnCandidateIndexByTileIndex.get(index);
    if (this.tileMap.isWalkable(x, y)) {
      if (existingIndex === undefined) {
        this.spawnCandidateIndexByTileIndex.set(index, this.spawnCandidates.length);
        this.spawnCandidates.push({ ...this.tileMap.tileToWorldCenter(x, y), tileX: x, tileY: y });
      }
      return;
    }

    if (existingIndex !== undefined) {
      const last = this.spawnCandidates.at(-1);
      if (last && existingIndex < this.spawnCandidates.length - 1) {
        this.spawnCandidates[existingIndex] = last;
        this.spawnCandidateIndexByTileIndex.set(tileIndex(this.tileMap.width, last.tileX, last.tileY), existingIndex);
      }
      this.spawnCandidates.pop();
      this.spawnCandidateIndexByTileIndex.delete(index);
    }
  }

  private collectSpawnCandidates(): SpawnPoint[] {
    const candidates: SpawnPoint[] = [];
    for (let y = 1; y < this.tileMap.height - 1; y += 1) {
      for (let x = 1; x < this.tileMap.width - 1; x += 1) {
        if (this.tileMap.isWalkable(x, y)) {
          this.spawnCandidateIndexByTileIndex.set(tileIndex(this.tileMap.width, x, y), candidates.length);
          candidates.push({ ...this.tileMap.tileToWorldCenter(x, y), tileX: x, tileY: y });
        }
      }
    }

    return candidates;
  }
}
