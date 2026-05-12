// Verifies grid A* pathfinding against walkable and blocked tilemaps.
import { describe, expect, it } from 'vitest';
import { findPath } from '../../src/shared/pathfinding/aStar.js';
import { TileType } from '../../src/shared/world/mapTypes.js';
import { TileMapView } from '../../src/shared/world/tileMap.js';

describe('A* pathfinding', () => {
  it('finds a route around walls', () => {
    const tiles = new Uint8Array(25);
    tiles.fill(TileType.Grass);
    const map = new TileMapView(5, 5, tiles);
    map.setTile(2, 1, TileType.Wall);
    map.setTile(2, 2, TileType.Wall);
    map.setTile(2, 3, TileType.Wall);

    const path = findPath(map, { x: 1, y: 2 }, { x: 3, y: 2 }, { maxExpandedNodes: 50 });

    expect(path.at(0)).toEqual({ x: 1, y: 2 });
    expect(path.at(-1)).toEqual({ x: 3, y: 2 });
    expect(path).not.toContainEqual({ x: 2, y: 2 });
  });

  it('returns no route when the goal is blocked', () => {
    const tiles = new Uint8Array(9);
    tiles.fill(TileType.Grass);
    const map = new TileMapView(3, 3, tiles);
    map.setTile(2, 2, TileType.Wall);

    expect(findPath(map, { x: 0, y: 0 }, { x: 2, y: 2 })).toEqual([]);
  });
});
