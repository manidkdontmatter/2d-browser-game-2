// Defines the 6 allocatable character stat buckets, the derived effects they produce, and
// pure derivation functions shared by server and client. Allocations are the points a player
// spends; derived effects are the concrete gameplay numbers systems read. The two are
// deliberately separated so a single allocation point can produce multiple derived effects
// (e.g. +1 speed = +5 moveSpeed AND -0.01s attack delay AND -0.015s cooldown).

// ── Allocation stat definitions ──────────────────────────────────────────

export interface StatAllocationDefinition {
  readonly id: string;
  readonly label: string;
  readonly description: string;
}

export const characterStatAllocationDefinitions: readonly StatAllocationDefinition[] = [
  { id: 'power',      label: 'Power',      description: 'Attack damage and ability damage.' },
  { id: 'durability', label: 'Durability', description: 'Defense and maximum health.' },
  { id: 'speed',      label: 'Speed',      description: 'Movement speed, attack delay reduction, and cooldown reduction.' },
  { id: 'stamina',    label: 'Stamina',    description: 'Maximum stamina and stamina regeneration.' },
  { id: 'vitality',   label: 'Vitality',   description: 'Health regeneration.' },
  { id: 'spirit',     label: 'Spirit',     description: 'Bonus damage proportional to missing health.' },
];

export const MAX_ALLOCATION_POINTS = 5;

// ── Derived effect definitions ───────────────────────────────────────────

export interface DerivedEffectDefinition {
  readonly id: string;
  readonly label: string;
  readonly sourceStat: string;   // which allocation stat drives this effect
  readonly baseValue: number;    // value when the source stat allocation is 0
  readonly perPoint: number;     // additive increase per allocated point in sourceStat
}

export const characterDerivedEffectDefinitions: readonly DerivedEffectDefinition[] = [
  { id: 'attackPower',            label: 'Attack Power',            sourceStat: 'power',      baseValue: 100, perPoint: 30 },
  { id: 'abilityPower',           label: 'Ability Power',           sourceStat: 'power',      baseValue: 100, perPoint: 20 },
  { id: 'defense',                label: 'Defense',                 sourceStat: 'durability', baseValue: 100, perPoint: 20 },
  { id: 'maxHealth',              label: 'Max Health',              sourceStat: 'durability', baseValue: 100, perPoint: 40 },
  { id: 'moveSpeed',              label: 'Move Speed',              sourceStat: 'speed',      baseValue: 360, perPoint: 5 },
  { id: 'attackDelayReduction',   label: 'Attack Delay Reduction',  sourceStat: 'speed',      baseValue: 0,   perPoint: 0.010 },
  { id: 'cooldownReduction',      label: 'Cooldown Reduction',      sourceStat: 'speed',      baseValue: 0,   perPoint: 0.015 },
  { id: 'maxStamina',             label: 'Max Stamina',             sourceStat: 'stamina',    baseValue: 100, perPoint: 20 },
  { id: 'staminaRegen',           label: 'Stamina Regen',           sourceStat: 'stamina',    baseValue: 0,   perPoint: 1 },
  { id: 'healthRegen',            label: 'Health Regen',            sourceStat: 'vitality',   baseValue: 0,   perPoint: 0.4 },
  { id: 'spiritBonus',            label: 'Spirit Bonus',            sourceStat: 'spirit',     baseValue: 0,   perPoint: 0.10 },
];

// ── Data types ───────────────────────────────────────────────────────────

export type AllocationStatId = (typeof characterStatAllocationDefinitions)[number]['id'];

export type AllocatedStats = Record<AllocationStatId, number>;

export type DerivedStatId = (typeof characterDerivedEffectDefinitions)[number]['id'];

export type DerivedStats = Record<DerivedStatId, number>;

// ── Pure derivation ──────────────────────────────────────────────────────

export function createEmptyAllocations(): AllocatedStats {
  return { power: 0, durability: 0, speed: 0, stamina: 0, vitality: 0, spirit: 0 };
}

export function totalAllocatedPoints(allocations: AllocatedStats): number {
  return Object.values(allocations).reduce((sum, value) => sum + value, 0);
}

export function deriveStats(allocations: AllocatedStats): DerivedStats {
  const derived: Record<string, number> = {};
  for (const effect of characterDerivedEffectDefinitions) {
    const points = allocations[effect.sourceStat] ?? 0;
    derived[effect.id] = effect.baseValue + points * effect.perPoint;
  }
  return derived as DerivedStats;
}
