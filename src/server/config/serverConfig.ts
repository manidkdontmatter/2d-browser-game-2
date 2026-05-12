// Parses server boot configuration from environment variables with production-safe defaults.
export const DEFAULT_HOSTILE_NPC_COUNT = 0;

export function parseHostileNpcCount(value: string | undefined): number {
  if (value === undefined) {
    return DEFAULT_HOSTILE_NPC_COUNT;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_HOSTILE_NPC_COUNT;
}
