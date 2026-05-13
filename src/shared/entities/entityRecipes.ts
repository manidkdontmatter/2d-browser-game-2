// Defines typed entity spawn recipes; recipes create initial composition but never define permanent identity.
import {
  CHARACTER_MAX_HEALTH,
  NPC_MOVE_SPEED,
  NPC_RADIUS,
  PLAYER_MOVE_SPEED,
  PLAYER_RADIUS,
  PROJECTILE_DAMAGE,
  PROJECTILE_SPEED,
} from '../config.js';
import { ContentDefinitionBase, ContentKind } from '../content/types.js';
import { ControllerKind } from '../domain/commands.js';
import { NetEntityKind } from '../domain/snapshots.js';

export const entityRecipeIds = {
  humanControlledBody: 'body.human_controlled.test',
  hostileAiBody: 'body.hostile_ai.test',
  woodDoorBody: 'body.wood_door.test',
  basicProjectile: 'projectile.basic',
  groundPickup: 'pickup.ground_item',
} as const;

export type EntityRecipeId = (typeof entityRecipeIds)[keyof typeof entityRecipeIds];

export interface BodyRecipe {
  readonly radius: number;
  readonly maxHealth: number;
  readonly locomotionSpeed: number;
  readonly controllable: boolean;
  readonly defaultControllerKind?: ControllerKind;
  readonly hostileBrain?: boolean;
}

export interface ProjectileRecipe {
  readonly damage: number;
  readonly speed: number;
  readonly lifetimeSeconds: number;
}

export interface PickupItemRecipe {
  readonly radius: number;
}

export interface EntityRecipe extends ContentDefinitionBase {
  readonly kind: typeof ContentKind.EntityRecipe;
  readonly id: EntityRecipeId;
  readonly appearanceKind: NetEntityKind;
  readonly body?: BodyRecipe;
  readonly projectile?: ProjectileRecipe;
  readonly pickup?: PickupItemRecipe;
}

export const rawEntityRecipes = {
  [entityRecipeIds.humanControlledBody]: {
    kind: ContentKind.EntityRecipe,
    id: entityRecipeIds.humanControlledBody,
    version: 1,
    tags: ['body', 'human'],
    appearanceKind: NetEntityKind.Body,
    body: {
      radius: PLAYER_RADIUS,
      maxHealth: CHARACTER_MAX_HEALTH,
      locomotionSpeed: PLAYER_MOVE_SPEED,
      controllable: true,
      defaultControllerKind: ControllerKind.Human,
    },
  },
  [entityRecipeIds.hostileAiBody]: {
    kind: ContentKind.EntityRecipe,
    id: entityRecipeIds.hostileAiBody,
    version: 1,
    tags: ['body', 'npc', 'hostile'],
    appearanceKind: NetEntityKind.Body,
    body: {
      radius: NPC_RADIUS,
      maxHealth: CHARACTER_MAX_HEALTH,
      locomotionSpeed: NPC_MOVE_SPEED,
      controllable: true,
      defaultControllerKind: ControllerKind.HostileAi,
      hostileBrain: true,
    },
  },
  [entityRecipeIds.woodDoorBody]: {
    kind: ContentKind.EntityRecipe,
    id: entityRecipeIds.woodDoorBody,
    version: 1,
    tags: ['body', 'door'],
    appearanceKind: NetEntityKind.Body,
    body: {
      radius: PLAYER_RADIUS,
      maxHealth: CHARACTER_MAX_HEALTH,
      locomotionSpeed: 0,
      controllable: false,
    },
  },
  [entityRecipeIds.basicProjectile]: {
    kind: ContentKind.EntityRecipe,
    id: entityRecipeIds.basicProjectile,
    version: 1,
    tags: ['projectile', 'basic'],
    appearanceKind: NetEntityKind.Projectile,
    projectile: {
      damage: PROJECTILE_DAMAGE,
      speed: PROJECTILE_SPEED,
      lifetimeSeconds: 1.2,
    },
  },
  [entityRecipeIds.groundPickup]: {
    kind: ContentKind.EntityRecipe,
    id: entityRecipeIds.groundPickup,
    version: 1,
    tags: ['pickup', 'ground_item'],
    appearanceKind: NetEntityKind.Pickup,
    pickup: {
      radius: 20,
    },
  },
} as const satisfies Record<EntityRecipeId, EntityRecipe>;

export const entityRecipes = rawEntityRecipes;

export function getEntityRecipe(id: EntityRecipeId): EntityRecipe {
  return entityRecipes[id];
}
