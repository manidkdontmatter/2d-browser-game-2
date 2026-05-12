// Compiles and validates authoritative content definitions at server startup, then exposes frozen runtime lookups.
import { ContentKind, type ContentValidationError } from '../../shared/content/types.js';
import {
  entityRecipeIds,
  rawEntityRecipes,
  type EntityRecipe,
  type EntityRecipeId,
} from '../../shared/entities/entityRecipes.js';

export interface ContentRegistrySources {
  entityRecipes: readonly EntityRecipe[];
}

export class ContentRegistry {
  private readonly entityRecipes: ReadonlyMap<EntityRecipeId, EntityRecipe>;

  private constructor(entityRecipes: ReadonlyMap<EntityRecipeId, EntityRecipe>) {
    this.entityRecipes = entityRecipes;
  }

  static compile(sources: ContentRegistrySources): ContentRegistry {
    const errors: ContentValidationError[] = [];
    const entityRecipeMap = new Map<EntityRecipeId, EntityRecipe>();

    for (const recipe of sources.entityRecipes) {
      validateEntityRecipe(recipe, errors);
      const existing = entityRecipeMap.get(recipe.id as EntityRecipeId);
      if (existing) {
        errors.push({
          code: 'duplicate_entity_recipe_id',
          message: `Duplicate entity recipe id '${recipe.id}'.`,
          definitionId: recipe.id,
        });
        continue;
      }

      entityRecipeMap.set(recipe.id as EntityRecipeId, deepFreeze({ ...recipe }));
    }

    // Validate required baseline recipes exist for the current game flow.
    for (const required of Object.values(entityRecipeIds)) {
      if (!entityRecipeMap.has(required)) {
        errors.push({
          code: 'missing_required_entity_recipe',
          message: `Missing required entity recipe '${required}'.`,
          definitionId: required,
        });
      }
    }

    if (errors.length > 0) {
      const details = errors.map((error) => `[${error.code}] ${error.message}`).join('\n');
      throw new Error(`Content compilation failed:\n${details}`);
    }

    return new ContentRegistry(entityRecipeMap);
  }

  getEntityRecipe(id: EntityRecipeId): EntityRecipe {
    const recipe = this.entityRecipes.get(id);
    if (!recipe) {
      throw new Error(`Unknown entity recipe id '${id}'.`);
    }
    return recipe;
  }
}

export function createDefaultContentRegistry(): ContentRegistry {
  return ContentRegistry.compile({
    entityRecipes: Object.values(rawEntityRecipes),
  });
}

function validateEntityRecipe(recipe: EntityRecipe, errors: ContentValidationError[]): void {
  if (recipe.kind !== ContentKind.EntityRecipe) {
    errors.push({
      code: 'invalid_kind',
      message: `Entity recipe '${recipe.id}' must have kind '${ContentKind.EntityRecipe}'.`,
      definitionId: recipe.id,
    });
  }
  if (!recipe.id || typeof recipe.id !== 'string') {
    errors.push({
      code: 'missing_id',
      message: 'Entity recipe is missing a valid id.',
    });
  }
  if (!Number.isInteger(recipe.version) || recipe.version < 1) {
    errors.push({
      code: 'invalid_version',
      message: `Entity recipe '${recipe.id}' has invalid version '${recipe.version}'.`,
      definitionId: recipe.id,
    });
  }
  if (!Array.isArray(recipe.tags)) {
    errors.push({
      code: 'invalid_tags',
      message: `Entity recipe '${recipe.id}' must define tags as an array.`,
      definitionId: recipe.id,
    });
  }
  if (!recipe.body && !recipe.projectile) {
    errors.push({
      code: 'invalid_recipe_shape',
      message: `Entity recipe '${recipe.id}' must define either body or projectile data.`,
      definitionId: recipe.id,
    });
  }
  if (recipe.body && recipe.projectile) {
    errors.push({
      code: 'invalid_recipe_shape',
      message: `Entity recipe '${recipe.id}' cannot define both body and projectile data.`,
      definitionId: recipe.id,
    });
  }
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== 'object') {
    return value;
  }

  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) {
    if (child && typeof child === 'object' && !Object.isFrozen(child)) {
      deepFreeze(child);
    }
  }
  return value;
}
