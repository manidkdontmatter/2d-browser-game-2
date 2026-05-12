// Builds network-facing records from authoritative ECS state.
import { query } from 'bitecs';
import { NetEntityRecord } from '../../shared/domain/snapshots.js';
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

  getSnapshots(): NetEntityRecord[] {
    return Array.from(this.world.netEntities.values());
  }

  getNetworkRecords(): NetEntityRecord[] {
    return Array.from(this.world.netEntities.values());
  }
}

function finiteOrDefault(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}
