// Validates and clamps untrusted client input commands before they reach authoritative simulation systems.
import { AttackIntent, NO_HOTBAR_SLOT, PlayerCommand } from '../domain/commands.js';
import { NType } from './nType.js';

const MAX_AIM_COORDINATE = 1_000_000;
const MAX_CLIENT_TIME_MS = 10 * 60 * 1000;

export function validateInputCommand(command: unknown): PlayerCommand | null {
  if (!command || typeof command !== 'object') {
    return null;
  }

  const input = command as Record<string, unknown>;
  if (input.ntype !== NType.InputCommand) {
    return null;
  }

  const sequence = unsignedIntegerOrNull(input.sequence);
  const clientTick = unsignedIntegerOrNull(input.clientTick);
  if (sequence === null || clientTick === null) {
    return null;
  }

  const move = normalizeAxis(numberOrZero(input.moveX), numberOrZero(input.moveY));
  return {
    moveX: move.x,
    moveY: move.y,
    aimX: clampFinite(numberOrZero(input.aimX), -MAX_AIM_COORDINATE, MAX_AIM_COORDINATE),
    aimY: clampFinite(numberOrZero(input.aimY), -MAX_AIM_COORDINATE, MAX_AIM_COORDINATE),
    attack: clampAttack(numberOrZero(input.attack)),
    interact: numberOrZero(input.interact) !== 0,
    sequence,
    clientTick,
    clientTimeMs: clampFinite(numberOrZero(input.clientTimeMs), 0, MAX_CLIENT_TIME_MS),
    hotbarSlotActivated: clampHotbarSlot(input.hotbarSlotActivated),
  };
}

function clampHotbarSlot(value: unknown): number {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 11) {
    return value;
  }
  return NO_HOTBAR_SLOT;
}

function normalizeAxis(x: number, y: number): { x: number; y: number } {
  const clampedX = clampFinite(x, -1, 1);
  const clampedY = clampFinite(y, -1, 1);
  const length = Math.hypot(clampedX, clampedY);
  if (length <= 1) {
    return { x: clampedX, y: clampedY };
  }
  return { x: clampedX / length, y: clampedY / length };
}

function numberOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function unsignedIntegerOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

function clampFinite(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clampAttack(value: number): AttackIntent {
  if (value === AttackIntent.Melee || value === AttackIntent.Projectile) {
    return value;
  }
  return AttackIntent.None;
}
