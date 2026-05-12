// Starts the top-level server manager that owns one child process per loaded map runtime.
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { findManagedMap, managedMaps, mapWebSocketUrl, type ManagedMapConfig } from './config/mapRegistry.js';

interface ManagedMapProcess {
  config: ManagedMapConfig;
  process: ChildProcess;
}

const isTypeScriptRuntime = import.meta.url.endsWith('.ts');
const children: ManagedMapProcess[] = [];
let shuttingDown = false;

for (const map of managedMaps) {
  children.push({
    config: map,
    process: spawnMapRuntime(map),
  });
}

console.log(`server manager started ${children.length} map runtimes`);

process.on('SIGINT', () => {
  shutdown(0);
});
process.on('SIGTERM', () => {
  shutdown(0);
});

function spawnMapRuntime(map: ManagedMapConfig): ChildProcess {
  const target = findManagedMap(map.targetMapId);
  if (!target) {
    throw new Error(`Map ${map.id} points at missing target map ${map.targetMapId}`);
  }

  const child = spawn(process.execPath, runtimeArgs(), {
    cwd: process.cwd(),
    env: {
      ...process.env,
      MAP_ID: map.id,
    },
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    windowsHide: true,
  });

  const runtimeConfig = {
    id: map.id,
    name: map.name,
    seed: map.seed,
    generation: map.generation,
    port: map.port,
    dbPath: map.dbPath,
    targetMapId: target.id,
    targetMapName: target.name,
    targetUrl: mapWebSocketUrl(target),
    transferToken: `${map.id}->${target.id}`,
    acceptedTokens: acceptedTokensForMap(map),
  };

  child.send({ type: 'mapRuntimeConfig', config: runtimeConfig });

  child.on('message', (message) => {
    if (isStartedMessage(message)) {
      console.log(`map runtime ${message.mapId} ready on ${message.port}`);
    }
  });
  child.on('exit', (code, signal) => {
    if (shuttingDown) {
      return;
    }

    console.error(`map runtime ${map.id} exited unexpectedly code=${code ?? '-'} signal=${signal ?? '-'}`);
    shutdown(1);
  });

  return child;
}

function acceptedTokensForMap(map: ManagedMapConfig): string[] {
  const tokens = ['dev'];
  for (const source of managedMaps) {
    if (source.targetMapId === map.id) {
      tokens.push(`${source.id}->${map.id}`);
    }
  }
  return tokens;
}

function runtimeArgs(): string[] {
  const runtimeUrl = new URL(isTypeScriptRuntime ? './mapRuntime.ts' : './mapRuntime.js', import.meta.url);
  const runtimePath = fileURLToPath(runtimeUrl);
  if (!isTypeScriptRuntime) {
    return [runtimePath];
  }

  const tsxCliPath = join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs');
  return [tsxCliPath, runtimePath];
}

function shutdown(exitCode: number): void {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  for (const child of children) {
    child.process.kill('SIGTERM');
  }
  process.exit(exitCode);
}

function isStartedMessage(message: unknown): message is { type: 'mapRuntimeStarted'; mapId: string; port: number } {
  return Boolean(
    message
    && typeof message === 'object'
    && (message as { type?: unknown }).type === 'mapRuntimeStarted'
    && typeof (message as { mapId?: unknown }).mapId === 'string'
    && typeof (message as { port?: unknown }).port === 'number',
  );
}
