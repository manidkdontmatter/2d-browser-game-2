// Resolves authoritative attacks, damage, death, and projectile simulation.
// Integrates with StatsSystem so damage, attack speed, defense, and spirit are
// driven by character derived stats instead of hardcoded constants.
import { query } from 'bitecs';
import {
  BASE_ATTACK_DELAY_MS,
  MELEE_DAMAGE,
  MELEE_RANGE,
  MIN_ATTACK_DELAY_MS,
  NPC_RESPAWN_SECONDS,
  PLAYER_RADIUS,
  PROJECTILE_DAMAGE,
  PROJECTILE_RADIUS,
} from '../../shared/config.js';
import { getDefaultAuthoredAbilityForAttackIntent } from '../../shared/abilities/abilityAuthoring.js';
import { effectDefinitions } from '../../shared/combat/effects.js';
import { AttackIntent, ControlIntent, ControllerKind } from '../../shared/domain/commands.js';
import type { DerivedStats } from '../../shared/stats/characterStats.js';
import { distance, normalize } from '../../shared/math/vector.js';
import { Active, Health, Identity, Position, Projectile, Velocity } from '../simulation/components.js';
import { isAlive, isControlledBy } from '../simulation/capabilities.js';
import { SimulationWorld } from '../simulation/simulationWorld.js';
import { CooldownLimiter } from './rateLimiter.js';
import { SpawnSystem } from './spawnSystem.js';
import { TileMutationSystem } from './tileMutationSystem.js';
import { AreaActivationSystem } from './areaActivationSystem.js';
import { EffectSystem } from './effectSystem.js';
import type { StatsSystem } from './statsSystem.js';

const DEFAULT_MELEE_STAMINA_COST = 10;
const DEFAULT_PROJECTILE_STAMINA_COST = 15;

export class CombatSystem {
  readonly attackLimiter = new CooldownLimiter(BASE_ATTACK_DELAY_MS);
  private spawnSystem: SpawnSystem | null = null;
  private tileMutationSystem: TileMutationSystem | null = null;
  private areaActivationSystem: AreaActivationSystem | null = null;
  private statsSystem: StatsSystem | null = null;
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

  setStatsSystem(statsSystem: StatsSystem): void {
    this.statsSystem = statsSystem;
  }

  setDamageObserver(observer: ((entityId: number) => void) | null): void {
    this.onEntityDamaged = observer;
  }

  handleIntent(intent: ControlIntent, simulationTimeMs: number): void {
    if (intent.attack === AttackIntent.None) {
      return;
    }

    const eid = this.world.eidByEntityId.get(intent.entityId);
    if (eid === undefined || !isAlive(eid)) {
      return;
    }

    const ability = getDefaultAuthoredAbilityForAttackIntent(intent.attack);
    if (!ability) {
      return;
    }

    const attackerStats = this.world.derivedStats.get(intent.entityId);
    const attackDelay = attackerStats
      ? Math.max(MIN_ATTACK_DELAY_MS, BASE_ATTACK_DELAY_MS - attackerStats.attackDelayReduction * 1000)
      : BASE_ATTACK_DELAY_MS;

    if (!this.attackLimiter.accept(intent.entityId, simulationTimeMs, attackDelay)) {
      return;
    }

    const staminaCost = ability.type === 'melee' ? DEFAULT_MELEE_STAMINA_COST : DEFAULT_PROJECTILE_STAMINA_COST;
    if (!this.statsSystem?.consumeStamina(intent.entityId, staminaCost)) {
      return;
    }

    if (ability.type === 'melee') {
      const direction = normalize({ x: intent.aimX - Position.x[eid], y: intent.aimY - Position.y[eid] });
      this.applyMelee(intent.entityId, Position.x[eid], Position.y[eid], direction.x, direction.y, attackerStats ?? undefined);
      return;
    }

    if (ability.type === 'projectile') {
      const baseDamage = attackerStats
        ? PROJECTILE_DAMAGE * (attackerStats.abilityPower / 100)
        : PROJECTILE_DAMAGE;
      const spiritDamage = attackerStats
        ? applySpiritBonus(baseDamage, attackerStats, Health.current[eid], Health.max[eid])
        : baseDamage;
      this.spawnSystem?.spawnProjectile(
        intent.entityId,
        Position.x[eid],
        Position.y[eid],
        intent.aimX - Position.x[eid],
        intent.aimY - Position.y[eid],
        Math.floor(spiritDamage),
      );
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

  private applyMelee(
    ownerEntityId: number,
    x: number,
    y: number,
    dirX: number,
    dirY: number,
    attackerStats?: DerivedStats,
  ): void {
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
      const baseDamage = attackerStats
        ? MELEE_DAMAGE * (attackerStats.attackPower / 100)
        : MELEE_DAMAGE;
      const damage = this.computeFinalDamage(ownerEntityId, baseDamage, attackerStats, bestTarget);
      this.damageEntity(bestTarget, damage);
      return;
    }

    this.damageAimedTile(x, y, dirX, dirY, MELEE_DAMAGE);
  }

  private computeFinalDamage(
    attackerEntityId: number,
    baseDamage: number,
    attackerStats: DerivedStats | undefined,
    targetEntityId: number,
  ): number {
    let damage = baseDamage;

    if (attackerStats) {
      const eid = this.world.eidByEntityId.get(attackerEntityId);
      if (eid !== undefined && isAlive(eid)) {
        damage = applySpiritBonus(damage, attackerStats, Health.current[eid], Health.max[eid]);
      }
    }

    const targetStats = this.world.derivedStats.get(targetEntityId);
    if (targetStats) {
      damage = Math.max(0, damage - targetStats.defense);
    }

    return Math.floor(damage);
  }

  private damageEntity(entityId: number, damage: number): void {
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

function applySpiritBonus(damage: number, stats: DerivedStats, currentHealth: number, maxHealth: number): number {
  if (stats.spiritBonus <= 0 || maxHealth <= 0 || currentHealth >= maxHealth) {
    return damage;
  }

  const missingRatio = 1 - currentHealth / maxHealth;
  return damage * (1 + missingRatio * stats.spiritBonus);
}
