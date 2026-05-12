// Verifies deterministic nearest-human spatial queries used by AI target acquisition at scale.
import { describe, expect, it } from 'vitest';
import { GameSimulation } from '../../src/server/simulation/gameSimulation.js';
import { SpatialQuerySystem } from '../../src/server/systems/spatialQuerySystem.js';
import { Position } from '../../src/server/simulation/components.js';

describe('spatial query system', () => {
  it('finds the nearest human in radius', () => {
    const simulation = new GameSimulation();
    const a = simulation.spawnPlayer();
    const b = simulation.spawnPlayer();
    const c = simulation.spawnPlayer();
    setEntityPosition(simulation, a, 100, 100);
    setEntityPosition(simulation, b, 300, 100);
    setEntityPosition(simulation, c, 900, 100);

    const spatial = new SpatialQuerySystem(simulation.world);
    spatial.syncFromWorld();
    const nearest = spatial.findNearestHumanInRadius(250, 100, 500);

    expect(nearest?.entityId).toBe(b);
  });

  it('returns null when no human is inside radius', () => {
    const simulation = new GameSimulation();
    const a = simulation.spawnPlayer();
    setEntityPosition(simulation, a, 2000, 2000);

    const spatial = new SpatialQuerySystem(simulation.world);
    spatial.syncFromWorld();
    const nearest = spatial.findNearestHumanInRadius(0, 0, 300);

    expect(nearest).toBeNull();
  });
});

function setEntityPosition(simulation: GameSimulation, entityId: number, x: number, y: number): void {
  const eid = simulation.world.eidByEntityId.get(entityId);
  expect(eid).toBeDefined();
  Position.x[eid!] = x;
  Position.y[eid!] = y;
  simulation.world.bodyByEntityId.get(entityId)?.setPosition(x, y);
}
