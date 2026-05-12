// Owns persistent controller minds and their authoritative attachment to controllable entities.
import { addComponent, hasComponent, removeComponent } from 'bitecs';
import { ControllerKind } from '../../shared/domain/commands.js';
import { ControlTarget, MindLink } from './components.js';
import { SimulationWorld } from './simulationWorld.js';

export interface MindRecord {
  readonly mindId: number;
  readonly controllerKind: ControllerKind;
  controlledEntityId: number | null;
}

export class MindSystem {
  private readonly records = new Map<number, MindRecord>();
  private readonly mindIdByEntityId = new Map<number, number>();
  private nextMindId = 1;

  constructor(private readonly world: SimulationWorld) {}

  createMind(controllerKind: ControllerKind): number {
    const mindId = this.nextMindId;
    this.nextMindId += 1;
    this.records.set(mindId, { mindId, controllerKind, controlledEntityId: null });
    return mindId;
  }

  createMindForEntity(controllerKind: ControllerKind, entityId: number): number {
    const mindId = this.createMind(controllerKind);
    if (!this.attachMindToEntity(mindId, entityId)) {
      this.records.delete(mindId);
      throw new Error(`Unable to attach mind ${mindId} to entity ${entityId}`);
    }
    return mindId;
  }

  attachMindToEntity(mindId: number, entityId: number): boolean {
    const mind = this.records.get(mindId);
    const eid = this.world.eidByEntityId.get(entityId);
    if (!mind || eid === undefined || !hasComponent(this.world.ecs, eid, ControlTarget)) {
      return false;
    }

    if (mind.controlledEntityId !== null) {
      this.detachMind(mindId);
    }

    if (hasComponent(this.world.ecs, eid, MindLink)) {
      const existingMindId = MindLink.mindId[eid];
      if (existingMindId !== 0 && existingMindId !== mindId) {
        this.detachMind(existingMindId);
      }
    }

    addComponent(this.world.ecs, eid, MindLink);
    MindLink.mindId[eid] = mindId;
    MindLink.controllerKind[eid] = mind.controllerKind;
    mind.controlledEntityId = entityId;
    this.mindIdByEntityId.set(entityId, mindId);
    return true;
  }

  detachMind(mindId: number): void {
    const mind = this.records.get(mindId);
    if (!mind || mind.controlledEntityId === null) {
      return;
    }

    const eid = this.world.eidByEntityId.get(mind.controlledEntityId);
    if (eid !== undefined && hasComponent(this.world.ecs, eid, MindLink) && MindLink.mindId[eid] === mindId) {
      MindLink.mindId[eid] = 0;
      MindLink.controllerKind[eid] = 0;
      removeComponent(this.world.ecs, eid, MindLink);
      this.mindIdByEntityId.delete(mind.controlledEntityId);
    }

    mind.controlledEntityId = null;
  }

  removeMind(mindId: number): void {
    this.detachMind(mindId);
    this.records.delete(mindId);
  }

  removeMindForControlledEntity(entityId: number): void {
    const mindId = this.mindIdByEntityId.get(entityId);
    if (mindId !== undefined) {
      this.removeMind(mindId);
    }
  }

  getMindIdForControlledEntity(entityId: number): number | null {
    return this.mindIdByEntityId.get(entityId) ?? null;
  }

  getControlledEntityId(mindId: number): number | null {
    return this.records.get(mindId)?.controlledEntityId ?? null;
  }

  getMind(mindId: number): MindRecord | undefined {
    return this.records.get(mindId);
  }
}
