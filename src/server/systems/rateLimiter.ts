// Provides cooldown-based rate limiting for authoritative gameplay actions.
export class CooldownLimiter {
  private readonly lastAcceptedAt = new Map<number, number>();

  constructor(private readonly cooldownMs: number) {}

  accept(key: number, nowMs: number): boolean {
    const last = this.lastAcceptedAt.get(key) ?? -Infinity;
    if (nowMs - last < this.cooldownMs) {
      return false;
    }

    this.lastAcceptedAt.set(key, nowMs);
    return true;
  }

  delete(key: number): void {
    this.lastAcceptedAt.delete(key);
  }
}
