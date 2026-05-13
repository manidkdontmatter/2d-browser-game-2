// Verifies nengi channel separation and spatial AOI updates without opening a network socket.
import { describe, expect, it } from 'vitest';
import { AttackIntent } from '../../src/shared/domain/commands.js';
import { NetEntityKind } from '../../src/shared/domain/snapshots.js';
import { NType } from '../../src/shared/net/nType.js';
import { GameSimulation } from '../../src/server/simulation/gameSimulation.js';
import { NengiServer } from '../../src/server/net/nengiServer.js';

interface FakeUser {
  id: number;
  subscriptions: Map<number, unknown>;
  queuedMessages: unknown[];
  queueMessage(message: unknown): void;
  subscribe(channel: { nid: number }): void;
  unsubscribe(channel: { nid: number }): void;
}

describe('nengi server spatial AOI channels', () => {
  it('only exposes spatial entities inside a user AOI', () => {
    const simulation = new GameSimulation();
    const server = new NengiServer(simulation, { width: 200, height: 200 });
    const user = fakeUser(1);
    const inside = spatialEntity(1, 50, 50);
    const outside = spatialEntity(2, 500, 500);

    server.spatialChannel.addEntity(inside);
    server.spatialChannel.addEntity(outside);
    server.spatialChannel.subscribe(user, { x: 0, y: 0, halfWidth: 100, halfHeight: 100 });

    expect(server.spatialChannel.getVisibleEntities(user.id)).toEqual([inside.nid]);
  });

  it('refreshes a moving player AOI center before snapshots are sent', () => {
    const simulation = new GameSimulation();
    const server = new NengiServer(simulation, { width: 200, height: 200 });
    const user = fakeUser(2);
    const internals = server as unknown as {
      handleConnect(user: FakeUser): void;
      syncEntitiesToNengi(): void;
      refreshSpatialViews(): void;
      entityByUserId: Map<number, number>;
      replication: { getEntityRecord(entityId: number): { x: number; y: number } | undefined };
    };

    internals.handleConnect(user);
    internals.syncEntitiesToNengi();
    const playerEntityId = internals.entityByUserId.get(user.id)!;
    const player = internals.replication.getEntityRecord(playerEntityId)!;
    player.x = 1000;
    player.y = 1000;

    const nearby = spatialEntity(77, 1040, 1040);
    server.spatialChannel.addEntity(nearby);
    internals.refreshSpatialViews();

    expect(server.spatialChannel.getVisibleEntities(user.id)).toContain(nearby.nid);
  });

  it('adds gameplay entities to the spatial channel and not the global channel', () => {
    const simulation = new GameSimulation();
    const server = new NengiServer(simulation);
    simulation.spawnPlayer();
    simulation.spawnHostileNpcs(2);

    const internals = server as unknown as { syncEntitiesToNengi(): void };
    internals.syncEntitiesToNengi();

    expect(server.spatialChannel.entities.array.length).toBeGreaterThanOrEqual(3);
    expect(server.globalChannel.entities.array).toHaveLength(0);
  });

  it('coexists with a global channel without duplicate gameplay replication', () => {
    const simulation = new GameSimulation();
    const server = new NengiServer(simulation, { width: 5000, height: 5000 });
    const user = fakeUser(3);
    const globalEntity = { nid: 0, ntype: NType.TileMutationMessage, x: 0, y: 0, tile: 1 };
    const gameplayEntity = spatialEntity(10, 100, 100);

    server.globalChannel.addEntity(globalEntity);
    server.spatialChannel.addEntity(gameplayEntity);
    server.globalChannel.subscribe(user);
    server.spatialChannel.subscribe(user, { x: 100, y: 100, halfWidth: 2500, halfHeight: 2500 });

    const globalVisible = server.globalChannel.getVisibleEntities(user.id);
    const spatialVisible = server.spatialChannel.getVisibleEntities(user.id);

    expect(globalVisible).toEqual([globalEntity.nid]);
    expect(spatialVisible).toEqual([gameplayEntity.nid]);
    expect(new Set([...globalVisible, ...spatialVisible]).size).toBe(2);
  });

  it('unsubscribes from both channels and clears command/user state on disconnect', () => {
    const simulation = new GameSimulation();
    const server = new NengiServer(simulation);
    const user = fakeUser(4);
    const internals = server as unknown as {
      handleConnect(user: FakeUser): void;
      handleCommands(user: FakeUser, commands: unknown[]): void;
      handleDisconnect(user: FakeUser): void;
      userById: Map<number, FakeUser>;
      entityByUserId: Map<number, number>;
      latestAcceptedSequenceByUserId: Map<number, number>;
      lastViewCenterByUserId: Map<number, { x: number; y: number }>;
    };

    internals.handleConnect(user);
    internals.handleCommands(user, [command(1)]);
    internals.handleDisconnect(user);

    expect(user.subscriptions.has(server.globalChannel.nid)).toBe(false);
    expect(user.subscriptions.has(server.spatialChannel.nid)).toBe(false);
    expect(internals.userById.has(user.id)).toBe(false);
    expect(internals.entityByUserId.has(user.id)).toBe(false);
    expect(internals.latestAcceptedSequenceByUserId.has(user.id)).toBe(false);
    expect(internals.lastViewCenterByUserId.has(user.id)).toBe(false);
  });
});

function fakeUser(id: number): FakeUser {
  return {
    id,
    subscriptions: new Map<number, unknown>(),
    queuedMessages: [],
    queueMessage(message: unknown): void {
      this.queuedMessages.push(message);
    },
    subscribe(channel: { nid: number }): void {
      this.subscriptions.set(channel.nid, channel);
    },
    unsubscribe(channel: { nid: number }): void {
      this.subscriptions.delete(channel.nid);
    },
  };
}

function spatialEntity(entityId: number, x: number, y: number): {
  nid: number;
  ntype: NType.NetEntity;
  entityId: number;
  kind: NetEntityKind.Body;
  x: number;
  y: number;
  health: number;
  facing: number;
} {
  return {
    nid: 0,
    ntype: NType.NetEntity,
    entityId,
    kind: NetEntityKind.Body,
    x,
    y,
    health: 100,
    facing: 1,
  };
}

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
    hotbarSlotActivated: -1,
  };
}
