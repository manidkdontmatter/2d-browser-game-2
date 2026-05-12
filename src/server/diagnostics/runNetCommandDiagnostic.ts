// Benchmarks server-side input command validation and authoritative queueing without opening sockets.
import { performance } from 'node:perf_hooks';
import { AttackIntent } from '../../shared/domain/commands.js';
import { validateInputCommand } from '../../shared/net/commandValidation.js';
import { NType } from '../../shared/net/nType.js';
import { NET_TIMING } from '../../shared/net/timing.js';
import { GameSimulation } from '../simulation/gameSimulation.js';

const players = readInt('COMMAND_PLAYERS', 100);
const commandsPerPlayer = readInt('COMMANDS_PER_PLAYER', NET_TIMING.movementCommandRate);
const minimumCommandsPerSecond = readInt('COMMANDS_MIN_PER_SECOND', 4500);
const totalCommands = players * commandsPerPlayer;

const simulation = new GameSimulation();
const playerEntityIds = Array.from({ length: players }, () => simulation.spawnPlayer());
let accepted = 0;
let rejected = 0;
const validationTimesMs: number[] = [];

const startMs = performance.now();
for (let playerIndex = 0; playerIndex < players; playerIndex += 1) {
  const entityId = playerEntityIds[playerIndex];
  for (let sequence = 1; sequence <= commandsPerPlayer; sequence += 1) {
    const command = {
      ntype: NType.InputCommand,
      moveX: sequence % 2 === 0 ? 1 : -1,
      moveY: 0,
      aimX: 1000 + playerIndex,
      aimY: 1000 + sequence,
      attack: AttackIntent.None,
      sequence,
      clientTick: sequence,
      clientTimeMs: sequence * (1000 / NET_TIMING.movementCommandRate),
    };

    const validateStartMs = performance.now();
    const parsed = validateInputCommand(command);
    validationTimesMs.push(performance.now() - validateStartMs);
    if (!parsed) {
      rejected += 1;
      continue;
    }

    simulation.queueCommand(entityId, parsed);
    accepted += 1;
  }
}

const elapsedSeconds = (performance.now() - startMs) / 1000;
const commandsPerSecond = totalCommands / Math.max(elapsedSeconds, 0.000001);
const validationStats = summarize(validationTimesMs);

console.log('Net command diagnostic');
console.log(`players=${players} commands/player=${commandsPerPlayer} total=${totalCommands}`);
console.log(`commands/s=${commandsPerSecond.toFixed(0)} accepted=${accepted} rejected=${rejected}`);
console.log(`validation ms p50=${validationStats.p50.toFixed(5)} p95=${validationStats.p95.toFixed(5)} max=${validationStats.max.toFixed(5)}`);

if (commandsPerSecond < minimumCommandsPerSecond || accepted < 3000) {
  console.error(`Command diagnostic failed: ${commandsPerSecond.toFixed(0)} commands/s < ${minimumCommandsPerSecond} or accepted ${accepted} < 3000.`);
  process.exitCode = 1;
}

function summarize(values: number[]): { p50: number; p95: number; max: number } {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    max: sorted[sorted.length - 1] ?? 0,
  };
}

function percentile(sortedValues: number[], fraction: number): number {
  if (sortedValues.length === 0) {
    return 0;
  }

  const index = Math.min(sortedValues.length - 1, Math.floor(sortedValues.length * fraction));
  return sortedValues[index];
}

function readInt(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}
