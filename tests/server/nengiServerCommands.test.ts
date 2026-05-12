// Verifies server-side command acceptance sequencing without opening a network socket.
import { describe, expect, it } from 'vitest';
import { AttackIntent } from '../../src/shared/domain/commands.js';
import { NType } from '../../src/shared/net/nType.js';
import { NET_TIMING } from '../../src/shared/net/timing.js';
import { GameSimulation } from '../../src/server/simulation/gameSimulation.js';
import { NengiServer } from '../../src/server/net/nengiServer.js';

interface TestUser {
  id: number;
  queueMessage: (message: unknown) => void;
}

describe('nengi server command acceptance', () => {
  it('tracks latest accepted command sequence and ignores stale commands', () => {
    const simulation = new GameSimulation();
    const server = new NengiServer(simulation);
    const spawned = simulation.spawnPlayerMind();
    const queuedMessages: unknown[] = [];
    const user = { id: 7, queueMessage: (message: unknown) => queuedMessages.push(message) };
    const serverInternals = server as unknown as {
      entityByUserId: Map<number, number>;
      mindByUserId: Map<number, number>;
      userById: Map<number, TestUser>;
      handleCommands(user: TestUser, commands: unknown[]): void;
    };

    serverInternals.entityByUserId.set(user.id, spawned.entityId);
    serverInternals.mindByUserId.set(user.id, spawned.mindId);
    serverInternals.userById.set(user.id, user);
    serverInternals.handleCommands(user, [
      command(1),
      command(1),
      command(3),
      { ntype: NType.InputCommand, sequence: 4, clientTick: 1.5 },
    ]);

    expect(server.getLatestAcceptedCommandSequenceForUser(user.id)).toBe(3);
    expect(queuedMessages).toEqual([]);

    simulation.step();
    serverInternals.handleCommands(user, [command(2)]);
    server.sendSnapshots(0);

    expect(queuedMessages).toEqual([]);
  });

  it('rejects implausible sequence jumps without poisoning future input', () => {
    const simulation = new GameSimulation();
    const server = new NengiServer(simulation);
    const spawned = simulation.spawnPlayerMind();
    const user = { id: 8, queueMessage: () => {} };
    const serverInternals = server as unknown as {
      entityByUserId: Map<number, number>;
      mindByUserId: Map<number, number>;
      userById: Map<number, TestUser>;
      handleCommands(user: TestUser, commands: unknown[]): void;
    };

    serverInternals.entityByUserId.set(user.id, spawned.entityId);
    serverInternals.mindByUserId.set(user.id, spawned.mindId);
    serverInternals.userById.set(user.id, user);
    serverInternals.handleCommands(user, [command(1_000_000)]);
    expect(server.getLatestAcceptedCommandSequenceForUser(user.id)).toBe(0);

    serverInternals.handleCommands(user, [command(1)]);
    expect(server.getLatestAcceptedCommandSequenceForUser(user.id)).toBe(1);
  });

  it('caps accepted commands per user receive to bound server work', () => {
    const simulation = new GameSimulation();
    const server = new NengiServer(simulation);
    const spawned = simulation.spawnPlayerMind();
    const user = { id: 9, queueMessage: () => {} };
    const serverInternals = server as unknown as {
      entityByUserId: Map<number, number>;
      mindByUserId: Map<number, number>;
      userById: Map<number, TestUser>;
      handleCommands(user: TestUser, commands: unknown[]): void;
    };

    serverInternals.entityByUserId.set(user.id, spawned.entityId);
    serverInternals.mindByUserId.set(user.id, spawned.mindId);
    serverInternals.userById.set(user.id, user);
    serverInternals.handleCommands(
      user,
      Array.from({ length: NET_TIMING.maxCommandsPerUserPerReceive + 5 }, (_, index) => command(index + 1)),
    );

    expect(server.getLatestAcceptedCommandSequenceForUser(user.id)).toBe(NET_TIMING.maxCommandsPerUserPerReceive);
  });
});

function command(sequence: number): Record<string, unknown> {
  return {
    ntype: NType.InputCommand,
    moveX: 1,
    moveY: 0,
    aimX: 100,
    aimY: 200,
    attack: AttackIntent.None,
    sequence,
    clientTick: sequence,
    clientTimeMs: sequence * 33,
  };
}
