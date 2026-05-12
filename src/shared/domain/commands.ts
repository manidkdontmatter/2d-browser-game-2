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
  sequence: number;
  clientTick: number;
  clientTimeMs: number;
}

export interface ControlIntent {
  entityId: number;
  moveX: number;
  moveY: number;
  aimX: number;
  aimY: number;
  attack: AttackIntent;
  sequence: number;
  sourceController: ControllerKind;
}
