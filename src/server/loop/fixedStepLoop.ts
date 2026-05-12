// Runs the authoritative simulation at a stable fixed timestep with bounded catch-up.
export interface FixedStepLoopOptions {
  tickRate: number;
  maxCatchUpTicks: number;
  now?: () => number;
}

export interface LoopTimingSample {
  intervalMs: number;
  wallIntervalMs: number;
  driftMs: number;
  steps: number;
}

export class FixedStepLoop {
  private static readonly precisionWindowMs = 12;
  private readonly tickMs: number;
  private readonly now: () => number;
  private timer: NodeJS.Timeout | NodeJS.Immediate | null = null;
  private running = false;
  private lastNow = 0;
  private lastWallNow = 0;
  private initialized = false;
  private nextTickMs = 0;

  constructor(
    private readonly options: FixedStepLoopOptions,
    private readonly step: (deltaSeconds: number) => void,
    private readonly onSample: (sample: LoopTimingSample) => void = () => {},
  ) {
    this.tickMs = 1000 / options.tickRate;
    this.now = options.now ?? (() => performance.now());
  }

  start(): void {
    if (this.running) {
      return;
    }

    this.running = true;
    this.lastNow = this.now();
    this.lastWallNow = this.lastNow;
    this.initialized = true;
    this.nextTickMs = this.lastNow + this.tickMs;
    this.scheduleToDeadline();
  }

  stop(): void {
    this.running = false;
    if (this.timer !== null) {
      clearTimeout(this.timer as NodeJS.Timeout);
      clearImmediate(this.timer as NodeJS.Immediate);
      this.timer = null;
    }
  }

  tickOnce(currentNow = this.now(), wallNow = currentNow): void {
    if (!this.initialized) {
      this.lastNow = currentNow;
      this.lastWallNow = wallNow;
      this.initialized = true;
      return;
    }

    const elapsedMs = currentNow - this.lastNow;
    const wallElapsedMs = wallNow - this.lastWallNow;
    this.lastNow = currentNow;
    this.lastWallNow = wallNow;

    const stalledSteps = elapsedMs > this.tickMs * 1.5 ? Math.floor(elapsedMs / this.tickMs) : 1;
    const steps = Math.max(1, Math.min(this.options.maxCatchUpTicks, stalledSteps));
    for (let i = 0; i < steps; i += 1) {
      this.step(this.tickMs / 1000);
    }

    this.onSample({
      intervalMs: elapsedMs,
      wallIntervalMs: wallElapsedMs,
      driftMs: elapsedMs - this.tickMs,
      steps,
    });
  }

  private scheduleToDeadline(): void {
    const nowMs = this.now();
    const delayMs = this.nextTickMs - nowMs;
    if (delayMs > FixedStepLoop.precisionWindowMs) {
      this.timer = setTimeout(() => this.scheduleToDeadline(), delayMs - FixedStepLoop.precisionWindowMs);
      return;
    }

    this.timer = setImmediate(() => {
      if (!this.running) {
        return;
      }

      let currentNow = this.now();
      if (currentNow + 0.05 < this.nextTickMs) {
        this.scheduleToDeadline();
        return;
      }

      let processedTicks = 0;
      while (currentNow + 0.05 >= this.nextTickMs && processedTicks < this.options.maxCatchUpTicks) {
        this.tickOnce(this.nextTickMs, currentNow);
        this.nextTickMs += this.tickMs;
        processedTicks += 1;
        currentNow = this.now();
      }

      if (currentNow + 0.05 >= this.nextTickMs) {
        this.nextTickMs = currentNow + this.tickMs;
        this.lastNow = currentNow;
      }
      this.scheduleToDeadline();
    });
  }
}
