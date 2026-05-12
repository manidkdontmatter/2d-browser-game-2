// Defines deterministic tilemap data structures shared by server, client, tests, and persistence.
export enum TileType {
  Grass = 0,
  Dirt = 1,
  Water = 2,
  Wall = 3,
}

export type WorldGeneratorProfile = 'grasslands' | 'wetlands';

export interface WorldGenerationSettings {
  width: number;
  height: number;
  profile: WorldGeneratorProfile;
  waterPatchCount: number;
  waterPatchRadiusMin: number;
  waterPatchRadiusMax: number;
  dirtPatchCount: number;
  dirtPatchRadiusMin: number;
  dirtPatchRadiusMax: number;
  rockClusterCount: number;
  rockClusterRadiusMin: number;
  rockClusterRadiusMax: number;
  rockDensity: number;
}

export interface WorldGenerationIdentity {
  seed: string;
  generatorVersion: number;
  settings: WorldGenerationSettings;
}

export interface GeneratedMap {
  identity: WorldGenerationIdentity;
  tiles: Uint8Array;
}

export interface TileMutation {
  x: number;
  y: number;
  tile: TileType;
}

export function tileIndex(width: number, x: number, y: number): number {
  return y * width + x;
}

export function inBounds(width: number, height: number, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < width && y < height;
}
