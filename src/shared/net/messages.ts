// Defines shared message payloads exchanged during world initialization and tile replication.
import type { TileMutation, WorldGenerationIdentity } from '../world/mapTypes.js';

export interface WorldInitPayload {
  mapId: string;
  mapName: string;
  seed: string;
  generatorVersion: number;
  width: number;
  height: number;
  settingsJson: string;
}

export interface MapTransferPayload {
  targetMapId: string;
  targetMapName: string;
  targetUrl: string;
  token: string;
}

export interface TileMutationPayload {
  x: number;
  y: number;
  tile: number;
}

export function worldIdentityToInitPayload(
  identity: WorldGenerationIdentity,
  map = { id: 'default', name: 'Default Map' },
): WorldInitPayload {
  return {
    mapId: map.id,
    mapName: map.name,
    seed: identity.seed,
    generatorVersion: identity.generatorVersion,
    width: identity.settings.width,
    height: identity.settings.height,
    settingsJson: JSON.stringify(identity.settings),
  };
}

export function parseWorldInitPayload(payload: WorldInitPayload): WorldGenerationIdentity {
  return {
    seed: payload.seed,
    generatorVersion: payload.generatorVersion,
    settings: JSON.parse(payload.settingsJson) as WorldGenerationIdentity['settings'],
  };
}

export function tileMutationToPayload(mutation: TileMutation): TileMutationPayload {
  return {
    x: mutation.x,
    y: mutation.y,
    tile: mutation.tile,
  };
}
