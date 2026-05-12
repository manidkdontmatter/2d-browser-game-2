// Generates deterministic open-world terrain maps from seed/version/settings.
import { GENERATOR_VERSION, TEST_MAP_HEIGHT, TEST_MAP_WIDTH } from '../config.js';
import { Mulberry32 } from './prng.js';
import {
  GeneratedMap,
  TileType,
  WorldGenerationIdentity,
  WorldGenerationSettings,
  inBounds,
  tileIndex,
} from './mapTypes.js';

interface Patch {
  x: number;
  y: number;
  radiusX: number;
  radiusY: number;
}

export const defaultGenerationSettings: WorldGenerationSettings = {
  width: TEST_MAP_WIDTH,
  height: TEST_MAP_HEIGHT,
  profile: 'grasslands',
  waterPatchCount: 8,
  waterPatchRadiusMin: 3,
  waterPatchRadiusMax: 8,
  dirtPatchCount: 18,
  dirtPatchRadiusMin: 4,
  dirtPatchRadiusMax: 12,
  rockClusterCount: 28,
  rockClusterRadiusMin: 2,
  rockClusterRadiusMax: 5,
  rockDensity: 0.38,
};

export function createWorldIdentity(
  seed = 'test-seed-001',
  settings: Partial<WorldGenerationSettings> = {},
): WorldGenerationIdentity {
  return {
    seed,
    generatorVersion: GENERATOR_VERSION,
    settings: { ...defaultGenerationSettings, ...settings },
  };
}

export function generateMap(identity: WorldGenerationIdentity): GeneratedMap {
  const settings = identity.settings;
  const tiles = new Uint8Array(settings.width * settings.height);
  tiles.fill(TileType.Grass);
  const rng = new Mulberry32(`${identity.generatorVersion}:${identity.seed}:${settings.profile}`);

  paintPatches(tiles, settings, rng, TileType.Dirt, settings.dirtPatchCount, settings.dirtPatchRadiusMin, settings.dirtPatchRadiusMax);
  paintPatches(tiles, settings, rng, TileType.Water, settings.waterPatchCount, settings.waterPatchRadiusMin, settings.waterPatchRadiusMax);
  paintRockClusters(tiles, settings, rng);
  carveGuaranteedSpawnArea(tiles, settings);
  ensureTerrainDiversity(tiles, settings);
  addBorderRocks(tiles, settings);

  return { identity, tiles };
}

function paintPatches(
  tiles: Uint8Array,
  settings: WorldGenerationSettings,
  rng: Mulberry32,
  tile: TileType,
  count: number,
  radiusMin: number,
  radiusMax: number,
): void {
  for (let i = 0; i < count; i += 1) {
    const patch = randomPatch(settings, rng, radiusMin, radiusMax);
    forEachPatchTile(settings, patch, (x, y, falloff) => {
      const noise = rng.next();
      if (falloff + noise * 0.28 <= 1) {
        setTile(tiles, settings, x, y, tile);
      }
    });
  }
}

function paintRockClusters(tiles: Uint8Array, settings: WorldGenerationSettings, rng: Mulberry32): void {
  for (let i = 0; i < settings.rockClusterCount; i += 1) {
    const patch = randomPatch(settings, rng, settings.rockClusterRadiusMin, settings.rockClusterRadiusMax);
    forEachPatchTile(settings, patch, (x, y, falloff) => {
      const centerBias = 1 - falloff;
      if (rng.next() < settings.rockDensity * (0.35 + centerBias)) {
        setTile(tiles, settings, x, y, TileType.Wall);
      }
    });
  }
}

function randomPatch(
  settings: WorldGenerationSettings,
  rng: Mulberry32,
  radiusMin: number,
  radiusMax: number,
): Patch {
  const radiusX = rng.int(radiusMin, radiusMax);
  const radiusY = rng.int(radiusMin, radiusMax);
  return {
    x: rng.int(2 + radiusX, settings.width - radiusX - 3),
    y: rng.int(2 + radiusY, settings.height - radiusY - 3),
    radiusX,
    radiusY,
  };
}

function forEachPatchTile(
  settings: WorldGenerationSettings,
  patch: Patch,
  visit: (x: number, y: number, falloff: number) => void,
): void {
  for (let y = patch.y - patch.radiusY; y <= patch.y + patch.radiusY; y += 1) {
    for (let x = patch.x - patch.radiusX; x <= patch.x + patch.radiusX; x += 1) {
      if (!inBounds(settings.width, settings.height, x, y)) {
        continue;
      }

      const dx = (x - patch.x) / patch.radiusX;
      const dy = (y - patch.y) / patch.radiusY;
      const falloff = Math.sqrt(dx * dx + dy * dy);
      if (falloff <= 1) {
        visit(x, y, falloff);
      }
    }
  }
}

function carveGuaranteedSpawnArea(tiles: Uint8Array, settings: WorldGenerationSettings): void {
  const centerX = Math.floor(settings.width / 2);
  const centerY = Math.floor(settings.height / 2);
  for (let y = centerY - 5; y <= centerY + 5; y += 1) {
    for (let x = centerX - 5; x <= centerX + 5; x += 1) {
      const distance = Math.hypot(x - centerX, y - centerY);
      if (distance <= 5) {
        setTile(tiles, settings, x, y, TileType.Grass);
      }
    }
  }
}

function ensureTerrainDiversity(tiles: Uint8Array, settings: WorldGenerationSettings): void {
  paintDisk(tiles, settings, Math.floor(settings.width * 0.25), Math.floor(settings.height * 0.25), 2, TileType.Dirt);
  paintDisk(tiles, settings, Math.floor(settings.width * 0.75), Math.floor(settings.height * 0.25), 2, TileType.Water);
}

function paintDisk(
  tiles: Uint8Array,
  settings: WorldGenerationSettings,
  centerX: number,
  centerY: number,
  radius: number,
  tile: TileType,
): void {
  for (let y = centerY - radius; y <= centerY + radius; y += 1) {
    for (let x = centerX - radius; x <= centerX + radius; x += 1) {
      if (Math.hypot(x - centerX, y - centerY) <= radius) {
        setTile(tiles, settings, x, y, tile);
      }
    }
  }
}

function addBorderRocks(tiles: Uint8Array, settings: WorldGenerationSettings): void {
  for (let x = 0; x < settings.width; x += 1) {
    setTile(tiles, settings, x, 0, TileType.Wall);
    setTile(tiles, settings, x, settings.height - 1, TileType.Wall);
  }
  for (let y = 0; y < settings.height; y += 1) {
    setTile(tiles, settings, 0, y, TileType.Wall);
    setTile(tiles, settings, settings.width - 1, y, TileType.Wall);
  }
}

function setTile(tiles: Uint8Array, settings: WorldGenerationSettings, x: number, y: number, tile: TileType): void {
  if (inBounds(settings.width, settings.height, x, y)) {
    tiles[tileIndex(settings.width, x, y)] = tile;
  }
}
