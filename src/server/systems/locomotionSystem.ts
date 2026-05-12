// Applies kinematic locomotion to controlled Skale bodies before the tick's shared separation pass.
import type { EntityId } from 'bitecs';
import { kinematicDisplacement, normalizeAxis } from '../../shared/movement/locomotion.js';
import { Facing, Identity, Locomotion, Position, Velocity } from '../simulation/components.js';
import { SimulationWorld } from '../simulation/simulationWorld.js';

export function moveEntityKinematically(
  world: SimulationWorld,
  eid: EntityId,
  moveX: number,
  moveY: number,
  durationSeconds: number,
): { x: number; y: number } {
  const entityId = Identity.entityId[eid];
  const body = world.bodyByEntityId.get(entityId);
  const axis = normalizeAxis(moveX, moveY);
  Velocity.x[eid] = 0;
  Velocity.y[eid] = 0;
  if (!body) {
    return axis;
  }

  const displacement = kinematicDisplacement(axis.x, axis.y, Locomotion.speed[eid], durationSeconds);
  body.setVelocity(0, 0);
  body.translate(displacement.x, displacement.y);
  body.setVelocity(0, 0);
  Position.x[eid] = body.x;
  Position.y[eid] = body.y;
  if (axis.x !== 0) {
    Facing.direction[eid] = axis.x > 0 ? 1 : -1;
  }

  return axis;
}

export function stopEntityKinematically(world: SimulationWorld, eid: EntityId): void {
  const entityId = Identity.entityId[eid];
  world.bodyByEntityId.get(entityId)?.setVelocity(0, 0);
  Velocity.x[eid] = 0;
  Velocity.y[eid] = 0;
}
