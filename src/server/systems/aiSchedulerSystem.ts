// Schedules AI sense/plan work with explicit per-tick budgets so NPC behavior scales without synchronized spikes.
export interface AiSchedulerConfig {
  maxSensePerTick: number;
  maxPlanPerTick: number;
  defaultSenseIntervalMs: number;
  defaultPlanIntervalMs: number;
  wakeGraceMs: number;
}

export interface AiSchedulerMetrics {
  sensed: number;
  planned: number;
  budgetSkippedSense: number;
  budgetSkippedPlan: number;
  wakeEvents: number;
}

export class AiSchedulerSystem {
  private metrics: AiSchedulerMetrics = {
    sensed: 0,
    planned: 0,
    budgetSkippedSense: 0,
    budgetSkippedPlan: 0,
    wakeEvents: 0,
  };
  private senseUsed = 0;
  private planUsed = 0;
  private simulationTimeMs = 0;
  private readonly wakeUntilByEntityId = new Map<number, number>();

  constructor(private readonly config: AiSchedulerConfig) {}

  beginTick(simulationTimeMs: number): void {
    this.simulationTimeMs = simulationTimeMs;
    this.senseUsed = 0;
    this.planUsed = 0;
    this.metrics.sensed = 0;
    this.metrics.planned = 0;
    this.metrics.budgetSkippedSense = 0;
    this.metrics.budgetSkippedPlan = 0;
  }

  shouldSense(entityId: number, nextSenseAtMs: number): boolean {
    if (this.senseUsed >= this.config.maxSensePerTick) {
      this.metrics.budgetSkippedSense += 1;
      return false;
    }

    if (this.isWoken(entityId) || nextSenseAtMs <= this.simulationTimeMs) {
      this.senseUsed += 1;
      this.metrics.sensed += 1;
      return true;
    }

    return false;
  }

  shouldPlan(entityId: number, nextPlanAtMs: number): boolean {
    if (this.planUsed >= this.config.maxPlanPerTick) {
      this.metrics.budgetSkippedPlan += 1;
      return false;
    }

    if (this.isWoken(entityId) || nextPlanAtMs <= this.simulationTimeMs) {
      this.planUsed += 1;
      this.metrics.planned += 1;
      return true;
    }

    return false;
  }

  markSensed(entityId: number): number {
    this.clearWakeIfExpired(entityId);
    return this.simulationTimeMs + this.config.defaultSenseIntervalMs + jitterMs(entityId, 80);
  }

  markPlanned(entityId: number): number {
    this.clearWakeIfExpired(entityId);
    return this.simulationTimeMs + this.config.defaultPlanIntervalMs + jitterMs(entityId, 140);
  }

  wakeEntity(entityId: number): void {
    this.metrics.wakeEvents += 1;
    const wakeUntilMs = this.simulationTimeMs + this.config.wakeGraceMs;
    const existing = this.wakeUntilByEntityId.get(entityId) ?? 0;
    if (wakeUntilMs > existing) {
      this.wakeUntilByEntityId.set(entityId, wakeUntilMs);
    }
  }

  snapshotMetrics(): AiSchedulerMetrics {
    return { ...this.metrics };
  }

  private isWoken(entityId: number): boolean {
    const wakeUntilMs = this.wakeUntilByEntityId.get(entityId);
    if (wakeUntilMs === undefined) {
      return false;
    }

    if (wakeUntilMs <= this.simulationTimeMs) {
      this.wakeUntilByEntityId.delete(entityId);
      return false;
    }
    return true;
  }

  private clearWakeIfExpired(entityId: number): void {
    const wakeUntilMs = this.wakeUntilByEntityId.get(entityId);
    if (wakeUntilMs !== undefined && wakeUntilMs <= this.simulationTimeMs) {
      this.wakeUntilByEntityId.delete(entityId);
    }
  }
}

function jitterMs(entityId: number, range: number): number {
  if (range <= 0) {
    return 0;
  }
  return (entityId * 1103515245 + 12345) >>> 0 % range;
}
