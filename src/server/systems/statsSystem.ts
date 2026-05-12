// Owns authoritative character stat allocation, derivation, stamina, and passive regeneration.
// Derived stats feed into combat, locomotion, and ability systems so gameplay numbers are
// driven by data rather than hardcoded constants. Allocations (the 6 point-buy buckets) are
// separate from derived effects (the concrete values systems read) — a single allocation point
// can produce multiple derived effects. Stamina is a runtime resource pool consumed by
// abilities; it regenerates 10 % of max per second plus a flat bonus from the stamina stat.
import { addComponent, hasComponent, type EntityId } from 'bitecs';
import {
  createEmptyAllocations,
  deriveStats,
  totalAllocatedPoints,
  MAX_ALLOCATION_POINTS,
  type AllocatedStats,
  type DerivedStats,
} from '../../shared/stats/characterStats.js';
import {
  Health,
  Locomotion,
  Stamina,
} from '../simulation/components.js';
import { isAlive } from '../simulation/capabilities.js';
import { SimulationWorld } from '../simulation/simulationWorld.js';

const STAMINA_REGEN_FRACTION_PER_SECOND = 0.10;

export class StatsSystem {
  constructor(private readonly world: SimulationWorld) {}

  // ── Initialization ───────────────────────────────────────────────────

  initializeCharacterStats(entityId: number): void {
    const eid = this.world.eidByEntityId.get(entityId);
    if (eid === undefined) {
      return;
    }

    const allocations = createEmptyAllocations();
    this.world.allocatedStats.set(entityId, allocations);

    const derived = deriveStats(allocations);
    this.world.derivedStats.set(entityId, derived);

    this.syncComponentsFromDerived(entityId, derived);
    this.initializeStamina(eid, derived.maxStamina);
  }

  // ── Allocation ───────────────────────────────────────────────────────

  getAllocatedStats(entityId: number): AllocatedStats | null {
    return this.world.allocatedStats.get(entityId) ?? null;
  }

  getDerivedStats(entityId: number): DerivedStats | null {
    return this.world.derivedStats.get(entityId) ?? null;
  }

  allocatePoint(entityId: number, statId: string): boolean {
    const allocations = this.world.allocatedStats.get(entityId);
    if (!allocations || !(statId in allocations)) {
      return false;
    }

    if (totalAllocatedPoints(allocations) >= MAX_ALLOCATION_POINTS) {
      return false;
    }

    (allocations as Record<string, number>)[statId] += 1;
    this.recomputeDerived(entityId);
    return true;
  }

  removePoint(entityId: number, statId: string): boolean {
    const allocations = this.world.allocatedStats.get(entityId);
    if (!allocations || !(statId in allocations)) {
      return false;
    }

    const current = (allocations as Record<string, number>)[statId];
    if (current <= 0) {
      return false;
    }

    (allocations as Record<string, number>)[statId] -= 1;
    this.recomputeDerived(entityId);
    return true;
  }

  resetAllocations(entityId: number): boolean {
    const allocations = this.world.allocatedStats.get(entityId);
    if (!allocations) {
      return false;
    }

    for (const key of Object.keys(allocations)) {
      (allocations as Record<string, number>)[key] = 0;
    }
    this.recomputeDerived(entityId);
    return true;
  }

  consumeStamina(entityId: number, amount: number): boolean {
    const eid = this.world.eidByEntityId.get(entityId);
    if (eid === undefined || !hasComponent(this.world.ecs, eid, Stamina)) {
      return false;
    }

    if (Stamina.current[eid] < amount) {
      return false;
    }

    Stamina.current[eid] -= amount;
    return true;
  }

  // ── Tick update ──────────────────────────────────────────────────────

  update(deltaSeconds: number): void {
    // Iterate entityIds that have derived stats — these are the entities with
    // allocations (characters). Each tick we regen stamina and health.
    for (const entityId of this.world.derivedStats.keys()) {
      const eid = this.world.eidByEntityId.get(entityId);
      if (eid === undefined || !isAlive(eid)) {
        continue;
      }

      if (hasComponent(this.world.ecs, eid, Stamina)) {
        this.regenStamina(entityId, eid, deltaSeconds);
      }
      this.regenHealth(entityId, eid, deltaSeconds);
    }
  }

  // ── Cleanup ──────────────────────────────────────────────────────────

  removeStats(entityId: number): void {
    this.world.allocatedStats.delete(entityId);
    this.world.derivedStats.delete(entityId);
  }

  // ── Internals ────────────────────────────────────────────────────────

  private recomputeDerived(entityId: number): void {
    const allocations = this.world.allocatedStats.get(entityId);
    const eid = this.world.eidByEntityId.get(entityId);
    if (!allocations || eid === undefined) {
      return;
    }

    const derived = deriveStats(allocations);
    this.world.derivedStats.set(entityId, derived);
    this.syncComponentsFromDerived(entityId, derived);

    if (hasComponent(this.world.ecs, eid, Stamina)) {
      Stamina.max[eid] = derived.maxStamina;
      if (Stamina.current[eid] > Stamina.max[eid]) {
        Stamina.current[eid] = Stamina.max[eid];
      }
    }
  }

  private syncComponentsFromDerived(entityId: number, derived: DerivedStats): void {
    const eid = this.world.eidByEntityId.get(entityId);
    if (eid === undefined) {
      return;
    }

    if (hasComponent(this.world.ecs, eid, Locomotion)) {
      Locomotion.speed[eid] = derived.moveSpeed;
    }
    if (hasComponent(this.world.ecs, eid, Health)) {
      const oldMax = Health.max[eid];
      Health.max[eid] = derived.maxHealth;
      if (Health.current[eid] > derived.maxHealth) {
        Health.current[eid] = derived.maxHealth;
      } else if (Health.current[eid] === oldMax) {
        // Snap current to max when they were equal (entity was at full health).
        Health.current[eid] = derived.maxHealth;
      } else {
        // Keep current health but scale proportionally to new max.
        const ratio = oldMax > 0 ? Health.current[eid] / oldMax : 1;
        Health.current[eid] = Math.max(1, Math.floor(derived.maxHealth * ratio));
      }
    }
  }

  private initializeStamina(eid: EntityId, maxStamina: number): void {
    if (!hasComponent(this.world.ecs, eid, Stamina)) {
      addComponent(this.world.ecs, eid, Stamina);
    }
    Stamina.current[eid] = maxStamina;
    Stamina.max[eid] = maxStamina;
  }

  private regenStamina(entityId: number, eid: EntityId, deltaSeconds: number): void {
    const derived = this.world.derivedStats.get(entityId);
    if (!derived || Stamina.current[eid] >= Stamina.max[eid]) {
      return;
    }

    const baseRegen = Stamina.max[eid] * STAMINA_REGEN_FRACTION_PER_SECOND;
    const flatRegen = derived.staminaRegen;
    Stamina.current[eid] = Math.min(
      Stamina.max[eid],
      Stamina.current[eid] + (baseRegen + flatRegen) * deltaSeconds,
    );
  }

  private regenHealth(entityId: number, eid: EntityId, deltaSeconds: number): void {
    const derived = this.world.derivedStats.get(entityId);
    if (!derived || derived.healthRegen <= 0) {
      return;
    }

    if (Health.current[eid] >= Health.max[eid]) {
      return;
    }

    Health.current[eid] = Math.min(
      Health.max[eid],
      Health.current[eid] + derived.healthRegen * deltaSeconds,
    );
  }
}
