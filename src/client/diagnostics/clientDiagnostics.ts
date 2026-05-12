// Collects rolling client performance and netcode diagnostics for the in-game debug panel.
import { ClientWorldState } from '../game/clientWorldState.js';

export interface DiagnosticsCounters {
  inputSamples: number;
  commandsQueued: number;
  commandsAccepted: number;
  predictionErrors: number;
  predictionReplays: number;
  messages: number;
  serverFrames: number;
  entityCreates: number;
  entityUpdates: number;
  entityDeletes: number;
}

export interface DiagnosticsSnapshot {
  fps: number;
  averageFrameMs: number;
  maxFrameMs: number;
  connected: boolean;
  inputSamplesPerSecond: number;
  commandsQueuedPerSecond: number;
  commandsAcceptedPerSecond: number;
  messagesPerSecond: number;
  serverFramesPerSecond: number;
  entityCreatesPerSecond: number;
  entityUpdatesPerSecond: number;
  entityDeletesPerSecond: number;
  predictionErrorsPerSecond: number;
  predictionReplaysPerSecond: number;
  lastServerFrameAgeMs: number | null;
  latestSentSequence: number;
  latestSentClientTick: number;
  latestConfirmedClientTick: number;
  pendingCommands: number;
  localEntityId: number;
  playerX: number | null;
  playerY: number | null;
  entityCount: number;
  mapReady: boolean;
  mapId: string;
  mapName: string;
  worldSeed: string | null;
}

export class ClientDiagnostics {
  private readonly windowMs: number;
  private readonly frames: Array<{ atMs: number; frameMs: number }> = [];
  private readonly counters: Array<{ atMs: number; values: DiagnosticsCounters }> = [];
  private connected = false;
  private lastFrameAtMs: number | null = null;
  private lastServerFrameAtMs: number | null = null;
  private latestSentSequence = 0;
  private latestSentClientTick = 0;
  private latestConfirmedClientTick = 0;
  private pendingCommands = 0;

  constructor(
    private readonly state: ClientWorldState,
    options: { windowMs?: number } = {},
  ) {
    this.windowMs = options.windowMs ?? 1000;
  }

  setConnected(connected: boolean): void {
    this.connected = connected;
  }

  recordFrame(nowMs = performance.now()): void {
    if (this.lastFrameAtMs !== null) {
      this.frames.push({ atMs: nowMs, frameMs: nowMs - this.lastFrameAtMs });
    }
    this.lastFrameAtMs = nowMs;
    this.prune(nowMs);
  }

  recordCommandsQueued(count = 1, nowMs = performance.now()): void {
    this.recordCounters({ commandsQueued: count }, nowMs);
  }

  recordInputSample(nowMs = performance.now()): void {
    this.recordCounters({ inputSamples: 1 }, nowMs);
  }

  recordCommandQueued(sequence: number, clientTick: number, pendingCommands: number, nowMs = performance.now()): void {
    this.latestSentSequence = Math.max(this.latestSentSequence, sequence);
    this.latestSentClientTick = Math.max(this.latestSentClientTick, clientTick);
    this.pendingCommands = pendingCommands;
    this.recordCommandsQueued(1, nowMs);
  }

  recordNengiConfirmation(clientTick: number, pendingCommands: number, nowMs = performance.now()): void {
    if (clientTick < 0) {
      return;
    }

    this.latestConfirmedClientTick = Math.max(this.latestConfirmedClientTick, clientTick);
    this.pendingCommands = pendingCommands;
    this.recordCounters({ commandsAccepted: 1 }, nowMs);
  }

  recordPredictionReconciliation(errorFrames: number, replayedFrames: number, nowMs = performance.now()): void {
    this.recordCounters({ predictionErrors: errorFrames, predictionReplays: replayedFrames }, nowMs);
  }

  recordMessages(count = 1, nowMs = performance.now()): void {
    if (count <= 0) {
      return;
    }
    this.recordCounters({ messages: count }, nowMs);
  }

  recordServerFrames(count = 1, nowMs = performance.now()): void {
    if (count <= 0) {
      return;
    }
    this.lastServerFrameAtMs = nowMs;
    this.recordCounters({ serverFrames: count }, nowMs);
  }

  recordEntityCreates(count: number, nowMs = performance.now()): void {
    this.recordCounters({ entityCreates: count }, nowMs);
  }

  recordEntityUpdates(count: number, nowMs = performance.now()): void {
    this.recordCounters({ entityUpdates: count }, nowMs);
  }

  recordEntityDeletes(count: number, nowMs = performance.now()): void {
    this.recordCounters({ entityDeletes: count }, nowMs);
  }

  snapshot(nowMs = performance.now()): DiagnosticsSnapshot {
    this.prune(nowMs);
    const frameCount = this.frames.length;
    const frameSum = this.frames.reduce((sum, frame) => sum + frame.frameMs, 0);
    const maxFrameMs = this.frames.reduce((max, frame) => Math.max(max, frame.frameMs), 0);
    const counterTotals = this.totalCounters();
    const localEntity = this.state.getLocalEntity();

    return {
      fps: rate(frameCount, this.windowMs),
      averageFrameMs: frameCount > 0 ? frameSum / frameCount : 0,
      maxFrameMs,
      connected: this.connected,
      inputSamplesPerSecond: rate(counterTotals.inputSamples, this.windowMs),
      commandsQueuedPerSecond: rate(counterTotals.commandsQueued, this.windowMs),
      commandsAcceptedPerSecond: rate(counterTotals.commandsAccepted, this.windowMs),
      messagesPerSecond: rate(counterTotals.messages, this.windowMs),
      serverFramesPerSecond: rate(counterTotals.serverFrames, this.windowMs),
      entityCreatesPerSecond: rate(counterTotals.entityCreates, this.windowMs),
      entityUpdatesPerSecond: rate(counterTotals.entityUpdates, this.windowMs),
      entityDeletesPerSecond: rate(counterTotals.entityDeletes, this.windowMs),
      predictionErrorsPerSecond: rate(counterTotals.predictionErrors, this.windowMs),
      predictionReplaysPerSecond: rate(counterTotals.predictionReplays, this.windowMs),
      lastServerFrameAgeMs: this.lastServerFrameAtMs === null ? null : nowMs - this.lastServerFrameAtMs,
      latestSentSequence: this.latestSentSequence,
      latestSentClientTick: this.latestSentClientTick,
      latestConfirmedClientTick: this.latestConfirmedClientTick,
      pendingCommands: this.pendingCommands,
      localEntityId: this.state.localEntityId,
      playerX: localEntity?.x ?? null,
      playerY: localEntity?.y ?? null,
      entityCount: this.state.entities.size,
      mapReady: this.state.tileMap !== null,
      mapId: this.state.mapId,
      mapName: this.state.mapName,
      worldSeed: this.state.identity?.seed ?? null,
    };
  }

  private recordCounters(partial: Partial<DiagnosticsCounters>, nowMs: number): void {
    const values: DiagnosticsCounters = {
      inputSamples: partial.inputSamples ?? 0,
      commandsQueued: partial.commandsQueued ?? 0,
      commandsAccepted: partial.commandsAccepted ?? 0,
      predictionErrors: partial.predictionErrors ?? 0,
      predictionReplays: partial.predictionReplays ?? 0,
      messages: partial.messages ?? 0,
      serverFrames: partial.serverFrames ?? 0,
      entityCreates: partial.entityCreates ?? 0,
      entityUpdates: partial.entityUpdates ?? 0,
      entityDeletes: partial.entityDeletes ?? 0,
    };
    this.counters.push({ atMs: nowMs, values });
    this.prune(nowMs);
  }

  private prune(nowMs: number): void {
    const minimumMs = nowMs - this.windowMs;
    while (this.frames.length > 0 && this.frames[0].atMs < minimumMs) {
      this.frames.shift();
    }
    while (this.counters.length > 0 && this.counters[0].atMs < minimumMs) {
      this.counters.shift();
    }
  }

  private totalCounters(): DiagnosticsCounters {
    return this.counters.reduce(
      (totals, entry) => ({
        inputSamples: totals.inputSamples + entry.values.inputSamples,
        commandsQueued: totals.commandsQueued + entry.values.commandsQueued,
        commandsAccepted: totals.commandsAccepted + entry.values.commandsAccepted,
        predictionErrors: totals.predictionErrors + entry.values.predictionErrors,
        predictionReplays: totals.predictionReplays + entry.values.predictionReplays,
        messages: totals.messages + entry.values.messages,
        serverFrames: totals.serverFrames + entry.values.serverFrames,
        entityCreates: totals.entityCreates + entry.values.entityCreates,
        entityUpdates: totals.entityUpdates + entry.values.entityUpdates,
        entityDeletes: totals.entityDeletes + entry.values.entityDeletes,
      }),
      {
        inputSamples: 0,
        commandsQueued: 0,
        commandsAccepted: 0,
        predictionErrors: 0,
        predictionReplays: 0,
        messages: 0,
        serverFrames: 0,
        entityCreates: 0,
        entityUpdates: 0,
        entityDeletes: 0,
      },
    );
  }
}

function rate(count: number, windowMs: number): number {
  return count * (1000 / windowMs);
}
