// Declares authoritative replication ownership boundaries so each network domain has a single writer.
export const ReplicationDomain = {
  EntityState: 'entity_state',
  TileMutations: 'tile_mutations',
  WorldInit: 'world_init',
  Identity: 'identity',
  Transfers: 'transfers',
  Debug: 'debug',
} as const;

export type ReplicationDomain = typeof ReplicationDomain[keyof typeof ReplicationDomain];

export const replicationOwnerByDomain: Record<ReplicationDomain, string> = {
  [ReplicationDomain.EntityState]: 'ReplicationCoordinator',
  [ReplicationDomain.TileMutations]: 'ReplicationCoordinator',
  [ReplicationDomain.WorldInit]: 'ReplicationCoordinator',
  [ReplicationDomain.Identity]: 'ReplicationCoordinator',
  [ReplicationDomain.Transfers]: 'ReplicationCoordinator',
  [ReplicationDomain.Debug]: 'NengiServerDebugResponder',
};

export function assertReplicationOwner(domain: ReplicationDomain, owner: string): void {
  const expected = replicationOwnerByDomain[domain];
  if (owner !== expected) {
    throw new Error(`Replication owner violation for ${domain}: expected ${expected}, received ${owner}`);
  }
}
