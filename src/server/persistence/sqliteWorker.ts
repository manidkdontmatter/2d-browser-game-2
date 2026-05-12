// Runs blocking SQLite writes off the authoritative simulation thread.
import Database from 'better-sqlite3';
import { parentPort, workerData } from 'node:worker_threads';

interface PersistMessage {
  type: 'init' | 'saveWorld';
  requestId?: number;
  payload?: {
    seed: string;
    generatorVersion: number;
    settingsJson: string;
    tileMutationsJson: string;
  };
}

const db = new Database(workerData.path as string);

function initialize(): void {
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

parentPort?.on('message', (message: PersistMessage) => {
  if (message.type === 'init') {
    initialize();
    parentPort?.postMessage({ type: 'ready' });
    return;
  }

  if (message.type === 'saveWorld' && message.payload) {
    initialize();
    db.prepare(`
      INSERT INTO worlds (id, seed, generator_version, settings_json, tile_mutations_json, updated_at)
      VALUES (1, @seed, @generatorVersion, @settingsJson, @tileMutationsJson, @updatedAt)
      ON CONFLICT(id) DO UPDATE SET
        seed = excluded.seed,
        generator_version = excluded.generator_version,
        settings_json = excluded.settings_json,
        tile_mutations_json = excluded.tile_mutations_json,
        updated_at = excluded.updated_at
    `).run({ ...message.payload, updatedAt: Date.now() });
    parentPort?.postMessage({ type: 'saved', requestId: message.requestId });
  }
});

parentPort?.postMessage({ type: 'started' });
