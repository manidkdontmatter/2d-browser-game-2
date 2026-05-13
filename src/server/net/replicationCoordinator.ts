// Centralizes all non-debug network replication writes so domains keep one explicit authoritative writer.
import { ChannelAABB2D, type User } from 'nengi';
import { NetEntityKind, type NetEntityRecord } from '../../shared/domain/snapshots.js';
import type { MapTransferPayload, TileMutationPayload, WorldInitPayload } from '../../shared/net/messages.js';
import { NType } from '../../shared/net/nType.js';
import { ReplicationDomain, assertReplicationOwner } from './replicationContract.js';

type SpatialEntity = {
  nid: number;
  ntype: NType.NetEntity;
  entityId: number;
  kind: NetEntityKind;
  x: number;
  y: number;
  health: number;
  facing: number;
};

const OWNER = 'ReplicationCoordinator';

export class ReplicationCoordinator {
  private readonly networkEntityByGameEntityId = new Map<number, SpatialEntity>();

  constructor(private readonly spatialChannel: ChannelAABB2D) {}

  syncEntityState(records: readonly NetEntityRecord[]): void {
    assertReplicationOwner(ReplicationDomain.EntityState, OWNER);
    const seen = new Set<number>();
    for (const entity of records) {
      seen.add(entity.entityId);
      const existing = this.networkEntityByGameEntityId.get(entity.entityId);
      if (!existing) {
        const record: SpatialEntity = {
          ...entity,
          ntype: NType.NetEntity,
          kind: normalizeKind(entity.kind),
        };
        this.networkEntityByGameEntityId.set(entity.entityId, record);
        this.spatialChannel.addEntity(record);
        continue;
      }

      existing.x = entity.x;
      existing.y = entity.y;
      existing.health = entity.health;
      existing.facing = entity.facing;
      existing.kind = normalizeKind(entity.kind);
    }

    for (const [entityId, entity] of this.networkEntityByGameEntityId.entries()) {
      if (!seen.has(entityId)) {
        this.spatialChannel.removeEntity(entity);
        this.networkEntityByGameEntityId.delete(entityId);
      }
    }
  }

  queueWorldInit(user: User, payload: WorldInitPayload): void {
    assertReplicationOwner(ReplicationDomain.WorldInit, OWNER);
    user.queueMessage({ ntype: NType.WorldInitMessage, ...payload });
  }

  queueIdentity(user: User, entityId: number): void {
    assertReplicationOwner(ReplicationDomain.Identity, OWNER);
    user.queueMessage({ ntype: NType.IdentityMessage, entityId });
  }

  queueMapTransfer(user: User, payload: MapTransferPayload): void {
    assertReplicationOwner(ReplicationDomain.Transfers, OWNER);
    user.queueMessage({ ntype: NType.MapTransferMessage, ...payload });
  }

  queueTileMutation(user: User, payload: TileMutationPayload): void {
    assertReplicationOwner(ReplicationDomain.TileMutations, OWNER);
    user.queueMessage({ ntype: NType.TileMutationMessage, ...payload });
  }

  getEntityRecord(entityId: number): SpatialEntity | undefined {
    return this.networkEntityByGameEntityId.get(entityId);
  }
}

function normalizeKind(kind: number): NetEntityKind {
  if (kind === NetEntityKind.Projectile) {
    return NetEntityKind.Projectile;
  }
  if (kind === NetEntityKind.Portal) {
    return NetEntityKind.Portal;
  }
  if (kind === NetEntityKind.Pickup) {
    return NetEntityKind.Pickup;
  }
  return NetEntityKind.Body;
}
