// Defines composable bitECS component stores for authoritative gameplay entities.
export const Active = {};

export const Identity = {
  entityId: [] as number[],
};

export const Position = {
  x: [] as number[],
  y: [] as number[],
};

export const Velocity = {
  x: [] as number[],
  y: [] as number[],
};

export const Health = {
  current: [] as number[],
  max: [] as number[],
};

export const Facing = {
  direction: [] as number[],
};

export const Locomotion = {
  speed: [] as number[],
};

export const ControlTarget = {};

export const MindLink = {
  mindId: [] as number[],
  controllerKind: [] as number[],
};

export const Appearance = {
  netKind: [] as number[],
};

export const Projectile = {
  ownerEntityId: [] as number[],
  damage: [] as number[],
  lifetime: [] as number[],
};

export const PhysicsBodyRef = {
  bodyId: [] as number[],
};

export const NpcBrain = {
  decisionCooldown: [] as number[],
  targetEntityId: [] as number[],
  pathIndex: [] as number[],
  state: [] as number[],
  nextSenseAtMs: [] as number[],
  nextPlanAtMs: [] as number[],
  lastKnownTargetX: [] as number[],
  lastKnownTargetY: [] as number[],
};

export const Stamina = {
  current: [] as number[],
  max: [] as number[],
};
