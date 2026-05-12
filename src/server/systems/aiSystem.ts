// Orchestrates hostile NPC AI through budgeted Sense/Plan/Act phases for scalable authoritative behavior.
import { query, type EntityId } from 'bitecs';
import { MELEE_RANGE, NPC_DECISION_INTERVAL_SECONDS, TILE_SIZE } from '../../shared/config.js';
import { AttackIntent, ControlIntent, ControllerKind } from '../../shared/domain/commands.js';
import { distance, normalize, tileCenter } from '../../shared/math/vector.js';
import { findPath, GridPoint } from '../../shared/pathfinding/aStar.js';
import { Active, ControlTarget, Health, Identity, Locomotion, MindLink, NpcBrain, PhysicsBodyRef, Position, Velocity } from '../simulation/components.js';
import { canMove, isAlive, isControlledBy } from '../simulation/capabilities.js';
import { type NpcPathCache, SimulationWorld } from '../simulation/simulationWorld.js';
import { CombatSystem } from './combatSystem.js';
import { moveEntityKinematically, stopEntityKinematically } from './locomotionSystem.js';
import { AreaActivationSystem } from './areaActivationSystem.js';
import { SpatialQuerySystem } from './spatialQuerySystem.js';
import { AiSchedulerSystem } from './aiSchedulerSystem.js';

const NPC_TARGET_ACQUIRE_RANGE_WORLD = 700;
const NPC_TARGET_LOSE_RANGE_WORLD = NPC_TARGET_ACQUIRE_RANGE_WORLD * 1.35;
const NPC_REPATH_INTERVAL_MS = 900;
const NPC_REPATH_DISTANCE_TILES = 2;
const NPC_MAX_REPATHS_PER_TICK = 48;
const PATH_POINT_REACHED_WORLD_EPSILON = TILE_SIZE * 0.2;

enum NpcAiState {
  Idle = 0,
  Pursuing = 1,
  Attacking = 2,
}

export class AiSystem {
  private simulationTimeMs = 0;
  private repathsThisTick = 0;
  private readonly scheduler = new AiSchedulerSystem({
    maxSensePerTick: 320,
    maxPlanPerTick: 220,
    defaultSenseIntervalMs: Math.round(NPC_DECISION_INTERVAL_SECONDS * 1000),
    defaultPlanIntervalMs: Math.round(NPC_DECISION_INTERVAL_SECONDS * 1000 * 1.2),
    wakeGraceMs: 900,
  });

  constructor(
    private readonly world: SimulationWorld,
    private readonly combat: CombatSystem,
    private readonly areaActivation: AreaActivationSystem,
    private readonly spatialQuery: SpatialQuerySystem,
  ) {}

  updateNpcBrains(deltaSeconds: number, simulationTimeMs: number): void {
    this.simulationTimeMs = simulationTimeMs;
    this.repathsThisTick = 0;
    this.scheduler.beginTick(simulationTimeMs);

    for (const eid of query(this.world.ecs, [Active, Identity, Health, MindLink, ControlTarget, Locomotion, Position, Velocity, NpcBrain, PhysicsBodyRef])) {
      if (!isAlive(eid) || !canMove(eid)) {
        continue;
      }

      const tile = this.world.worldToTile(Position.x[eid], Position.y[eid]);
      if (!this.areaActivation.isTileActive(tile.x, tile.y)) {
        this.stopEntity(eid);
        NpcBrain.state[eid] = NpcAiState.Idle;
        continue;
      }

      if (this.scheduler.shouldSense(Identity.entityId[eid], NpcBrain.nextSenseAtMs[eid])) {
        this.sense(eid);
        NpcBrain.nextSenseAtMs[eid] = this.scheduler.markSensed(Identity.entityId[eid]);
      }

      if (NpcBrain.targetEntityId[eid] !== 0 && this.scheduler.shouldPlan(Identity.entityId[eid], NpcBrain.nextPlanAtMs[eid])) {
        this.plan(eid);
        NpcBrain.nextPlanAtMs[eid] = this.scheduler.markPlanned(Identity.entityId[eid]);
      }

      this.act(eid, deltaSeconds);
    }
  }

  wakeEntity(entityId: number): void {
    this.scheduler.wakeEntity(entityId);
  }

  snapshotSchedulerMetrics(): ReturnType<AiSchedulerSystem['snapshotMetrics']> {
    return this.scheduler.snapshotMetrics();
  }

  private sense(eid: EntityId): void {
    const self = { x: Position.x[eid], y: Position.y[eid] };
    const existingTargetId = NpcBrain.targetEntityId[eid];
    if (existingTargetId !== 0) {
      const existingEid = this.world.eidByEntityId.get(existingTargetId);
      if (existingEid !== undefined && isAlive(existingEid) && isControlledBy(existingEid, ControllerKind.Human)) {
        const targetX = Position.x[existingEid];
        const targetY = Position.y[existingEid];
        const existingDistance = distance(self, { x: targetX, y: targetY });
        if (existingDistance <= NPC_TARGET_LOSE_RANGE_WORLD) {
          NpcBrain.lastKnownTargetX[eid] = targetX;
          NpcBrain.lastKnownTargetY[eid] = targetY;
          return;
        }
      }
    }

    const nearest = this.spatialQuery.findNearestHumanInRadius(self.x, self.y, NPC_TARGET_ACQUIRE_RANGE_WORLD);
    const bestEntityId = nearest?.entityId ?? 0;
    NpcBrain.targetEntityId[eid] = bestEntityId;

    if (bestEntityId === 0) {
      this.world.npcPaths.delete(Identity.entityId[eid]);
      NpcBrain.pathIndex[eid] = 0;
      NpcBrain.state[eid] = NpcAiState.Idle;
      return;
    }

    const targetEid = this.world.eidByEntityId.get(bestEntityId);
    if (targetEid !== undefined) {
      NpcBrain.lastKnownTargetX[eid] = Position.x[targetEid];
      NpcBrain.lastKnownTargetY[eid] = Position.y[targetEid];
    }
  }

  private plan(eid: EntityId): void {
    const targetId = NpcBrain.targetEntityId[eid];
    if (targetId === 0) {
      return;
    }

    const targetEid = this.world.eidByEntityId.get(targetId);
    if (targetEid === undefined || !isAlive(targetEid)) {
      NpcBrain.targetEntityId[eid] = 0;
      this.world.npcPaths.delete(Identity.entityId[eid]);
      NpcBrain.pathIndex[eid] = 0;
      NpcBrain.state[eid] = NpcAiState.Idle;
      return;
    }

    const self = { x: Position.x[eid], y: Position.y[eid] };
    const target = { x: Position.x[targetEid], y: Position.y[targetEid] };
    const targetDistance = Math.hypot(target.x - self.x, target.y - self.y);
    NpcBrain.lastKnownTargetX[eid] = target.x;
    NpcBrain.lastKnownTargetY[eid] = target.y;

    if (targetDistance <= MELEE_RANGE) {
      NpcBrain.state[eid] = NpcAiState.Attacking;
      return;
    }

    this.planPathIfNeeded(eid, Identity.entityId[eid], self, target);
    NpcBrain.state[eid] = NpcAiState.Pursuing;
  }

  private act(eid: EntityId, deltaSeconds: number): void {
    const targetId = NpcBrain.targetEntityId[eid];
    const entityId = Identity.entityId[eid];
    const body = this.world.bodyByEntityId.get(entityId);
    if (targetId === 0 || !body) {
      this.stopEntity(eid);
      NpcBrain.state[eid] = NpcAiState.Idle;
      return;
    }

    const targetEid = this.world.eidByEntityId.get(targetId);
    if (targetEid === undefined || !isAlive(targetEid)) {
      NpcBrain.targetEntityId[eid] = 0;
      this.world.npcPaths.delete(entityId);
      NpcBrain.pathIndex[eid] = 0;
      this.stopEntity(eid);
      NpcBrain.state[eid] = NpcAiState.Idle;
      return;
    }

    const self = { x: Position.x[eid], y: Position.y[eid] };
    const target = { x: Position.x[targetEid], y: Position.y[targetEid] };
    const delta = { x: target.x - self.x, y: target.y - self.y };
    const targetDistance = Math.hypot(delta.x, delta.y);

    if (targetDistance > NPC_TARGET_LOSE_RANGE_WORLD) {
      NpcBrain.targetEntityId[eid] = 0;
      this.world.npcPaths.delete(entityId);
      NpcBrain.pathIndex[eid] = 0;
      this.stopEntity(eid);
      NpcBrain.state[eid] = NpcAiState.Idle;
      return;
    }

    if (targetDistance <= MELEE_RANGE) {
      this.stopEntity(eid);
      this.combat.handleIntent(createAiIntent(entityId, target, AttackIntent.Melee), this.simulationTimeMs);
      NpcBrain.state[eid] = NpcAiState.Attacking;
      return;
    }

    const next = this.nextPathPoint(eid, entityId, self, target);
    const direction = normalize({ x: next.x - self.x, y: next.y - self.y });
    moveEntityKinematically(this.world, eid, direction.x, direction.y, deltaSeconds);
    NpcBrain.state[eid] = NpcAiState.Pursuing;
  }

  stopEntity(eid: EntityId): void {
    stopEntityKinematically(this.world, eid);
  }

  private planPathIfNeeded(eid: EntityId, entityId: number, self: { x: number; y: number }, target: { x: number; y: number }): void {
    const start = this.world.worldToTile(self.x, self.y);
    const goal = this.world.worldToTile(target.x, target.y);
    const cached = this.world.npcPaths.get(entityId);
    const hasUsableCachedPath = this.canUseCachedPath(cached, start, goal);
    if (hasUsableCachedPath || this.repathsThisTick >= NPC_MAX_REPATHS_PER_TICK) {
      return;
    }

    this.repathsThisTick += 1;
    const path = findPath(this.world.tileMap, start, goal);
    const nextRepathAtMs = this.simulationTimeMs + NPC_REPATH_INTERVAL_MS + this.repathJitterMs(eid);
    this.world.npcPaths.set(entityId, { path, goal, nextRepathAtMs });
    NpcBrain.pathIndex[eid] = 1;
  }

  private nextPathPoint(eid: EntityId, entityId: number, self: { x: number; y: number }, target: { x: number; y: number }): { x: number; y: number } {
    const pathState = this.world.npcPaths.get(entityId);
    if (!pathState || pathState.path.length === 0) {
      return target;
    }

    const nextTileIndex = this.resolveNextPathTileIndex(eid, pathState.path, self);
    const fallbackGoal = this.world.worldToTile(target.x, target.y);
    const nextTile = pathState.path[nextTileIndex] ?? fallbackGoal;
    return tileCenter(nextTile.x, nextTile.y, TILE_SIZE);
  }

  private canUseCachedPath(cached: NpcPathCache | undefined, start: GridPoint, goal: GridPoint): boolean {
    if (!cached || cached.path.length < 2) {
      return false;
    }

    if (this.simulationTimeMs >= cached.nextRepathAtMs) {
      return false;
    }

    const goalShift = Math.abs(cached.goal.x - goal.x) + Math.abs(cached.goal.y - goal.y);
    if (goalShift > NPC_REPATH_DISTANCE_TILES) {
      return false;
    }

    const startShift = Math.abs(cached.path[0].x - start.x) + Math.abs(cached.path[0].y - start.y);
    return startShift <= NPC_REPATH_DISTANCE_TILES;
  }

  private resolveNextPathTileIndex(eid: EntityId, path: readonly GridPoint[], self: { x: number; y: number }): number {
    let index = Math.max(1, Math.min(NpcBrain.pathIndex[eid] || 1, path.length - 1));
    while (index < path.length - 1) {
      const point = tileCenter(path[index].x, path[index].y, TILE_SIZE);
      if (Math.hypot(point.x - self.x, point.y - self.y) > PATH_POINT_REACHED_WORLD_EPSILON) {
        break;
      }
      index += 1;
    }
    NpcBrain.pathIndex[eid] = index;
    return index;
  }

  private repathJitterMs(eid: EntityId): number {
    return (eid % 17) * 20;
  }
}

function createAiIntent(
  entityId: number,
  target: { x: number; y: number },
  attack: AttackIntent,
): ControlIntent {
  return {
    entityId,
    moveX: 0,
    moveY: 0,
    aimX: target.x,
    aimY: target.y,
    attack,
    sequence: 0,
    sourceController: ControllerKind.HostileAi,
  };
}
