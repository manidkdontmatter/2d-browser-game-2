// Defines data-driven tile properties used by simulation, pathfinding, collision, and rendering.
import { assetKeys, type AssetKey } from '../assets/assetKeys.js';
import { TileType } from './mapTypes.js';

export interface TileDefinition {
  id: TileType;
  key: string;
  assetKey: AssetKey;
  walkable: boolean;
  dense: boolean;
  durability: number | null;
}

export const tileDefinitions: Readonly<Partial<Record<TileType, TileDefinition>>> = {
  [TileType.Grass]: {
    id: TileType.Grass,
    key: 'grass',
    assetKey: assetKeys.tileGrass,
    walkable: true,
    dense: false,
    durability: null,
  },
  [TileType.Dirt]: {
    id: TileType.Dirt,
    key: 'dirt',
    assetKey: assetKeys.tileDirt,
    walkable: true,
    dense: false,
    durability: null,
  },
  [TileType.Water]: {
    id: TileType.Water,
    key: 'water',
    assetKey: assetKeys.tileWater,
    walkable: true,
    dense: false,
    durability: null,
  },
  [TileType.Wall]: {
    id: TileType.Wall,
    key: 'wall',
    assetKey: assetKeys.tileWall,
    walkable: false,
    dense: true,
    durability: 100,
  },
};

export const renderableTileTypes = [
  TileType.Grass,
  TileType.Dirt,
  TileType.Water,
  TileType.Wall,
] as const;

export function getTileDefinition(tile: TileType): TileDefinition {
  return tileDefinitions[tile] ?? tileDefinitions[TileType.Wall]!;
}
