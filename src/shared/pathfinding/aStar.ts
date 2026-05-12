// Implements deterministic grid A* pathfinding against the shared tilemap abstraction.
import { TileMapView } from '../world/tileMap.js';

export interface GridPoint {
  x: number;
  y: number;
}

interface SearchNode extends GridPoint {
  g: number;
  f: number;
  parent: SearchNode | null;
}

export interface AStarOptions {
  maxExpandedNodes?: number;
}

export function findPath(map: TileMapView, start: GridPoint, goal: GridPoint, options: AStarOptions = {}): GridPoint[] {
  if (!map.isWalkable(goal.x, goal.y)) {
    return [];
  }

  const maxExpandedNodes = options.maxExpandedNodes ?? 600;
  const open: SearchNode[] = [{ ...start, g: 0, f: heuristic(start, goal), parent: null }];
  const best = new Map<string, number>([[key(start), 0]]);
  let expanded = 0;

  while (open.length > 0 && expanded < maxExpandedNodes) {
    open.sort((a, b) => a.f - b.f);
    const current = open.shift();
    if (!current) {
      break;
    }

    if (current.x === goal.x && current.y === goal.y) {
      return unwind(current);
    }

    expanded += 1;
    for (const next of neighbors(current)) {
      if (!map.isWalkable(next.x, next.y)) {
        continue;
      }

      const g = current.g + 1;
      const nextKey = key(next);
      const known = best.get(nextKey);
      if (known !== undefined && known <= g) {
        continue;
      }

      best.set(nextKey, g);
      open.push({
        ...next,
        g,
        f: g + heuristic(next, goal),
        parent: current,
      });
    }
  }

  return [];
}

function neighbors(point: GridPoint): GridPoint[] {
  return [
    { x: point.x + 1, y: point.y },
    { x: point.x - 1, y: point.y },
    { x: point.x, y: point.y + 1 },
    { x: point.x, y: point.y - 1 },
  ];
}

function heuristic(a: GridPoint, b: GridPoint): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function key(point: GridPoint): string {
  return `${point.x},${point.y}`;
}

function unwind(node: SearchNode): GridPoint[] {
  const path: GridPoint[] = [];
  let current: SearchNode | null = node;
  while (current) {
    path.push({ x: current.x, y: current.y });
    current = current.parent;
  }
  return path.reverse();
}
