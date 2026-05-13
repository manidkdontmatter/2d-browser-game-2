// Owns authoritative translation from entity recipes into ECS, physics, indexes, and initial replication records.
import { addComponent, addEntity, hasComponent, removeComponent, removeEntity } from 'bitecs';
import { type BodyRecipe, type EntityRecipeId, type PickupItemRecipe, type ProjectileRecipe } from '../../shared/entities/entityRecipes.js';
import { ContentRegistry } from '../content/contentRegistry.js';
import type { StatsSystem } from '../systems/statsSystem.js';
import {
  Active,
  Appearance,
  ControlTarget,
  Facing,
  Health,
  Identity,
  Locomotion,
  MindLink,
  NpcBrain,
  PhysicsBodyRef,
  PickupItem,
  Position,
  Projectile,
  Stamina,
  Velocity,
} from './components.js';
import { bodyLayer, wallLayer } from './layers.js';
import { SimulationWorld } from './simulationWorld.js';

export interface EntitySpawnPosition {
  x: number;
  y: number;
}

export class EntityComposer {
  private statsSystem: StatsSystem | null = null;

  constructor(private readonly world: SimulationWorld, private readonly content: ContentRegistry) {}

  setStatsSystem(statsSystem: StatsSystem): void {
    this.statsSystem = statsSystem;
  }

  createFromRecipe(recipeId: EntityRecipeId, position: EntitySpawnPosition): number {
    const recipe = this.content.getEntityRecipe(recipeId);
    const entityId = this.world.allocateEntityId();
    const eid = addEntity(this.world.ecs);

    addComponent(this.world.ecs, eid, Identity);
    addComponent(this.world.ecs, eid, Position);
    addComponent(this.world.ecs, eid, Velocity);
    addComponent(this.world.ecs, eid, Appearance);
    Identity.entityId[eid] = entityId;
    Position.x[eid] = position.x;
    Position.y[eid] = position.y;
    Velocity.x[eid] = 0;
    Velocity.y[eid] = 0;
    Appearance.netKind[eid] = recipe.appearanceKind;
    this.world.eidByEntityId.set(entityId, eid);

    if (recipe.body) {
      this.addBodyComposition(eid, entityId, recipe.body, position);
    }

    if (recipe.projectile) {
      this.addProjectileComposition(eid, recipe.projectile);
    }

    if (recipe.pickup) {
      this.addPickupComposition(eid, recipe.pickup);
    }

    return entityId;
  }

  activateEntity(entityId: number): void {
    const eid = this.world.eidByEntityId.get(entityId);
    if (eid === undefined) {
      return;
    }

    addComponent(this.world.ecs, eid, Active);
    const record = this.world.createNetworkRecord(entityId, Appearance.netKind[eid]);
    record.x = Position.x[eid];
    record.y = Position.y[eid];
    record.health = Number.isFinite(Health.current[eid]) ? Health.current[eid] : 1;
    record.facing = Facing.direction[eid] === -1 ? -1 : 1;
    this.world.netEntities.set(entityId, record);
  }

  removeEntity(entityId: number): void {
    const eid = this.world.eidByEntityId.get(entityId);
    if (eid !== undefined) {
      removeEntity(this.world.ecs, eid);
    }
    this.world.removePhysicsBody(entityId);
    this.world.eidByEntityId.delete(entityId);
    this.world.netEntities.delete(entityId);
    this.world.pickupItemIds.delete(entityId);
    this.world.npcPaths.delete(entityId);
    this.statsSystem?.removeStats(entityId);
  }

  resetBody(entityId: number, position: EntitySpawnPosition): void {
    const eid = this.world.eidByEntityId.get(entityId);
    const body = this.world.bodyByEntityId.get(entityId);
    if (eid === undefined || !body) {
      return;
    }

    Position.x[eid] = position.x;
    Position.y[eid] = position.y;
    Velocity.x[eid] = 0;
    Velocity.y[eid] = 0;
    Health.current[eid] = Health.max[eid];
    if (hasComponent(this.world.ecs, eid, Stamina)) {
      Stamina.current[eid] = Stamina.max[eid];
    }
    Facing.direction[eid] = 1;
    body.setPosition(position.x, position.y);
    body.setVelocity(0, 0);
    body.active = true;
    this.activateEntity(entityId);
  }

  setControllable(entityId: number, enabled: boolean): boolean {
    const eid = this.world.eidByEntityId.get(entityId);
    if (eid === undefined) {
      return false;
    }

    if (enabled) {
      addComponent(this.world.ecs, eid, ControlTarget);
      return true;
    }

    if (
      hasComponent(this.world.ecs, eid, MindLink)
      && MindLink.mindId[eid] !== 0
    ) {
      return false;
    }

    if (hasComponent(this.world.ecs, eid, ControlTarget)) {
      removeComponent(this.world.ecs, eid, ControlTarget);
    }
    return true;
  }

  setLocomotionSpeed(entityId: number, speed: number): boolean {
    const eid = this.world.eidByEntityId.get(entityId);
    if (eid === undefined || speed < 0 || !Number.isFinite(speed)) {
      return false;
    }

    addComponent(this.world.ecs, eid, Locomotion);
    Locomotion.speed[eid] = speed;
    return true;
  }

  private addBodyComposition(eid: number, entityId: number, recipe: BodyRecipe, position: EntitySpawnPosition): void {
    addComponent(this.world.ecs, eid, Health);
    addComponent(this.world.ecs, eid, Facing);
    addComponent(this.world.ecs, eid, Locomotion);
    addComponent(this.world.ecs, eid, PhysicsBodyRef);
    Health.current[eid] = recipe.maxHealth;
    Health.max[eid] = recipe.maxHealth;
    Facing.direction[eid] = 1;
    Locomotion.speed[eid] = recipe.locomotionSpeed;

    if (recipe.controllable) {
      addComponent(this.world.ecs, eid, ControlTarget);
    }

    if (recipe.hostileBrain) {
      addComponent(this.world.ecs, eid, NpcBrain);
      NpcBrain.decisionCooldown[eid] = 0;
      NpcBrain.targetEntityId[eid] = 0;
      NpcBrain.pathIndex[eid] = 0;
      NpcBrain.state[eid] = 0;
      NpcBrain.nextSenseAtMs[eid] = 0;
      NpcBrain.nextPlanAtMs[eid] = 0;
      NpcBrain.lastKnownTargetX[eid] = 0;
      NpcBrain.lastKnownTargetY[eid] = 0;
    }

    const body = this.world.physics.createBody({
      type: 'dynamic',
      layer: bodyLayer,
      mask: wallLayer | bodyLayer,
      shape: { kind: 'circle', x: position.x, y: position.y, radius: recipe.radius },
      restitution: 0,
      damping: 12,
      canSleep: false,
    });
    PhysicsBodyRef.bodyId[eid] = body.id;
    this.world.bodyByEntityId.set(entityId, body);
    this.world.entityIdByBodyId.set(body.id, entityId);
    this.statsSystem?.initializeCharacterStats(entityId);
  }

  private addProjectileComposition(eid: number, recipe: ProjectileRecipe): void {
    addComponent(this.world.ecs, eid, Projectile);
    Projectile.ownerEntityId[eid] = 0;
    Projectile.damage[eid] = recipe.damage;
    Projectile.lifetime[eid] = recipe.lifetimeSeconds;
  }

  private addPickupComposition(eid: number, _recipe: PickupItemRecipe): void {
    addComponent(this.world.ecs, eid, PickupItem);
    PickupItem.stackCount[eid] = 1;
  }
}
