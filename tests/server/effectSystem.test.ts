// Verifies authoritative effect stacking, expiry, and deterministic combat modifier resolution behavior.
import { describe, expect, it } from 'vitest';
import { effectDefinitionById, type EffectDefinition } from '../../src/shared/combat/effects.js';
import { EffectSystem } from '../../src/server/systems/effectSystem.js';

describe('effect system', () => {
  it('blocks damage when invincible is active', () => {
    const effects = new EffectSystem();
    effects.applyEffect(1, 'debug.invincible', 100);

    const resolved = effects.resolveDamage({
      attackerEntityId: 2,
      targetEntityId: 1,
      baseDamage: 50,
      damageTags: ['melee'],
    });

    expect(resolved.blocked).toBe(true);
    expect(resolved.finalDamage).toBe(0);
  });

  it('expires timed effects on update', () => {
    const effects = new EffectSystem();
    registerTestDefinition({
      id: 'test.timed-flat',
      tags: ['test'],
      durationMs: 200,
      stackPolicy: 'refresh',
      maxStacks: 1,
      modifiers: [{ type: 'flat_damage_delta', value: -5 }],
    });

    effects.applyEffect(1, 'test.timed-flat', 100);
    expect(effects.resolveDamage({ attackerEntityId: 2, targetEntityId: 1, baseDamage: 20 }).finalDamage).toBe(15);
    effects.update(299);
    expect(effects.resolveDamage({ attackerEntityId: 2, targetEntityId: 1, baseDamage: 20 }).finalDamage).toBe(15);
    effects.update(300);
    expect(effects.resolveDamage({ attackerEntityId: 2, targetEntityId: 1, baseDamage: 20 }).finalDamage).toBe(20);
  });

  it('applies stack_add modifiers deterministically', () => {
    const effects = new EffectSystem();
    registerTestDefinition({
      id: 'test.stack-flat',
      tags: ['test'],
      durationMs: null,
      stackPolicy: 'stack_add',
      maxStacks: 3,
      modifiers: [{ type: 'flat_damage_delta', value: -2 }],
    });

    effects.applyEffect(1, 'test.stack-flat', 100);
    effects.applyEffect(1, 'test.stack-flat', 101);
    effects.applyEffect(1, 'test.stack-flat', 102);
    effects.applyEffect(1, 'test.stack-flat', 103);

    const resolved = effects.resolveDamage({
      attackerEntityId: 2,
      targetEntityId: 1,
      baseDamage: 20,
    });
    expect(resolved.blocked).toBe(false);
    expect(resolved.finalDamage).toBe(14);
  });

  it('uses fixed resolution order: multiplier -> flat -> clamps', () => {
    const effects = new EffectSystem();
    registerTestDefinition({
      id: 'test.mult',
      tags: ['test'],
      durationMs: null,
      stackPolicy: 'refresh',
      maxStacks: 1,
      modifiers: [{ type: 'damage_multiplier', value: 0.5 }],
    });
    registerTestDefinition({
      id: 'test.flat',
      tags: ['test'],
      durationMs: null,
      stackPolicy: 'refresh',
      maxStacks: 1,
      modifiers: [{ type: 'flat_damage_delta', value: -5 }],
    });
    registerTestDefinition({
      id: 'test.min',
      tags: ['test'],
      durationMs: null,
      stackPolicy: 'refresh',
      maxStacks: 1,
      modifiers: [{ type: 'min_damage', value: 4 }],
    });

    effects.applyEffect(1, 'test.mult', 100);
    effects.applyEffect(1, 'test.flat', 100);
    effects.applyEffect(1, 'test.min', 100);

    const resolved = effects.resolveDamage({
      attackerEntityId: 2,
      targetEntityId: 1,
      baseDamage: 20,
    });
    expect(resolved.finalDamage).toBe(5);
  });
});

function registerTestDefinition(definition: EffectDefinition): void {
  if (!effectDefinitionById.has(definition.id)) {
    effectDefinitionById.set(definition.id, definition);
  }
}
