// Defines the shared authoring contract for player-created and game-default abilities.
// This module intentionally contains only deterministic data shapes, catalog
// definitions, and pure calculation helpers. The browser can use it to drive
// the ability creator UI immediately, while the authoritative server can later
// use the same rules to validate submitted ability definitions before saving or
// allowing them to be executed. It does not describe runtime combat behavior;
// authored abilities and activated abilities are separate concerns. Built-in
// attacks are represented as ordinary authored ability definitions so default
// game content and player-created content share the same long-term data shape.
import { ContentKind, type ContentDefinitionBase, type ContentValidationError } from '../content/types.js';
import { AttackIntent } from '../domain/commands.js';

export const abilityTypes = ['melee', 'projectile', 'beam', 'area_of_effect', 'buff', 'movement'] as const;
export type AbilityType = (typeof abilityTypes)[number];

export const abilityTiers = [1, 2, 3, 4, 5] as const;
export type AbilityTier = (typeof abilityTiers)[number];

export type AbilityAttributePolarity = 'upside' | 'downside';

export interface AbilityStatDefinition {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly appliesTo: readonly AbilityType[];
}

export interface AbilityAttributeDefinition {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly polarity: AbilityAttributePolarity;
  readonly budgetDelta: number;
  readonly appliesTo: readonly AbilityType[];
}

export interface AuthoredAbilityDefinition extends ContentDefinitionBase {
  readonly kind: typeof ContentKind.Ability;
  readonly name: string;
  readonly description: string;
  readonly type: AbilityType;
  readonly tier: AbilityTier;
  readonly statAllocations: Readonly<Record<string, number>>;
  readonly attributeIds: readonly string[];
}

export interface AbilityBudgetSummary {
  readonly baseBudget: number;
  readonly spentBudget: number;
  readonly grantedBudget: number;
  readonly remainingBudget: number;
}

export interface AbilityStatPointSummary {
  readonly availablePoints: number;
  readonly spentPoints: number;
  readonly remainingPoints: number;
}

export interface AbilityAuthoringSummary {
  readonly statPoints: AbilityStatPointSummary;
  readonly attributeBudget: AbilityBudgetSummary;
  readonly errors: readonly ContentValidationError[];
}

const allAbilityTypes = abilityTypes;

export const abilityStatDefinitions: readonly AbilityStatDefinition[] = [
  { id: 'stat1', label: 'Stat 1', description: 'placeholder description', appliesTo: allAbilityTypes },
  { id: 'stat2', label: 'Stat 2', description: 'placeholder description', appliesTo: allAbilityTypes },
  { id: 'stat3', label: 'Stat 3', description: 'placeholder description', appliesTo: allAbilityTypes },
];

export const abilityAttributeDefinitions: readonly AbilityAttributeDefinition[] = [
  { id: 'upside_1', label: 'Upside 1', description: 'placeholder description', polarity: 'upside', budgetDelta: -50, appliesTo: allAbilityTypes },
  { id: 'upside_2', label: 'Upside 2', description: 'placeholder description', polarity: 'upside', budgetDelta: -50, appliesTo: allAbilityTypes },
  { id: 'upside_3', label: 'Upside 3', description: 'placeholder description', polarity: 'upside', budgetDelta: -50, appliesTo: allAbilityTypes },
  { id: 'downside_1', label: 'Downside 1', description: 'placeholder description', polarity: 'downside', budgetDelta: 50, appliesTo: allAbilityTypes },
  { id: 'downside_2', label: 'Downside 2', description: 'placeholder description', polarity: 'downside', budgetDelta: 50, appliesTo: allAbilityTypes },
  { id: 'downside_3', label: 'Downside 3', description: 'placeholder description', polarity: 'downside', budgetDelta: 50, appliesTo: allAbilityTypes },
];

export const defaultAbilityIds = {
  basicMelee: 'ability.default.basic_melee',
  basicProjectile: 'ability.default.basic_projectile',
} as const;

export const defaultAuthoredAbilities: readonly AuthoredAbilityDefinition[] = [
  {
    kind: ContentKind.Ability,
    id: defaultAbilityIds.basicMelee,
    version: 1,
    tags: ['game-default'],
    name: 'Melee Attack',
    description: 'A default close-range attack used by the existing left mouse button combat input.',
    type: 'melee',
    tier: 1,
    statAllocations: { stat1: 0, stat2: 0, stat3: 0 },
    attributeIds: [],
  },
  {
    kind: ContentKind.Ability,
    id: defaultAbilityIds.basicProjectile,
    version: 1,
    tags: ['game-default'],
    name: 'Projectile Attack',
    description: 'A default ranged attack used by the existing right mouse button combat input.',
    type: 'projectile',
    tier: 1,
    statAllocations: { stat1: 0, stat2: 0, stat3: 0 },
    attributeIds: [],
  },
];

export function getDefaultAuthoredAbilityForAttackIntent(
  attack: AttackIntent,
): AuthoredAbilityDefinition | null {
  if (attack === AttackIntent.Melee) {
    return defaultAuthoredAbilities[0];
  }
  if (attack === AttackIntent.Projectile) {
    return defaultAuthoredAbilities[1];
  }
  return null;
}

export function getAbilityStatDefinitions(type: AbilityType): readonly AbilityStatDefinition[] {
  return abilityStatDefinitions.filter((definition) => definition.appliesTo.includes(type));
}

export function getAbilityAttributeDefinitions(
  type: AbilityType,
  polarity?: AbilityAttributePolarity,
): readonly AbilityAttributeDefinition[] {
  return abilityAttributeDefinitions.filter((definition) => {
    return definition.appliesTo.includes(type) && (!polarity || definition.polarity === polarity);
  });
}

export function isAbilityType(value: string): value is AbilityType {
  return (abilityTypes as readonly string[]).includes(value);
}

export function isAbilityTier(value: number): value is AbilityTier {
  return Number.isInteger(value) && (abilityTiers as readonly number[]).includes(value);
}

export function getAbilityTierStatPoints(tier: AbilityTier): number {
  return tier * 5;
}

export function getAbilityTierAttributeBudget(tier: AbilityTier): number {
  return 100 + (tier - 1) * 50;
}

export function summarizeAuthoredAbility(ability: AuthoredAbilityDefinition): AbilityAuthoringSummary {
  const errors: ContentValidationError[] = [];
  validateAuthoredAbility(ability, errors);
  return {
    statPoints: summarizeAbilityStatPoints(ability),
    attributeBudget: summarizeAbilityAttributeBudget(ability),
    errors,
  };
}

export function summarizeAbilityStatPoints(ability: AuthoredAbilityDefinition): AbilityStatPointSummary {
  const availablePoints = getAbilityTierStatPoints(ability.tier);
  const spentPoints = Object.values(ability.statAllocations).reduce((total, value) => total + value, 0);
  return {
    availablePoints,
    spentPoints,
    remainingPoints: availablePoints - spentPoints,
  };
}

export function summarizeAbilityAttributeBudget(ability: AuthoredAbilityDefinition): AbilityBudgetSummary {
  const baseBudget = getAbilityTierAttributeBudget(ability.tier);
  let spentBudget = 0;
  let grantedBudget = 0;

  for (const attributeId of ability.attributeIds) {
    const definition = abilityAttributeDefinitions.find((candidate) => candidate.id === attributeId);
    if (!definition) {
      continue;
    }

    if (definition.budgetDelta < 0) {
      spentBudget += Math.abs(definition.budgetDelta);
    } else {
      grantedBudget += definition.budgetDelta;
    }
  }

  return {
    baseBudget,
    spentBudget,
    grantedBudget,
    remainingBudget: baseBudget + grantedBudget - spentBudget,
  };
}

export function createEmptyStatAllocations(type: AbilityType): Record<string, number> {
  return Object.fromEntries(getAbilityStatDefinitions(type).map((definition) => [definition.id, 0]));
}

export function normalizeStatAllocations(
  type: AbilityType,
  allocations: Readonly<Record<string, number>>,
): Record<string, number> {
  const normalized: Record<string, number> = {};
  for (const definition of getAbilityStatDefinitions(type)) {
    normalized[definition.id] = Math.max(0, Math.floor(allocations[definition.id] ?? 0));
  }
  return normalized;
}

function validateAuthoredAbility(ability: AuthoredAbilityDefinition, errors: ContentValidationError[]): void {
  if (ability.kind !== ContentKind.Ability) {
    errors.push({
      code: 'invalid_kind',
      message: `Ability '${ability.id}' must have kind '${ContentKind.Ability}'.`,
      definitionId: ability.id,
    });
  }
  if (!ability.name.trim()) {
    errors.push({
      code: 'missing_ability_name',
      message: 'Ability name is required.',
      definitionId: ability.id,
    });
  }
  if (ability.description.length > 400) {
    errors.push({
      code: 'ability_description_too_long',
      message: `Ability '${ability.id}' description is too long.`,
      definitionId: ability.id,
    });
  }
  if (!isAbilityType(ability.type)) {
    errors.push({
      code: 'invalid_ability_type',
      message: `Ability '${ability.id}' has invalid type '${ability.type}'.`,
      definitionId: ability.id,
    });
  }
  if (!isAbilityTier(ability.tier)) {
    errors.push({
      code: 'invalid_ability_tier',
      message: `Ability '${ability.id}' has invalid tier '${ability.tier}'.`,
      definitionId: ability.id,
    });
  }

  const validStatIds = new Set(getAbilityStatDefinitions(ability.type).map((definition) => definition.id));
  for (const [statId, allocation] of Object.entries(ability.statAllocations)) {
    if (!validStatIds.has(statId)) {
      errors.push({
        code: 'invalid_ability_stat',
        message: `Ability '${ability.id}' has stat allocation for unavailable stat '${statId}'.`,
        definitionId: ability.id,
      });
    }
    if (!Number.isInteger(allocation) || allocation < 0) {
      errors.push({
        code: 'invalid_ability_stat_allocation',
        message: `Ability '${ability.id}' has invalid allocation '${allocation}' for stat '${statId}'.`,
        definitionId: ability.id,
      });
    }
  }

  const statSummary = summarizeAbilityStatPoints(ability);
  if (statSummary.remainingPoints < 0) {
    errors.push({
      code: 'ability_stat_budget_exceeded',
      message: `Ability '${ability.id}' spends ${statSummary.spentPoints} stat points but only has ${statSummary.availablePoints}.`,
      definitionId: ability.id,
    });
  }

  const validAttributeIds = new Set(getAbilityAttributeDefinitions(ability.type).map((definition) => definition.id));
  const seenAttributeIds = new Set<string>();
  for (const attributeId of ability.attributeIds) {
    if (seenAttributeIds.has(attributeId)) {
      errors.push({
        code: 'duplicate_ability_attribute',
        message: `Ability '${ability.id}' repeats attribute '${attributeId}'.`,
        definitionId: ability.id,
      });
    }
    seenAttributeIds.add(attributeId);

    if (!validAttributeIds.has(attributeId)) {
      errors.push({
        code: 'invalid_ability_attribute',
        message: `Ability '${ability.id}' uses unavailable attribute '${attributeId}'.`,
        definitionId: ability.id,
      });
    }
  }

  const budgetSummary = summarizeAbilityAttributeBudget(ability);
  if (budgetSummary.remainingBudget < 0) {
    errors.push({
      code: 'ability_attribute_budget_exceeded',
      message: `Ability '${ability.id}' exceeds its attribute budget by ${Math.abs(budgetSummary.remainingBudget)}.`,
      definitionId: ability.id,
    });
  }
}
