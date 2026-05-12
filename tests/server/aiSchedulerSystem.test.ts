// Verifies AI scheduler budgets and wake behavior for scalable phased NPC updates.
import { describe, expect, it } from 'vitest';
import { AiSchedulerSystem } from '../../src/server/systems/aiSchedulerSystem.js';

describe('ai scheduler system', () => {
  it('enforces per-tick sense and plan budgets', () => {
    const scheduler = new AiSchedulerSystem({
      maxSensePerTick: 2,
      maxPlanPerTick: 1,
      defaultSenseIntervalMs: 100,
      defaultPlanIntervalMs: 100,
      wakeGraceMs: 200,
    });

    scheduler.beginTick(1000);
    expect(scheduler.shouldSense(1, 0)).toBe(true);
    expect(scheduler.shouldSense(2, 0)).toBe(true);
    expect(scheduler.shouldSense(3, 0)).toBe(false);

    expect(scheduler.shouldPlan(1, 0)).toBe(true);
    expect(scheduler.shouldPlan(2, 0)).toBe(false);

    const metrics = scheduler.snapshotMetrics();
    expect(metrics.sensed).toBe(2);
    expect(metrics.planned).toBe(1);
    expect(metrics.budgetSkippedSense).toBe(1);
    expect(metrics.budgetSkippedPlan).toBe(1);
  });

  it('prioritizes woken entities even when their next windows are in the future', () => {
    const scheduler = new AiSchedulerSystem({
      maxSensePerTick: 4,
      maxPlanPerTick: 4,
      defaultSenseIntervalMs: 100,
      defaultPlanIntervalMs: 100,
      wakeGraceMs: 500,
    });

    scheduler.beginTick(1000);
    scheduler.wakeEntity(42);
    expect(scheduler.shouldSense(42, 5000)).toBe(true);
    expect(scheduler.shouldPlan(42, 5000)).toBe(true);
  });
});
