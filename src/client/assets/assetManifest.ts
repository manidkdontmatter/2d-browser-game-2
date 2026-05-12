// Maps shared logical asset keys to concrete client-side asset sources.
import { assetKeys, type AssetKey } from '../../shared/assets/assetKeys.js';
import dirtTileUrl from './tiles/dirt.png';
import grassTileUrl from './tiles/grass.png';
import wallTileUrl from './tiles/wall.png';
import waterTileUrl from './tiles/water.png';

export type ClientAssetKind = 'texture';

export interface ClientAssetManifestEntry {
  readonly kind: ClientAssetKind;
  readonly src: string;
}

export const clientAssetManifest = {
  [assetKeys.tileGrass]: {
    kind: 'texture',
    src: grassTileUrl,
  },
  [assetKeys.tileDirt]: {
    kind: 'texture',
    src: dirtTileUrl,
  },
  [assetKeys.tileWater]: {
    kind: 'texture',
    src: waterTileUrl,
  },
  [assetKeys.tileWall]: {
    kind: 'texture',
    src: wallTileUrl,
  },
} as const satisfies Record<AssetKey, ClientAssetManifestEntry>;
