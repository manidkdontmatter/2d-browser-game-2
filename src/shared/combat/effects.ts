// Defines deterministic authoritative status-effect schemas and built-in effect definitions for combat resolution.
export type StackPolicy = 'replace' | 'refresh' | 'stack_add' | 'max';

export type EffectModifier =
  | { type: 'block_damage' }
  | { type: 'damage_multiplier'; value: number }
  | { type: 'flat_damage_delta'; value: number }
  | { type: 'min_damage'; value: number }
  | { type: 'max_damage'; value: number }
  | { type: 'immunity_tag'; tag: string };

export interface EffectDefinition {
  id: string;
  tags: readonly string[];
  durationMs: number | null;
  stackPolicy: StackPolicy;
  maxStacks: number;
  modifiers: readonly EffectModifier[];
}

export const effectDefinitions = {
  debugInvincible: {
    id: 'debug.invincible',
    tags: ['invincible'],
    durationMs: null,
    stackPolicy: 'refresh',
    maxStacks: 1,
    modifiers: [{ type: 'block_damage' }],
  } satisfies EffectDefinition,
} as const;

export type EffectDefinitionId = typeof effectDefinitions[keyof typeof effectDefinitions]['id'];

export const effectDefinitionById = new Map<string, EffectDefinition>(
  Object.values(effectDefinitions).map((definition) => [definition.id, definition]),
);
