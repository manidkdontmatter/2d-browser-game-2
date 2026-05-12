// Defines shared replicated entity shapes produced by the authoritative simulation.
export enum NetEntityKind {
  Body = 1,
  Projectile = 2,
  Portal = 3,
}

export interface EntitySnapshot {
  entityId: number;
  kind: 'body' | 'projectile' | 'portal';
  x: number;
  y: number;
  health: number;
  facing: number;
}

export interface NetEntityRecord {
  nid: number;
  ntype: number;
  entityId: number;
  kind: NetEntityKind;
  x: number;
  y: number;
  health: number;
  facing: number;
}
