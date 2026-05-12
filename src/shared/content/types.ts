// Defines canonical content metadata and shared authoring primitives for data-driven gameplay definitions.
export const ContentKind = {
  EntityRecipe: 'entity_recipe',
  Item: 'item',
  Ability: 'ability',
  Trait: 'trait',
} as const;

export type ContentKind = typeof ContentKind[keyof typeof ContentKind];

export interface ContentDefinitionBase {
  readonly kind: ContentKind;
  readonly id: string;
  readonly version: number;
  readonly tags: readonly string[];
}

export interface StatModifier {
  readonly stat: string;
  readonly additive?: number;
  readonly multiplier?: number;
}

export interface Budget {
  readonly cost?: number;
  readonly grant?: number;
}

export interface TraitDefinition extends ContentDefinitionBase {
  readonly kind: typeof ContentKind.Trait;
  readonly statModifiers?: readonly StatModifier[];
  readonly budget?: Budget;
  readonly constraints?: readonly string[];
}

export interface ContentValidationError {
  readonly code: string;
  readonly message: string;
  readonly definitionId?: string;
}
