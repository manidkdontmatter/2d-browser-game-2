// Verifies fixed-step scheduler behavior without relying on real-time sleeps.
import { describe, expect, it } from 'vitest';
import { FixedStepLoop } from '../../src/server/loop/fixedStepLoop.js';

describe('fixed-step loop', () => {
  it('emits the expected number of fixed steps for elapsed time', () => {
    let steps = 0;
    const loop = new FixedStepLoop({ tickRate: 30, maxCatchUpTicks: 5 }, () => {
      steps += 1;
    });

    loop.tickOnce(0);
    loop.tickOnce(33.333);
    loop.tickOnce(66.666);

    expect(steps).toBe(2);
  });

  it('caps catch-up work after stalls', () => {
    let steps = 0;
    const loop = new FixedStepLoop({ tickRate: 30, maxCatchUpTicks: 3 }, () => {
      steps += 1;
    });

    loop.tickOnce(0);
    loop.tickOnce(1000);

    expect(steps).toBe(3);
  });
});
