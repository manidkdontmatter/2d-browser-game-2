// Verifies core authoritative gameplay outcomes without a browser or network client.
import { describe, expect, it } from 'vitest';
import { ATTACK_RATE_LIMIT_MS, CHARACTER_MAX_HEALTH, MELEE_DAMAGE, MELEE_RANGE, NPC_RESPAWN_SECONDS, PLAYER_MOVE_SPEED, PROJECTILE_SPEED } from '../../src/shared/config.js';
import { AttackIntent, ControllerKind, PlayerCommand } from '../../src/shared/domain/commands.js';
import { NET_TIMING } from '../../src/shared/net/timing.js';
import { NetEntityKind } from '../../src/shared/domain/snapshots.js';
import { TileType } from '../../src/shared/world/mapTypes.js';
import { GameSimulation } from '../../src/server/simulation/gameSimulation.js';
import { Health, MindLink, Position, Velocity } from '../../src/server/simulation/components.js';

describe('authoritative game simulation', () => {
  it('spawns players and NPCs as body snapshots', () => {
    const simulation = new GameSimulation();
    const playerId = simulation.spawnPlayer();
    simulation.spawnHostileNpcs(3);
    simulation.step();

    const snapshots = simulation.getSnapshots();
    expect(snapshots.some((snapshot) => snapshot.entityId === playerId)).toBe(true);
    expect(snapshots.filter((snapshot) => snapshot.kind === NetEntityKind.Body)).toHaveLength(4);
  });

  it('replicates map portals and resolves transfer targets from entity proximity', () => {
    const simulation = new GameSimulation();
    const portal = simulation.addPortalToTarget({
      targetMapId: 'test-map-b',
      targetMapName: 'Test Map B',
      targetUrl: 'ws://127.0.0.1:9002',
      token: 'test-map-a->test-map-b',
    });
    const playerId = simulation.spawnPlayer();
    const eid = simulation.world.eidByEntityId.get(playerId)!;
    Position.x[eid] = portal.x;
    Position.y[eid] = portal.y;

    expect(simulation.getSnapshots().some((snapshot) => snapshot.kind === NetEntityKind.Portal)).toBe(true);
    expect(simulation.findPortalTransferForEntity(playerId)?.targetMapId).toBe('test-map-b');
  });

  it('mutates dense tiles and synchronizes authoritative tile collision bodies', () => {
    const simulation = new GameSimulation();
    const wall = findTile(simulation, TileType.Wall);
    simulation.world.tileCollision.syncActiveChunkIndexes(new Set([simulation.world.tileMap.chunkIndexFromTile(wall.x, wall.y)]));
    const bodyCountBefore = simulation.world.tileCollision.getBodyCount();

    expect(simulation.world.tileMap.isDense(wall.x, wall.y)).toBe(true);
    expect(bodyCountBefore).toBeGreaterThan(0);
    expect(simulation.mutateTile(wall.x, wall.y, TileType.Dirt)).toBe(true);

    expect(simulation.world.tileMap.getTile(wall.x, wall.y)).toBe(TileType.Dirt);
    expect(simulation.world.tileMap.isDense(wall.x, wall.y)).toBe(false);
    expect(simulation.world.tileCollision.getBodyCount()).toBe(bodyCountBefore - 1);
    expect(simulation.drainTileMutationReplication()).toEqual([{ x: wall.x, y: wall.y, tile: TileType.Dirt }]);
    expect(simulation.getTileMutationsInRect({
      minX: wall.x,
      minY: wall.y,
      maxX: wall.x,
      maxY: wall.y,
    })).toContainEqual({ x: wall.x, y: wall.y, tile: TileType.Dirt });
  });

  it('accumulates dense tile damage and destroys walls into dirt', () => {
    const simulation = new GameSimulation();
    const wall = findTile(simulation, TileType.Wall);

    expect(simulation.damageTile(wall.x, wall.y, 99)).toBe(true);
    expect(simulation.world.tileMap.getTile(wall.x, wall.y)).toBe(TileType.Wall);
    expect(simulation.drainTileMutationReplication()).toEqual([]);

    expect(simulation.damageTile(wall.x, wall.y, 1)).toBe(true);
    expect(simulation.world.tileMap.getTile(wall.x, wall.y)).toBe(TileType.Dirt);
    expect(simulation.drainTileMutationReplication()).toEqual([{ x: wall.x, y: wall.y, tile: TileType.Dirt }]);
  });

  it('accepts player movement commands server-side', () => {
    const simulation = new GameSimulation();
    const playerId = simulation.spawnPlayer();

    simulation.queueCommand(playerId, {
      moveX: 1,
      moveY: 0,
      aimX: 1000,
      aimY: 1000,
      attack: AttackIntent.None,
      interact: false,
      sequence: 1,
      clientTick: 1,
      clientTimeMs: 33,
      hotbarSlotActivated: -1,
    });
    simulation.step();

    const eid = simulation.world.eidByEntityId.get(playerId)!;
    expect(Position.x[eid]).toBeGreaterThan(0);
    expect(Velocity.x[eid]).toBe(0);
  });

  it('does not advance human movement without a fresh command tick', () => {
    const simulation = new GameSimulation();
    const playerId = simulation.spawnPlayer();

    simulation.queueCommand(playerId, command({
      moveX: 1,
      sequence: 1,
    }));
    simulation.step(1 / 30);
    const eid = simulation.world.eidByEntityId.get(playerId)!;
    const afterFreshCommandX = Position.x[eid];
    expect(afterFreshCommandX).toBeGreaterThan(0);

    simulation.step(1 / 30);
    expect(Position.x[eid]).toBe(afterFreshCommandX);
    expect(Velocity.x[eid]).toBe(0);
  });

  it('uses fixed movement-command credits and queues overflow without granting extra speed', () => {
    const simulation = new GameSimulation();
    const playerId = simulation.spawnPlayer();
    const eid = simulation.world.eidByEntityId.get(playerId)!;
    const beforeX = Position.x[eid];

    for (let sequence = 1; sequence <= NET_TIMING.maxMovementCommandCredits + 1; sequence += 1) {
      simulation.queueCommand(playerId, command({
        moveX: 1,
        sequence,
      }));
    }

    simulation.step(1 / 30);
    expect(Position.x[eid]).toBeCloseTo(
      beforeX + PLAYER_MOVE_SPEED * NET_TIMING.movementCommandSeconds * NET_TIMING.maxMovementCommandCredits,
      1,
    );

    simulation.step(1 / 30);
    expect(Position.x[eid]).toBeGreaterThan(beforeX + PLAYER_MOVE_SPEED * NET_TIMING.movementCommandSeconds * NET_TIMING.maxMovementCommandCredits);
  });

  it('keeps human movement inactive after an idle input sample', () => {
    const simulation = new GameSimulation();
    const playerId = simulation.spawnPlayer();

    simulation.queueCommand(playerId, command({
      moveX: 1,
      sequence: 1,
    }));
    simulation.step();
    simulation.queueCommand(playerId, command({
      moveX: 0,
      sequence: 2,
    }));
    simulation.step();

    const eid = simulation.world.eidByEntityId.get(playerId)!;
    expect(Velocity.x[eid]).toBe(0);
  });

  it('processes queued input samples in order while preserving each command as combat intent', () => {
    const simulation = new GameSimulation();
    const playerId = simulation.spawnPlayer();

    simulation.queueCommand(playerId, command({
      moveX: 1,
      sequence: 1,
    }));
    simulation.queueCommand(playerId, command({
      moveX: 0,
      sequence: 2,
    }));
    simulation.step();

    const eid = simulation.world.eidByEntityId.get(playerId)!;
    expect(Velocity.x[eid]).toBe(0);
  });

  it('spawns server-authoritative projectiles from command intent', () => {
    const simulation = new GameSimulation();
    const playerId = simulation.spawnPlayer();
    simulation.queueCommand(playerId, command({
      aimX: 9999,
      aimY: 9999,
      attack: AttackIntent.Projectile,
      sequence: 1,
    }));
    simulation.step();

    expect(simulation.getSnapshots().some((snapshot) => snapshot.kind === NetEntityKind.Projectile)).toBe(true);
  });

  it('transfers a mind into a nonstandard controllable body', () => {
    const simulation = new GameSimulation();
    const spawned = simulation.spawnPlayerMind();
    const mobileDoorId = simulation.spawnAndTransferMindToMobileDoor(spawned.mindId);
    expect(mobileDoorId).toBeDefined();
    expect(mobileDoorId).not.toBe(spawned.entityId);
    expect(simulation.getControlledEntityId(spawned.mindId)).toBe(mobileDoorId);

    const doorEid = simulation.world.eidByEntityId.get(mobileDoorId!);
    expect(doorEid).toBeDefined();
    const beforeX = Position.x[doorEid!];

    simulation.queueCommandForMind(spawned.mindId, command({
      moveX: 1,
      sequence: 1,
    }));
    simulation.step();

    expect(Position.x[doorEid!]).toBeGreaterThan(beforeX);
  });

  it('pools expired projectiles instead of deleting their ECS entity ids', () => {
    const simulation = new GameSimulation();
    const playerId = simulation.spawnPlayer();
    simulation.queueCommand(playerId, command({
      aimX: 9999,
      aimY: 9999,
      attack: AttackIntent.Projectile,
      sequence: 1,
    }));
    simulation.step();
    const projectile = simulation.getSnapshots().find((snapshot) => snapshot.kind === NetEntityKind.Projectile);
    expect(projectile).toBeDefined();
    const projectileEid = simulation.world.eidByEntityId.get(projectile!.entityId);

    simulation.step(2);

    expect(simulation.getSnapshots().some((snapshot) => snapshot.entityId === projectile!.entityId)).toBe(false);
    expect(simulation.world.eidByEntityId.get(projectile!.entityId)).toBe(projectileEid);
    expect(simulation.getPoolStats().pooledProjectiles).toBe(1);
  });

  it('reports whether an entity id still has a live physics body', () => {
    const simulation = new GameSimulation();
    const playerId = simulation.spawnPlayer();

    expect(simulation.hasEntityBody(playerId)).toBe(true);
    simulation.removeEntity(playerId);
    expect(simulation.hasEntityBody(playerId)).toBe(false);
  });

  it('spreads hostile NPCs away from the player spawn', () => {
    const simulation = new GameSimulation();
    const playerId = simulation.spawnPlayer();
    simulation.spawnHostileNpcs(25);
    simulation.step();

    const snapshots = simulation.getSnapshots();
    const player = snapshots.find((snapshot) => snapshot.entityId === playerId);
    expect(player).toBeDefined();

    const closestNpcDistance = Math.min(
      ...snapshots
        .filter((snapshot) => snapshot.kind === NetEntityKind.Body && snapshot.entityId !== playerId)
        .map((snapshot) => Math.hypot(snapshot.x - player!.x, snapshot.y - player!.y)),
    );

    expect(closestNpcDistance).toBeGreaterThan(128 * 10);
  });

  it('removes entities from ECS, physics, indexes, and replication state', () => {
    const simulation = new GameSimulation();
    const playerId = simulation.spawnPlayer();
    const eid = simulation.world.eidByEntityId.get(playerId);
    const body = simulation.world.bodyByEntityId.get(playerId);

    expect(eid).toBeDefined();
    expect(body).toBeDefined();

    simulation.removeEntity(playerId);

    expect(simulation.world.eidByEntityId.has(playerId)).toBe(false);
    expect(simulation.world.bodyByEntityId.has(playerId)).toBe(false);
    expect(body ? simulation.world.entityIdByBodyId.has(body.id) : false).toBe(false);
    expect(simulation.getNetworkRecords().some((record) => record.entityId === playerId)).toBe(false);
    expect(simulation.getSnapshots().some((snapshot) => snapshot.entityId === playerId)).toBe(false);
  });
});

function command(overrides: Partial<PlayerCommand>): PlayerCommand {
  return {
    moveX: 0,
    moveY: 0,
    aimX: 0,
    aimY: 0,
    attack: AttackIntent.None,
    interact: false,
    sequence: 1,
    clientTick: 1,
    clientTimeMs: 33,
    hotbarSlotActivated: -1,
    ...overrides,
  };
}

function setEntityPosition(simulation: GameSimulation, entityId: number, x: number, y: number): void {
  const eid = simulation.world.eidByEntityId.get(entityId);
  expect(eid).toBeDefined();
  Position.x[eid!] = x;
  Position.y[eid!] = y;
  simulation.world.bodyByEntityId.get(entityId)?.setPosition(x, y);
}

function findTile(simulation: GameSimulation, tile: TileType): { x: number; y: number } {
  for (let y = 0; y < simulation.world.tileMap.height; y += 1) {
    for (let x = 0; x < simulation.world.tileMap.width; x += 1) {
      if (simulation.world.tileMap.getTile(x, y) === tile) {
        return { x, y };
      }
    }
  }

  throw new Error(`No tile found for ${tile}`);
}
