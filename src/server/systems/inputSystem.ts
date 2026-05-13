// Converts queued human player commands into shared movement and attack intents.
import { query } from 'bitecs';
import { ControlIntent, ControllerKind, PlayerCommand } from '../../shared/domain/commands.js';
import { NET_TIMING } from '../../shared/net/timing.js';
import { Active, ControlTarget, Health, Identity, Locomotion, MindLink, PhysicsBodyRef, Position, Velocity } from '../simulation/components.js';
import { canMove, isAlive, isControlledBy } from '../simulation/capabilities.js';
import { SimulationWorld } from '../simulation/simulationWorld.js';
import { CombatSystem } from './combatSystem.js';
import { moveEntityKinematically, stopEntityKinematically } from './locomotionSystem.js';

export class InputSystem {
  readonly commandsByEntityId = new Map<number, PlayerCommand[]>();
  private readonly movementCreditsByEntityId = new Map<number, number>();

  constructor(
    private readonly world: SimulationWorld,
    private readonly combat: CombatSystem,
  ) {}

  queueCommand(entityId: number, command: PlayerCommand): void {
    const commands = this.commandsByEntityId.get(entityId);
    if (commands) {
      if (commands.length >= NET_TIMING.maxQueuedInputCommandsPerEntity) {
        return;
      }
      commands.push(command);
      return;
    }

    this.commandsByEntityId.set(entityId, [command]);
  }

  applyHumanInput(simulationTimeMs: number): void {
    const liveHumanEntityIds = new Set<number>();

    for (const eid of query(this.world.ecs, [Active, Identity, Health, MindLink, ControlTarget, Locomotion, Position, Velocity, PhysicsBodyRef])) {
      if (!isControlledBy(eid, ControllerKind.Human) || !isAlive(eid)) {
        continue;
      }

      const entityId = Identity.entityId[eid];
      liveHumanEntityIds.add(entityId);
      const queuedCommands = this.commandsByEntityId.get(entityId) ?? [];
      if (queuedCommands.length === 0) {
        stopEntityKinematically(this.world, eid);
        this.refillMovementCredits(entityId);
        continue;
      }

      let movementCredits = this.refillMovementCredits(entityId);
      let processedCommandCount = 0;

      for (const queuedCommand of queuedCommands) {
        const hasMovement = canMove(eid) && (queuedCommand.moveX !== 0 || queuedCommand.moveY !== 0);
        if (hasMovement) {
          if (movementCredits < 1) {
            break;
          }

          movementCredits -= 1;
          const axis = moveEntityKinematically(
            this.world,
            eid,
            queuedCommand.moveX,
            queuedCommand.moveY,
            NET_TIMING.movementCommandSeconds,
          );
          this.combat.handleIntent(toControlIntent(entityId, queuedCommand, axis.x, axis.y), simulationTimeMs);
        } else {
          stopEntityKinematically(this.world, eid);
          this.combat.handleIntent(toControlIntent(entityId, queuedCommand, 0, 0), simulationTimeMs);
        }

        processedCommandCount += 1;
      }

      this.movementCreditsByEntityId.set(entityId, movementCredits);
      if (processedCommandCount >= queuedCommands.length) {
        this.commandsByEntityId.delete(entityId);
      } else {
        this.commandsByEntityId.set(entityId, queuedCommands.slice(processedCommandCount));
      }
    }

    this.pruneMissingHumans(liveHumanEntityIds);
  }

  private refillMovementCredits(entityId: number): number {
    const current = this.movementCreditsByEntityId.get(entityId) ?? NET_TIMING.maxMovementCommandCredits;
    const next = Math.min(
      NET_TIMING.maxMovementCommandCredits,
      current + NET_TIMING.movementCommandCreditsPerServerTick,
    );
    this.movementCreditsByEntityId.set(entityId, next);
    return next;
  }

  private pruneMissingHumans(liveHumanEntityIds: Set<number>): void {
    for (const entityId of this.movementCreditsByEntityId.keys()) {
      if (!liveHumanEntityIds.has(entityId)) {
        this.movementCreditsByEntityId.delete(entityId);
      }
    }

    for (const entityId of this.commandsByEntityId.keys()) {
      if (!liveHumanEntityIds.has(entityId)) {
        this.commandsByEntityId.delete(entityId);
      }
    }
  }
}

function toControlIntent(entityId: number, command: PlayerCommand, moveX: number, moveY: number): ControlIntent {
  return {
    entityId,
    moveX,
    moveY,
    aimX: command.aimX,
    aimY: command.aimY,
    attack: command.attack,
    interact: command.interact,
    sequence: command.sequence,
    sourceController: ControllerKind.Human,
    hotbarSlotActivated: command.hotbarSlotActivated,
  };
}
