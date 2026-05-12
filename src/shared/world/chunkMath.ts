// Provides deterministic chunk math helpers for shared tilemap ownership and server-side area activation.
import type { ChunkCoordinate, ChunkDimensions, ChunkTileBounds, TileChunkRect } from './chunkTypes.js';

export const DEFAULT_TILE_CHUNK_SIZE = 16;

export function chunkDimensions(width: number, height: number, chunkSize = DEFAULT_TILE_CHUNK_SIZE): ChunkDimensions {
  return {
    widthChunks: Math.ceil(width / chunkSize),
    heightChunks: Math.ceil(height / chunkSize),
  };
}

export function tileToChunk(x: number, y: number, chunkSize = DEFAULT_TILE_CHUNK_SIZE): ChunkCoordinate {
  return {
    chunkX: Math.floor(x / chunkSize),
    chunkY: Math.floor(y / chunkSize),
  };
}

export function chunkIndexFromChunk(widthChunks: number, chunkX: number, chunkY: number): number {
  return chunkY * widthChunks + chunkX;
}

export function chunkIndexFromTile(widthChunks: number, x: number, y: number, chunkSize = DEFAULT_TILE_CHUNK_SIZE): number {
  const chunk = tileToChunk(x, y, chunkSize);
  return chunkIndexFromChunk(widthChunks, chunk.chunkX, chunk.chunkY);
}

export function chunkCoordinateFromIndex(widthChunks: number, index: number): ChunkCoordinate {
  return {
    chunkX: index % widthChunks,
    chunkY: Math.floor(index / widthChunks),
  };
}

export function localTileIndexInChunk(x: number, y: number, chunkSize = DEFAULT_TILE_CHUNK_SIZE): number {
  const localX = modulo(x, chunkSize);
  const localY = modulo(y, chunkSize);
  return localY * chunkSize + localX;
}

export function tileFromChunkLocal(
  chunkX: number,
  chunkY: number,
  localIndex: number,
  chunkSize = DEFAULT_TILE_CHUNK_SIZE,
): { x: number; y: number } {
  const localX = localIndex % chunkSize;
  const localY = Math.floor(localIndex / chunkSize);
  return {
    x: chunkX * chunkSize + localX,
    y: chunkY * chunkSize + localY,
  };
}

export function chunkTileBounds(
  width: number,
  height: number,
  chunkX: number,
  chunkY: number,
  chunkSize = DEFAULT_TILE_CHUNK_SIZE,
): ChunkTileBounds {
  const startX = Math.max(0, chunkX * chunkSize);
  const startY = Math.max(0, chunkY * chunkSize);
  const endX = Math.min(width, startX + chunkSize);
  const endY = Math.min(height, startY + chunkSize);
  return { startX, startY, endX, endY };
}

export function chunkRectFromTileRect(
  width: number,
  height: number,
  rect: { minX: number; minY: number; maxX: number; maxY: number },
  chunkSize = DEFAULT_TILE_CHUNK_SIZE,
): TileChunkRect {
  const minX = Math.max(0, Math.floor(rect.minX));
  const minY = Math.max(0, Math.floor(rect.minY));
  const maxX = Math.min(width - 1, Math.floor(rect.maxX));
  const maxY = Math.min(height - 1, Math.floor(rect.maxY));
  return {
    minChunkX: Math.floor(minX / chunkSize),
    minChunkY: Math.floor(minY / chunkSize),
    maxChunkX: Math.floor(maxX / chunkSize),
    maxChunkY: Math.floor(maxY / chunkSize),
  };
}

function modulo(value: number, divisor: number): number {
  const remainder = value % divisor;
  return remainder >= 0 ? remainder : remainder + divisor;
}
