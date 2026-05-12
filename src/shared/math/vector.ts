// Provides small vector helpers shared by gameplay, AI, and rendering code.
export interface Vec2 {
  x: number;
  y: number;
}

export function length(value: Vec2): number {
  return Math.hypot(value.x, value.y);
}

export function normalize(value: Vec2): Vec2 {
  const magnitude = length(value);
  if (magnitude <= 0.000001) {
    return { x: 0, y: 0 };
  }

  return { x: value.x / magnitude, y: value.y / magnitude };
}

export function clampMagnitude(value: Vec2, maxLength: number): Vec2 {
  const magnitude = length(value);
  if (magnitude <= maxLength || magnitude <= 0.000001) {
    return value;
  }

  const scale = maxLength / magnitude;
  return { x: value.x * scale, y: value.y * scale };
}

export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function tileCenter(tileX: number, tileY: number, tileSize: number): Vec2 {
  return {
    x: tileX * tileSize + tileSize / 2,
    y: tileY * tileSize + tileSize / 2,
  };
}
