// Builds network-facing records and snapshots from authoritative ECS state.
import { query } from 'bitecs';
import { NetEntityKind, EntitySnapshot, NetEntityRecord } from '../../shared/domain/snapshots.js';
import { Active, Appearance, Facing, Health, Identity, Position, Velocity } from '../simulation/components.js';
import { SimulationWorld } from '../simulation/simulationWorld.js';

export class ReplicationSystem {
  constructor(private readonly world: SimulationWorld) {}

  syncNetworkRecords(): void {
    for (const eid of query(this.world.ecs, [Active, Identity, Appearance, Position, Velocity])) {
      const record = this.world.netEntities.get(Identity.entityId[eid]);
      if (record) {
        record.kind = Appearance.netKind[eid];
        record.x = Position.x[eid];
        record.y = Position.y[eid];
        record.health = finiteOrDefault(Health.current[eid], 1);
        record.facing = Facing.direction[eid] === -1 ? -1 : 1;
      }
    }
  }

  getSnapshots(): EntitySnapshot[] {
    const snapshots: EntitySnapshot[] = [];
    for (const entity of this.world.netEntities.values()) {
      snapshots.push({
        entityId: entity.entityId,
        kind: snapshotKind(entity.kind),
        x: entity.x,
        y: entity.y,
        health: entity.health,
        facing: entity.facing,
      });
    }
    return snapshots;
  }

  getNetworkRecords(): NetEntityRecord[] {
    return Array.from(this.world.netEntities.values());
  }
}

function snapshotKind(kind: NetEntityKind): EntitySnapshot['kind'] {
  if (kind === NetEntityKind.Projectile) {
    return 'projectile';
  }
  if (kind === NetEntityKind.Portal) {
    return 'portal';
  }
  return 'body';
}

function finiteOrDefault(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}
