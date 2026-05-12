// Mirrors authoritative movement physics on the client for nengi client-side prediction and reconciliation.
import { Body, World as PhysicsWorld } from 'skale-physics';
import { PLAYER_MOVE_SPEED, PLAYER_RADIUS, TILE_SIZE } from '../../shared/config.js';
import { NetEntityKind } from '../../shared/domain/snapshots.js';
import { kinematicDisplacement, normalizeAxis } from '../../shared/movement/locomotion.js';
import { tileIndex } from '../../shared/world/mapTypes.js';
import { InputCommandPayload } from '../input.js';
import { ClientEntity, ClientWorldState } from '../game/clientWorldState.js';
import { getTileDefinition } from '../../shared/world/tileDefinitions.js';
import { bodyLayer, wallLayer } from '../../shared/physics/layers.js';
import { NType } from '../../shared/net/nType.js';
import { NET_TIMING } from '../../shared/net/timing.js';

const PREDICTED_PROPS = ['x', 'y', 'facing'];
const HARD_POSITION_ERROR_DISTANCE = 128;
const CORRECTION_DECAY_HALFLIFE_MS = 70;
const PREDICTION_TILE_COLLISION_CHUNK_SIZE = 16;
const PREDICTION_ACTIVE_CHUNK_RADIUS = 1;

export interface NengiPredictionEntity {
  nid: number;
  ntype: number;
  x: number;
  y: number;
  facing: number;
}

export interface NengiReplayCommandSet {
  tick: number;
  commands: InputCommandPayload[];
}

export interface NengiPredictionReplay {
  tick: number;
  entity: NengiPredictionEntity;
}

interface PredictionErrorPropertyLike {
  prop: string;
  actualValue: unknown;
}

interface PredictionErrorEntityLike {
  errors: PredictionErrorPropertyLike[];
}

export interface PredictionErrorFrameLike {
  tick: number;
  entities: Map<number, PredictionErrorEntityLike>;
}

export class MovementPredictionController {
  private enabled = true;
  private readonly physicsMirror: ClientPredictionPhysicsMirror;
  private forceHardResync = false;
  private correctionOffsetX = 0;
  private correctionOffsetY = 0;
  private lastCorrectionDecayAtMs: number | null = null;

  constructor(private readonly state: ClientWorldState) {
    this.physicsMirror = new ClientPredictionPhysicsMirror(state);
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  applyLocalCommand(command: InputCommandPayload): void {
    if (!this.enabled) {
      return;
    }

    const local = this.state.getLocalEntity();
    if (!local) {
      return;
    }

    this.physicsMirror.stepCommand(local, command);
  }

  getLocalPredictionEntity(): NengiPredictionEntity | null {
    const local = this.state.getLocalEntity();
    return local ? toPredictionEntity(local) : null;
  }

  shouldApplyServerUpdate(entity: ClientEntity, prop: string): boolean {
    if (!this.enabled) {
      return true;
    }

    if (entity.entityId !== this.state.localEntityId) {
      return true;
    }

    return !PREDICTED_PROPS.includes(prop);
  }

  handleAuthoritativeReset(): void {
    this.forceHardResync = true;
    this.clearCorrectionOffset();
    const local = this.state.getLocalEntity();
    if (local) {
      this.physicsMirror.snapLocalBody(local);
    }
  }

  reconcileFromPredictionErrorFrame(
    frame: PredictionErrorFrameLike,
    unconfirmedCommandSets: NengiReplayCommandSet[],
    nowMs: number,
  ): NengiPredictionReplay[] {
    if (!this.enabled) {
      return [];
    }

    const local = this.state.getLocalEntity();
    if (!local) {
      return [];
    }

    const predictionError = frame.entities.get(local.nid);
    if (!predictionError) {
      return [];
    }

    const next = { x: local.x, y: local.y, facing: local.facing };
    let hasPositionCorrection = false;
    let hasFacingCorrection = false;

    for (const error of predictionError.errors) {
      if (error.prop === 'x') {
        next.x = finiteOrCurrent(error.actualValue, local.x);
        hasPositionCorrection = true;
      }
      if (error.prop === 'y') {
        next.y = finiteOrCurrent(error.actualValue, local.y);
        hasPositionCorrection = true;
      }
      if (error.prop === 'facing') {
        next.facing = finiteOrCurrent(error.actualValue, local.facing);
        hasFacingCorrection = next.facing !== local.facing;
      }
    }

    const dx = next.x - local.x;
    const dy = next.y - local.y;
    const positionError = Math.hypot(dx, dy);
    const hasMeaningfulCorrection = (
      this.forceHardResync
      || hasPositionCorrection
      || hasFacingCorrection
    );

    if (!hasMeaningfulCorrection) {
      return [];
    }

    const shouldHardResync = this.forceHardResync || (hasPositionCorrection && positionError >= HARD_POSITION_ERROR_DISTANCE);
    this.forceHardResync = false;
    const previousPredictedX = local.x;
    const previousPredictedY = local.y;

    local.x = next.x;
    local.y = next.y;
    local.facing = next.facing;
    this.physicsMirror.snapLocalBody(local);

    if (shouldHardResync) {
      this.clearCorrectionOffset();
      return [];
    }

    const replays: NengiPredictionReplay[] = [];
    for (const commandSet of unconfirmedCommandSets) {
      for (const command of commandSet.commands) {
        this.physicsMirror.stepCommand(local, command);
      }
      replays.push({ tick: commandSet.tick, entity: toPredictionEntity(local) });
    }

    this.correctionOffsetX += previousPredictedX - local.x;
    this.correctionOffsetY += previousPredictedY - local.y;
    this.lastCorrectionDecayAtMs = nowMs;
    return replays;
  }

  getPresentationPosition(nowMs: number): { x: number; y: number } | null {
    const local = this.state.getLocalEntity();
    if (!this.enabled || !local) {
      return local ? { x: local.x, y: local.y } : null;
    }

    this.decayCorrectionOffset(nowMs);
    return {
      x: local.x + this.correctionOffsetX,
      y: local.y + this.correctionOffsetY,
    };
  }

  private decayCorrectionOffset(nowMs: number): void {
    if (this.lastCorrectionDecayAtMs === null) {
      return;
    }

    const elapsedMs = Math.max(0, nowMs - this.lastCorrectionDecayAtMs);
    this.lastCorrectionDecayAtMs = nowMs;
    const decay = 0.5 ** (elapsedMs / CORRECTION_DECAY_HALFLIFE_MS);
    this.correctionOffsetX *= decay;
    this.correctionOffsetY *= decay;
    if (Math.hypot(this.correctionOffsetX, this.correctionOffsetY) < 0.05) {
      this.clearCorrectionOffset();
    }
  }

  private clearCorrectionOffset(): void {
    this.correctionOffsetX = 0;
    this.correctionOffsetY = 0;
    this.lastCorrectionDecayAtMs = null;
  }
}

export class ClientPredictionPhysicsMirror {
  private physics: PhysicsWorld | null = null;
  private localBody: Body | null = null;
  private readonly remoteBodies = new Map<number, Body>();
  private readonly staticTileBodiesByIndex = new Map<number, Body>();
  private readonly activeTileChunkKeys = new Set<string>();
  private builtMapRevision = -1;

  constructor(private readonly state: ClientWorldState) {}

  stepCommand(entity: ClientEntity, command: InputCommandPayload): void {
    this.ensureWorld();
    this.syncActiveTileBodiesAround(entity.x, entity.y);
    this.ensureLocalBody(entity);
    this.syncRemoteBlockers(entity);
    if (!this.physics || !this.localBody) {
      applyFallbackPredictedMovement(entity, command);
      return;
    }

    const axis = normalizeAxis(command.moveX, command.moveY);
    const displacement = kinematicDisplacement(command.moveX, command.moveY, PLAYER_MOVE_SPEED, NET_TIMING.movementCommandSeconds);
    this.localBody.setVelocity(0, 0);
    this.localBody.translate(displacement.x, displacement.y);
    this.physics.step(0);
    this.localBody.setVelocity(0, 0);
    entity.x = this.localBody.x;
    entity.y = this.localBody.y;
    if (axis.x !== 0) {
      entity.facing = axis.x > 0 ? 1 : -1;
    }
  }

  snapLocalBody(entity: ClientEntity): void {
    this.ensureWorld();
    this.syncActiveTileBodiesAround(entity.x, entity.y);
    this.ensureLocalBody(entity);
    this.localBody?.setPosition(entity.x, entity.y).setVelocity(0, 0);
  }

  private ensureWorld(): void {
    if (this.builtMapRevision === this.state.mapRevision) {
      this.syncPendingTileBodies();
      return;
    }

    const map = this.state.tileMap;
    this.physics = new PhysicsWorld({
      width: (map?.width ?? 100) * TILE_SIZE,
      height: (map?.height ?? 100) * TILE_SIZE,
      bounds: map !== null,
    });
    this.localBody = null;
    this.remoteBodies.clear();
    this.staticTileBodiesByIndex.clear();
    this.activeTileChunkKeys.clear();
    this.builtMapRevision = this.state.mapRevision;
    this.state.consumePendingTileCollisionUpdates();
  }

  private syncPendingTileBodies(): void {
    for (const update of this.state.consumePendingTileCollisionUpdates()) {
      this.syncTileBody(update.x, update.y);
    }
  }

  private syncTileBody(x: number, y: number): void {
    const map = this.state.tileMap;
    if (!this.physics || !map) {
      return;
    }

    const index = tileIndex(map.width, x, y);
    const existing = this.staticTileBodiesByIndex.get(index);
    const shouldHaveBody = this.activeTileChunkKeys.has(predictionTileChunkKeyForTile(x, y)) && getTileDefinition(map.getTile(x, y)).dense;

    if (shouldHaveBody && !existing) {
      const body = this.physics.createBody({
        type: 'static',
        layer: wallLayer,
        shape: { kind: 'box', x: x * TILE_SIZE, y: y * TILE_SIZE, width: TILE_SIZE, height: TILE_SIZE },
      });
      this.staticTileBodiesByIndex.set(index, body);
      return;
    }

    if (!shouldHaveBody && existing) {
      this.physics.removeBody(existing);
      this.staticTileBodiesByIndex.delete(index);
    }
  }

  private syncActiveTileBodiesAround(worldX: number, worldY: number): void {
    const map = this.state.tileMap;
    if (!this.physics || !map) {
      return;
    }

    const tile = map.worldToTile(worldX, worldY);
    const centerChunkX = Math.floor(tile.x / PREDICTION_TILE_COLLISION_CHUNK_SIZE);
    const centerChunkY = Math.floor(tile.y / PREDICTION_TILE_COLLISION_CHUNK_SIZE);
    const desiredChunkKeys = new Set<string>();

    for (let chunkY = centerChunkY - PREDICTION_ACTIVE_CHUNK_RADIUS; chunkY <= centerChunkY + PREDICTION_ACTIVE_CHUNK_RADIUS; chunkY += 1) {
      for (let chunkX = centerChunkX - PREDICTION_ACTIVE_CHUNK_RADIUS; chunkX <= centerChunkX + PREDICTION_ACTIVE_CHUNK_RADIUS; chunkX += 1) {
        if (predictionChunkOverlapsMap(map.width, map.height, chunkX, chunkY)) {
          desiredChunkKeys.add(predictionTileChunkKey(chunkX, chunkY));
        }
      }
    }

    for (const key of Array.from(this.activeTileChunkKeys)) {
      if (!desiredChunkKeys.has(key)) {
        const chunk = parsePredictionTileChunkKey(key);
        this.unloadTileChunk(chunk.x, chunk.y);
      }
    }

    for (const key of desiredChunkKeys) {
      if (!this.activeTileChunkKeys.has(key)) {
        const chunk = parsePredictionTileChunkKey(key);
        this.activeTileChunkKeys.add(key);
        this.loadTileChunk(chunk.x, chunk.y);
      }
    }
  }

  private loadTileChunk(chunkX: number, chunkY: number): void {
    const bounds = this.tileChunkBounds(chunkX, chunkY);
    for (let y = bounds.startY; y < bounds.endY; y += 1) {
      for (let x = bounds.startX; x < bounds.endX; x += 1) {
        this.syncTileBody(x, y);
      }
    }
  }

  private unloadTileChunk(chunkX: number, chunkY: number): void {
    const map = this.state.tileMap;
    if (!this.physics || !map) {
      return;
    }

    this.activeTileChunkKeys.delete(predictionTileChunkKey(chunkX, chunkY));
    const bounds = this.tileChunkBounds(chunkX, chunkY);
    for (let y = bounds.startY; y < bounds.endY; y += 1) {
      for (let x = bounds.startX; x < bounds.endX; x += 1) {
        const index = tileIndex(map.width, x, y);
        const existing = this.staticTileBodiesByIndex.get(index);
        if (existing) {
          this.physics.removeBody(existing);
          this.staticTileBodiesByIndex.delete(index);
        }
      }
    }
  }

  private tileChunkBounds(chunkX: number, chunkY: number): { startX: number; startY: number; endX: number; endY: number } {
    const map = this.state.tileMap;
    if (!map) {
      return { startX: 0, startY: 0, endX: 0, endY: 0 };
    }

    const startX = Math.max(0, chunkX * PREDICTION_TILE_COLLISION_CHUNK_SIZE);
    const startY = Math.max(0, chunkY * PREDICTION_TILE_COLLISION_CHUNK_SIZE);
    const endX = Math.min(map.width, startX + PREDICTION_TILE_COLLISION_CHUNK_SIZE);
    const endY = Math.min(map.height, startY + PREDICTION_TILE_COLLISION_CHUNK_SIZE);
    return { startX, startY, endX, endY };
  }

  private ensureLocalBody(entity: ClientEntity): void {
    if (!this.physics || this.localBody) {
      return;
    }

    this.localBody = this.physics.createBody({
      type: 'dynamic',
      layer: bodyLayer,
      mask: wallLayer | bodyLayer,
      shape: { kind: 'circle', x: entity.x, y: entity.y, radius: PLAYER_RADIUS },
      restitution: 0,
      damping: 12,
      canSleep: false,
    });
    this.localBody.setVelocity(0, 0);
  }

  private syncRemoteBlockers(local: ClientEntity): void {
    if (!this.physics) {
      return;
    }

    const liveRemoteNids = new Set<number>();
    for (const entity of this.state.entities.values()) {
      if (entity.nid === local.nid || entity.kind !== NetEntityKind.Body || entity.health <= 0) {
        continue;
      }

      liveRemoteNids.add(entity.nid);
      const existing = this.remoteBodies.get(entity.nid);
      if (existing) {
        existing.setPosition(entity.x, entity.y);
        continue;
      }

      const body = this.physics.createBody({
        type: 'static',
        layer: bodyLayer,
        mask: bodyLayer,
        shape: { kind: 'circle', x: entity.x, y: entity.y, radius: PLAYER_RADIUS },
      });
      this.remoteBodies.set(entity.nid, body);
    }

    for (const [nid, body] of this.remoteBodies) {
      if (!liveRemoteNids.has(nid)) {
        this.physics.removeBody(body);
        this.remoteBodies.delete(nid);
      }
    }
  }
}

export function applyPredictedMovement(entity: ClientEntity, command: InputCommandPayload, state?: ClientWorldState): void {
  if (!state) {
    applyFallbackPredictedMovement(entity, command);
    return;
  }

  new ClientPredictionPhysicsMirror(state).stepCommand(entity, command);
}

function applyFallbackPredictedMovement(entity: ClientEntity, command: InputCommandPayload): void {
  const axis = normalizeAxis(command.moveX, command.moveY);
  const displacement = kinematicDisplacement(command.moveX, command.moveY, PLAYER_MOVE_SPEED, NET_TIMING.movementCommandSeconds);
  entity.x += displacement.x;
  entity.y += displacement.y;
  if (axis.x !== 0) {
    entity.facing = axis.x > 0 ? 1 : -1;
  }
}

function finiteOrCurrent(value: unknown, current: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : current;
}

function toPredictionEntity(entity: ClientEntity): NengiPredictionEntity {
  return {
    nid: entity.nid,
    ntype: NType.NetEntity,
    x: Math.fround(entity.x),
    y: Math.fround(entity.y),
    facing: entity.facing,
  };
}

function predictionTileChunkKeyForTile(x: number, y: number): string {
  return predictionTileChunkKey(
    Math.floor(x / PREDICTION_TILE_COLLISION_CHUNK_SIZE),
    Math.floor(y / PREDICTION_TILE_COLLISION_CHUNK_SIZE),
  );
}

function predictionTileChunkKey(chunkX: number, chunkY: number): string {
  return `${chunkX}:${chunkY}`;
}

function parsePredictionTileChunkKey(key: string): { x: number; y: number } {
  const [x, y] = key.split(':').map(Number);
  return { x: x ?? 0, y: y ?? 0 };
}

function predictionChunkOverlapsMap(width: number, height: number, chunkX: number, chunkY: number): boolean {
  return (
    chunkX * PREDICTION_TILE_COLLISION_CHUNK_SIZE < width
    && chunkY * PREDICTION_TILE_COLLISION_CHUNK_SIZE < height
    && (chunkX + 1) * PREDICTION_TILE_COLLISION_CHUNK_SIZE > 0
    && (chunkY + 1) * PREDICTION_TILE_COLLISION_CHUNK_SIZE > 0
  );
}
