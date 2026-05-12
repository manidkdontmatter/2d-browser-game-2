// Defines server simulation helper types that are not part of the public protocol.
import { Body } from 'skale-physics';
import { Vec2 } from '../../shared/math/vector.js';
import { NetEntityRecord } from '../../shared/domain/snapshots.js';

export interface SpawnPoint extends Vec2 {
  tileX: number;
  tileY: number;
}

export interface SimulationIndexes {
  eidByEntityId: Map<number, number>;
  bodyByEntityId: Map<number, Body>;
  entityIdByBodyId: Map<number, number>;
  netEntities: Map<number, NetEntityRecord>;
}
