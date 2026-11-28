// Layer 1 WP4 phase B — spawn event list + main-pool event
// demand plan (pure functions in lib/gpgpuSpawnAllocator.ts).
//
// Cases:
//  1 single-event equivalence: a length-1 list fires exactly
//    when the legacy spawnEventFiresAt fires, and its
//    resolved demand equals the legacy hash cohort's size
//  2 normalisation: clamps, time ordering, stable order for
//    events at the same time
//  3 multiple events: only the crossed events fire per step;
//    a step crossing two events allocates both, in time
//    order, the earlier event claiming slots first
//  4 allocation order: parked first (ascending gate value),
//    then oldest live — identical to planSpawnAllocation
//  5 truncation: demand above the pool size, and later
//    events in the same step truncated to the remainder
//  6 cumulative due demand (the threshold-facing form)
//  7 determinism: identical inputs plan identical outputs
import { build } from 'esbuild';
import { unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.l1wp4-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

await build({
  stdin: {
    contents: `
      export { normalizeSpawnEventSpecs, resolveSpawnEventDemand, resolveSpawnEventDemands, spawnEventDemandsFiringAt, spawnEventDemandDueBy, planSpawnEventDemands, planSpawnAllocation, planSpawnEventCohort } from './lib/gpgpuSpawnAllocator.ts';
      export { spawnEventFiresAt, spawnEventHashForIndex, spawnEventSelects } from './lib/gpgpuLifecycle.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});
const lib = await import(pathToFileURL(BUNDLE).href);
unlinkSync(BUNDLE);
const {
  normalizeSpawnEventSpecs, resolveSpawnEventDemand, resolveSpawnEventDemands,
  spawnEventDemandsFiringAt, spawnEventDemandDueBy, planSpawnEventDemands,
  planSpawnAllocation, planSpawnEventCohort,
  spawnEventFiresAt, spawnEventHashForIndex, spawnEventSelects,
} = lib;

// ── Fixtures ──────────────────────────────────────────────────
// A pool of 6 slots: 3 parked (gate values out of order), 3
// live (ages out of order). Reuse order: parked by ascending
// gate value → [1 (0.1), 2 (0.4), 0 (0.9)], then live by
// descending age → [4 (9), 5 (5), 3 (1)].
const SLOTS = [
  { index: 0, parked: true, gateValue: 0.9, age: 0 },
  { index: 1, parked: true, gateValue: 0.1, age: 0 },
  { index: 2, parked: true, gateValue: 0.4, age: 0 },
  { index: 3, parked: false, gateValue: 0, age: 1 },
  { index: 4, parked: false, gateValue: 0, age: 9 },
  { index: 5, parked: false, gateValue: 0, age: 5 },
];
const REUSE_ORDER = [1, 2, 0, 4, 5, 3];

// ── 1. Single-event equivalence ───────────────────────────────
{
  const texSize = 16;
  const eventTime = 2.5;
  const fraction = 0.25;
  const demands = resolveSpawnEventDemands([{ time: eventTime, count: fraction }], texSize);

  // Firing equivalence over a grid of frame steps.
  let firingOk = true;
  for (let t = 0; t <= 5.0001; t += 0.1) {
    for (const dt of [1 / 60, 0.1, 0.5]) {
      const legacy = spawnEventFiresAt(t, dt, eventTime);
      const listed = spawnEventDemandsFiringAt(demands, t, dt).length === 1;
      if (legacy !== listed) firingOk = false;
    }
  }
  check('1a length-1 list fires exactly when the legacy event fires', firingOk);

  // Demand size equivalence: the resolved count is the exact
  // size of the legacy hash cohort, counted two ways.
  const cohort = planSpawnEventCohort(texSize, fraction);
  let direct = 0;
  for (let i = 0; i < texSize * texSize; i++) {
    if (spawnEventSelects(spawnEventHashForIndex(i, texSize), fraction)) direct += 1;
  }
  check('1b resolved demand equals the legacy cohort size',
    demands.length === 1 && demands[0].count === cohort.length && cohort.length === direct,
    `demand=${demands[0]?.count} cohort=${cohort.length} direct=${direct}`);
  check('1c resolved demand keeps the authored time', demands[0].time === eventTime);

  // Allocation equivalence at the firing frame: a single
  // event over the pool plans exactly what planSpawnAllocation
  // plans for the same demand, in the same order.
  const demand = [{ time: 1, count: 4 }];
  const plan = planSpawnEventDemands(SLOTS, demand, 1, 1 / 60);
  check('1d single event allocates through the fixed reuse order',
    plan.length === 1 && eq(plan[0].indices, planSpawnAllocation(SLOTS, 4)),
    JSON.stringify(plan));
}

// ── 2. Normalisation ──────────────────────────────────────────
{
  const out = normalizeSpawnEventSpecs([
    { time: 3, count: 0.5 },
    { time: 1, count: 0.25 },
    { time: 3, count: 0.75 },
    { time: -5, count: 2 },
    { time: Number.NaN, count: Number.NaN },
  ]);
  check('2a events sort by time', eq(out.map((e) => e.time), [0, 0, 1, 3, 3]),
    JSON.stringify(out));
  check('2b equal times keep authored order',
    out[3].count === 0.5 && out[4].count === 0.75, JSON.stringify(out));
  check('2c times and counts clamp to the event grammar ranges',
    out[0].time === 0 && out[0].count === 1 && out[1].count === 0,
    JSON.stringify(out));
  check('2d empty list stays empty', eq(normalizeSpawnEventSpecs([]), []));
}

// ── 3. Multiple events ────────────────────────────────────────
{
  const demands = [
    { time: 1, count: 2 },
    { time: 2, count: 2 },
    { time: 3, count: 2 },
  ];
  // A step crossing only t=2.
  const only = planSpawnEventDemands(SLOTS, demands, 2, 0.5);
  check('3a a step allocates only the events it crosses',
    only.length === 1 && only[0].demand.time === 2, JSON.stringify(only));
  // A step crossing t=1 and t=2 at once: both fire, in time
  // order, and the earlier event claims the first slots.
  const both = planSpawnEventDemands(SLOTS, demands, 2, 1.5);
  check('3b two crossed events allocate in time order',
    both.length === 2 && both[0].demand.time === 1 && both[1].demand.time === 2,
    JSON.stringify(both));
  check('3c the earlier event claims slots first, no overlap',
    eq(both[0].indices, REUSE_ORDER.slice(0, 2)) &&
    eq(both[1].indices, REUSE_ORDER.slice(2, 4)) &&
    new Set([...both[0].indices, ...both[1].indices]).size === 4,
    JSON.stringify(both));
  // A step crossing nothing allocates nothing.
  check('3d a step crossing no event plans nothing',
    eq(planSpawnEventDemands(SLOTS, demands, 0.5, 0.25), []));
}

// ── 4. Allocation order ───────────────────────────────────────
{
  const plan = planSpawnEventDemands(SLOTS, [{ time: 0, count: 6 }], 0, 1 / 60);
  check('4a full demand follows parked-then-oldest order',
    plan.length === 1 && eq(plan[0].indices, REUSE_ORDER), JSON.stringify(plan));
  const partial = planSpawnEventDemands(SLOTS, [{ time: 0, count: 4 }], 0, 1 / 60);
  check('4b partial demand takes parked slots before stealing live ones',
    eq(partial[0].indices, [1, 2, 0, 4]), JSON.stringify(partial));
}

// ── 5. Truncation ─────────────────────────────────────────────
{
  const over = planSpawnEventDemands(SLOTS, [{ time: 0, count: 99 }], 0, 1 / 60);
  check('5a demand above the pool size truncates to the pool',
    over.length === 1 && over[0].indices.length === SLOTS.length,
    JSON.stringify(over));
  const chain = planSpawnEventDemands(SLOTS, [
    { time: 0, count: 5 },
    { time: 0, count: 5 },
    { time: 0, count: 5 },
  ], 0, 1 / 60);
  check('5b later events truncate to the remaining supply',
    chain.length === 3 &&
    chain[0].indices.length === 5 &&
    chain[1].indices.length === 1 &&
    chain[2].indices.length === 0,
    JSON.stringify(chain.map((a) => a.indices.length)));
  check('5c zero demand fires but allocates nothing',
    eq(planSpawnEventDemands(SLOTS, [{ time: 0, count: 0 }], 0, 1 / 60)
      .map((a) => a.indices), [[]]));
}

// ── 6. Cumulative due demand ──────────────────────────────────
{
  const demands = [
    { time: 1, count: 10 },
    { time: 2, count: 20 },
    { time: 4, count: 30 },
  ];
  check('6a due demand accumulates events as their time is reached',
    spawnEventDemandDueBy(demands, 0.5) === 0 &&
    spawnEventDemandDueBy(demands, 1) === 10 &&
    spawnEventDemandDueBy(demands, 3.9) === 30 &&
    spawnEventDemandDueBy(demands, 4) === 60 &&
    spawnEventDemandDueBy(demands, 100) === 60);
  check('6b due demand of an empty list is 0',
    spawnEventDemandDueBy([], 10) === 0);
}

// ── 7. Determinism ────────────────────────────────────────────
{
  const specs = [
    { time: 2, count: 0.5 },
    { time: 1, count: 0.25 },
    { time: 2, count: 0.1 },
  ];
  const a = resolveSpawnEventDemands(specs, 8);
  const b = resolveSpawnEventDemands(specs, 8);
  check('7a resolution is deterministic', eq(a, b), `${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
  const p1 = planSpawnEventDemands(SLOTS, a, 2, 2.5);
  const p2 = planSpawnEventDemands(SLOTS, b, 2, 2.5);
  check('7b planning is deterministic', eq(p1, p2));
  check('7c resolveSpawnEventDemand matches the list form at length 1',
    eq(resolveSpawnEventDemand({ time: 1, count: 0.25 }, 8),
      resolveSpawnEventDemands([{ time: 1, count: 0.25 }], 8)[0]));
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
