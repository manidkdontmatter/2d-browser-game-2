// Defines shared gameplay command and controller intent contracts for clients, AI, and the server simulation.
export enum AttackIntent {
  None = 0,
  Melee = 1,
  Projectile = 2,
}

export enum ControllerKind {
  Human = 1,
  HostileAi = 2,
}

export interface PlayerCommand {
  moveX: number;
  moveY: number;
  aimX: number;
  aimY: number;
  attack: AttackIntent;
  interact: boolean;
  sequence: number;
  clientTick: number;
  clientTimeMs: number;
  hotbarSlotActivated: number;
}

export interface ControlIntent {
  entityId: number;
  moveX: number;
  moveY: number;
  aimX: number;
  aimY: number;
  attack: AttackIntent;
  interact: boolean;
  sequence: number;
  sourceController: ControllerKind;
  hotbarSlotActivated: number;
}

export const NO_HOTBAR_SLOT = -1;
