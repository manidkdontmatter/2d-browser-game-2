// Owns client-side ability authoring state for the main UI.
// The store keeps created abilities and the currently edited draft separate from
// DOM rendering, which makes the ability creator easier to replace with server
// persistence later. It starts with game-default authored abilities and then
// keeps any player-created or altered definitions for the current browser
// session; runtime activation, authoritative validation, networking, and
// permanent account/server storage belong to future server-side systems that can
// reuse the shared ability authoring rules.
import { ContentKind } from '../../shared/content/types.js';
import {
  createEmptyStatAllocations,
  defaultAuthoredAbilities,
  getAbilityAttributeDefinitions,
  normalizeStatAllocations,
  summarizeAbilityStatPoints,
  type AbilityTier,
  type AbilityType,
  type AuthoredAbilityDefinition,
} from '../../shared/abilities/abilityAuthoring.js';

export interface AbilityEditorDraft {
  readonly ability: AuthoredAbilityDefinition;
  readonly editingAbilityId: string | null;
}

export class AbilityAuthoringStore {
  private readonly abilities = new Map<string, AuthoredAbilityDefinition>(
    defaultAuthoredAbilities.map((ability) => [ability.id, cloneAbility(ability)]),
  );
  private draft: AbilityEditorDraft = {
    ability: createNewAbilityDefinition(createAbilityId(), 'New Ability'),
    editingAbilityId: null,
  };

  getAbilities(): readonly AuthoredAbilityDefinition[] {
    return [...this.abilities.values()];
  }

  getDraft(): AbilityEditorDraft {
    return this.draft;
  }

  startNewAbility(): void {
    const index = this.abilities.size + 1;
    this.draft = {
      ability: createNewAbilityDefinition(createAbilityId(), `Ability ${index}`),
      editingAbilityId: null,
    };
  }

  editAbility(id: string): boolean {
    const ability = this.abilities.get(id);
    if (!ability) {
      return false;
    }

    this.draft = {
      ability: cloneAbility(ability),
      editingAbilityId: id,
    };
    return true;
  }

  saveDraft(): AuthoredAbilityDefinition {
    const ability = cloneAbility({
      ...this.draft.ability,
      name: normalizeAbilityName(this.draft.ability.name),
      description: normalizeAbilityDescription(this.draft.ability.description),
      statAllocations: normalizeStatAllocations(this.draft.ability.type, this.draft.ability.statAllocations),
      attributeIds: [...new Set(this.draft.ability.attributeIds)],
    });
    this.abilities.set(ability.id, ability);
    this.draft = {
      ability: cloneAbility(ability),
      editingAbilityId: ability.id,
    };
    return ability;
  }

  deleteAbility(id: string): boolean {
    const deleted = this.abilities.delete(id);
    if (this.draft.editingAbilityId === id) {
      this.startNewAbility();
    }
    return deleted;
  }

  updateDraftName(name: string): void {
    this.replaceDraftAbility({ ...this.draft.ability, name });
  }

  updateDraftDescription(description: string): void {
    this.replaceDraftAbility({ ...this.draft.ability, description });
  }

  updateDraftType(type: AbilityType): void {
    const availableAttributeIds = new Set(getAbilityAttributeDefinitions(type).map((definition) => definition.id));
    this.replaceDraftAbility({
      ...this.draft.ability,
      type,
      statAllocations: createEmptyStatAllocations(type),
      attributeIds: this.draft.ability.attributeIds.filter((attributeId) => availableAttributeIds.has(attributeId)),
    });
  }

  updateDraftTier(tier: AbilityTier): void {
    const ability = {
      ...this.draft.ability,
      tier,
      statAllocations: { ...this.draft.ability.statAllocations },
    };
    let summary = summarizeAbilityStatPoints(ability);
    while (summary.remainingPoints < 0) {
      const statId = Object.entries(ability.statAllocations).find(([, value]) => value > 0)?.[0];
      if (!statId) {
        break;
      }
      ability.statAllocations[statId] -= 1;
      summary = summarizeAbilityStatPoints(ability);
    }
    this.replaceDraftAbility(ability);
  }

  adjustDraftStat(statId: string, delta: number): void {
    const current = this.draft.ability.statAllocations[statId] ?? 0;
    if (delta > 0 && summarizeAbilityStatPoints(this.draft.ability).remainingPoints <= 0) {
      return;
    }

    this.replaceDraftAbility({
      ...this.draft.ability,
      statAllocations: {
        ...this.draft.ability.statAllocations,
        [statId]: Math.max(0, current + delta),
      },
    });
  }

  toggleDraftAttribute(attributeId: string): void {
    const selected = this.draft.ability.attributeIds.includes(attributeId);
    this.replaceDraftAbility({
      ...this.draft.ability,
      attributeIds: selected
        ? this.draft.ability.attributeIds.filter((candidate) => candidate !== attributeId)
        : [...this.draft.ability.attributeIds, attributeId],
    });
  }

  private replaceDraftAbility(ability: AuthoredAbilityDefinition): void {
    this.draft = {
      ...this.draft,
      ability: cloneAbility(ability),
    };
  }
}

function createNewAbilityDefinition(id: string, name: string): AuthoredAbilityDefinition {
  return {
    kind: ContentKind.Ability,
    id,
    version: 1,
    tags: ['player-authored'],
    name,
    description: '',
    type: 'melee',
    tier: 1,
    statAllocations: createEmptyStatAllocations('melee'),
    attributeIds: [],
  };
}

function createAbilityId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `ability.${crypto.randomUUID()}`;
  }
  return `ability.${Date.now().toString(36)}.${Math.floor(Math.random() * 1_000_000).toString(36)}`;
}

function cloneAbility(ability: AuthoredAbilityDefinition): AuthoredAbilityDefinition {
  return {
    ...ability,
    tags: [...ability.tags],
    statAllocations: { ...ability.statAllocations },
    attributeIds: [...ability.attributeIds],
  };
}

function normalizeAbilityName(name: string): string {
  const trimmed = name.trim();
  return trimmed.length > 0 ? trimmed : 'Unnamed Ability';
}

function normalizeAbilityDescription(description: string): string {
  return description.trim().slice(0, 400);
}
