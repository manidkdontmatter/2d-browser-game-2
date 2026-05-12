// Owns static SKALE collision bodies for dense authoritative tiles.
import type { Body, World as PhysicsWorld } from 'skale-physics';
import { TILE_SIZE } from '../../shared/config.js';
import { chunkCoordinateFromIndex, chunkTileBounds } from '../../shared/world/chunkMath.js';
import { tileIndex } from '../../shared/world/mapTypes.js';
import { TileMapView } from '../../shared/world/tileMap.js';
import { wallLayer } from '../simulation/layers.js';

export class TileCollisionSystem {
  private readonly bodyByTileIndex = new Map<number, Body>();
  private readonly activeChunkIndexes = new Set<number>();

  constructor(
    private readonly tileMap: TileMapView,
    private readonly physics: PhysicsWorld,
  ) {}

  syncActiveChunkIndexes(activeChunkIndexes: ReadonlySet<number>): void {
    for (const chunkIndex of Array.from(this.activeChunkIndexes)) {
      if (!activeChunkIndexes.has(chunkIndex)) {
        this.unloadChunk(chunkIndex);
      }
    }

    for (const chunkIndex of activeChunkIndexes) {
      if (!this.activeChunkIndexes.has(chunkIndex)) {
        this.activeChunkIndexes.add(chunkIndex);
        this.loadChunk(chunkIndex);
      }
    }
  }

  syncTileBody(x: number, y: number): void {
    const index = tileIndex(this.tileMap.width, x, y);
    const existing = this.bodyByTileIndex.get(index);
    const shouldHaveBody = this.activeChunkIndexes.has(this.tileMap.chunkIndexFromTile(x, y)) && this.tileMap.isDense(x, y);

    if (shouldHaveBody && !existing) {
      this.bodyByTileIndex.set(index, this.createStaticTileBody(x, y));
      return;
    }

    if (!shouldHaveBody && existing) {
      this.physics.removeBody(existing);
      this.bodyByTileIndex.delete(index);
    }
  }

  getBodyCount(): number {
    return this.bodyByTileIndex.size;
  }

  private loadChunk(chunkIndex: number): void {
    const chunk = chunkCoordinateFromIndex(this.tileMap.widthChunks, chunkIndex);
    const bounds = chunkTileBounds(this.tileMap.width, this.tileMap.height, chunk.chunkX, chunk.chunkY, this.tileMap.chunkSize);
    for (let y = bounds.startY; y < bounds.endY; y += 1) {
      for (let x = bounds.startX; x < bounds.endX; x += 1) {
        this.syncTileBody(x, y);
      }
    }
  }

  private unloadChunk(chunkIndex: number): void {
    this.activeChunkIndexes.delete(chunkIndex);
    const chunk = chunkCoordinateFromIndex(this.tileMap.widthChunks, chunkIndex);
    const bounds = chunkTileBounds(this.tileMap.width, this.tileMap.height, chunk.chunkX, chunk.chunkY, this.tileMap.chunkSize);
    for (let y = bounds.startY; y < bounds.endY; y += 1) {
      for (let x = bounds.startX; x < bounds.endX; x += 1) {
        const index = tileIndex(this.tileMap.width, x, y);
        const existing = this.bodyByTileIndex.get(index);
        if (existing) {
          this.physics.removeBody(existing);
          this.bodyByTileIndex.delete(index);
        }
      }
    }
  }

  private createStaticTileBody(x: number, y: number): Body {
    return this.physics.createBody({
      type: 'static',
      layer: wallLayer,
      shape: { kind: 'box', x: x * TILE_SIZE, y: y * TILE_SIZE, width: TILE_SIZE, height: TILE_SIZE },
    });
  }
}
