// Defines the shared data-driven item catalog used by server authority and client UI.
import { ContentKind, type ContentDefinitionBase, type StatModifier } from '../content/types.js';

export const itemTypes = ['weapon', 'consumable', 'resource', 'armor', 'tool'] as const;
export type ItemType = (typeof itemTypes)[number];

export const itemTiers = ['common', 'uncommon', 'rare', 'epic', 'legendary'] as const;
export type ItemTier = (typeof itemTiers)[number];

export interface ItemDefinition extends ContentDefinitionBase {
  readonly kind: typeof ContentKind.Item;
  readonly name: string;
  readonly description: string;
  readonly type: ItemType;
  readonly tier: ItemTier;
  readonly stackSize: number;
  readonly statModifiers?: readonly StatModifier[];
  readonly weaponType?: 'melee' | 'ranged';
  readonly damage?: number;
  readonly effectId?: string;
}

export const defaultItemIds = {
  ironSword: 'item.weapon.iron_sword',
  huntingBow: 'item.weapon.hunting_bow',
  healthPotion: 'item.consumable.health_potion',
  staminaPotion: 'item.consumable.stamina_potion',
  ironOre: 'item.resource.iron_ore',
  woodLog: 'item.resource.wood_log',
  pickaxe: 'item.tool.pickaxe',
} as const;

export type DefaultItemId = (typeof defaultItemIds)[keyof typeof defaultItemIds];

export const defaultItems: readonly ItemDefinition[] = [
  {
    kind: ContentKind.Item,
    id: defaultItemIds.ironSword,
    version: 1,
    tags: ['weapon', 'melee', 'metal'],
    name: 'Iron Sword',
    description: 'A sturdy iron blade. Deals moderate melee damage.',
    type: 'weapon',
    tier: 'common',
    stackSize: 1,
    weaponType: 'melee',
    damage: 20,
    statModifiers: [
      { stat: 'attack_power', additive: 5 },
    ],
  },
  {
    kind: ContentKind.Item,
    id: defaultItemIds.huntingBow,
    version: 1,
    tags: ['weapon', 'ranged', 'wood'],
    name: 'Hunting Bow',
    description: 'A simple wooden bow. Fires projectiles.',
    type: 'weapon',
    tier: 'common',
    stackSize: 1,
    weaponType: 'ranged',
    damage: 15,
    statModifiers: [
      { stat: 'ability_power', additive: 3 },
    ],
  },
  {
    kind: ContentKind.Item,
    id: defaultItemIds.healthPotion,
    version: 1,
    tags: ['consumable', 'healing'],
    name: 'Health Potion',
    description: 'A crimson vial that restores 30 health.',
    type: 'consumable',
    tier: 'common',
    stackSize: 10,
    effectId: 'restore_health_30',
  },
  {
    kind: ContentKind.Item,
    id: defaultItemIds.staminaPotion,
    version: 1,
    tags: ['consumable', 'stamina'],
    name: 'Stamina Potion',
    description: 'A green vial that restores 30 stamina.',
    type: 'consumable',
    tier: 'common',
    stackSize: 10,
    effectId: 'restore_stamina_30',
  },
  {
    kind: ContentKind.Item,
    id: defaultItemIds.ironOre,
    version: 1,
    tags: ['resource', 'metal', 'crafting'],
    name: 'Iron Ore',
    description: 'Raw iron ore. Can be smelted into ingots.',
    type: 'resource',
    tier: 'common',
    stackSize: 50,
  },
  {
    kind: ContentKind.Item,
    id: defaultItemIds.woodLog,
    version: 1,
    tags: ['resource', 'wood', 'crafting'],
    name: 'Wood Log',
    description: 'A chopped log. Used for crafting and building.',
    type: 'resource',
    tier: 'common',
    stackSize: 30,
  },
  {
    kind: ContentKind.Item,
    id: defaultItemIds.pickaxe,
    version: 1,
    tags: ['tool', 'mining'],
    name: 'Pickaxe',
    description: 'A basic mining pick. Used to extract ore and stone.',
    type: 'tool',
    tier: 'common',
    stackSize: 1,
  },
];

export function getItemDefinition(id: string): ItemDefinition | undefined {
  return defaultItems.find((item) => item.id === id);
}

export function isItemType(value: string): value is ItemType {
  return (itemTypes as readonly string[]).includes(value);
}

export function isItemTier(value: string): value is ItemTier {
  return (itemTiers as readonly string[]).includes(value);
}
