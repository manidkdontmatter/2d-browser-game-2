// Owns authoritative status effects, including stacking/expiration semantics and deterministic damage modifier resolution.
import { effectDefinitionById, type EffectModifier } from '../../shared/combat/effects.js';

interface ActiveEffectInstance {
  instanceId: number;
  definitionId: string;
  sourceEntityId: number | null;
  appliedAtMs: number;
  expiresAtMs: number | null;
  stacks: number;
}

export interface DamageContext {
  attackerEntityId: number;
  targetEntityId: number;
  baseDamage: number;
  damageTags?: readonly string[];
}

export interface DamageResolution {
  blocked: boolean;
  finalDamage: number;
  reasons: string[];
}

export class EffectSystem {
  private nextInstanceId = 1;
  private readonly effectsByEntityId = new Map<number, Map<string, ActiveEffectInstance>>();

  applyEffect(entityId: number, definitionId: string, nowMs: number, sourceEntityId: number | null = null): boolean {
    const definition = effectDefinitionById.get(definitionId);
    if (!definition) {
      return false;
    }

    const effects = this.effectsByEntityId.get(entityId) ?? new Map<string, ActiveEffectInstance>();
    const existing = effects.get(definition.id);
    const expiresAtMs = definition.durationMs === null ? null : nowMs + definition.durationMs;

    if (!existing) {
      effects.set(definition.id, {
        instanceId: this.nextInstanceId++,
        definitionId: definition.id,
        sourceEntityId,
        appliedAtMs: nowMs,
        expiresAtMs,
        stacks: 1,
      });
      this.effectsByEntityId.set(entityId, effects);
      return true;
    }

    if (definition.stackPolicy === 'replace') {
      effects.set(definition.id, {
        instanceId: this.nextInstanceId++,
        definitionId: definition.id,
        sourceEntityId,
        appliedAtMs: nowMs,
        expiresAtMs,
        stacks: 1,
      });
      return true;
    }

    if (definition.stackPolicy === 'stack_add') {
      existing.stacks = Math.min(definition.maxStacks, existing.stacks + 1);
    }

    if (definition.stackPolicy === 'max') {
      existing.stacks = Math.max(existing.stacks, 1);
    }

    existing.sourceEntityId = sourceEntityId;
    existing.appliedAtMs = nowMs;
    existing.expiresAtMs = expiresAtMs;
    return true;
  }

  removeEffect(entityId: number, definitionId: string): boolean {
    const effects = this.effectsByEntityId.get(entityId);
    if (!effects) {
      return false;
    }

    const removed = effects.delete(definitionId);
    if (effects.size === 0) {
      this.effectsByEntityId.delete(entityId);
    }
    return removed;
  }

  hasEffect(entityId: number, definitionId: string): boolean {
    return this.effectsByEntityId.get(entityId)?.has(definitionId) ?? false;
  }

  update(simulationTimeMs: number): void {
    for (const [entityId, effects] of this.effectsByEntityId.entries()) {
      for (const [definitionId, effect] of effects.entries()) {
        if (effect.expiresAtMs !== null && simulationTimeMs >= effect.expiresAtMs) {
          effects.delete(definitionId);
        }
      }

      if (effects.size === 0) {
        this.effectsByEntityId.delete(entityId);
      }
    }
  }

  resolveDamage(context: DamageContext): DamageResolution {
    const effects = this.effectsByEntityId.get(context.targetEntityId);
    if (!effects || effects.size === 0) {
      return {
        blocked: false,
        finalDamage: Math.max(0, Math.floor(context.baseDamage)),
        reasons: [],
      };
    }

    const modifiers = this.collectSortedModifiers(effects);
    const tags = new Set(context.damageTags ?? []);
    const reasons: string[] = [];

    for (const modifier of modifiers) {
      if (modifier.type === 'block_damage') {
        reasons.push('blocked:block_damage');
        return { blocked: true, finalDamage: 0, reasons };
      }
      if (modifier.type === 'immunity_tag' && tags.has(modifier.tag)) {
        reasons.push(`blocked:immunity_tag:${modifier.tag}`);
        return { blocked: true, finalDamage: 0, reasons };
      }
    }

    let value = context.baseDamage;

    for (const modifier of modifiers) {
      if (modifier.type === 'damage_multiplier') {
        value *= modifier.value;
        reasons.push(`mult:${modifier.value}`);
      }
    }

    for (const modifier of modifiers) {
      if (modifier.type === 'flat_damage_delta') {
        value += modifier.value;
        reasons.push(`flat:${modifier.value}`);
      }
    }

    let minDamage: number | null = null;
    let maxDamage: number | null = null;
    for (const modifier of modifiers) {
      if (modifier.type === 'min_damage') {
        minDamage = minDamage === null ? modifier.value : Math.max(minDamage, modifier.value);
      } else if (modifier.type === 'max_damage') {
        maxDamage = maxDamage === null ? modifier.value : Math.min(maxDamage, modifier.value);
      }
    }

    if (minDamage !== null) {
      value = Math.max(value, minDamage);
      reasons.push(`min:${minDamage}`);
    }
    if (maxDamage !== null) {
      value = Math.min(value, maxDamage);
      reasons.push(`max:${maxDamage}`);
    }

    return {
      blocked: false,
      finalDamage: Math.max(0, Math.floor(value)),
      reasons,
    };
  }

  private collectSortedModifiers(effects: Map<string, ActiveEffectInstance>): EffectModifier[] {
    const ordered = [...effects.values()].sort((a, b) => {
      if (a.definitionId !== b.definitionId) {
        return a.definitionId.localeCompare(b.definitionId);
      }
      return a.instanceId - b.instanceId;
    });

    const modifiers: EffectModifier[] = [];
    for (const effect of ordered) {
      const definition = effectDefinitionById.get(effect.definitionId);
      if (!definition) {
        continue;
      }

      for (let i = 0; i < effect.stacks; i += 1) {
        modifiers.push(...definition.modifiers);
      }
    }
    return modifiers;
  }
}
