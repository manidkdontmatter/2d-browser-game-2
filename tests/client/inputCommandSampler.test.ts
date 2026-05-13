// Verifies client input sampling, command cadence decisions, and nengi-style movement prediction behavior.
import { describe, expect, it } from 'vitest';
import { InputCommandPayload, InputCommandSampler, InputState } from '../../src/client/input.js';
import { applyPredictedMovement, MovementPredictionController } from '../../src/client/net/movementPrediction.js';
import { AttackIntent, NO_HOTBAR_SLOT } from '../../src/shared/domain/commands.js';
import { NetEntityKind } from '../../src/shared/domain/snapshots.js';
import { NType } from '../../src/shared/net/nType.js';
import { NET_TIMING } from '../../src/shared/net/timing.js';
import { ClientEntity, ClientWorldState } from '../../src/client/game/clientWorldState.js';
import { TileType } from '../../src/shared/world/mapTypes.js';
import { TileMapView } from '../../src/shared/world/tileMap.js';

describe('input command sampler', () => {
  it('builds explicit command samples with movement axis and sequence metadata', () => {
    const sampler = new InputCommandSampler();
    const command = sampler.sample(inputState({ w: true, d: true }), 500, 600, AttackIntent.None, false, 123, NO_HOTBAR_SLOT);

    expect(command.sequence).toBe(1);
    expect(command.clientTick).toBe(0);
    expect(command.clientTimeMs).toBe(123);
    expect(command.moveX).toBeCloseTo(Math.SQRT1_2);
    expect(command.moveY).toBeCloseTo(-Math.SQRT1_2);
    expect(command.aimX).toBe(500);
    expect(command.aimY).toBe(600);
  });

  it('suppresses redundant no-op commands until the heartbeat window elapses', () => {
    const sampler = new InputCommandSampler();
    const first = sampler.sample(inputState(), 10, 20, AttackIntent.None, false, 0, NO_HOTBAR_SLOT);

    expect(sampler.shouldSend(first, 0)).toBe(true);
    sampler.markSent(first, 0);

    const redundant = sampler.sample(inputState(), 10, 20, AttackIntent.None, false, NET_TIMING.inputHeartbeatMs - 1, NO_HOTBAR_SLOT);
    expect(sampler.shouldSend(redundant, NET_TIMING.inputHeartbeatMs - 1)).toBe(false);

    const heartbeat = sampler.sample(inputState(), 10, 20, AttackIntent.None, false, NET_TIMING.inputHeartbeatMs, NO_HOTBAR_SLOT);
    expect(sampler.shouldSend(heartbeat, NET_TIMING.inputHeartbeatMs)).toBe(true);
    expect(heartbeat.sequence).toBe(2);
  });

  it('sends attack commands immediately even when movement and aim are unchanged', () => {
    const sampler = new InputCommandSampler();
    const first = sampler.sample(inputState(), 10, 20, AttackIntent.None, false, 0, NO_HOTBAR_SLOT);
    sampler.markSent(first, 0);

    const attack = sampler.sample(inputState(), 10, 20, AttackIntent.Projectile, false, 1, NO_HOTBAR_SLOT);
    expect(sampler.shouldSend(attack, 1)).toBe(true);
  });

  it('sends active movement samples at the input command cadence', () => {
    const sampler = new InputCommandSampler();
    const first = sampler.sample(inputState({ d: true }), 10, 20, AttackIntent.None, false, 0, NO_HOTBAR_SLOT);
    sampler.markSent(first, 0);

    const held = sampler.sample(inputState({ d: true }), 10, 20, AttackIntent.None, false, 33, NO_HOTBAR_SLOT);

    expect(sampler.shouldSend(held, 33)).toBe(true);
  });

});

describe('movement prediction controller', () => {
  it('predicts local movement from commands', () => {
    const entity = clientEntity();
    applyPredictedMovement(entity, {
      ntype: NType.InputCommand,
      moveX: 1,
      moveY: 0,
      aimX: 0,
      aimY: 0,
      attack: AttackIntent.None,
      interact: false,
      sequence: 1,
      clientTick: 1,
      clientTimeMs: 0,
      hotbarSlotActivated: NO_HOTBAR_SLOT,
    });

    expect(entity.x).toBeGreaterThan(100);
    expect(entity.facing).toBe(1);
  });

  it('blocks predicted movement against wall tiles', () => {
    const state = new ClientWorldState();
    state.tileMap = new TileMapView(2, 1, new Uint8Array([TileType.Grass, TileType.Wall]));
    const entity = clientEntity({ x: 93, y: 64 });

    applyPredictedMovement(entity, {
      ntype: NType.InputCommand,
      moveX: 1,
      moveY: 0,
      aimX: 0,
      aimY: 0,
      attack: AttackIntent.None,
      interact: false,
      sequence: 1,
      clientTick: 1,
      clientTimeMs: 0,
      hotbarSlotActivated: NO_HOTBAR_SLOT,
    }, state);

    expect(entity.x).toBeLessThan(105);
  });

  it('blocks predicted movement against visible bodies', () => {
    const state = new ClientWorldState();
    const entity = clientEntity({ x: 100, y: 100 });
    state.upsertEntity(entity);
    state.upsertEntity(clientEntity({ nid: 2, entityId: 99, x: 170, y: 100 }));

    applyPredictedMovement(entity, {
      ntype: NType.InputCommand,
      moveX: 1,
      moveY: 0,
      aimX: 0,
      aimY: 0,
      attack: AttackIntent.None,
      interact: false,
      sequence: 1,
      clientTick: 1,
      clientTimeMs: 0,
      hotbarSlotActivated: NO_HOTBAR_SLOT,
    }, state);

    expect(entity.x).toBeLessThan(112);
  });

  it('presents the canonical predicted local entity without render-ahead extrapolation', () => {
    const state = new ClientWorldState();
    state.tileMap = new TileMapView(2, 1, new Uint8Array([TileType.Grass, TileType.Wall]));
    state.setLocalEntityId(42);
    const local = clientEntity({ entityId: 42, x: 93, y: 64 });
    state.upsertEntity(local);
    const controller = new MovementPredictionController(state);
    const command: InputCommandPayload = {
      ntype: NType.InputCommand,
      moveX: 1,
      moveY: 0,
      aimX: 0,
      aimY: 0,
      attack: AttackIntent.None,
      interact: false,
      sequence: 1,
      clientTick: 1,
      clientTimeMs: 100,
      hotbarSlotActivated: NO_HOTBAR_SLOT,
    };

    controller.applyLocalCommand(command);
    const canonicalX = state.getLocalEntity()?.x ?? 0;
    const presented = controller.getPresentationPosition(116);

    expect(presented?.x).toBe(canonicalX);
  });

  it('ignores server position updates for the predicted local entity', () => {
    const state = new ClientWorldState();
    state.setLocalEntityId(42);
    const local = clientEntity({ entityId: 42 });
    const remote = clientEntity({ nid: 2, entityId: 99 });
    state.upsertEntity(local);
    state.upsertEntity(remote);
    const controller = new MovementPredictionController(state);

    expect(controller.shouldApplyServerUpdate(local, 'x')).toBe(false);
    expect(controller.shouldApplyServerUpdate(local, 'health')).toBe(true);
    expect(controller.shouldApplyServerUpdate(remote, 'x')).toBe(true);
  });

  it('reconciles nengi prediction errors and returns replayed predictions', () => {
    const state = new ClientWorldState();
    state.setLocalEntityId(42);
    state.upsertEntity(clientEntity({ entityId: 42, x: 112 }));
    const controller = new MovementPredictionController(state);
    const replays = controller.reconcileFromPredictionErrorFrame({
      tick: 7,
      entities: new Map([[1, { errors: [{ prop: 'x', actualValue: 100 }, { prop: 'y', actualValue: 100 }] }]]),
    }, [{
      tick: 8,
      commands: [{
        ntype: NType.InputCommand,
        moveX: 1,
        moveY: 0,
        aimX: 0,
        aimY: 0,
        attack: AttackIntent.None,
        interact: false,
        sequence: 9,
        clientTick: 8,
        clientTimeMs: 0,
      hotbarSlotActivated: NO_HOTBAR_SLOT,
      }],
    }], 0);

    expect(state.getLocalEntity()?.x).toBeGreaterThan(100);
    expect(replays[0].tick).toBe(8);
  });

  it('hard resyncs large nengi prediction errors without replaying stale commands', () => {
    const state = new ClientWorldState();
    state.setLocalEntityId(42);
    state.upsertEntity(clientEntity({ entityId: 42, x: 1000, y: 1000 }));
    const replays = new MovementPredictionController(state).reconcileFromPredictionErrorFrame({
      tick: 1,
      entities: new Map([[1, { errors: [{ prop: 'x', actualValue: 100 }, { prop: 'y', actualValue: 100 }] }]]),
    }, [{
      tick: 2,
      commands: [{
        ntype: NType.InputCommand,
        moveX: 1,
        moveY: 0,
        aimX: 0,
        aimY: 0,
        attack: AttackIntent.None,
        interact: false,
        sequence: 1,
        clientTick: 2,
        clientTimeMs: 0,
      hotbarSlotActivated: NO_HOTBAR_SLOT,
      }],
    }], 0);

    expect(state.getLocalEntity()?.x).toBe(100);
    expect(replays).toEqual([]);
  });

  it('clears correction presentation on authoritative reset boundaries', () => {
    const state = new ClientWorldState();
    state.setLocalEntityId(42);
    state.upsertEntity(clientEntity({ entityId: 42 }));
    const controller = new MovementPredictionController(state);

    controller.handleAuthoritativeReset();

    expect(controller.getPresentationPosition(0)).toEqual({ x: 100, y: 100 });
  });

  it('can be disabled so server position updates are applied directly', () => {
    const state = new ClientWorldState();
    state.setLocalEntityId(42);
    const local = clientEntity({ entityId: 42 });
    state.upsertEntity(local);
    const controller = new MovementPredictionController(state);

    controller.setEnabled(false);
    controller.applyLocalCommand({
      ntype: NType.InputCommand,
      moveX: 1,
      moveY: 0,
      aimX: 0,
      aimY: 0,
      attack: AttackIntent.None,
      interact: false,
      sequence: 1,
      clientTick: 1,
      clientTimeMs: 0,
      hotbarSlotActivated: NO_HOTBAR_SLOT,
    });

    expect(local.x).toBe(100);
    expect(controller.shouldApplyServerUpdate(local, 'x')).toBe(true);
  });
});

function inputState(overrides: Partial<InputState> = {}): InputState {
  return {
    w: false,
    a: false,
    s: false,
    d: false,
    e: false,
    mouseX: 0,
    mouseY: 0,
    attack: AttackIntent.None,
    hotbarSlotActivated: NO_HOTBAR_SLOT,
    ...overrides,
  };
}

function clientEntity(overrides: Partial<ClientEntity> = {}): ClientEntity {
  return {
    nid: 1,
    ntype: NType.NetEntity,
    entityId: 42,
    kind: NetEntityKind.Body,
    x: 100,
    y: 100,
    health: 100,
    facing: 1,
    ...overrides,
  };
}
