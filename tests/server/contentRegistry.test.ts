// Verifies startup content compilation/validation and immutable runtime lookups for authoritative content definitions.
import { describe, expect, it } from 'vitest';
import { ContentKind } from '../../src/shared/content/types.js';
import { entityRecipeIds, rawEntityRecipes, type EntityRecipe } from '../../src/shared/entities/entityRecipes.js';
import { ContentRegistry } from '../../src/server/content/contentRegistry.js';

describe('content registry', () => {
  it('compiles valid entity recipes and resolves lookups', () => {
    const registry = ContentRegistry.compile({
      entityRecipes: Object.values(rawEntityRecipes),
    });

    const playerRecipe = registry.getEntityRecipe(entityRecipeIds.humanControlledBody);
    expect(playerRecipe.id).toBe(entityRecipeIds.humanControlledBody);
    expect(playerRecipe.kind).toBe(ContentKind.EntityRecipe);
  });

  it('rejects duplicate entity recipe ids', () => {
    expect(() => ContentRegistry.compile({
      entityRecipes: [
        ...Object.values(rawEntityRecipes),
        { ...rawEntityRecipes[entityRecipeIds.humanControlledBody] },
      ],
    })).toThrowError(/duplicate_entity_recipe_id/);
  });

  it('rejects invalid content kind', () => {
    const invalid = {
      ...rawEntityRecipes[entityRecipeIds.humanControlledBody],
      kind: ContentKind.Item,
    } as unknown as EntityRecipe;

    expect(() => ContentRegistry.compile({
      entityRecipes: [
        invalid,
        ...Object.values(rawEntityRecipes).filter((recipe) => recipe.id !== entityRecipeIds.humanControlledBody),
      ],
    })).toThrowError(/invalid_kind/);
  });

  it('freezes compiled recipes', () => {
    const registry = ContentRegistry.compile({
      entityRecipes: Object.values(rawEntityRecipes),
    });
    const recipe = registry.getEntityRecipe(entityRecipeIds.hostileAiBody);
    expect(Object.isFrozen(recipe)).toBe(true);
    expect(Object.isFrozen(recipe.body)).toBe(true);
  });
});
