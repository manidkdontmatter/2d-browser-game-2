// Computes deterministic kinematic locomotion displacements from input-like movement commands.
export interface MovementVector {
  x: number;
  y: number;
}

export function kinematicDisplacement(moveX: number, moveY: number, speed: number, durationSeconds: number): MovementVector {
  const axis = normalizeAxis(moveX, moveY);
  return {
    x: axis.x * speed * Math.max(0, durationSeconds),
    y: axis.y * speed * Math.max(0, durationSeconds),
  };
}

export function normalizeAxis(x: number, y: number): MovementVector {
  const length = Math.hypot(x, y);
  if (length <= 1 || length === 0) {
    return { x, y };
  }

  return { x: x / length, y: y / length };
}
