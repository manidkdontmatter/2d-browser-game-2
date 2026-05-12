// Defines shared chunk-coordinate and chunk-bounds types used by world storage and simulation activation.
export interface ChunkCoordinate {
  chunkX: number;
  chunkY: number;
}

export interface ChunkDimensions {
  widthChunks: number;
  heightChunks: number;
}

export interface ChunkTileBounds {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

export interface TileChunkRect {
  minChunkX: number;
  minChunkY: number;
  maxChunkX: number;
  maxChunkY: number;
}
