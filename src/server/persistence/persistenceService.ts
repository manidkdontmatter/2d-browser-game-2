// Coordinates background SQLite persistence without blocking the server simulation loop.
import Database from 'better-sqlite3';
import { Worker } from 'node:worker_threads';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import type { TileMutation, WorldGenerationIdentity } from '../../shared/world/mapTypes.js';
import { TileMapView } from '../../shared/world/tileMap.js';

const isTypeScriptRuntime = import.meta.url.endsWith('.ts');

export interface PersistedWorldSnapshot {
  identity: WorldGenerationIdentity;
  mutations: TileMutation[];
}

export class PersistenceService {
  private readonly worker: Worker;
  private flushTimer: NodeJS.Timeout | null = null;
  private nextRequestId = 1;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.worker = createSqliteWorker(dbPath);
    this.worker.postMessage({ type: 'init' });
  }

  startAutosave(identity: WorldGenerationIdentity, tileMap: TileMapView, intervalMs = 10_000): void {
    this.flushTimer = setInterval(() => this.saveWorld(identity, tileMap), intervalMs);
  }

  saveWorld(identity: WorldGenerationIdentity, tileMap: TileMapView): void {
    this.worker.postMessage(this.createSaveMessage(identity, tileMap));
  }

  async stop(identity: WorldGenerationIdentity, tileMap: TileMapView): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    await this.saveWorldAndWait(identity, tileMap);
    await this.worker.terminate();
  }

  static loadWorld(dbPath: string): PersistedWorldSnapshot | null {
    mkdirSync(dirname(dbPath), { recursive: true });
    const db = new Database(dbPath);
    try {
      initializeDatabase(db);
      const row = db.prepare(`
        SELECT seed, generator_version, settings_json, tile_mutations_json
        FROM worlds
        WHERE id = 1
      `).get() as PersistedWorldRow | undefined;
      if (!row) {
        return null;
      }

      return {
        identity: {
          seed: row.seed,
          generatorVersion: row.generator_version,
          settings: JSON.parse(row.settings_json) as WorldGenerationIdentity['settings'],
        },
        mutations: JSON.parse(row.tile_mutations_json) as TileMutation[],
      };
    } finally {
      db.close();
    }
  }

  private saveWorldAndWait(identity: WorldGenerationIdentity, tileMap: TileMapView): Promise<void> {
    const requestId = this.nextRequestId;
    this.nextRequestId += 1;
    const message = this.createSaveMessage(identity, tileMap, requestId);

    return new Promise((resolve, reject) => {
      const onMessage = (response: unknown): void => {
        if (
          response
          && typeof response === 'object'
          && (response as { type?: unknown }).type === 'saved'
          && (response as { requestId?: unknown }).requestId === requestId
        ) {
          cleanup();
          resolve();
        }
      };
      const onError = (error: Error): void => {
        cleanup();
        reject(error);
      };
      const cleanup = (): void => {
        this.worker.off('message', onMessage);
        this.worker.off('error', onError);
      };

      this.worker.on('message', onMessage);
      this.worker.on('error', onError);
      this.worker.postMessage(message);
    });
  }

  private createSaveMessage(identity: WorldGenerationIdentity, tileMap: TileMapView, requestId?: number): Record<string, unknown> {
    return {
      type: 'saveWorld',
      requestId,
      payload: {
        seed: identity.seed,
        generatorVersion: identity.generatorVersion,
        settingsJson: JSON.stringify(identity.settings),
        tileMutationsJson: JSON.stringify(tileMap.exportMutations()),
      },
    };
  }
}

interface PersistedWorldRow {
  seed: string;
  generator_version: number;
  settings_json: string;
  tile_mutations_json: string;
}

function createSqliteWorker(dbPath: string): Worker {
  const workerUrl = new URL(isTypeScriptRuntime ? './sqliteWorker.ts' : './sqliteWorker.js', import.meta.url);
  if (!isTypeScriptRuntime) {
    return new Worker(workerUrl, {
      workerData: { path: dbPath },
    });
  }

  const tsxEsmUrl = import.meta.resolve('tsx/esm/api');
  const devWorkerSource = `
    import { tsImport } from ${JSON.stringify(tsxEsmUrl)};
    await tsImport(${JSON.stringify(workerUrl.href)}, { parentURL: ${JSON.stringify(import.meta.url)} });
  `;
  return new Worker(new URL(`data:text/javascript,${encodeURIComponent(devWorkerSource)}`), {
    workerData: { path: dbPath },
  });
}

function initializeDatabase(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS worlds (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      seed TEXT NOT NULL,
      generator_version INTEGER NOT NULL,
      settings_json TEXT NOT NULL,
      tile_mutations_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
}
