// Applies authoritative tile mutations and keeps tile-derived systems synchronized.
import type { TileMutation } from '../../shared/world/mapTypes.js';
import { TileType, inBounds, tileIndex } from '../../shared/world/mapTypes.js';
import { getTileDefinition } from '../../shared/world/tileDefinitions.js';
import { SimulationWorld } from '../simulation/simulationWorld.js';

export interface TileMutationResult {
  accepted: boolean;
  mutation?: TileMutation;
}

export class TileMutationSystem {
  private readonly pendingReplication: TileMutation[] = [];
  private readonly tileDamageByIndex = new Map<number, number>();

  constructor(private readonly world: SimulationWorld) {}

  mutateTile(x: number, y: number, tile: TileType): TileMutationResult {
    if (!inBounds(this.world.tileMap.width, this.world.tileMap.height, x, y)) {
      return { accepted: false };
    }

    if (this.world.tileMap.getTile(x, y) === tile) {
      return { accepted: true };
    }

    this.world.tileMap.setTile(x, y, tile);
    this.tileDamageByIndex.delete(tileIndex(this.world.tileMap.width, x, y));
    this.world.tileCollision.syncTileBody(x, y);
    this.world.syncSpawnCandidateForTile(x, y);
    this.world.npcPaths.clear();

    const mutation = { x, y, tile };
    this.pendingReplication.push(mutation);
    return { accepted: true, mutation };
  }

  damageTile(x: number, y: number, damage: number): TileMutationResult {
    if (!inBounds(this.world.tileMap.width, this.world.tileMap.height, x, y) || damage <= 0) {
      return { accepted: false };
    }

    const tile = this.world.tileMap.getTile(x, y);
    const definition = getTileDefinition(tile);
    if (definition.durability === null) {
      return { accepted: false };
    }

    const index = tileIndex(this.world.tileMap.width, x, y);
    const totalDamage = (this.tileDamageByIndex.get(index) ?? 0) + damage;
    if (totalDamage < definition.durability) {
      this.tileDamageByIndex.set(index, totalDamage);
      return { accepted: true };
    }

    return this.mutateTile(x, y, TileType.Dirt);
  }

  drainPendingReplication(): TileMutation[] {
    return this.pendingReplication.splice(0);
  }
}
