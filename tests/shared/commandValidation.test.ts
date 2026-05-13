// Verifies untrusted input command payloads are accepted, rejected, or clamped consistently.
import { describe, expect, it } from 'vitest';
import { AttackIntent } from '../../src/shared/domain/commands.js';
import { validateInputCommand } from '../../src/shared/net/commandValidation.js';
import { NType } from '../../src/shared/net/nType.js';

describe('input command validation', () => {
  it('accepts valid command payloads', () => {
    expect(
      validateInputCommand({
        ntype: NType.InputCommand,
        moveX: 1,
        moveY: 0,
        aimX: 100,
        aimY: 200,
        attack: AttackIntent.Melee,
        sequence: 10,
        clientTick: 4,
        clientTimeMs: 150,
      }),
    ).toEqual({
      moveX: 1,
      moveY: 0,
      aimX: 100,
      aimY: 200,
      attack: AttackIntent.Melee,
      interact: false,
      sequence: 10,
      clientTick: 4,
      clientTimeMs: 150,
      hotbarSlotActivated: -1,
    });
  });

  it('rejects non-input messages and invalid identity fields', () => {
    expect(validateInputCommand(null)).toBeNull();
    expect(validateInputCommand({ ntype: NType.WorldInitMessage })).toBeNull();
    expect(validateInputCommand({ ntype: NType.InputCommand, sequence: -1, clientTick: 0 })).toBeNull();
    expect(validateInputCommand({ ntype: NType.InputCommand, sequence: 1, clientTick: 1.5 })).toBeNull();
  });

  it('clamps untrusted numbers and invalid attacks', () => {
    const command = validateInputCommand({
      ntype: NType.InputCommand,
      moveX: 2,
      moveY: 2,
      aimX: Number.POSITIVE_INFINITY,
      aimY: -2_000_000,
      attack: 99,
      sequence: 1,
      clientTick: 2,
      clientTimeMs: 999_999_999,
    });

    expect(command?.moveX).toBeCloseTo(Math.SQRT1_2);
    expect(command?.moveY).toBeCloseTo(Math.SQRT1_2);
    expect(command?.aimX).toBe(0);
    expect(command?.aimY).toBe(-1_000_000);
    expect(command?.attack).toBe(AttackIntent.None);
    expect(command?.clientTimeMs).toBe(600_000);
  });
});
