// Centralizes netcode timing and buffer sizes shared by the client and authoritative server.
export const NET_TIMING = {
  serverTickRate: 30,
  snapshotRate: 30,
  clientCommandPacketRate: 60,
  movementCommandRate: 60,
  movementCommandSeconds: 1 / 60,
  movementCommandCreditsPerServerTick: 60 / 30,
  maxMovementCommandCredits: 4,
  maxQueuedInputCommandsPerEntity: 24,
  maxClientInputCommandsPerFrame: 4,
  interpolationDelayMs: 100,
  inputHeartbeatMs: 250,
  maxInputSequenceLead: 120,
  maxCommandsPerUserPerReceive: 10,
} as const;

export const SERVER_TICK_MS = 1000 / NET_TIMING.serverTickRate;
export const SNAPSHOT_INTERVAL_SECONDS = 1 / NET_TIMING.snapshotRate;
export const CLIENT_COMMAND_PACKET_INTERVAL_MS = 1000 / NET_TIMING.clientCommandPacketRate;
export const MOVEMENT_COMMAND_INTERVAL_MS = 1000 / NET_TIMING.movementCommandRate;
