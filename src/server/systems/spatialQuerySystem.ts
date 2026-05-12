// Maintains a deterministic grid index of authoritative entities for fast nearest-in-radius spatial queries.
import { query } from 'bitecs';
import { TILE_SIZE } from '../../shared/config.js';
import { ControllerKind } from '../../shared/domain/commands.js';
import { Active, Health, Identity, MindLink, Position } from '../simulation/components.js';
import { isAlive } from '../simulation/capabilities.js';
import { SimulationWorld } from '../simulation/simulationWorld.js';

interface SpatialPoint {
  entityId: number;
  x: number;
  y: number;
}

export interface SpatialQueryStats {
  indexedHumans: number;
  nearestHumanQueries: number;
  candidatesVisited: number;
  cellsVisited: number;
}

export interface NearestTargetResult {
  entityId: number;
  distance: number;
}

export class SpatialQuerySystem {
  private readonly humansByCellKey = new Map<string, SpatialPoint[]>();
  private readonly stats: SpatialQueryStats = {
    indexedHumans: 0,
    nearestHumanQueries: 0,
    candidatesVisited: 0,
    cellsVisited: 0,
  };
  private readonly cellSizeWorld = TILE_SIZE * 4;

  constructor(private readonly world: SimulationWorld) {}

  syncFromWorld(): void {
    this.humansByCellKey.clear();
    this.stats.indexedHumans = 0;

    for (const eid of query(this.world.ecs, [Active, Identity, Health, MindLink, Position])) {
      if (!isAlive(eid) || MindLink.controllerKind[eid] !== ControllerKind.Human) {
        continue;
      }

      const entityId = Identity.entityId[eid];
      const x = Position.x[eid];
      const y = Position.y[eid];
      const key = cellKey(cellCoord(x, this.cellSizeWorld), cellCoord(y, this.cellSizeWorld));
      const bucket = this.humansByCellKey.get(key);
      if (bucket) {
        bucket.push({ entityId, x, y });
      } else {
        this.humansByCellKey.set(key, [{ entityId, x, y }]);
      }
      this.stats.indexedHumans += 1;
    }
  }

  findNearestHumanInRadius(x: number, y: number, radius: number): NearestTargetResult | null {
    this.stats.nearestHumanQueries += 1;
    if (radius <= 0) {
      return null;
    }

    const minCellX = cellCoord(x - radius, this.cellSizeWorld);
    const maxCellX = cellCoord(x + radius, this.cellSizeWorld);
    const minCellY = cellCoord(y - radius, this.cellSizeWorld);
    const maxCellY = cellCoord(y + radius, this.cellSizeWorld);
    const maxDistanceSquared = radius * radius;
    let best: NearestTargetResult | null = null;
    let bestDistanceSquared = maxDistanceSquared;

    for (let cellY = minCellY; cellY <= maxCellY; cellY += 1) {
      for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
        this.stats.cellsVisited += 1;
        const bucket = this.humansByCellKey.get(cellKey(cellX, cellY));
        if (!bucket) {
          continue;
        }

        for (const point of bucket) {
          this.stats.candidatesVisited += 1;
          const dx = point.x - x;
          const dy = point.y - y;
          const distanceSquared = dx * dx + dy * dy;
          if (distanceSquared > bestDistanceSquared) {
            continue;
          }

          bestDistanceSquared = distanceSquared;
          best = {
            entityId: point.entityId,
            distance: Math.sqrt(distanceSquared),
          };
        }
      }
    }

    return best;
  }

  snapshotStatsAndReset(): SpatialQueryStats {
    const snapshot: SpatialQueryStats = { ...this.stats };
    this.stats.nearestHumanQueries = 0;
    this.stats.candidatesVisited = 0;
    this.stats.cellsVisited = 0;
    return snapshot;
  }
}

function cellCoord(value: number, cellSize: number): number {
  return Math.floor(value / cellSize);
}

function cellKey(cellX: number, cellY: number): string {
  return `${cellX}:${cellY}`;
}
