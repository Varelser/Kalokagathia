// Layer 1 WP6 B3 — declarative crowd state grammar + flow
// generation (lib/steering.ts additions). Checks:
//   - the stage-1 machine re-expressed as a declaration (the
//     preset) evaluates IDENTICALLY to crowdStateFor over the
//     full input grid, for two parameter sets incl. degenerate
//     ones — the existing fixed 3-state behaviour is the
//     grammar's preset, bit for bit
//   - declared machines beyond the preset: custom states,
//     density conditions, named thresholds, literal bounds,
//     requiresSdf, priority order, fail-closed unknowns
//   - normalizeCrowdStateMachine: malformed rules dropped,
//     fallback clamped, empty states -> null
//   - flow generation (Populate grammar surface): path arc
//     length / point-at-arc, resolveCrowdFlow derived values,
//     entered-by counting, per-agent arc / point evaluation
import { build } from 'esbuild';
import { unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.l1-wp6-crowd-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
const nearPt = (p, x, y, z, eps = 1e-9) => !!p && near(p.x, x, eps) && near(p.y, y, eps) && near(p.z, z, eps);

await build({
  stdin: {
    contents: `
      export { CROWD_STATE_IDS, crowdStateFor, crowdSignalsFromInputs, resolveCrowdBound, crowdConditionHolds, evaluateCrowdStateMachine, normalizeCrowdStateMachine, CROWD_STATE_MACHINE_STATES, crowdStateMachinePreset, crowdStateForDeclared, pathArcLength, pathPointAtArc, resolveCrowdFlow, crowdFlowEnteredBy, crowdFlowAgentArc, crowdFlowAgentPoint } from './lib/steering.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});
const lib = await import(pathToFileURL(BUNDLE).href);
unlinkSync(BUNDLE);
const {
  CROWD_STATE_IDS, crowdStateFor, crowdSignalsFromInputs, resolveCrowdBound,
  crowdConditionHolds, evaluateCrowdStateMachine, normalizeCrowdStateMachine,
  CROWD_STATE_MACHINE_STATES, crowdStateMachinePreset, crowdStateForDeclared,
  pathArcLength, pathPointAtArc, resolveCrowdFlow, crowdFlowEnteredBy,
  crowdFlowAgentArc, crowdFlowAgentPoint,
} = lib;

// ── Preset structure ─────────────────────────────────────────
{
  const { machine, thresholds } = crowdStateMachinePreset({
    avoidRange: 30, avoidHysteresis: 0.2, idleSpeed: 0.05, idleSpeedOut: 0.1, idleRadius: 50,
  });
  check('preset: states are idle/move/avoid by CROWD_STATE_IDS',
    machine.states.length === 3
    && machine.states[CROWD_STATE_IDS.idle] === 'idle'
    && machine.states[CROWD_STATE_IDS.move] === 'move'
    && machine.states[CROWD_STATE_IDS.avoid] === 'avoid'
    && CROWD_STATE_MACHINE_STATES.join() === 'idle,move,avoid');
  check('preset: fallback is MOVE', machine.fallback === CROWD_STATE_IDS.move);
  check('preset: 4 rules (P1, P2, P3 entry, P3 band)', machine.rules.length === 4);
  check('preset: thresholds carry the derived AVOID exit range',
    thresholds.crowdAvoidRangeIn === 30 && near(thresholds.crowdAvoidRangeOut, 36, 1e-12)
    && thresholds.crowdIdleRadius === 50 && thresholds.crowdIdleSpeed === 0.05
    && thresholds.crowdIdleSpeedOut === 0.1);
}

// ── Preset == crowdStateFor over the full grid ───────────────
{
  const paramSets = [
    { avoidRange: 30, avoidHysteresis: 0.2, idleSpeed: 0.05, idleSpeedOut: 0.1, idleRadius: 50 },
    { avoidRange: 0, avoidHysteresis: 0, idleSpeed: 0, idleSpeedOut: 0, idleRadius: 0 },
    { avoidRange: 12.5, avoidHysteresis: 1, idleSpeed: 2, idleSpeedOut: 1, idleRadius: 7.25 },
  ];
  const sds = [-5, 0, 15, 29.9, 30, 33, 36, 36.1, 100];
  const vns = [-1, 0, 0.5];
  const speeds = [0, 0.049, 0.05, 0.08, 0.1, 0.5, 3];
  const dists = [0, 7.25, 49.9, 50, 500];
  const toward = [-0.2, 0, 0.2];
  let combos = 0;
  let mismatches = 0;
  for (const P of paramSets) {
    for (const sdfEnabled of [true, false]) {
      for (const sd of sds) for (const velNormal of vns) for (const speed of speeds) {
        for (const distToTarget of dists) for (const towardTarget of toward) {
          const input = { sdfEnabled, sd, velNormal, speed, distToTarget, towardTarget };
          combos += 1;
          if (crowdStateFor(input, P) !== crowdStateForDeclared(input, P)) mismatches += 1;
          // A supplied density must not disturb the preset (it
          // declares no density condition).
          if (crowdStateFor(input, P) !== crowdStateForDeclared(input, P, 0.9)) mismatches += 1;
        }
      }
    }
  }
  check(`preset equivalence: ${combos} grid combos x2, 0 mismatches`, mismatches === 0, `${mismatches} mismatches`);
}

// ── Condition primitives ─────────────────────────────────────
{
  const sig = crowdSignalsFromInputs(
    { sdfEnabled: true, sd: 10, velNormal: -1, speed: 2, distToTarget: 40, towardTarget: 0 },
  );
  check('signals: inputs carried, density defaults to NaN',
    sig.sd === 10 && sig.velNormal === -1 && sig.speed === 2 && sig.distToTarget === 40
    && sig.towardTarget === 0 && Number.isNaN(sig.density));
  check('signals: finite density kept, non-finite density -> NaN',
    crowdSignalsFromInputs({ sdfEnabled: false, sd: 0, velNormal: 0, speed: 0, distToTarget: 0, towardTarget: 0 }, 0.3).density === 0.3
    && Number.isNaN(crowdSignalsFromInputs({ sdfEnabled: false, sd: 0, velNormal: 0, speed: 0, distToTarget: 0, towardTarget: 0 }, Infinity).density));
  const th = { line: 5 };
  check('bound: literal resolves to itself', resolveCrowdBound(3.5, th) === 3.5);
  check('bound: named threshold resolves', resolveCrowdBound({ param: 'line' }, th) === 5);
  check('bound: missing threshold -> NaN (fail closed)', Number.isNaN(resolveCrowdBound({ param: 'nope' }, th)));
  check('bound: non-finite literal -> NaN', Number.isNaN(resolveCrowdBound(Infinity, th)));
  check('ops: lt/le/gt/ge at the boundary',
    crowdConditionHolds({ signal: 'speed', op: 'lt', bound: 2 }, sig, th) === false
    && crowdConditionHolds({ signal: 'speed', op: 'le', bound: 2 }, sig, th) === true
    && crowdConditionHolds({ signal: 'speed', op: 'gt', bound: 2 }, sig, th) === false
    && crowdConditionHolds({ signal: 'speed', op: 'ge', bound: 2 }, sig, th) === true);
  check('condition: unknown (NaN) signal never holds',
    crowdConditionHolds({ signal: 'density', op: 'ge', bound: 0 }, sig, th) === false);
  check('condition: unknown threshold never holds',
    crowdConditionHolds({ signal: 'speed', op: 'lt', bound: { param: 'nope' } }, sig, th) === false);
}

// ── A declared machine beyond the preset ─────────────────────
{
  // States: 0 cruise / 1 gather / 2 scatter / 3 hold.
  const machine = {
    states: ['cruise', 'gather', 'scatter', 'hold'],
    rules: [
      { state: 2, conditions: [{ signal: 'density', op: 'gt', bound: { param: 'denseLine' } }] },
      {
        state: 1,
        conditions: [
          { signal: 'distToTarget', op: 'lt', bound: 10 },
          { signal: 'speed', op: 'ge', bound: { param: 'minSpeed' } },
        ],
      },
      { state: 3, requiresSdf: true, conditions: [{ signal: 'sd', op: 'lt', bound: 5 }] },
    ],
    fallback: 0,
  };
  const th = { denseLine: 0.7, minSpeed: 1.5 };
  const base = { sdfEnabled: true, sd: 100, velNormal: 0, speed: 0, distToTarget: 500, towardTarget: 0 };
  const ev = (over, density = NaN, sdf = true) => evaluateCrowdStateMachine(
    machine, sdf, crowdSignalsFromInputs({ ...base, ...over }, density), th,
  );
  check('declared: dense crowd scatters', ev({}, 0.8) === 2);
  check('declared: density at the line does NOT scatter (strict gt)', ev({}, 0.7) === 0);
  check('declared: unknown density cannot scatter (fail closed)', ev({}) === 0);
  check('declared: near + fast enough gathers', ev({ distToTarget: 9, speed: 1.5 }) === 1);
  check('declared: near + too slow stays cruise', ev({ distToTarget: 9, speed: 1.4 }) === 0);
  check('declared: near SDF holds', ev({ sd: 4 }) === 3);
  check('declared: requiresSdf rule skipped without the collider', ev({ sd: 4 }, NaN, false) === 0);
  check('declared: priority — scatter (rule 1) beats hold (rule 3)', ev({ sd: 4 }, 0.9) === 2);
  check('declared: fallback when nothing matches', ev({}) === 0);
}

// ── normalizeCrowdStateMachine ───────────────────────────────
{
  const good = normalizeCrowdStateMachine({
    states: ['a', 'b'],
    rules: [
      { state: 1, conditions: [{ signal: 'speed', op: 'gt', bound: 2 }] },
      { state: 5, conditions: [] },
      { state: 0, conditions: [{ signal: 'bogus', op: 'lt', bound: 1 }] },
      { state: 0, conditions: [{ signal: 'sd', op: 'lt', bound: { param: 'x' } }], requiresSdf: true },
    ],
    fallback: 9,
  });
  check('normalize: usable machine survives', !!good && good.states.join() === 'a,b');
  check('normalize: out-of-range state and unknown-signal rules dropped',
    !!good && good.rules.length === 2 && good.rules[0].state === 1 && good.rules[1].requiresSdf === true);
  check('normalize: out-of-range fallback clamped to 0', !!good && good.fallback === 0);
  check('normalize: empty states -> null',
    normalizeCrowdStateMachine({ states: [], rules: [], fallback: 0 }) === null
    && normalizeCrowdStateMachine(null) === null
    && normalizeCrowdStateMachine({ states: ['', 7], rules: [], fallback: 0 }) === null);
  const capped = normalizeCrowdStateMachine({
    states: ['a'],
    rules: [{ state: 0, conditions: Array.from({ length: 9 }, () => ({ signal: 'sd', op: 'lt', bound: 1 })) }],
    fallback: 0,
  });
  check('normalize: rule with too many conditions dropped', !!capped && capped.rules.length === 0);
  check('normalize: preset passes through unchanged',
    (() => {
      const { machine } = crowdStateMachinePreset({
        avoidRange: 30, avoidHysteresis: 0.2, idleSpeed: 0.05, idleSpeedOut: 0.1, idleRadius: 50,
      });
      const n = normalizeCrowdStateMachine(machine);
      return !!n && n.rules.length === 4 && n.fallback === machine.fallback;
    })());
}

// ── Flow generation ──────────────────────────────────────────
{
  const path = [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 40 }];
  check('arc length: two segments, z defaults to 0', pathArcLength(path) === 70);
  check('arc length: 3D segment', pathArcLength([{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 5 }]) === 5);
  check('arc length: empty / single point -> 0',
    pathArcLength([]) === 0 && pathArcLength([{ x: 1, y: 2 }]) === 0);
  check('point at arc: start / corner / end / clamped past end',
    nearPt(pathPointAtArc(path, 0), 0, 0, 0)
    && nearPt(pathPointAtArc(path, 30), 30, 0, 0)
    && nearPt(pathPointAtArc(path, 70), 30, 40, 0)
    && nearPt(pathPointAtArc(path, 999), 30, 40, 0));
  check('point at arc: mid-segment', nearPt(pathPointAtArc(path, 35), 30, 5, 0));
  check('point at arc: empty -> origin, single -> the point',
    nearPt(pathPointAtArc([], 10), 0, 0, 0) && nearPt(pathPointAtArc([{ x: 3, y: 4, z: 5 }], 10), 3, 4, 5));

  const flow = resolveCrowdFlow({ path, density: 0.5, inflowRate: 5, speed: 10, laneCount: 2 });
  check('flow resolve: length / capacity / interval / lane density',
    flow.length === 70 && flow.capacity === 35 && near(flow.spawnInterval, 0.2)
    && flow.laneCount === 2 && near(flow.laneDensity, 0.25) && flow.path.length === 3);
  check('flow enteredBy: t<0 -> 0, t=0 -> 1 (agent 0 enters at once)',
    crowdFlowEnteredBy(flow, -1) === 0 && crowdFlowEnteredBy(flow, 0) === 1);
  check('flow enteredBy: one per interval',
    crowdFlowEnteredBy(flow, 0.19) === 1 && crowdFlowEnteredBy(flow, 0.2) === 2
    && crowdFlowEnteredBy(flow, 1) === 6);
  check('flow enteredBy: capped at capacity', crowdFlowEnteredBy(flow, 100) === 35);
  check('flow agentArc: agent 2 at t=1.4 (entered 0.4, speed 10) -> 10',
    near(crowdFlowAgentArc(flow, 2, 1.4), 10));
  check('flow agentArc: agent past the end stays at the end',
    crowdFlowAgentArc(flow, 0, 100) === 70);
  check('flow agentArc: not yet entered / beyond capacity / invalid -> -1',
    crowdFlowAgentArc(flow, 5, 0.5) === -1 && crowdFlowAgentArc(flow, 35, 100) === -1
    && crowdFlowAgentArc(flow, -1, 10) === -1 && crowdFlowAgentArc(flow, 1.5, 10) === -1);
  check('flow agentPoint: on-path positions, null before entry',
    nearPt(crowdFlowAgentPoint(flow, 2, 1.4), 10, 0, 0)
    && nearPt(crowdFlowAgentPoint(flow, 0, 3.5), 30, 5, 0)
    && crowdFlowAgentPoint(flow, 5, 0.5) === null);

  const dry = resolveCrowdFlow({ path, density: 0.5, inflowRate: 0 });
  check('flow: zero inflow -> interval Infinity, nobody ever enters',
    dry.spawnInterval === Infinity && crowdFlowEnteredBy(dry, 1000) === 0
    && crowdFlowAgentArc(dry, 0, 1000) === -1);
  const sparse = resolveCrowdFlow({ path: [{ x: 0, y: 0 }], density: 3, inflowRate: 2 });
  check('flow: zero-length path -> capacity 0, nobody enters',
    sparse.length === 0 && sparse.capacity === 0 && crowdFlowEnteredBy(sparse, 10) === 0);
  const messy = resolveCrowdFlow({
    path: [{ x: 0, y: 0 }, { x: NaN, y: 1 }, { x: 10, y: 0 }],
    density: -2, inflowRate: 5, laneCount: 99,
  });
  check('flow resolve: non-finite points dropped, density clamped, lanes clamped to 4',
    messy.path.length === 2 && messy.density === 0 && messy.capacity === 0 && messy.laneCount === 4);
}

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
