// Defines client preload groups that keep boot-time asset loading explicit and deterministic.
import { assetKeys, type AssetKey } from '../../shared/assets/assetKeys.js';

export const assetGroups = {
  boot: [
    assetKeys.tileGrass,
    assetKeys.tileDirt,
    assetKeys.tileWater,
    assetKeys.tileWall,
  ],
} as const satisfies Record<string, readonly AssetKey[]>;

export type AssetGroupName = keyof typeof assetGroups;
