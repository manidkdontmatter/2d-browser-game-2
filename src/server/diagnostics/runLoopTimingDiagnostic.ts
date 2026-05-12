// Measures real-time fixed-loop stability so 30 TPS regressions are visible outside gameplay.
import { DEFAULT_TICK_RATE } from '../../shared/config.js';
import { FixedStepLoop, LoopTimingSample } from '../loop/fixedStepLoop.js';

const durationMs = 10_000;
const warmupMs = 1_000;
const targetMs = 1000 / DEFAULT_TICK_RATE;
const samples: LoopTimingSample[] = [];

const loop = new FixedStepLoop(
  { tickRate: DEFAULT_TICK_RATE, maxCatchUpTicks: 5 },
  () => {},
  (sample) => samples.push(sample),
);

loop.start();

setTimeout(() => {
  loop.stop();
  const warmupSampleCount = Math.ceil(warmupMs / targetMs);
  const measuredSamples = samples.slice(warmupSampleCount);
  const intervals = measuredSamples.map((sample) => sample.intervalMs).filter((value) => value > 0);
  intervals.sort((a, b) => a - b);
  const mean = intervals.reduce((sum, value) => sum + value, 0) / intervals.length;
  const p95 = intervals[Math.floor(intervals.length * 0.95)] ?? 0;
  const max = intervals.at(-1) ?? 0;
  const missedTicks = measuredSamples.filter((sample) => sample.steps === 0).length;
  const passed = p95 <= targetMs + 7 && max <= targetMs + 17 && missedTicks === 0;

  console.log(
    JSON.stringify(
      {
        targetMs,
        warmupMs,
        sampleCount: measuredSamples.length,
        meanMs: Number(mean.toFixed(3)),
        p95Ms: Number(p95.toFixed(3)),
        maxMs: Number(max.toFixed(3)),
        missedTicks,
        passed,
      },
      null,
      2,
    ),
  );

  if (!passed) {
    process.exitCode = 1;
  }
}, durationMs + warmupMs);
