// Verifies deterministic procedural generation and authoritative tile mutation overlays.
import { describe, expect, it } from 'vitest';
import { createWorldIdentity, generateMap } from '../../src/shared/world/generateMap.js';
import { TileType } from '../../src/shared/world/mapTypes.js';
import { TileMapView } from '../../src/shared/world/tileMap.js';

describe('procedural map generation', () => {
  it('generates the same tile data for the same identity', () => {
    const identity = createWorldIdentity('repeatable');
    const a = generateMap(identity);
    const b = generateMap(identity);

    expect(Array.from(a.tiles)).toEqual(Array.from(b.tiles));
  });

  it('uses grass, dirt, water, and wall tiles in open-world maps', () => {
    const map = generateMap(createWorldIdentity('terrain-variety'));
    const uniqueTiles = new Set(map.tiles);

    expect(uniqueTiles.has(TileType.Grass)).toBe(true);
    expect(uniqueTiles.has(TileType.Dirt)).toBe(true);
    expect(uniqueTiles.has(TileType.Water)).toBe(true);
    expect(uniqueTiles.has(TileType.Wall)).toBe(true);
  });

  it('applies tile mutations over baseline tiles', () => {
    const map = generateMap(createWorldIdentity('mutations'));
    const view = new TileMapView(map.identity.settings.width, map.identity.settings.height, map.tiles);
    const baseline = view.getTile(1, 1);
    const replacement = baseline === TileType.Wall ? TileType.Dirt : TileType.Wall;

    view.setTile(1, 1, replacement);
    expect(view.getTile(1, 1)).toBe(replacement);
    expect(view.exportMutations()).toContainEqual({ x: 1, y: 1, tile: replacement });
  });

  it('tracks chunk mutation ownership and removes overlays when returning to baseline', () => {
    const map = generateMap(createWorldIdentity('chunk-ownership'));
    const view = new TileMapView(map.identity.settings.width, map.identity.settings.height, map.tiles);
    const baseline = view.getTile(10, 10);
    const replacement = baseline === TileType.Wall ? TileType.Dirt : TileType.Wall;
    const chunk = view.tileToChunk(10, 10);

    view.setTile(10, 10, replacement);
    expect(view.getChunkMutationCount(chunk.x, chunk.y)).toBe(1);
    expect(view.getChunkRevision(chunk.x, chunk.y)).toBeGreaterThan(0);

    view.setTile(10, 10, baseline);
    expect(view.getTile(10, 10)).toBe(baseline);
    expect(view.getChunkMutationCount(chunk.x, chunk.y)).toBe(0);
    expect(view.exportMutations()).toEqual([]);
  });
});
