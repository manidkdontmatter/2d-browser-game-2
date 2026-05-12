// Integrates the authoritative simulation with nengi 2 over the uWebSockets instance adapter.
import { Channel, ChannelAABB2D, Instance, NetworkEvent, type User } from 'nengi';
import { uWebSocketsInstanceAdapter } from 'nengi-uws-instance-adapter';
import { DEFAULT_AOI_HEIGHT, DEFAULT_AOI_WIDTH, TILE_SIZE } from '../../shared/config.js';
import { coordKey } from '../../shared/math/vector.js';
import type { MapTransferPayload } from '../../shared/net/messages.js';
import { tileMutationToPayload, worldIdentityToInitPayload } from '../../shared/net/messages.js';
import { ncontext } from '../../shared/net/context.js';
import { NType } from '../../shared/net/nType.js';
import { validateInputCommand } from '../../shared/net/commandValidation.js';
import { parseDebugInvincibleEnabled, parseDebugNpcSpawnCount } from '../../shared/net/debugRequests.js';
import { RequestEndpoint } from '../../shared/net/requestEndpoints.js';
import type { AllocateStatRequest, CharacterStatsResponse, RemoveStatRequest } from '../../shared/net/statRequests.js';
import { totalAllocatedPoints } from '../../shared/stats/characterStats.js';
import { NET_TIMING, SNAPSHOT_INTERVAL_SECONDS } from '../../shared/net/timing.js';
import type { TileMutation } from '../../shared/world/mapTypes.js';
import { GameSimulation } from '../simulation/gameSimulation.js';
import { ReplicationCoordinator } from './replicationCoordinator.js';
import { ReplicationDomain, assertReplicationOwner } from './replicationContract.js';

export interface SpatialAoiConfig {
  width: number;
  height: number;
}

export interface RuntimeMapInfo {
  id: string;
  name: string;
}

export interface NengiServerOptions {
  acceptedTokens?: readonly string[];
}

interface ViewCenter {
  x: number;
  y: number;
}

export class NengiServer {
  readonly instance = new Instance(ncontext);
  readonly globalChannel = new Channel(this.instance.localState);
  readonly spatialChannel = new ChannelAABB2D(this.instance.localState);
  private readonly entityByUserId = new Map<number, number>();
  private readonly mindByUserId = new Map<number, number>();
  private readonly userById = new Map<number, User>();
  private readonly latestAcceptedSequenceByUserId = new Map<number, number>();
  private readonly lastViewCenterByUserId = new Map<number, ViewCenter>();
  private readonly transferringUserIds = new Set<number>();
  private readonly sentTileMutationTileByCoordByUserId = new Map<number, Map<string, number>>();
  private adapter: uWebSocketsInstanceAdapter | null = null;
  private snapshotAccumulator = 0;
  private readonly spatialAoi: SpatialAoiConfig;
  private readonly mapInfo: RuntimeMapInfo;
  private readonly replication: ReplicationCoordinator;

  constructor(
    private readonly simulation: GameSimulation,
    mapInfoOrSpatial: RuntimeMapInfo | Partial<SpatialAoiConfig> = { id: 'default', name: 'Default Map' },
    spatialAoi: Partial<SpatialAoiConfig> = {},
    private readonly options: NengiServerOptions = {},
  ) {
    const hasMapInfo = 'id' in mapInfoOrSpatial || 'name' in mapInfoOrSpatial;
    this.mapInfo = hasMapInfo ? mapInfoOrSpatial as RuntimeMapInfo : { id: 'default', name: 'Default Map' };
    const resolvedSpatialAoi = hasMapInfo ? spatialAoi : mapInfoOrSpatial as Partial<SpatialAoiConfig>;
    this.spatialAoi = {
      width: resolvedSpatialAoi.width ?? DEFAULT_AOI_WIDTH,
      height: resolvedSpatialAoi.height ?? DEFAULT_AOI_HEIGHT,
    };
    this.replication = new ReplicationCoordinator(this.spatialChannel);
    this.instance.onConnect = async (handshake: unknown) => {
      this.validateHandshake(handshake);
      return { accepted: true, mapId: this.mapInfo.id };
    };
    this.instance.respond(RequestEndpoint.DebugSpawnNpcs, ({ body }, send) => {
      assertReplicationOwner(ReplicationDomain.Debug, 'NengiServerDebugResponder');
      const requested = parseDebugNpcSpawnCount(body);
      const spawned = this.simulation.spawnHostileNpcs(requested).length;
      send({ requested, spawned });
    });
    this.instance.respond(RequestEndpoint.DebugSetInvincible, ({ user, body }, send) => {
      assertReplicationOwner(ReplicationDomain.Debug, 'NengiServerDebugResponder');
      const entityId = this.getControlledEntityForUser(user.id);
      if (entityId === undefined) {
        send({ enabled: false });
        return;
      }

      const enabled = this.simulation.setEntityInvincible(entityId, parseDebugInvincibleEnabled(body));
      send({ enabled });
    });
    this.instance.respond(RequestEndpoint.GetCharacterStats, ({ user }, send) => {
      const entityId = this.getControlledEntityForUser(user.id);
      if (entityId === undefined) {
        send(null);
        return;
      }
      send(this.buildCharacterStatsResponse(entityId));
    });
    this.instance.respond(RequestEndpoint.AllocateStat, ({ user, body }, send) => {
      const entityId = this.getControlledEntityForUser(user.id);
      if (entityId === undefined) {
        send(null);
        return;
      }
      const request = body as AllocateStatRequest;
      this.simulation.stats.allocatePoint(entityId, request.statId);
      send(this.buildCharacterStatsResponse(entityId));
    });
    this.instance.respond(RequestEndpoint.RemoveStat, ({ user, body }, send) => {
      const entityId = this.getControlledEntityForUser(user.id);
      if (entityId === undefined) {
        send(null);
        return;
      }
      const request = body as RemoveStatRequest;
      this.simulation.stats.removePoint(entityId, request.statId);
      send(this.buildCharacterStatsResponse(entityId));
    });
    this.instance.respond(RequestEndpoint.ResetStats, ({ user }, send) => {
      const entityId = this.getControlledEntityForUser(user.id);
      if (entityId === undefined) {
        send(null);
        return;
      }
      this.simulation.stats.resetAllocations(entityId);
      send(this.buildCharacterStatsResponse(entityId));
    });
  }

  listen(port: number): void {
    this.adapter = new uWebSocketsInstanceAdapter(this.instance.network, {});
    this.adapter.listen(port, () => {
      console.log(`nengi uWebSockets adapter listening on ${port}`);
    });
  }

  getLatestAcceptedCommandSequenceForUser(userId: number): number {
    return this.latestAcceptedSequenceByUserId.get(userId) ?? 0;
  }

  transferUserMindToMobileDoor(userId: number): number | null {
    const mindId = this.mindByUserId.get(userId);
    if (mindId === undefined) {
      return null;
    }

    const entityId = this.simulation.spawnAndTransferMindToMobileDoor(mindId);
    if (entityId === null) {
      return null;
    }

    this.entityByUserId.set(userId, entityId);
    const user = this.userById.get(userId);
    if (user) {
      this.replication.queueIdentity(user, entityId);
    }
    return entityId;
  }

  step(deltaSeconds: number): void {
    this.receiveNetworkInput();
    this.sendSnapshots(deltaSeconds);
  }

  receiveNetworkInput(): void {
    this.processNetworkEvents();
  }

  sendSnapshots(deltaSeconds: number): void {
    this.respawnDeadUsers();
    this.queuePortalTransfers();
    this.queueLiveTileMutations();
    this.queueTileMutationCatchup();
    this.syncEntitiesToNengi();
    this.snapshotAccumulator += deltaSeconds;
    if (this.snapshotAccumulator >= SNAPSHOT_INTERVAL_SECONDS) {
      this.refreshSpatialViews();
      this.instance.step();
      this.snapshotAccumulator = 0;
    }
  }

  private processNetworkEvents(): void {
    while (!this.instance.queue.isEmpty()) {
      const event = this.instance.queue.next();
      if (event.type === NetworkEvent.UserConnected) {
        this.handleConnect(event.user);
      }

      if (event.type === NetworkEvent.UserDisconnected) {
        this.handleDisconnect(event.user);
      }

      if (event.type === NetworkEvent.CommandSet) {
        this.handleCommands(event.user, event.commands ?? []);
      }
    }
  }

  private handleConnect(user: User): void {
    this.userById.set(user.id, user);
    this.sentTileMutationTileByCoordByUserId.set(user.id, new Map());
    this.assignPlayerEntity(user);
    this.globalChannel.subscribe(user);
    this.subscribeUserToSpatialChannel(user);
    this.replication.queueWorldInit(user, worldIdentityToInitPayload(this.simulation.identity, this.mapInfo));
  }

  private handleDisconnect(user: User): void {
    const mindId = this.mindByUserId.get(user.id);
    const entityId = mindId !== undefined ? this.simulation.getControlledEntityId(mindId) : this.entityByUserId.get(user.id);
    if (entityId !== undefined && entityId !== null) {
      this.simulation.removeEntity(entityId);
    }
    if (mindId !== undefined) {
      this.simulation.removeMind(mindId);
    }
    this.mindByUserId.delete(user.id);
    this.entityByUserId.delete(user.id);
    this.userById.delete(user.id);
    this.latestAcceptedSequenceByUserId.delete(user.id);
    this.lastViewCenterByUserId.delete(user.id);
    this.transferringUserIds.delete(user.id);
    this.sentTileMutationTileByCoordByUserId.delete(user.id);
    this.globalChannel.unsubscribe(user);
    this.spatialChannel.unsubscribe(user);
  }

  private handleCommands(user: User, commands: unknown[]): void {
    const mindId = this.mindByUserId.get(user.id);
    if (mindId === undefined) {
      return;
    }

    let acceptedCommandCount = 0;
    for (const command of commands) {
      if (acceptedCommandCount >= NET_TIMING.maxCommandsPerUserPerReceive) {
        break;
      }

      const parsed = validateInputCommand(command);
      if (!parsed) {
        continue;
      }

      const latestAccepted = this.latestAcceptedSequenceByUserId.get(user.id) ?? 0;
      if (parsed.sequence <= latestAccepted) {
        continue;
      }

      if (parsed.sequence > latestAccepted + NET_TIMING.maxInputSequenceLead) {
        continue;
      }

      this.latestAcceptedSequenceByUserId.set(user.id, parsed.sequence);
      this.simulation.queueCommandForMind(mindId, parsed);
      acceptedCommandCount += 1;
    }
  }

  private syncEntitiesToNengi(): void {
    this.replication.syncEntityState(this.simulation.getNetworkRecords());
  }

  private refreshSpatialViews(): void {
    for (const user of this.userById.values()) {
      this.subscribeUserToSpatialChannel(user);
    }
  }

  private subscribeUserToSpatialChannel(user: User): void {
    const center = this.resolveViewCenter(user.id);
    this.lastViewCenterByUserId.set(user.id, center);
    this.spatialChannel.subscribe(user, {
      x: center.x,
      y: center.y,
      halfWidth: this.spatialAoi.width / 2,
      halfHeight: this.spatialAoi.height / 2,
    });
  }

  private resolveViewCenter(userId: number): ViewCenter {
    const entityId = this.getControlledEntityForUser(userId);
    if (entityId !== undefined) {
      const entity = this.replication.getEntityRecord(entityId)
        ?? this.simulation.getNetworkRecords().find((record) => record.entityId === entityId);
      if (entity) {
        return { x: entity.x, y: entity.y };
      }
    }

    return this.lastViewCenterByUserId.get(userId) ?? { x: 0, y: 0 };
  }

  private respawnDeadUsers(): void {
    for (const [userId, mindId] of this.mindByUserId.entries()) {
      const entityId = this.simulation.getControlledEntityId(mindId);
      if (entityId !== null && this.simulation.hasEntityBody(entityId)) {
        continue;
      }

      const user = this.userById.get(userId);
      if (user) {
        this.simulation.removeMind(mindId);
        this.mindByUserId.delete(userId);
        this.assignPlayerEntity(user);
      }
    }
  }

  private queuePortalTransfers(): void {
    for (const [userId] of this.entityByUserId.entries()) {
      if (this.transferringUserIds.has(userId)) {
        continue;
      }

      const user = this.userById.get(userId);
      const entityId = this.getControlledEntityForUser(userId);
      if (entityId === undefined) {
        continue;
      }
      const portal = this.simulation.findPortalTransferForEntity(entityId);
      if (!user || !portal) {
        continue;
      }

      const payload: MapTransferPayload = {
        targetMapId: portal.targetMapId,
        targetMapName: portal.targetMapName,
        targetUrl: portal.targetUrl,
        token: portal.token,
      };
      this.replication.queueMapTransfer(user, payload);
      this.transferringUserIds.add(userId);
    }
  }

  private queueLiveTileMutations(): void {
    const mutations = this.simulation.drainTileMutationReplication();
    if (mutations.length === 0) {
      return;
    }

    for (const mutation of mutations) {
      for (const user of this.userById.values()) {
        if (!this.tileIsInsideUserAoi(user.id, mutation.x, mutation.y)) {
          continue;
        }

        this.queueTileMutationIfNeeded(user, mutation);
      }
    }
  }

  private queueTileMutationCatchup(): void {
    for (const user of this.userById.values()) {
      const rect = this.tileAoiRectForUser(user.id);
      for (const mutation of this.simulation.getTileMutationsInRect(rect)) {
        this.queueTileMutationIfNeeded(user, mutation);
      }
    }
  }

  private queueTileMutationIfNeeded(user: User, mutation: TileMutation): void {
    const sentTiles = this.sentTileMutationTileByCoordByUserId.get(user.id);
    if (!sentTiles) {
      return;
    }

    const key = coordKey(mutation.x, mutation.y);
    if (sentTiles.get(key) === mutation.tile) {
      return;
    }

    this.replication.queueTileMutation(user, tileMutationToPayload(mutation));
    sentTiles.set(key, mutation.tile);
  }

  private tileIsInsideUserAoi(userId: number, tileX: number, tileY: number): boolean {
    const center = this.resolveViewCenter(userId);
    const worldX = tileX * TILE_SIZE + TILE_SIZE / 2;
    const worldY = tileY * TILE_SIZE + TILE_SIZE / 2;
    return (
      Math.abs(worldX - center.x) <= this.spatialAoi.width / 2
      && Math.abs(worldY - center.y) <= this.spatialAoi.height / 2
    );
  }

  private tileAoiRectForUser(userId: number): { minX: number; minY: number; maxX: number; maxY: number } {
    const center = this.resolveViewCenter(userId);
    const halfWidthTiles = Math.ceil(this.spatialAoi.width / TILE_SIZE / 2);
    const halfHeightTiles = Math.ceil(this.spatialAoi.height / TILE_SIZE / 2);
    const centerTileX = Math.floor(center.x / TILE_SIZE);
    const centerTileY = Math.floor(center.y / TILE_SIZE);
    return {
      minX: centerTileX - halfWidthTiles,
      minY: centerTileY - halfHeightTiles,
      maxX: centerTileX + halfWidthTiles,
      maxY: centerTileY + halfHeightTiles,
    };
  }

  private assignPlayerEntity(user: User): number {
    const previousMindId = this.mindByUserId.get(user.id);
    if (previousMindId !== undefined) {
      const previousEntityId = this.simulation.getControlledEntityId(previousMindId);
      if (previousEntityId !== null) {
        this.simulation.removeEntity(previousEntityId);
      }
      this.simulation.removeMind(previousMindId);
    }

    const spawned = this.simulation.spawnPlayerMind();
    const entityId = spawned.entityId;
    this.mindByUserId.set(user.id, spawned.mindId);
    this.entityByUserId.set(user.id, entityId);
    const entity = this.simulation.getNetworkRecords().find((record) => record.entityId === entityId);
    if (entity) {
      this.lastViewCenterByUserId.set(user.id, { x: entity.x, y: entity.y });
    }
    this.replication.queueIdentity(user, entityId);
    return entityId;
  }

  private getControlledEntityForUser(userId: number): number | undefined {
    const mindId = this.mindByUserId.get(userId);
    if (mindId === undefined) {
      return this.entityByUserId.get(userId);
    }

    const entityId = this.simulation.getControlledEntityId(mindId);
    if (entityId !== null) {
      this.entityByUserId.set(userId, entityId);
      return entityId;
    }

    return undefined;
  }

  private buildCharacterStatsResponse(entityId: number): CharacterStatsResponse | null {
    const allocations = this.simulation.stats.getAllocatedStats(entityId);
    const derived = this.simulation.stats.getDerivedStats(entityId);
    if (!allocations || !derived) {
      return null;
    }
    return {
      allocations: { ...allocations },
      derived: { ...derived },
      remainingPoints: 5 - totalAllocatedPoints(allocations),
    };
  }

  private validateHandshake(handshake: unknown): void {
    const acceptedTokens = this.options.acceptedTokens ?? ['dev'];
    const token = handshake && typeof handshake === 'object' ? (handshake as { token?: unknown }).token : null;
    if (typeof token !== 'string' || !acceptedTokens.includes(token)) {
      throw { reason: 'invalid_token', mapId: this.mapInfo.id };
    }
  }
}

