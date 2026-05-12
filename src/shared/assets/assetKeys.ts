// Defines stable logical asset keys shared by gameplay data and client presentation code.
export const assetKeys = {
  tileGrass: 'tile.grass',
  tileDirt: 'tile.dirt',
  tileWater: 'tile.water',
  tileWall: 'tile.wall',
} as const;

export type AssetKey = (typeof assetKeys)[keyof typeof assetKeys];
