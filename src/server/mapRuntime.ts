// Boots one authoritative map runtime with its own simulation, physics world, nengi instance, loop, and persistence.
import { DEFAULT_TICK_RATE } from '../shared/config.js';
import { createWorldIdentity } from '../shared/world/generateMap.js';
import type { WorldGenerationSettings } from '../shared/world/mapTypes.js';
import { FixedStepLoop } from './loop/fixedStepLoop.js';
import { NengiServer } from './net/nengiServer.js';
import { PersistenceService } from './persistence/persistenceService.js';
import { GameSimulation } from './simulation/gameSimulation.js';
import { parseHostileNpcCount } from './config/serverConfig.js';

interface MapRuntimeConfig {
  id: string;
  name: string;
  seed: string;
  generation: Partial<WorldGenerationSettings>;
  port: number;
  dbPath: string;
  targetMapId: string;
  targetMapName: string;
  targetUrl: string;
  transferToken: string;
  acceptedTokens: string[];
}

const config = readMapRuntimeConfig();
const configuredIdentity = createWorldIdentity(config.seed, config.generation);
const persistedWorld = PersistenceService.loadWorld(config.dbPath);
const loadedMutations = persistedWorld && sameWorldIdentity(configuredIdentity, persistedWorld.identity) ? persistedWorld.mutations : [];
const simulation = new GameSimulation(configuredIdentity, loadedMutations);
simulation.spawnHostileNpcs(parseHostileNpcCount(process.env.NPC_COUNT));
simulation.addPortalToTarget({
  targetMapId: config.targetMapId,
  targetMapName: config.targetMapName,
  targetUrl: config.targetUrl,
  token: config.transferToken,
});

const persistence = new PersistenceService(config.dbPath);
persistence.startAutosave(simulation.identity, simulation.tileMap);

const netServer = new NengiServer(simulation, { id: config.id, name: config.name }, {}, {
  acceptedTokens: config.acceptedTokens,
});
netServer.listen(config.port);
let latestTickLogAtMs = performance.now();

const loop = new FixedStepLoop(
  { tickRate: DEFAULT_TICK_RATE, maxCatchUpTicks: 5 },
  (deltaSeconds) => {
    netServer.receiveNetworkInput();
    simulation.step(deltaSeconds);
    netServer.sendSnapshots(deltaSeconds);
  },
  (sample) => {
    const nowMs = performance.now();
    if (nowMs - latestTickLogAtMs < 2000) {
      return;
    }

    latestTickLogAtMs = nowMs;
    const ai = simulation.getAiSchedulerMetrics();
    console.log(
      `[${config.id}] tick ms=${sample.wallIntervalMs.toFixed(3)}`
      + ` steps=${sample.steps}`
      + ` activeChunks=${simulation.getActiveChunkCount()}`
      + ` denseBodies=${simulation.world.tileCollision.getBodyCount()}`
      + ` aiSense=${ai.sensed}`
      + ` aiPlan=${ai.planned}`
      + ` aiSkipSense=${ai.budgetSkippedSense}`
      + ` aiSkipPlan=${ai.budgetSkippedPlan}`,
    );
  },
);

loop.start();
process.send?.({ type: 'mapRuntimeStarted', mapId: config.id, port: config.port });

async function shutdown(): Promise<void> {
  loop.stop();
  await persistence.stop(simulation.identity, simulation.tileMap);
  process.exit(0);
}

process.on('SIGINT', () => {
  void shutdown();
});
process.on('SIGTERM', () => {
  void shutdown();
});

function readMapRuntimeConfig(): MapRuntimeConfig {
  const port = Number(process.env.MAP_PORT ?? process.env.PORT ?? 9001);
  const id = process.env.MAP_ID ?? 'test-map-a';
  const targetMapId = process.env.MAP_TARGET_ID ?? 'test-map-b';
  return {
    id,
    name: process.env.MAP_NAME ?? id,
    seed: process.env.MAP_SEED ?? 'test-seed-001',
    generation: parseGenerationSettings(process.env.MAP_GENERATION_SETTINGS_JSON),
    port,
    dbPath: process.env.MAP_DB_PATH ?? `data/${id}.sqlite`,
    targetMapId,
    targetMapName: process.env.MAP_TARGET_NAME ?? targetMapId,
    targetUrl: process.env.MAP_TARGET_URL ?? 'ws://127.0.0.1:9002',
    transferToken: process.env.MAP_TRANSFER_TOKEN ?? `${id}->${targetMapId}`,
    acceptedTokens: parseAcceptedTokens(process.env.MAP_ACCEPTED_TOKENS),
  };
}

function parseAcceptedTokens(value: string | undefined): string[] {
  const tokens = (value ?? 'dev').split(',').map((token) => token.trim()).filter(Boolean);
  return tokens.length > 0 ? tokens : ['dev'];
}

function parseGenerationSettings(value: string | undefined): Partial<WorldGenerationSettings> {
  if (!value) {
    return {};
  }

  try {
    const parsed = JSON.parse(value) as Partial<WorldGenerationSettings>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function sameWorldIdentity(a: ReturnType<typeof createWorldIdentity>, b: ReturnType<typeof createWorldIdentity>): boolean {
  return (
    a.seed === b.seed
    && a.generatorVersion === b.generatorVersion
    && JSON.stringify(a.settings) === JSON.stringify(b.settings)
  );
}
