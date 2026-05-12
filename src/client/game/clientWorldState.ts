// Stores client-side replicated world state separately from networking and Pixi rendering.
import { NetEntityKind } from '../../shared/domain/snapshots.js';
import { parseWorldInitPayload, TileMutationPayload, WorldInitPayload } from '../../shared/net/messages.js';
import { coordKey } from '../../shared/math/vector.js';
import { generateMap } from '../../shared/world/generateMap.js';
import { TileType, WorldGenerationIdentity } from '../../shared/world/mapTypes.js';
import { TileMapView } from '../../shared/world/tileMap.js';

export const CLIENT_TILE_CHUNK_SIZE = 16;

export interface ClientEntity {
  nid: number;
  ntype: number;
  entityId: number;
  kind: NetEntityKind;
  x: number;
  y: number;
  health: number;
  facing: number;
}

export class ClientWorldState {
  readonly entities = new Map<number, ClientEntity>();
  localEntityId = 0;
  mapId = '';
  mapName = '';
  identity: WorldGenerationIdentity | null = null;
  tileMap: TileMapView | null = null;
  mapRevision = 0;
  private readonly tileChunkRevisions = new Map<string, number>();
  private readonly pendingTileCollisionUpdates: Array<{ x: number; y: number }> = [];

  setLocalEntityId(entityId: number): void {
    this.localEntityId = entityId;
  }

  getLocalEntity(): ClientEntity | undefined {
    return Array.from(this.entities.values()).find((entity) => entity.entityId === this.localEntityId);
  }

  applyWorldInit(payload: WorldInitPayload): void {
    const identity = parseWorldInitPayload(payload);
    const generated = generateMap(identity);
    this.mapId = payload.mapId;
    this.mapName = payload.mapName;
    this.identity = identity;
    this.tileMap = new TileMapView(identity.settings.width, identity.settings.height, generated.tiles);
    this.tileChunkRevisions.clear();
    this.pendingTileCollisionUpdates.length = 0;
    this.mapRevision += 1;
  }

  resetForMapTransfer(): void {
    this.entities.clear();
    this.localEntityId = 0;
    this.mapId = '';
    this.mapName = '';
    this.identity = null;
    this.tileMap = null;
    this.tileChunkRevisions.clear();
    this.pendingTileCollisionUpdates.length = 0;
    this.mapRevision += 1;
  }

  applyTileMutation(payload: TileMutationPayload): void {
    if (!this.tileMap) {
      return;
    }

    if (this.tileMap.getTile(payload.x, payload.y) === payload.tile) {
      return;
    }

    this.tileMap.setTile(payload.x, payload.y, payload.tile as TileType);
    this.markTileChunkDirty(payload.x, payload.y);
    this.pendingTileCollisionUpdates.push({ x: payload.x, y: payload.y });
  }

  getTileChunkRevision(chunkX: number, chunkY: number): string {
    return `${this.mapRevision}:${this.tileChunkRevisions.get(coordKey(chunkX, chunkY)) ?? 0}`;
  }

  consumePendingTileCollisionUpdates(): Array<{ x: number; y: number }> {
    return this.pendingTileCollisionUpdates.splice(0);
  }

  upsertEntity(entity: ClientEntity): void {
    const previous = this.entities.get(entity.nid);
    this.entities.set(entity.nid, { ...previous, ...entity });
  }

  patchEntity(nid: number, prop: string, value: unknown): void {
    const entity = this.entities.get(nid);
    if (entity) {
      (entity as unknown as Record<string, unknown>)[prop] = value;
    }
  }

  patchEntityIfAllowed(nid: number, prop: string, value: unknown, shouldApply: (entity: ClientEntity, prop: string) => boolean): void {
    const entity = this.entities.get(nid);
    if (entity && shouldApply(entity, prop)) {
      (entity as unknown as Record<string, unknown>)[prop] = value;
    }
  }

  deleteEntity(nid: number): void {
    this.entities.delete(nid);
  }

  private markTileChunkDirty(tileX: number, tileY: number): void {
    const chunkX = Math.floor(tileX / CLIENT_TILE_CHUNK_SIZE);
    const chunkY = Math.floor(tileY / CLIENT_TILE_CHUNK_SIZE);
    const key = coordKey(chunkX, chunkY);
    this.tileChunkRevisions.set(key, (this.tileChunkRevisions.get(key) ?? 0) + 1);
  }
}
