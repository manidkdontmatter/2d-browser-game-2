// Orchestrates the authoritative simulation by sequencing focused gameplay systems each fixed tick.
import { FIXED_DELTA_SECONDS, PLAYER_MOVE_SPEED } from '../../shared/config.js';
import { PlayerCommand } from '../../shared/domain/commands.js';
import { entityRecipeIds } from '../../shared/entities/entityRecipes.js';
import { EntitySnapshot, NetEntityKind, NetEntityRecord } from '../../shared/domain/snapshots.js';
import type { TileMutation, WorldGenerationIdentity } from '../../shared/world/mapTypes.js';
import { TileType } from '../../shared/world/mapTypes.js';
import { CombatSystem } from '../systems/combatSystem.js';
import { AiSystem } from '../systems/aiSystem.js';
import { InputSystem } from '../systems/inputSystem.js';
import { PhysicsSystem } from '../systems/physicsSystem.js';
import { ReplicationSystem } from '../systems/replicationSystem.js';
import { SpawnSystem } from '../systems/spawnSystem.js';
import { TileMutationSystem } from '../systems/tileMutationSystem.js';
import { AreaActivationSystem } from '../systems/areaActivationSystem.js';
import { EffectSystem } from '../systems/effectSystem.js';
import { SpatialQuerySystem } from '../systems/spatialQuerySystem.js';
import type { AiSchedulerMetrics } from '../systems/aiSchedulerSystem.js';
import { createDefaultContentRegistry } from '../content/contentRegistry.js';
import { EntityComposer } from './entityComposer.js';
import { MindSystem } from './mindSystem.js';
import { SimulationWorld } from './simulationWorld.js';

export interface PlayerMindSpawn {
  mindId: number;
  entityId: number;
}

export interface MapPortal {
  entityId: number;
  x: number;
  y: number;
  radius: number;
  targetMapId: string;
  targetMapName: string;
  targetUrl: string;
  token: string;
}

export class GameSimulation {
  readonly world: SimulationWorld;
  private readonly combat: CombatSystem;
  private readonly composer: EntityComposer;
  private readonly spawns: SpawnSystem;
  private readonly minds: MindSystem;
  private readonly input: InputSystem;
  private readonly ai: AiSystem;
  private readonly physicsSystem: PhysicsSystem;
  private readonly replication: ReplicationSystem;
  private readonly tileMutations: TileMutationSystem;
  private readonly areaActivation: AreaActivationSystem;
  private readonly effects: EffectSystem;
  private readonly spatialQuery: SpatialQuerySystem;
  private readonly content = createDefaultContentRegistry();
  private lastAiSchedulerMetrics: AiSchedulerMetrics = {
    sensed: 0,
    planned: 0,
    budgetSkippedSense: 0,
    budgetSkippedPlan: 0,
    wakeEvents: 0,
  };
  private readonly portals: MapPortal[] = [];
  private simulationTimeSeconds = 0;

  constructor(identity?: WorldGenerationIdentity, mutations: TileMutation[] = []) {
    this.world = new SimulationWorld(identity, mutations);
    this.effects = new EffectSystem();
    this.spatialQuery = new SpatialQuerySystem(this.world);
    this.areaActivation = new AreaActivationSystem(this.world);
    this.tileMutations = new TileMutationSystem(this.world);
    this.combat = new CombatSystem(this.world, this.effects);
    this.composer = new EntityComposer(this.world, this.content);
    this.minds = new MindSystem(this.world);
    this.spawns = new SpawnSystem(this.world, this.content, this.composer, this.minds, this.combat.attackLimiter);
    this.input = new InputSystem(this.world, this.combat);
    this.ai = new AiSystem(this.world, this.combat, this.areaActivation, this.spatialQuery);
    this.physicsSystem = new PhysicsSystem(this.world);
    this.replication = new ReplicationSystem(this.world);
    this.combat.setSpawnSystem(this.spawns);
    this.combat.setTileMutationSystem(this.tileMutations);
    this.combat.setAreaActivationSystem(this.areaActivation);
    this.combat.setDamageObserver((entityId) => this.ai.wakeEntity(entityId));
    this.areaActivation.update();
    this.world.tileCollision.syncActiveChunkIndexes(this.areaActivation.getActiveChunkIndexes());
  }

  get ecs(): SimulationWorld['ecs'] {
    return this.world.ecs;
  }

  get identity(): SimulationWorld['identity'] {
    return this.world.identity;
  }

  get generated(): SimulationWorld['generated'] {
    return this.world.generated;
  }

  get tileMap(): SimulationWorld['tileMap'] {
    return this.world.tileMap;
  }

  get physics(): SimulationWorld['physics'] {
    return this.world.physics;
  }

  spawnPlayer(): number {
    return this.spawns.spawnPlayer();
  }

  spawnPlayerMind(): PlayerMindSpawn {
    const entityId = this.spawnPlayer();
    const mindId = this.minds.getMindIdForControlledEntity(entityId);
    if (mindId === null) {
      throw new Error(`Spawned player entity ${entityId} without a mind`);
    }
    return { mindId, entityId };
  }

  spawnHostileNpcs(count: number): number[] {
    return this.spawns.spawnHostileNpcs(count);
  }

  queueCommand(entityId: number, command: PlayerCommand): void {
    this.input.queueCommand(entityId, command);
  }

  queueCommandForMind(mindId: number, command: PlayerCommand): void {
    const entityId = this.minds.getControlledEntityId(mindId);
    if (entityId !== null) {
      this.input.queueCommand(entityId, command);
    }
  }

  getControlledEntityId(mindId: number): number | null {
    return this.minds.getControlledEntityId(mindId);
  }

  transferMindToEntity(mindId: number, entityId: number): boolean {
    return this.minds.attachMindToEntity(mindId, entityId);
  }

  removeMind(mindId: number): void {
    this.minds.removeMind(mindId);
  }

  spawnMobileDoorBodyNear(entityId: number): number | null {
    const position = this.world.getEntityPosition(entityId);
    if (!position) {
      return null;
    }

    const mobileDoorId = this.composer.createFromRecipe(entityRecipeIds.woodDoorBody, {
      x: position.x + 96,
      y: position.y,
    });
    if (
      !this.composer.setLocomotionSpeed(mobileDoorId, PLAYER_MOVE_SPEED * 0.7)
      || !this.composer.setControllable(mobileDoorId, true)
    ) {
      this.composer.removeEntity(mobileDoorId);
      return null;
    }
    this.composer.activateEntity(mobileDoorId);
    return mobileDoorId;
  }

  spawnAndTransferMindToMobileDoor(mindId: number): number | null {
    const currentEntityId = this.minds.getControlledEntityId(mindId);
    if (currentEntityId === null) {
      return null;
    }

    const mobileDoorId = this.spawnMobileDoorBodyNear(currentEntityId);
    if (mobileDoorId === null || !this.transferMindToEntity(mindId, mobileDoorId)) {
      return null;
    }
    return mobileDoorId;
  }

  removeEntity(entityId: number): void {
    this.spawns.removeEntity(entityId);
  }

  hasEntityBody(entityId: number): boolean {
    return this.world.eidByEntityId.has(entityId) && this.world.bodyByEntityId.has(entityId);
  }

  step(deltaSeconds = FIXED_DELTA_SECONDS): void {
    this.simulationTimeSeconds += deltaSeconds;
    const simulationTimeMs = this.simulationTimeSeconds * 1000;
    this.spawns.updateRespawns(deltaSeconds);
    this.effects.update(simulationTimeMs);
    this.areaActivation.update();
    this.world.tileCollision.syncActiveChunkIndexes(this.areaActivation.getActiveChunkIndexes());
    this.input.applyHumanInput(simulationTimeMs);
    this.spatialQuery.syncFromWorld();
    this.ai.updateNpcBrains(deltaSeconds, simulationTimeMs);
    this.lastAiSchedulerMetrics = this.ai.snapshotSchedulerMetrics();
    this.combat.updateProjectiles(deltaSeconds);
    this.physicsSystem.step(deltaSeconds);
    this.replication.syncNetworkRecords();
  }

  getSnapshots(): EntitySnapshot[] {
    return this.replication.getSnapshots();
  }

  getNetworkRecords(): NetEntityRecord[] {
    return this.replication.getNetworkRecords();
  }

  mutateTile(x: number, y: number, tile: TileType): boolean {
    return this.tileMutations.mutateTile(x, y, tile).accepted;
  }

  damageTile(x: number, y: number, damage: number): boolean {
    return this.tileMutations.damageTile(x, y, damage).accepted;
  }

  drainTileMutationReplication(): TileMutation[] {
    return this.tileMutations.drainPendingReplication();
  }

  getTileMutationsInRect(rect: { minX: number; minY: number; maxX: number; maxY: number }): TileMutation[] {
    return this.tileMap.exportMutationsInRect(rect);
  }

  addPortalToTarget(target: Omit<MapPortal, 'entityId' | 'x' | 'y' | 'radius'>): MapPortal {
    const spawn = this.world.findPortalSpawnPoint();
    const portal: MapPortal = {
      entityId: this.world.allocateEntityId(),
      x: spawn.x,
      y: spawn.y,
      radius: 72,
      ...target,
    };
    const record = this.world.createNetworkRecord(portal.entityId, NetEntityKind.Portal);
    record.x = portal.x;
    record.y = portal.y;
    record.health = 1;
    this.world.netEntities.set(portal.entityId, record);
    this.portals.push(portal);
    return portal;
  }

  findPortalTransferForEntity(entityId: number): MapPortal | null {
    const position = this.world.getEntityPosition(entityId);
    if (!position) {
      return null;
    }

    return this.portals.find((portal) => Math.hypot(position.x - portal.x, position.y - portal.y) <= portal.radius) ?? null;
  }

  getPoolStats(): { pooledProjectiles: number; pooledNpcs: number; pendingNpcRespawns: number } {
    return this.spawns.getPoolStats();
  }

  setEntityInvincible(entityId: number, enabled: boolean): boolean {
    return this.combat.setEntityInvincible(entityId, enabled, this.simulationTimeSeconds * 1000);
  }

  isEntityInvincible(entityId: number): boolean {
    return this.combat.isEntityInvincible(entityId);
  }

  getActiveChunkCount(): number {
    return this.areaActivation.getActiveChunkCount();
  }

  getAiSchedulerMetrics(): AiSchedulerMetrics {
    return this.lastAiSchedulerMetrics;
  }
}
