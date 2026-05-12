// Computes server-authoritative active chunk ownership from live human player anchors with a deactivation grace window.
import { query } from 'bitecs';
import { Active, ControlTarget, Health, MindLink, PhysicsBodyRef, Position } from '../simulation/components.js';
import { isAlive, isControlledBy } from '../simulation/capabilities.js';
import { SimulationWorld } from '../simulation/simulationWorld.js';
import { AREA_ACTIVATION_RADIUS_CHUNKS, AREA_DEACTIVATION_GRACE_TICKS } from '../../shared/config.js';
import { ControllerKind } from '../../shared/domain/commands.js';

export interface AreaActivationOptions {
  activationRadiusChunks?: number;
  deactivationGraceTicks?: number;
}

export class AreaActivationSystem {
  private readonly activationRadiusChunks: number;
  private readonly deactivationGraceTicks: number;
  private readonly activeUntilTickByChunkIndex = new Map<number, number>();
  private readonly activeChunkIndexes = new Set<number>();
  private readonly scratchDesiredChunkIndexes = new Set<number>();
  private tick = 0;

  constructor(
    private readonly world: SimulationWorld,
    options: AreaActivationOptions = {},
  ) {
    this.activationRadiusChunks = Math.max(0, options.activationRadiusChunks ?? AREA_ACTIVATION_RADIUS_CHUNKS);
    this.deactivationGraceTicks = Math.max(0, options.deactivationGraceTicks ?? AREA_DEACTIVATION_GRACE_TICKS);
  }

  update(): void {
    this.tick += 1;
    this.scratchDesiredChunkIndexes.clear();
    this.collectDesiredChunksFromPlayers(this.scratchDesiredChunkIndexes);

    const deactivateAfterTick = this.tick + this.deactivationGraceTicks;
    for (const chunkIndex of this.scratchDesiredChunkIndexes) {
      this.activeUntilTickByChunkIndex.set(chunkIndex, deactivateAfterTick);
    }

    this.activeChunkIndexes.clear();
    for (const [chunkIndex, untilTick] of this.activeUntilTickByChunkIndex) {
      if (untilTick >= this.tick) {
        this.activeChunkIndexes.add(chunkIndex);
        continue;
      }

      this.activeUntilTickByChunkIndex.delete(chunkIndex);
    }
  }

  getActiveChunkIndexes(): ReadonlySet<number> {
    return this.activeChunkIndexes;
  }

  getActiveChunkCount(): number {
    return this.activeChunkIndexes.size;
  }

  isTileActive(tileX: number, tileY: number): boolean {
    return this.activeChunkIndexes.has(this.world.tileMap.chunkIndexFromTile(tileX, tileY));
  }

  private collectDesiredChunksFromPlayers(target: Set<number>): void {
    for (const eid of query(this.world.ecs, [Active, Health, MindLink, ControlTarget, Position, PhysicsBodyRef])) {
      if (!isControlledBy(eid, ControllerKind.Human) || !isAlive(eid)) {
        continue;
      }

      const centerTile = this.world.tileMap.worldToTile(Position.x[eid], Position.y[eid]);
      const centerChunk = this.world.tileMap.tileToChunk(centerTile.x, centerTile.y);
      for (let chunkY = centerChunk.y - this.activationRadiusChunks; chunkY <= centerChunk.y + this.activationRadiusChunks; chunkY += 1) {
        if (chunkY < 0 || chunkY >= this.world.tileMap.heightChunks) {
          continue;
        }

        for (let chunkX = centerChunk.x - this.activationRadiusChunks; chunkX <= centerChunk.x + this.activationRadiusChunks; chunkX += 1) {
          if (chunkX < 0 || chunkX >= this.world.tileMap.widthChunks) {
            continue;
          }

          target.add(this.world.tileMap.chunkIndexFromChunk(chunkX, chunkY));
        }
      }
    }
  }
}
