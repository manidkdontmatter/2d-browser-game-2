// Steps Skale physics and synchronizes authoritative body transforms back to ECS components.
import { query } from 'bitecs';
import { Active, Identity, PhysicsBodyRef, Position, Velocity } from '../simulation/components.js';
import { SimulationWorld } from '../simulation/simulationWorld.js';

export class PhysicsSystem {
  constructor(private readonly world: SimulationWorld) {}

  step(deltaSeconds: number): void {
    this.world.physics.step(deltaSeconds);
    this.syncPhysicsToEcs();
  }

  private syncPhysicsToEcs(): void {
    for (const eid of query(this.world.ecs, [Active, Identity, Position, Velocity, PhysicsBodyRef])) {
      const body = this.world.bodyByEntityId.get(Identity.entityId[eid]);
      if (!body) {
        continue;
      }
      Position.x[eid] = body.x;
      Position.y[eid] = body.y;
      Velocity.x[eid] = body.velocity.x;
      Velocity.y[eid] = body.velocity.y;
    }
  }
}
