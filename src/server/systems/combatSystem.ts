// Resolves authoritative attacks, damage, death, and projectile simulation.
import { query } from 'bitecs';
import { ATTACK_RATE_LIMIT_MS, MELEE_DAMAGE, MELEE_RANGE, NPC_RESPAWN_SECONDS, PLAYER_RADIUS, PROJECTILE_RADIUS } from '../../shared/config.js';
import { effectDefinitions } from '../../shared/combat/effects.js';
import { AttackIntent, ControlIntent, ControllerKind } from '../../shared/domain/commands.js';
import { distance, normalize } from '../../shared/math/vector.js';
import { Active, Health, Identity, Position, Projectile, Velocity } from '../simulation/components.js';
import { isAlive, isControlledBy } from '../simulation/capabilities.js';
import { SimulationWorld } from '../simulation/simulationWorld.js';
import { CooldownLimiter } from './rateLimiter.js';
import { SpawnSystem } from './spawnSystem.js';
import { TileMutationSystem } from './tileMutationSystem.js';
import { AreaActivationSystem } from './areaActivationSystem.js';
import { EffectSystem } from './effectSystem.js';

export class CombatSystem {
  readonly attackLimiter = new CooldownLimiter(ATTACK_RATE_LIMIT_MS);
  private spawnSystem: SpawnSystem | null = null;
  private tileMutationSystem: TileMutationSystem | null = null;
  private areaActivationSystem: AreaActivationSystem | null = null;
  private onEntityDamaged: ((entityId: number) => void) | null = null;

  constructor(private readonly world: SimulationWorld, private readonly effects: EffectSystem) {}

  setSpawnSystem(spawnSystem: SpawnSystem): void {
    this.spawnSystem = spawnSystem;
  }

  setTileMutationSystem(tileMutationSystem: TileMutationSystem): void {
    this.tileMutationSystem = tileMutationSystem;
  }

  setAreaActivationSystem(areaActivationSystem: AreaActivationSystem): void {
    this.areaActivationSystem = areaActivationSystem;
  }

  setDamageObserver(observer: ((entityId: number) => void) | null): void {
    this.onEntityDamaged = observer;
  }

  handleIntent(intent: ControlIntent, simulationTimeMs: number): void {
    if (intent.attack === AttackIntent.None || !this.attackLimiter.accept(intent.entityId, simulationTimeMs)) {
      return;
    }

    const eid = this.world.eidByEntityId.get(intent.entityId);
    if (eid === undefined) {
      return;
    }

    if (!isAlive(eid)) {
      return;
    }

    if (intent.attack === AttackIntent.Melee) {
      const direction = normalize({ x: intent.aimX - Position.x[eid], y: intent.aimY - Position.y[eid] });
      this.applyMelee(intent.entityId, Position.x[eid], Position.y[eid], direction.x, direction.y);
      return;
    }

    if (intent.attack === AttackIntent.Projectile) {
      this.spawnSystem?.spawnProjectile(intent.entityId, Position.x[eid], Position.y[eid], intent.aimX - Position.x[eid], intent.aimY - Position.y[eid]);
    }
  }

  updateProjectiles(deltaSeconds: number): void {
    const toRemove: number[] = [];
    for (const eid of query(this.world.ecs, [Active, Identity, Projectile, Position, Velocity])) {
      Projectile.lifetime[eid] -= deltaSeconds;
      const nextX = Position.x[eid] + Velocity.x[eid] * deltaSeconds;
      const nextY = Position.y[eid] + Velocity.y[eid] * deltaSeconds;
      const tile = this.world.worldToTile(nextX, nextY);
      if (this.areaActivationSystem && !this.areaActivationSystem.isTileActive(tile.x, tile.y)) {
        toRemove.push(Identity.entityId[eid]);
        continue;
      }

      if (Projectile.lifetime[eid] <= 0 || !this.world.tileMap.isWalkable(tile.x, tile.y)) {
        this.tileMutationSystem?.damageTile(tile.x, tile.y, Projectile.damage[eid]);
        toRemove.push(Identity.entityId[eid]);
        continue;
      }

      const hit = this.findProjectileHit(Projectile.ownerEntityId[eid], nextX, nextY);
      if (hit !== 0) {
        this.damageEntity(hit, Projectile.damage[eid]);
        toRemove.push(Identity.entityId[eid]);
        continue;
      }

      Position.x[eid] = nextX;
      Position.y[eid] = nextY;
    }

    for (const entityId of toRemove) {
      this.spawnSystem?.removeProjectile(entityId);
    }
  }

  setEntityInvincible(entityId: number, enabled: boolean, simulationTimeMs: number): boolean {
    if (!this.world.eidByEntityId.has(entityId)) {
      return false;
    }

    if (enabled) {
      return this.effects.applyEffect(entityId, effectDefinitions.debugInvincible.id, simulationTimeMs);
    }
    return this.effects.removeEffect(entityId, effectDefinitions.debugInvincible.id);
  }

  isEntityInvincible(entityId: number): boolean {
    return this.effects.hasEffect(entityId, effectDefinitions.debugInvincible.id);
  }

  applyMelee(ownerEntityId: number, x: number, y: number, dirX: number, dirY: number): void {
    let bestTarget = 0;
    let bestDistance = Infinity;

    for (const eid of query(this.world.ecs, [Active, Identity, Health, Position])) {
      const targetId = Identity.entityId[eid];
      if (targetId === ownerEntityId || !isAlive(eid)) {
        continue;
      }

      const toTarget = { x: Position.x[eid] - x, y: Position.y[eid] - y };
      const targetDistance = Math.hypot(toTarget.x, toTarget.y);
      const targetDirection = normalize(toTarget);
      const facingDot = targetDirection.x * dirX + targetDirection.y * dirY;
      if (targetDistance <= MELEE_RANGE && facingDot > 0.25 && targetDistance < bestDistance) {
        bestDistance = targetDistance;
        bestTarget = targetId;
      }
    }

    if (bestTarget !== 0) {
      this.damageEntity(bestTarget, MELEE_DAMAGE);
      return;
    }

    this.damageAimedTile(x, y, dirX, dirY, MELEE_DAMAGE);
  }

  damageEntity(entityId: number, damage: number): void {
    const resolved = this.effects.resolveDamage({
      attackerEntityId: 0,
      targetEntityId: entityId,
      baseDamage: damage,
    });
    if (resolved.blocked || resolved.finalDamage <= 0) {
      return;
    }
    const eid = this.world.eidByEntityId.get(entityId);
    if (eid === undefined) {
      return;
    }

    Health.current[eid] = Math.max(0, Health.current[eid] - resolved.finalDamage);
    this.onEntityDamaged?.(entityId);
    if (Health.current[eid] <= 0 && isControlledBy(eid, ControllerKind.Human)) {
      this.spawnSystem?.respawnControlledEntity(entityId);
      return;
    }

    if (Health.current[eid] <= 0) {
      this.spawnSystem?.deactivateAiEntityForRespawn(entityId, NPC_RESPAWN_SECONDS);
    }
  }

  private findProjectileHit(ownerEntityId: number, x: number, y: number): number {
    for (const eid of query(this.world.ecs, [Active, Identity, Health, Position])) {
      const entityId = Identity.entityId[eid];
      if (entityId === ownerEntityId || !isAlive(eid)) {
        continue;
      }

      if (distance({ x, y }, { x: Position.x[eid], y: Position.y[eid] }) <= PLAYER_RADIUS + PROJECTILE_RADIUS) {
        return entityId;
      }
    }

    return 0;
  }

  private damageAimedTile(x: number, y: number, dirX: number, dirY: number, damage: number): void {
    const target = this.world.worldToTile(x + dirX * MELEE_RANGE, y + dirY * MELEE_RANGE);
    if (this.world.tileMap.isDense(target.x, target.y)) {
      this.tileMutationSystem?.damageTile(target.x, target.y, damage);
    }
  }
}
