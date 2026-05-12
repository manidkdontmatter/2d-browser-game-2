// Verifies server boot configuration defaults and environment overrides.
import { describe, expect, it } from 'vitest';
import { DEFAULT_HOSTILE_NPC_COUNT, parseHostileNpcCount } from '../../src/server/config/serverConfig.js';

describe('server configuration', () => {
  it('defaults hostile NPC count to zero when NPC_COUNT is unset', () => {
    expect(DEFAULT_HOSTILE_NPC_COUNT).toBe(0);
    expect(parseHostileNpcCount(undefined)).toBe(0);
  });

  it('preserves explicit NPC_COUNT overrides', () => {
    expect(parseHostileNpcCount('100')).toBe(100);
    expect(parseHostileNpcCount('0')).toBe(0);
  });
});
