// Creates and removes authoritative composed entities across ECS, physics, and replication indexes.
import { removeComponent } from 'bitecs';
import { entityRecipeIds, type BodyRecipe, type EntityRecipeId, type ProjectileRecipe } from '../../shared/entities/entityRecipes.js';
import { ControllerKind } from '../../shared/domain/commands.js';
import { normalize } from '../../shared/math/vector.js';
import {
  Active,
  Health,
  MindLink,
  NpcBrain,
  Position,
  Projectile,
  Velocity,
} from '../simulation/components.js';
import { EntityComposer } from '../simulation/entityComposer.js';
import { MindSystem } from '../simulation/mindSystem.js';
import { SimulationWorld } from '../simulation/simulationWorld.js';
import { SpawnPoint } from '../simulation/types.js';
import { ContentRegistry } from '../content/contentRegistry.js';
import { CooldownLimiter } from './rateLimiter.js';

export class SpawnSystem {
  private readonly pooledProjectileEntityIds: number[] = [];
  private readonly pooledNpcEntityIds: number[] = [];
  private readonly pendingNpcRespawns: Array<{ entityId: number; remainingSeconds: number }> = [];

  constructor(
    private readonly world: SimulationWorld,
    private readonly content: ContentRegistry,
    private readonly composer: EntityComposer,
    private readonly minds: MindSystem,
    private readonly attackLimiter: CooldownLimiter,
  ) {}

  spawnPlayer(): number {
    this.world.playerSpawn = this.world.findPlayerSpawnPoint();
    return this.spawnControlledEntity(entityRecipeIds.humanControlledBody, this.world.playerSpawn);
  }

  spawnHostileNpcs(count: number): number[] {
    const ids: number[] = [];
    const spawnPoints = this.world.findNpcSpawnPoints(count);
    for (let i = 0; i < count; i += 1) {
      const spawn = spawnPoints[i];
      if (spawn) {
        ids.push(this.spawnNpc(spawn));
      }
    }
    return ids;
  }

  spawnProjectile(ownerEntityId: number, originX: number, originY: number, directionX: number, directionY: number): void {
    const entityId = this.pooledProjectileEntityIds.pop() ?? this.composer.createFromRecipe(entityRecipeIds.basicProjectile, { x: originX, y: originY });
    const recipe = this.getProjectileRecipe(entityRecipeIds.basicProjectile);
    const direction = normalize({ x: directionX, y: directionY });

    const eid = this.world.eidByEntityId.get(entityId);
    if (eid === undefined) {
      return;
    }

    Projectile.ownerEntityId[eid] = ownerEntityId;
    Projectile.damage[eid] = recipe.damage;
    Projectile.lifetime[eid] = recipe.lifetimeSeconds;
    Position.x[eid] = originX;
    Position.y[eid] = originY;
    Velocity.x[eid] = direction.x * recipe.speed;
    Velocity.y[eid] = direction.y * recipe.speed;
    this.composer.activateEntity(entityId);
  }

  removeEntity(entityId: number): void {
    this.minds.removeMindForControlledEntity(entityId);
    this.composer.removeEntity(entityId);
    this.attackLimiter.delete(entityId);
  }

  respawnControlledEntity(entityId: number): void {
    const eid = this.world.eidByEntityId.get(entityId);
    const body = this.world.bodyByEntityId.get(entityId);
    if (eid === undefined || !body) {
      return;
    }

    const spawn = this.world.findPlayerSpawnPoint();
    this.world.playerSpawn = spawn;
    this.composer.resetBody(entityId, spawn);
    this.attackLimiter.delete(entityId);
  }

  deactivateAiEntityForRespawn(entityId: number, respawnSeconds: number): void {
    const eid = this.world.eidByEntityId.get(entityId);
    const body = this.world.bodyByEntityId.get(entityId);
    if (eid === undefined || MindLink.controllerKind[eid] !== ControllerKind.HostileAi) {
      this.removeEntity(entityId);
      return;
    }

    removeComponent(this.world.ecs, eid, Active);
    Health.current[eid] = 0;
    Velocity.x[eid] = 0;
    Velocity.y[eid] = 0;
    NpcBrain.targetEntityId[eid] = 0;
    NpcBrain.pathIndex[eid] = 0;
    NpcBrain.decisionCooldown[eid] = 0;
    NpcBrain.state[eid] = 0;
    NpcBrain.nextSenseAtMs[eid] = 0;
    NpcBrain.nextPlanAtMs[eid] = 0;
    NpcBrain.lastKnownTargetX[eid] = 0;
    NpcBrain.lastKnownTargetY[eid] = 0;
    this.world.npcPaths.delete(entityId);
    this.attackLimiter.delete(entityId);
    if (body) {
      body.setVelocity(0, 0);
      body.active = false;
    }
    this.world.netEntities.delete(entityId);
    this.pendingNpcRespawns.push({ entityId, remainingSeconds: respawnSeconds });
  }

  removeProjectile(entityId: number): void {
    const eid = this.world.eidByEntityId.get(entityId);
    if (eid === undefined) {
      return;
    }

    removeComponent(this.world.ecs, eid, Active);
    Projectile.lifetime[eid] = 0;
    Velocity.x[eid] = 0;
    Velocity.y[eid] = 0;
    this.world.netEntities.delete(entityId);
    if (!this.pooledProjectileEntityIds.includes(entityId)) {
      this.pooledProjectileEntityIds.push(entityId);
    }
  }

  updateRespawns(deltaSeconds: number): void {
    for (let i = this.pendingNpcRespawns.length - 1; i >= 0; i -= 1) {
      const pending = this.pendingNpcRespawns[i];
      pending.remainingSeconds -= deltaSeconds;
      if (pending.remainingSeconds > 0.000001) {
        continue;
      }

      this.pendingNpcRespawns.splice(i, 1);
      const spawn = this.world.findNpcSpawnPoints(1)[0] ?? this.world.findPlayerSpawnPoint();
      this.activateNpc(pending.entityId, spawn);
    }
  }

  getPoolStats(): { pooledProjectiles: number; pooledNpcs: number; pendingNpcRespawns: number } {
    return {
      pooledProjectiles: this.pooledProjectileEntityIds.length,
      pooledNpcs: this.pooledNpcEntityIds.length + this.pendingNpcRespawns.length,
      pendingNpcRespawns: this.pendingNpcRespawns.length,
    };
  }

  private spawnControlledEntity(recipeId: EntityRecipeId, spawn: SpawnPoint): number {
    const entityRecipe = this.content.getEntityRecipe(recipeId);
    const recipe = this.getBodyRecipe(recipeId);
    const entityId = this.composer.createFromRecipe(recipeId, spawn);
    if (entityRecipe.body && recipe.defaultControllerKind !== undefined) {
      this.minds.createMindForEntity(recipe.defaultControllerKind, entityId);
    }
    this.composer.activateEntity(entityId);
    return entityId;
  }

  private spawnNpc(spawn: SpawnPoint): number {
    const entityId = this.pooledNpcEntityIds.pop();
    if (entityId !== undefined) {
      this.activateNpc(entityId, spawn);
      return entityId;
    }

    return this.spawnControlledEntity(entityRecipeIds.hostileAiBody, spawn);
  }

  private activateNpc(entityId: number, spawn: SpawnPoint): void {
    const eid = this.world.eidByEntityId.get(entityId);
    const body = this.world.bodyByEntityId.get(entityId);
    if (eid === undefined || !body) {
      return;
    }

    this.composer.resetBody(entityId, spawn);
    NpcBrain.decisionCooldown[eid] = 0;
    NpcBrain.targetEntityId[eid] = 0;
    NpcBrain.pathIndex[eid] = 0;
    NpcBrain.state[eid] = 0;
    NpcBrain.nextSenseAtMs[eid] = 0;
    NpcBrain.nextPlanAtMs[eid] = 0;
    NpcBrain.lastKnownTargetX[eid] = 0;
    NpcBrain.lastKnownTargetY[eid] = 0;
  }

  private getBodyRecipe(id: EntityRecipeId): BodyRecipe {
    const recipe = this.content.getEntityRecipe(id);
    if (!recipe.body) {
      throw new Error(`Entity recipe ${id} does not define a body`);
    }
    return recipe.body;
  }

  private getProjectileRecipe(id: EntityRecipeId): ProjectileRecipe {
    const recipe = this.content.getEntityRecipe(id);
    if (!recipe.projectile) {
      throw new Error(`Entity recipe ${id} does not define a projectile`);
    }
    return recipe.projectile;
  }
}
