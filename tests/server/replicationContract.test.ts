// Verifies replication domains keep explicit single-owner boundaries and reject cross-domain writer violations.
import { describe, expect, it } from 'vitest';
import { replicationOwnerByDomain, ReplicationDomain, assertReplicationOwner } from '../../src/server/net/replicationContract.js';

describe('replication ownership contract', () => {
  it('declares a single authoritative owner per domain', () => {
    expect(replicationOwnerByDomain[ReplicationDomain.EntityState]).toBe('ReplicationCoordinator');
    expect(replicationOwnerByDomain[ReplicationDomain.TileMutations]).toBe('ReplicationCoordinator');
    expect(replicationOwnerByDomain[ReplicationDomain.WorldInit]).toBe('ReplicationCoordinator');
    expect(replicationOwnerByDomain[ReplicationDomain.Identity]).toBe('ReplicationCoordinator');
    expect(replicationOwnerByDomain[ReplicationDomain.Transfers]).toBe('ReplicationCoordinator');
    expect(replicationOwnerByDomain[ReplicationDomain.Debug]).toBe('NengiServerDebugResponder');
  });

  it('throws when a non-owner attempts to write a domain', () => {
    expect(() => assertReplicationOwner(ReplicationDomain.WorldInit, 'NengiServer')).toThrowError(/Replication owner violation/);
    expect(() => assertReplicationOwner(ReplicationDomain.Debug, 'ReplicationCoordinator')).toThrowError(/Replication owner violation/);
  });
});
