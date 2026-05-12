// Provides cooldown-based rate limiting for authoritative gameplay actions.
// Supports per-entity cooldown overrides so attack speed varies by entity stats.
export class CooldownLimiter {
  private readonly lastAcceptedAt = new Map<number, number>();

  constructor(private readonly defaultCooldownMs: number) {}

  accept(key: number, nowMs: number, cooldownMs?: number): boolean {
    const effectiveCooldown = cooldownMs ?? this.defaultCooldownMs;
    const last = this.lastAcceptedAt.get(key) ?? -Infinity;
    if (nowMs - last < effectiveCooldown) {
      return false;
    }

    this.lastAcceptedAt.set(key, nowMs);
    return true;
  }

  delete(key: number): void {
    this.lastAcceptedAt.delete(key);
  }
}
