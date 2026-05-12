// Verifies client replicated world state is initialized from server-owned world messages.
import { describe, expect, it } from 'vitest';
import { ClientWorldState } from '../../src/client/game/clientWorldState.js';
import { worldIdentityToInitPayload } from '../../src/shared/net/messages.js';
import { NetEntityKind } from '../../src/shared/domain/snapshots.js';
import { createWorldIdentity, generateMap } from '../../src/shared/world/generateMap.js';
import { TileType } from '../../src/shared/world/mapTypes.js';

describe('client world state', () => {
  it('builds the same baseline map from the server world init payload', () => {
    const identity = createWorldIdentity('client-server-seed');
    const expected = generateMap(identity);
    const state = new ClientWorldState();

    state.applyWorldInit(worldIdentityToInitPayload(identity, { id: 'test-map-a', name: 'Test Map A' }));

    expect(state.identity).toEqual(identity);
    expect(state.mapId).toBe('test-map-a');
    expect(state.mapName).toBe('Test Map A');
    expect(state.tileMap?.width).toBe(identity.settings.width);
    expect(state.tileMap?.height).toBe(identity.settings.height);
    expect(Array.from(state.tileMap?.baseline ?? [])).toEqual(Array.from(expected.tiles));
  });

  it('applies server tile mutations over the deterministic baseline', () => {
    const state = new ClientWorldState();
    state.applyWorldInit(worldIdentityToInitPayload(createWorldIdentity('client-mutations')));
    const beforeMapRevision = state.mapRevision;
    const beforeChunkRevision = state.getTileChunkRevision(0, 0);
    const beforeTile = state.tileMap?.getTile(1, 1);
    const replacement = beforeTile === TileType.Wall ? TileType.Dirt : TileType.Wall;
    state.applyTileMutation({ x: 1, y: 1, tile: replacement });

    expect(state.tileMap?.getTile(1, 1)).toBe(replacement);
    expect(state.mapRevision).toBe(beforeMapRevision);
    expect(state.getTileChunkRevision(0, 0)).not.toBe(beforeChunkRevision);
    expect(state.consumePendingTileCollisionUpdates()).toEqual([{ x: 1, y: 1 }]);
  });

  it('ignores tile mutations received before a map is initialized', () => {
    const state = new ClientWorldState();
    const beforeMapRevision = state.mapRevision;

    state.applyTileMutation({ x: 1, y: 1, tile: TileType.Wall });

    expect(state.tileMap).toBeNull();
    expect(state.mapRevision).toBe(beforeMapRevision);
    expect(state.consumePendingTileCollisionUpdates()).toEqual([]);
  });

  it('clears map-local state before reconnecting to another map runtime', () => {
    const state = new ClientWorldState();
    state.applyWorldInit(worldIdentityToInitPayload(createWorldIdentity('client-transfer'), { id: 'old-map', name: 'Old Map' }));
    state.setLocalEntityId(42);
    state.upsertEntity({ nid: 1, ntype: 2, entityId: 42, kind: NetEntityKind.Body, x: 10, y: 20, health: 100, facing: 1 });

    state.resetForMapTransfer();

    expect(state.localEntityId).toBe(0);
    expect(state.mapId).toBe('');
    expect(state.mapName).toBe('');
    expect(state.identity).toBeNull();
    expect(state.tileMap).toBeNull();
    expect(state.entities.size).toBe(0);
  });
});
