// Defines capability checks derived from authoritative ECS composition.
import { ControllerKind } from '../../shared/domain/commands.js';
import { Health, Locomotion, MindLink } from './components.js';

export function isAlive(eid: number): boolean {
  return Health.current[eid] > 0;
}

export function isControlledBy(eid: number, controllerKind: ControllerKind): boolean {
  return MindLink.controllerKind[eid] === controllerKind;
}

export function canMove(eid: number): boolean {
  return Locomotion.speed[eid] > 0;
}
