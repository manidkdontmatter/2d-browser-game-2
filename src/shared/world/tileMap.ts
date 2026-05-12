// Applies authoritative tile mutations over deterministic baseline maps and supports spatial mutation queries.
import { TILE_SIZE } from '../config.js';
import {
  DEFAULT_TILE_CHUNK_SIZE,
  chunkCoordinateFromIndex,
  chunkDimensions,
  chunkIndexFromTile as chunkIndexFromTileCoord,
  chunkRectFromTileRect,
  localTileIndexInChunk,
  tileFromChunkLocal,
  tileToChunk as tileToChunkCoord,
} from './chunkMath.js';
import type { TileMutation } from './mapTypes.js';
import { TileType, inBounds, tileIndex } from './mapTypes.js';
import type { TileDefinition } from './tileDefinitions.js';
import { getTileDefinition } from './tileDefinitions.js';

export interface TileRect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface TilePoint {
  x: number;
  y: number;
}

export interface TileQueryResult {
  x: number;
  y: number;
  tile: TileType;
  definition: TileDefinition;
}

export class TileMapView {
  readonly width: number;
  readonly height: number;
  readonly baseline: Uint8Array;
  readonly chunkSize: number;
  readonly widthChunks: number;
  readonly heightChunks: number;
  private readonly mutationsByChunkIndex = new Map<number, Map<number, TileType>>();
  private readonly chunkRevisionByIndex: Uint32Array;
  private readonly chunkMutationCountByIndex: Uint32Array;

  constructor(width: number, height: number, baseline: Uint8Array, mutations: TileMutation[] = [], chunkSize = DEFAULT_TILE_CHUNK_SIZE) {
    this.width = width;
    this.height = height;
    this.baseline = baseline;
    this.chunkSize = chunkSize;
    const dims = chunkDimensions(width, height, chunkSize);
    this.widthChunks = dims.widthChunks;
    this.heightChunks = dims.heightChunks;
    this.chunkRevisionByIndex = new Uint32Array(this.widthChunks * this.heightChunks);
    this.chunkMutationCountByIndex = new Uint32Array(this.widthChunks * this.heightChunks);

    for (const mutation of mutations) {
      this.setTile(mutation.x, mutation.y, mutation.tile);
    }
  }

  getTile(x: number, y: number): TileType {
    if (!inBounds(this.width, this.height, x, y)) {
      return TileType.Wall;
    }

    const mutation = this.getMutationAt(x, y);
    if (mutation !== undefined) {
      return mutation;
    }

    return this.baseline[tileIndex(this.width, x, y)] as TileType;
  }

  setTile(x: number, y: number, tile: TileType): void {
    if (!inBounds(this.width, this.height, x, y)) {
      return;
    }

    const chunkIndex = this.chunkIndexFromTile(x, y);
    const localIndex = localTileIndexInChunk(x, y, this.chunkSize);
    const baselineTile = this.baseline[tileIndex(this.width, x, y)] as TileType;
    const existingChunkMutations = this.mutationsByChunkIndex.get(chunkIndex);
    const existing = existingChunkMutations?.get(localIndex);
    const current = existing ?? baselineTile;

    if (current === tile) {
      return;
    }

    if (tile === baselineTile) {
      if (!existingChunkMutations) {
        return;
      }

      if (existingChunkMutations.delete(localIndex)) {
        this.chunkMutationCountByIndex[chunkIndex] = Math.max(0, this.chunkMutationCountByIndex[chunkIndex] - 1);
      }
      if (existingChunkMutations.size === 0) {
        this.mutationsByChunkIndex.delete(chunkIndex);
      }
    } else {
      const chunkMutations = existingChunkMutations ?? this.ensureChunkMutations(chunkIndex);
      if (!chunkMutations.has(localIndex)) {
        this.chunkMutationCountByIndex[chunkIndex] += 1;
      }
      chunkMutations.set(localIndex, tile);
    }

    this.chunkRevisionByIndex[chunkIndex] += 1;
  }

  getDefinition(x: number, y: number): TileDefinition {
    return getTileDefinition(this.getTile(x, y));
  }

  isWalkable(x: number, y: number): boolean {
    return this.getDefinition(x, y).walkable;
  }

  isDense(x: number, y: number): boolean {
    return this.getDefinition(x, y).dense;
  }

  worldToTile(x: number, y: number, tileSize = TILE_SIZE): TilePoint {
    return {
      x: Math.floor(x / tileSize),
      y: Math.floor(y / tileSize),
    };
  }

  tileToWorldCenter(x: number, y: number, tileSize = TILE_SIZE): TilePoint {
    return {
      x: x * tileSize + tileSize / 2,
      y: y * tileSize + tileSize / 2,
    };
  }

  queryRectTiles(rect: TileRect): TileQueryResult[] {
    const minX = Math.max(0, Math.floor(rect.minX));
    const minY = Math.max(0, Math.floor(rect.minY));
    const maxX = Math.min(this.width - 1, Math.floor(rect.maxX));
    const maxY = Math.min(this.height - 1, Math.floor(rect.maxY));
    const results: TileQueryResult[] = [];

    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const tile = this.getTile(x, y);
        results.push({ x, y, tile, definition: getTileDefinition(tile) });
      }
    }

    return results;
  }

  exportMutations(): TileMutation[] {
    const mutations: TileMutation[] = [];
    for (const [chunkIndex, chunkMutations] of this.mutationsByChunkIndex) {
      const chunk = chunkCoordinateFromIndex(this.widthChunks, chunkIndex);
      for (const [localIndex, tile] of chunkMutations) {
        const { x, y } = tileFromChunkLocal(chunk.chunkX, chunk.chunkY, localIndex, this.chunkSize);
        if (inBounds(this.width, this.height, x, y)) {
          mutations.push({ x, y, tile });
        }
      }
    }
    return mutations;
  }

  exportMutationsInRect(rect: TileRect): TileMutation[] {
    const minX = Math.max(0, Math.floor(rect.minX));
    const minY = Math.max(0, Math.floor(rect.minY));
    const maxX = Math.min(this.width - 1, Math.floor(rect.maxX));
    const maxY = Math.min(this.height - 1, Math.floor(rect.maxY));
    const mutations: TileMutation[] = [];

    const chunkRect = chunkRectFromTileRect(this.width, this.height, rect, this.chunkSize);

    for (let chunkY = chunkRect.minChunkY; chunkY <= chunkRect.maxChunkY; chunkY += 1) {
      for (let chunkX = chunkRect.minChunkX; chunkX <= chunkRect.maxChunkX; chunkX += 1) {
        const chunkIndex = this.chunkIndexFromChunk(chunkX, chunkY);
        const chunkMutations = this.mutationsByChunkIndex.get(chunkIndex);
        if (!chunkMutations) {
          continue;
        }

        for (const [localIndex, tile] of chunkMutations) {
          const { x, y } = tileFromChunkLocal(chunkX, chunkY, localIndex, this.chunkSize);
          if (x >= minX && x <= maxX && y >= minY && y <= maxY) {
            mutations.push({ x, y, tile });
          }
        }
      }
    }

    return mutations;
  }

  getChunkRevision(chunkX: number, chunkY: number): number {
    if (chunkX < 0 || chunkY < 0 || chunkX >= this.widthChunks || chunkY >= this.heightChunks) {
      return 0;
    }

    return this.chunkRevisionByIndex[this.chunkIndexFromChunk(chunkX, chunkY)];
  }

  getChunkMutationCount(chunkX: number, chunkY: number): number {
    if (chunkX < 0 || chunkY < 0 || chunkX >= this.widthChunks || chunkY >= this.heightChunks) {
      return 0;
    }

    return this.chunkMutationCountByIndex[this.chunkIndexFromChunk(chunkX, chunkY)];
  }

  getChunkMutations(chunkX: number, chunkY: number): TileMutation[] {
    if (chunkX < 0 || chunkY < 0 || chunkX >= this.widthChunks || chunkY >= this.heightChunks) {
      return [];
    }

    const chunkIndex = this.chunkIndexFromChunk(chunkX, chunkY);
    const chunkMutations = this.mutationsByChunkIndex.get(chunkIndex);
    if (!chunkMutations) {
      return [];
    }

    const mutations: TileMutation[] = [];
    for (const [localIndex, tile] of chunkMutations) {
      const { x, y } = tileFromChunkLocal(chunkX, chunkY, localIndex, this.chunkSize);
      if (inBounds(this.width, this.height, x, y)) {
        mutations.push({ x, y, tile });
      }
    }
    return mutations;
  }

  tileToChunk(x: number, y: number): TilePoint {
    const chunk = tileToChunkCoord(x, y, this.chunkSize);
    return { x: chunk.chunkX, y: chunk.chunkY };
  }

  chunkIndexFromTile(x: number, y: number): number {
    return chunkIndexFromTileCoord(this.widthChunks, x, y, this.chunkSize);
  }

  chunkIndexFromChunk(chunkX: number, chunkY: number): number {
    return chunkY * this.widthChunks + chunkX;
  }

  private ensureChunkMutations(chunkIndex: number): Map<number, TileType> {
    const existing = this.mutationsByChunkIndex.get(chunkIndex);
    if (existing) {
      return existing;
    }

    const created = new Map<number, TileType>();
    this.mutationsByChunkIndex.set(chunkIndex, created);
    return created;
  }

  private getMutationAt(x: number, y: number): TileType | undefined {
    const chunkMutations = this.mutationsByChunkIndex.get(this.chunkIndexFromTile(x, y));
    if (!chunkMutations) {
      return undefined;
    }
    return chunkMutations.get(localTileIndexInChunk(x, y, this.chunkSize));
  }
}
