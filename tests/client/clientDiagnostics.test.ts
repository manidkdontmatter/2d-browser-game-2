// Verifies rolling client diagnostics aggregation without requiring a browser render loop.
import { describe, expect, it } from 'vitest';
import { ClientDiagnostics } from '../../src/client/diagnostics/clientDiagnostics.js';
import { ClientWorldState } from '../../src/client/game/clientWorldState.js';
import { worldIdentityToInitPayload } from '../../src/shared/net/messages.js';
import { createWorldIdentity } from '../../src/shared/world/generateMap.js';

describe('client diagnostics', () => {
  it('aggregates rolling frame, command, and replication rates', () => {
    const state = new ClientWorldState();
    const diagnostics = new ClientDiagnostics(state, { windowMs: 1000 });

    diagnostics.recordFrame(0);
    diagnostics.recordFrame(16);
    diagnostics.recordFrame(32);
    diagnostics.recordInputSample(90);
    diagnostics.recordCommandsQueued(2, 100);
    diagnostics.recordCommandQueued(7, 11, 2, 110);
    diagnostics.recordNengiConfirmation(10, 1, 130);
    diagnostics.recordPredictionReconciliation(1, 2, 135);
    diagnostics.recordMessages(1, 120);
    diagnostics.recordServerFrames(1, 140);
    diagnostics.recordEntityCreates(3, 140);
    diagnostics.recordEntityUpdates(5, 140);
    diagnostics.recordEntityDeletes(1, 140);
    diagnostics.setConnected(true);

    const snapshot = diagnostics.snapshot(200);

    expect(snapshot.fps).toBe(2);
    expect(snapshot.averageFrameMs).toBe(16);
    expect(snapshot.maxFrameMs).toBe(16);
    expect(snapshot.inputSamplesPerSecond).toBe(1);
    expect(snapshot.commandsQueuedPerSecond).toBe(3);
    expect(snapshot.commandsAcceptedPerSecond).toBe(1);
    expect(snapshot.messagesPerSecond).toBe(1);
    expect(snapshot.serverFramesPerSecond).toBe(1);
    expect(snapshot.entityCreatesPerSecond).toBe(3);
    expect(snapshot.entityUpdatesPerSecond).toBe(5);
    expect(snapshot.entityDeletesPerSecond).toBe(1);
    expect(snapshot.predictionErrorsPerSecond).toBe(1);
    expect(snapshot.predictionReplaysPerSecond).toBe(2);
    expect(snapshot.connected).toBe(true);
    expect(snapshot.lastServerFrameAgeMs).toBe(60);
    expect(snapshot.latestSentSequence).toBe(7);
    expect(snapshot.latestSentClientTick).toBe(11);
    expect(snapshot.latestConfirmedClientTick).toBe(10);
    expect(snapshot.pendingCommands).toBe(1);
  });

  it('prunes old samples and includes current world state', () => {
    const state = new ClientWorldState();
    state.setLocalEntityId(42);
    state.applyWorldInit(worldIdentityToInitPayload(createWorldIdentity('diagnostics-seed')));
    const diagnostics = new ClientDiagnostics(state, { windowMs: 1000 });

    diagnostics.recordCommandsQueued(10, 0);
    diagnostics.recordCommandsQueued(1, 1500);
    const snapshot = diagnostics.snapshot(1500);

    expect(snapshot.commandsQueuedPerSecond).toBe(1);
    expect(snapshot.localEntityId).toBe(42);
    expect(snapshot.mapReady).toBe(true);
    expect(snapshot.worldSeed).toBe('diagnostics-seed');
  });
});
