// Defines the manager-owned test map processes and their local runtime endpoints.
import type { WorldGenerationSettings } from '../../shared/world/mapTypes.js';

export interface ManagedMapConfig {
  id: string;
  name: string;
  seed: string;
  generation: Partial<WorldGenerationSettings>;
  port: number;
  dbPath: string;
  targetMapId: string;
}

export const managedMaps: ManagedMapConfig[] = [
  {
    id: 'test-map-a',
    name: 'Test Map A',
    seed: 'test-map-a-open-fields',
    generation: {
      profile: 'grasslands',
      waterPatchCount: 7,
      waterPatchRadiusMin: 3,
      waterPatchRadiusMax: 7,
      dirtPatchCount: 14,
      dirtPatchRadiusMin: 4,
      dirtPatchRadiusMax: 10,
      rockClusterCount: 22,
      rockClusterRadiusMin: 2,
      rockClusterRadiusMax: 4,
      rockDensity: 0.32,
    },
    port: 9001,
    dbPath: 'data/test-map-a.sqlite',
    targetMapId: 'test-map-b',
  },
  {
    id: 'test-map-b',
    name: 'Test Map B',
    seed: 'test-map-b-wet-basin',
    generation: {
      profile: 'wetlands',
      waterPatchCount: 14,
      waterPatchRadiusMin: 4,
      waterPatchRadiusMax: 11,
      dirtPatchCount: 24,
      dirtPatchRadiusMin: 5,
      dirtPatchRadiusMax: 14,
      rockClusterCount: 34,
      rockClusterRadiusMin: 2,
      rockClusterRadiusMax: 6,
      rockDensity: 0.44,
    },
    port: 9002,
    dbPath: 'data/test-map-b.sqlite',
    targetMapId: 'test-map-a',
  },
];

export function findManagedMap(id: string): ManagedMapConfig | undefined {
  return managedMaps.find((map) => map.id === id);
}

export function mapWebSocketUrl(map: ManagedMapConfig, host = '127.0.0.1'): string {
  return `ws://${host}:${map.port}`;
}
