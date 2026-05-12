// Verifies protocol payload helpers preserve deterministic world identity data.
import { describe, expect, it } from 'vitest';
import { worldIdentityToInitPayload, parseWorldInitPayload, tileMutationToPayload } from '../../src/shared/net/messages.js';
import { createWorldIdentity } from '../../src/shared/world/generateMap.js';
import { TileType } from '../../src/shared/world/mapTypes.js';

describe('network message payload helpers', () => {
  it('round-trips world identity through the init payload shape', () => {
    const identity = createWorldIdentity('network-seed');
    const payload = worldIdentityToInitPayload(identity);

    expect(parseWorldInitPayload(payload)).toEqual(identity);
    expect(payload.mapId).toBe('default');
    expect(payload.mapName).toBe('Default Map');
    expect(payload.width).toBe(identity.settings.width);
    expect(payload.height).toBe(identity.settings.height);
  });

  it('serializes tile mutations for protocol messages', () => {
    expect(tileMutationToPayload({ x: 3, y: 4, tile: TileType.Wall })).toEqual({
      x: 3,
      y: 4,
      tile: TileType.Wall,
    });
  });
});
