// Loads, caches, and resolves client assets through a single runtime boundary.
import { Assets, Texture } from 'pixi.js';
import { assetGroups, type AssetGroupName } from './assetGroups.js';
import { clientAssetManifest, type ClientAssetManifestEntry } from './assetManifest.js';
import type { AssetKey } from '../../shared/assets/assetKeys.js';

type LoadedAsset = Texture;

export class AssetLoader {
  private readonly cache = new Map<AssetKey, LoadedAsset>();
  private readonly inFlight = new Map<AssetKey, Promise<LoadedAsset>>();

  constructor(private readonly manifest: Readonly<Record<AssetKey, ClientAssetManifestEntry>> = clientAssetManifest) {}

  has(key: AssetKey): boolean {
    return this.cache.has(key);
  }

  resolve(key: AssetKey): ClientAssetManifestEntry {
    const entry = this.manifest[key];
    if (!entry) {
      throw new Error(`Missing asset manifest entry for key ${key}`);
    }
    return entry;
  }

  getTexture(key: AssetKey): Texture | undefined {
    return this.cache.get(key);
  }

  async loadTexture(key: AssetKey): Promise<Texture> {
    const loaded = await this.load(key);
    if (!(loaded instanceof Texture)) {
      throw new Error(`Asset ${key} did not resolve to a texture`);
    }
    return loaded;
  }

  async preload(keys: readonly AssetKey[]): Promise<void> {
    await Promise.all(keys.map((key) => this.loadTexture(key)));
  }

  async preloadGroup(groupName: AssetGroupName): Promise<void> {
    await this.preload(assetGroups[groupName]);
  }

  private async load(key: AssetKey): Promise<LoadedAsset> {
    const cached = this.cache.get(key);
    if (cached) {
      return cached;
    }

    const existing = this.inFlight.get(key);
    if (existing) {
      return existing;
    }

    const entry = this.resolve(key);
    const promise = this.loadEntry(key, entry).then((loaded) => {
      this.cache.set(key, loaded);
      this.inFlight.delete(key);
      return loaded;
    }).catch((error: unknown) => {
      this.inFlight.delete(key);
      throw error;
    });

    this.inFlight.set(key, promise);
    return promise;
  }

  private async loadEntry(key: AssetKey, entry: ClientAssetManifestEntry): Promise<LoadedAsset> {
    switch (entry.kind) {
      case 'texture':
        return Assets.load<Texture>(entry.src);
      default: {
        throw new Error(`Unsupported asset kind for key ${key}`);
      }
    }
  }
}
