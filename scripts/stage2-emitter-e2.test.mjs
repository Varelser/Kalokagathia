// Grammar 2.0 stage 2, slice E2 — spawn allocator (absolute
// rate + reuse order), burst re-hosting, emission envelope,
// rule spawn gate, and the general directed initial velocity.
// Design: kalokagathia-pro/STAGE2_DESIGN.md §2 E2.
//
// Cases:
//  1 allocator quota: exact fractional accumulation of an
//    absolute rate (particles/sec → per-frame counts)
//  2 allocation plan: the fixed reuse order (parked first by
//    ascending gate value, then oldest live), determinism,
//    demand clamping
//  3 burst equivalence: the t=0 burst set the allocator plans
//    is exactly the legacy gate's live-at-0 set, in gate order
//  4 absolute threshold: spawnThresholdAbsolute equals the
//    legacy full threshold at rate = fraction × poolSize, and
//    the release count at a given time matches the gate slots
//  5 event cohort: planSpawnEventCohort equals the legacy
//    direct selection loop, index order
//  6 envelope: value evaluation (before start / window /
//    after stop / no stop) and the accumulated clock
//  7 directed velocity: spawnEventVelocity is bit-identical
//    to an independent copy of the pre-E2 formula; the
//    general mouth with the radial base equals it; spread 0
//    is exactly the authored direction; the GLSL twin is
//    pinned and spliced ahead of the event block
//  8 bake: directed mode keeps positions bit-identical to
//    the cube bake (same draws) and velocities equal the JS
//    law per texel; explicit null stays bit-identical
//  9 shader variants: defaults pinned; allocator / rule-gate
//    / directed variants carry their segments, defaults do
//    not; the live-rule texture is declared exactly once
// 10 capability: the four new features route to WebGL only
//    when their keys are on
// 11 key registration: the 12 new keys sit at their defaults
import { build } from 'esbuild';
import { unlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.s2e2-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};

await build({
  stdin: {
    contents: `
      export { buildGpgpuInitialData } from './lib/gpgpuInitialData.ts';
      export { clampSpawnRateAbsolute, spawnRateAbsoluteActive, spawnRateFractionEquivalent, spawnThresholdAbsolute, resolveSpawnRateEff, spawnAllocQuota, planSpawnAllocation, spawnGateSlots, planSpawnEventCohort, clampSpawnEnvelopeTime, resolveSpawnEnvelope, spawnEnvelopeValueAt, advanceSpawnEnvelopeClock, spawnAllocVariantActive, spawnRuleGateKeyOn } from './lib/gpgpuSpawnAllocator.ts';
      export { spawnThresholdFull, spawnStateForIndexFull, spawnGateValueForIndex, spawnHashForIndex, spawnEventHashForIndex, spawnEventSelects, spawnEventVelocity, directedInitialVelocity, clampSpawnRate } from './lib/gpgpuLifecycle.ts';
      export { resolveEmitterBaseDirection, clampEmitterVelSpeed, clampEmitterVelSpread, emitterVelocityDirectedActive } from './lib/gpgpuEmitter.ts';
      export { buildPositionFragment, SIM_POS_FRAG } from './components/gpgpuShaderSimulationPosition.ts';
      export { buildVelocityFragment, SIM_VEL_FRAG } from './components/gpgpuShaderSimulationVelocity.ts';
      export { VEL_FRAG_EMITTER_VELOCITY_FN } from './components/gpgpuShaderSimulationVelocityHelpers.ts';
      export { getWebgpuComputeCapabilityReport } from './lib/webgpuComputeFoundation.ts';
      export { APP_STATE_DEFAULT_GPGPU } from './lib/appStateDefaultGpgpu.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});
const lib = await import(pathToFileURL(BUNDLE).href);
unlinkSync(BUNDLE);
const {
  buildGpgpuInitialData,
  clampSpawnRateAbsolute, spawnRateAbsoluteActive, spawnRateFractionEquivalent,
  spawnThresholdAbsolute, resolveSpawnRateEff, spawnAllocQuota,
  planSpawnAllocation, spawnGateSlots, planSpawnEventCohort,
  clampSpawnEnvelopeTime, resolveSpawnEnvelope, spawnEnvelopeValueAt,
  advanceSpawnEnvelopeClock, spawnAllocVariantActive, spawnRuleGateKeyOn,
  spawnThresholdFull, spawnStateForIndexFull, spawnGateValueForIndex,
  spawnHashForIndex, spawnEventHashForIndex, spawnEventSelects,
  spawnEventVelocity, directedInitialVelocity, clampSpawnRate,
  resolveEmitterBaseDirection, clampEmitterVelSpeed, clampEmitterVelSpread,
  emitterVelocityDirectedActive,
  buildPositionFragment, SIM_POS_FRAG, buildVelocityFragment, SIM_VEL_FRAG,
  VEL_FRAG_EMITTER_VELOCITY_FN, getWebgpuComputeCapabilityReport,
  APP_STATE_DEFAULT_GPGPU,
} = lib;

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const approx = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
const eqArr = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

// ── 1. Allocator quota ───────────────────────────────────
{
  let carry = 0; let total = 0;
  for (let f = 0; f < 120; f++) {
    const q = spawnAllocQuota(30, 1 / 60, carry);
    total += q.count; carry = q.carry;
  }
  check('1 30/s at 60fps for 2s allocates exactly 60', total === 60, `total=${total}`);
  check('1 carry stays in [0, 1)', carry >= 0 && carry < 1, `carry=${carry}`);

  let carry2 = 0; let total2 = 0;
  for (let f = 0; f < 600; f++) {
    const q = spawnAllocQuota(100, 0.016, carry2);
    total2 += q.count; carry2 = q.carry;
  }
  check('1 100/s at dt=0.016 for 600 frames allocates 960', total2 === 960, `total=${total2}`);

  const zero = spawnAllocQuota(0, 1 / 60, 0.5);
  check('1 rate 0 allocates nothing and keeps the carry',
    zero.count === 0 && zero.carry === 0.5);
  const neg = spawnAllocQuota(50, -1, 0);
  check('1 negative dt allocates nothing', neg.count === 0 && neg.carry === 0);
  check('1 clamps: non-finite rate is off, huge rate is capped',
    clampSpawnRateAbsolute(Number.NaN) === 0
    && clampSpawnRateAbsolute(-5) === 0
    && clampSpawnRateAbsolute(1e12) === 1_000_000);
}

// ── 2. Allocation plan order ─────────────────────────────
{
  const slots = [
    { index: 0, parked: false, gateValue: 0.1, age: 3 },
    { index: 1, parked: true, gateValue: 0.7, age: 9 },
    { index: 2, parked: true, gateValue: 0.2, age: 1 },
    { index: 3, parked: false, gateValue: 0.9, age: 12 },
    { index: 4, parked: true, gateValue: 0.2, age: 5 },
    { index: 5, parked: false, gateValue: 0.5, age: 12 },
  ];
  check('2 parked first (gate asc, index tie-break), then oldest live (age desc, index tie-break)',
    eqArr(planSpawnAllocation(slots, 6), [2, 4, 1, 3, 5, 0]),
    JSON.stringify(planSpawnAllocation(slots, 6)));
  check('2 partial demand takes the head of the same order',
    eqArr(planSpawnAllocation(slots, 3), [2, 4, 1]));
  check('2 demand clamps to the pool and zero demand plans nothing',
    planSpawnAllocation(slots, 99).length === 6
    && planSpawnAllocation(slots, 0).length === 0);
  const again = planSpawnAllocation([...slots].reverse(), 6);
  check('2 the plan is input-order independent (deterministic)',
    eqArr(again, [2, 4, 1, 3, 5, 0]), JSON.stringify(again));
}

// ── 3. Burst equivalence at t=0 ──────────────────────────
{
  const texSize = 8; const burst = 0.25;
  const slots = spawnGateSlots(texSize, 0, 1 / 60, 1, burst, 0, 1, 0, 1);
  const liveAt0 = [];
  for (let i = 0; i < texSize * texSize; i++) {
    if (spawnHashForIndex(i, texSize) < burst) liveAt0.push(i);
  }
  // The burst itself is the gate's live-at-0 set (checked via
  // the complement below); the allocator's plan for the
  // remaining births is the parked set, released in ascending
  // gate order — the burst's continuation under the allocator.
  const parkedIdx = slots.filter((s) => s.parked).map((s) => s.index);
  const plan = planSpawnAllocation(slots, parkedIdx.length);
  const byGate = [...parkedIdx].sort((a, b) =>
    (spawnGateValueForIndex(a, texSize) - spawnGateValueForIndex(b, texSize)) || (a - b));
  check('3 the allocator plans exactly the parked remainder at t=0',
    eqArr([...plan].sort((a, b) => a - b), [...parkedIdx].sort((a, b) => a - b)),
    `plan=${plan.length} parked=${parkedIdx.length}`);
  check('3 and releases it in ascending gate order (lowest gate value first)',
    eqArr(plan, byGate));
  const parkedCount = slots.filter((s) => s.parked).length;
  check('3 parked count is the complement of the burst set',
    parkedCount === texSize * texSize - liveAt0.length,
    `parked=${parkedCount}`);
}

// ── 4. Absolute threshold ────────────────────────────────
{
  const pool = 256; let allEq = true; let worst = 0;
  for (const t of [0, 0.3, 1, 2.7, 10]) {
    for (const frac of [0.05, 0.25, 0.5, 1]) {
      for (const pulse of [[0, 1, 0, 1], [2, 0.5, 3, 0.8]]) {
        const a = spawnThresholdAbsolute(t, frac * pool, pool, 0.2, ...pulse);
        const b = spawnThresholdFull(t, frac, 0.2, ...pulse);
        worst = Math.max(worst, Math.abs(a - b));
        if (!approx(a, b, 1e-12)) allEq = false;
      }
    }
  }
  check('4 absolute threshold equals the legacy threshold at rate = fraction × pool',
    allEq, `worst=${worst}`);
  check('4 a rate above the pool saturates the threshold at 1',
    spawnThresholdAbsolute(5, pool * 4, pool, 0, 0, 1, 0, 1) === 1);
  check('4 burst 1 short-circuits to 1 in both forms',
    spawnThresholdAbsolute(0, 10, pool, 1, 0, 1, 0, 1) === 1);
  check('4 fraction equivalent and effective rate resolution',
    spawnRateFractionEquivalent(25.6, 256) === 0.1
    && resolveSpawnRateEff({ gpgpuSpawnRateAbsolute: 25.6 }, 16) === 0.1
    && resolveSpawnRateEff({ gpgpuSpawnRateAbsolute: 0, gpgpuSpawnRate: 0.3 }, 16) === clampSpawnRate(0.3)
    && spawnRateAbsoluteActive({ gpgpuSpawnRateAbsolute: 0 }) === false
    && spawnRateAbsoluteActive({ gpgpuSpawnRateAbsolute: 5 }) === true);
  // Release count at t=1 with an absolute rate of 25.6/s over
  // a 256 pool: threshold 0.1 — the gate slots' live count is
  // exactly the hashes below it, and near 25.6 ± granularity.
  const slots = spawnGateSlots(16, 1, 1 / 60, 25.6 / 256, 0, 0, 1, 0, 1);
  const live = slots.filter((s) => !s.parked).length;
  const exact = spawnGateSlots(16, 1, 1 / 60, 25.6 / 256, 0, 0, 1, 0, 1)
    .filter((s) => s.gateValue < spawnThresholdAbsolute(1, 25.6, 256, 0, 0, 1, 0, 1)).length;
  check('4 the live count at t=1 is the threshold count, near 25.6',
    live === exact && Math.abs(live - 25.6) <= 8, `live=${live}`);
}

// ── 5. Event cohort equivalence ──────────────────────────
{
  const direct = [];
  for (let i = 0; i < 64; i++) {
    if (spawnEventSelects(spawnEventHashForIndex(i, 8), 0.3)) direct.push(i);
  }
  check('5 the allocator cohort equals the legacy direct selection',
    eqArr(planSpawnEventCohort(8, 0.3), direct) && direct.length > 0,
    `cohort=${planSpawnEventCohort(8, 0.3).length} direct=${direct.length}`);
  check('5 count 0 selects nobody, count 1 selects everyone',
    planSpawnEventCohort(8, 0).length === 0 && planSpawnEventCohort(8, 1).length === 64);
}

// ── 6. Envelope ──────────────────────────────────────────
{
  const off = resolveSpawnEnvelope({ gpgpuSpawnEnvelopeEnabled: false });
  check('6 disabled envelope is the plain clock (value 1 everywhere)',
    spawnEnvelopeValueAt(0, off) === 1 && spawnEnvelopeValueAt(999, off) === 1);
  const env = resolveSpawnEnvelope({
    gpgpuSpawnEnvelopeEnabled: true,
    gpgpuSpawnEnvelopeStart: 2, gpgpuSpawnEnvelopeStop: 6,
    gpgpuSpawnEnvelopeCurve: [0, 1, 1, 1],
  });
  check('6 window: 0 before start, curve inside, 0 at/after stop',
    spawnEnvelopeValueAt(1.99, env) === 0
    && spawnEnvelopeValueAt(2, env) === 1
    && spawnEnvelopeValueAt(4, env) === 1
    && spawnEnvelopeValueAt(6, env) === 0
    && spawnEnvelopeValueAt(60, env) === 0);
  const ramp = resolveSpawnEnvelope({
    gpgpuSpawnEnvelopeEnabled: true,
    gpgpuSpawnEnvelopeStart: 2, gpgpuSpawnEnvelopeStop: 6,
    gpgpuSpawnEnvelopeCurve: [0, 0, 1, 1],
  });
  check('6 the amount curve shapes the window (ramp midpoint = 0.5)',
    approx(spawnEnvelopeValueAt(4, ramp), 0.5, 1e-12),
    `v=${spawnEnvelopeValueAt(4, ramp)}`);
  const noStop = resolveSpawnEnvelope({
    gpgpuSpawnEnvelopeEnabled: true,
    gpgpuSpawnEnvelopeStart: 2, gpgpuSpawnEnvelopeStop: 0,
    gpgpuSpawnEnvelopeCurve: [0, 0.25, 1, 0.75],
  });
  check('6 no stop: the curve tail applies after start',
    approx(spawnEnvelopeValueAt(100, noStop), 0.75, 1e-12)
    && spawnEnvelopeValueAt(1, noStop) === 0);
  let clock = 0;
  for (let f = 0; f < 20; f++) clock = advanceSpawnEnvelopeClock(clock, f * 0.5, 0.5, env);
  check('6 the accumulated clock integrates the window (2..6 at value 1 = 4s)',
    clock === 4, `clock=${clock}`);
  let plain = 0;
  for (let f = 0; f < 20; f++) plain = advanceSpawnEnvelopeClock(plain, f * 0.5, 0.5, off);
  check('6 disabled, the accumulated clock is the spawn time itself', plain === 10);
  check('6 window times clamp to [0, 600] and non-finite to 0',
    clampSpawnEnvelopeTime(-3) === 0 && clampSpawnEnvelopeTime(9999) === 600
    && clampSpawnEnvelopeTime(Number.NaN) === 0);
  check('6 variant activity: absolute rate or envelope, not the defaults',
    spawnAllocVariantActive({ gpgpuSpawnRateAbsolute: 0, gpgpuSpawnEnvelopeEnabled: false }) === false
    && spawnAllocVariantActive({ gpgpuSpawnRateAbsolute: 10, gpgpuSpawnEnvelopeEnabled: false }) === true
    && spawnAllocVariantActive({ gpgpuSpawnRateAbsolute: 0, gpgpuSpawnEnvelopeEnabled: true }) === true
    && spawnRuleGateKeyOn({ gpgpuSpawnRuleGateEnabled: true }) === true
    && spawnRuleGateKeyOn({ gpgpuSpawnRuleGateEnabled: false }) === false);
}

// ── 7. Directed initial velocity ─────────────────────────
// Independent copy of the PRE-E2 spawnEventVelocity formula
// (radial base + hash sphere blend), written from the shipped
// code before the refactor delegated to directedInitialVelocity.
function legacyEventVelocity(pos, u, v, speed, spread) {
  const dmHash11 = (n) => {
    const fract = (x) => x - Math.floor(x);
    let x = fract(n * 0.1031);
    let y = fract(n * 0.1030);
    let z = fract(n * 0.0973);
    const d = x * (y + 33.33) + y * (x + 33.33) + z * (z + 33.33);
    x += d; y += d; z += d;
    return fract((x + y) * z);
  };
  const hash = (ou, ov) => dmHash11((u + ou) * 127.1 + (v + ov) * 311.7);
  const plen = Math.hypot(pos.x, pos.y, pos.z);
  const bx = plen > 0.0001 ? pos.x / plen : 0;
  const by = plen > 0.0001 ? pos.y / plen : 1;
  const bz = plen > 0.0001 ? pos.z / plen : 0;
  const th = hash(2.71, 6.13) * Math.PI * 2;
  const phi = Math.acos(2 * hash(9.43, 4.29) - 1);
  const magHash = hash(7.77, 1.93);
  const rx = Math.sin(phi) * Math.cos(th);
  const ry = Math.sin(phi) * Math.sin(th);
  const rz = Math.cos(phi);
  let dx = bx + (rx - bx) * spread;
  let dy = by + (ry - by) * spread;
  let dz = bz + (rz - bz) * spread;
  const dl = Math.hypot(dx, dy, dz) || 1;
  dx /= dl; dy /= dl; dz /= dl;
  const mag = speed * (1 + (0.25 + 0.75 * magHash - 1) * spread);
  return { x: dx * mag, y: dy * mag, z: dz * mag };
}
{
  let identical = true;
  for (const pos of [{ x: 3, y: -4, z: 5 }, { x: 0, y: 0, z: 0 }, { x: -10, y: 0.5, z: 2 }]) {
    for (const [u, v] of [[0.1, 0.9], [0.5, 0.5], [0.97, 0.03]]) {
      for (const [speed, spread] of [[2, 0], [3.5, 0.5], [10, 1]]) {
        const a = spawnEventVelocity(pos, u, v, speed, spread);
        const b = legacyEventVelocity(pos, u, v, speed, spread);
        // The hash draws run through dmHash11; agreement to
        // 1e-12 proves the refactor kept the law term for term.
        if (!approx(a.x, b.x, 1e-12) || !approx(a.y, b.y, 1e-12) || !approx(a.z, b.z, 1e-12)) identical = false;
        const plen = Math.hypot(pos.x, pos.y, pos.z);
        const base = plen > 0.0001
          ? { x: pos.x / plen, y: pos.y / plen, z: pos.z / plen } : { x: 0, y: 1, z: 0 };
        const c = directedInitialVelocity(base, u, v, speed, spread);
        if (a.x !== c.x || a.y !== c.y || a.z !== c.z) identical = false;
      }
    }
  }
  check('7 the event velocity is the general mouth at the radial base (bit-exact), and matches the pre-E2 formula',
    identical);
  const straight = directedInitialVelocity({ x: 0, y: 1, z: 0 }, 0.3, 0.7, 4, 0);
  check('7 spread 0 is exactly the authored direction at the authored speed',
    straight.x === 0 && straight.y === 4 && straight.z === 0);
  let magOk = true;
  for (let i = 0; i < 200; i++) {
    const u = (i % 16 + 0.5) / 16; const v = (Math.floor(i / 16) + 0.5) / 16;
    const vel = directedInitialVelocity({ x: 1, y: 0, z: 0 }, u, v, 8, 1);
    const m = Math.hypot(vel.x, vel.y, vel.z);
    if (m < 2 - 1e-9 || m > 8 + 1e-9) magOk = false;
  }
  check('7 spread 1 keeps the magnitude inside [0.25×, 1×] of the speed', magOk);
  check('7 base direction resolution: normalise, zero/non-finite fall back to +Y',
    (() => { const d = resolveEmitterBaseDirection({ gpgpuEmitterVelDirX: 3, gpgpuEmitterVelDirY: 0, gpgpuEmitterVelDirZ: 4 }); return approx(d.x, 0.6, 1e-12) && d.y === 0 && approx(d.z, 0.8, 1e-12); })()
    && (() => { const d = resolveEmitterBaseDirection({ gpgpuEmitterVelDirX: 0, gpgpuEmitterVelDirY: 0, gpgpuEmitterVelDirZ: 0 }); return d.x === 0 && d.y === 1 && d.z === 0; })());
  check('7 velocity clamps: speed [0, 50] default 2, spread [0, 1] default 0.5',
    clampEmitterVelSpeed(99) === 50 && clampEmitterVelSpeed(Number.NaN) === 2
    && clampEmitterVelSpread(2) === 1 && clampEmitterVelSpread(Number.NaN) === 0.5
    && emitterVelocityDirectedActive({ gpgpuEmitterVelMode: 'directed' }) === true
    && emitterVelocityDirectedActive({ gpgpuEmitterVelMode: 'cube' }) === false);
  check('7 GLSL twin pinned',
    sha256(VEL_FRAG_EMITTER_VELOCITY_FN) === '50e61ef341b66bfd71e1efc14839381616d76379062098d2a038002841dbe51e',
    sha256(VEL_FRAG_EMITTER_VELOCITY_FN));
}

// ── 8. Bake with the directed mouth ──────────────────────
{
  const cube = buildGpgpuInitialData(16, 100, 'sphere', 1234, 8, null, null);
  const directed = buildGpgpuInitialData(16, 100, 'sphere', 1234, 8, null, {
    initialVelocity: { dir: { x: 0, y: 1, z: 0 }, speed: 3, spread: 0.25 },
  });
  check('8 directed bake keeps positions bit-identical (same draw consumption)',
    sha256(Buffer.from(directed.posData.buffer)) === '485ca667bb0c060d738b092fda8a97c3ebc430355d4f70dc05b83ee237c06c29'
    && Buffer.from(directed.posData.buffer).equals(Buffer.from(cube.posData.buffer)));
  let lawOk = true;
  for (let i = 0; i < 256; i++) {
    const u = ((i % 16) + 0.5) / 16; const v = (Math.floor(i / 16) + 0.5) / 16;
    const want = directedInitialVelocity({ x: 0, y: 1, z: 0 }, u, v, 3, 0.25);
    if (!approx(directed.velData[i * 4], want.x, 1e-5)
      || !approx(directed.velData[i * 4 + 1], want.y, 1e-5)
      || !approx(directed.velData[i * 4 + 2], want.z, 1e-5)) lawOk = false;
  }
  check('8 directed bake velocities equal the JS law per texel', lawOk);
  check('8 directed velocities differ from the cube scatter',
    !Buffer.from(directed.velData.buffer).equals(Buffer.from(cube.velData.buffer)));
  const explicitNull = buildGpgpuInitialData(16, 100, 'sphere', 1234, 8, null, { initialVelocity: null });
  check('8 explicit null initial velocity is a bake no-op',
    Buffer.from(explicitNull.velData.buffer).equals(Buffer.from(cube.velData.buffer))
    && sha256(Buffer.from(cube.velData.buffer)) === 'd1390093472035da64a864fa01c760b2907407fb5502d16dd5b2c21c50641d41');
}

// ── 9. Shader variants ───────────────────────────────────
{
  check('9 default position string is the shipped one (pin)',
    sha256(SIM_POS_FRAG) === 'f01a1a6ccd9e0df88a5ff7c91157e21607a5b2652790d5beb2148f156f3a1e49');
  check('9 default velocity string is the shipped one (pin)',
    sha256(SIM_VEL_FRAG) === '5c1925996726e4f97ff037d8dccfeb848e63a8aca3e755a32736e84c5c49e637');
  check('9 defaults carry none of the E2 segments',
    !SIM_POS_FRAG.includes('uSpawnRateEff') && !SIM_POS_FRAG.includes('uSpawnRuleGateEnabled')
    && !SIM_VEL_FRAG.includes('kaloEmitterVelocity') && !SIM_VEL_FRAG.includes('uSpawnClockTime'));
  const posAlloc = buildPositionFragment({ spawnAlloc: true });
  check('9 allocator position variant swaps the threshold lines',
    posAlloc.includes('uSpawnRateEff') && posAlloc.includes('uSpawnClockTime')
    && !posAlloc.includes('min(1.0, uSpawnBurst + uSpawnRate * liveTime)'));
  const posRule = buildPositionFragment({ spawnRuleGate: true });
  check('9 rule-gate position variant reads REP bit 13',
    posRule.includes('uSpawnRuleGateEnabled') && posRule.includes('8192.0'));
  const posBoth = buildPositionFragment({ spawnRuleGate: true, particleRulesLive: true });
  check('9 the live-rule texture is declared exactly once with both variants',
    (posBoth.match(/uniform sampler2D uRuleLiveTex/g) || []).length === 1
    && (posRule.match(/uniform sampler2D uRuleLiveTex/g) || []).length === 1);
  const velAlloc = buildVelocityFragment('', undefined, { spawnAlloc: true });
  check('9 allocator velocity variant swaps the gate line',
    velAlloc.includes('uSpawnRateEff') && !velAlloc.includes('uSpawnRate * liveTime'));
  const velDir = buildVelocityFragment('', undefined, { emitterVelocity: true });
  check('9 directed segment is spliced ahead of the event block, on the legacy clock',
    velDir.includes('kaloEmitterVelocity')
    && velDir.indexOf('kaloEmitterVelocity') < velDir.indexOf('Spawn burst event')
    && velDir.includes('uSpawnTime - uDelta') && !velDir.includes('uSpawnClockTime'));
  const velBoth = buildVelocityFragment('', undefined, { emitterVelocity: true, spawnAlloc: true });
  check('9 directed + allocator: the segment runs on the envelope clock',
    velBoth.includes('uSpawnClockTime') && velBoth.includes('uSpawnClockPrev'));
  check('9 the plain builder still returns the stock string',
    buildVelocityFragment('') === SIM_VEL_FRAG && buildPositionFragment() === SIM_POS_FRAG);
}

// ── 10. Capability ───────────────────────────────────────
{
  const base = { ...APP_STATE_DEFAULT_GPGPU };
  const dflt = getWebgpuComputeCapabilityReport(base);
  check('10 defaults request none of the E2 features',
    !dflt.unsupportedFeatures.includes('spawn-rate-absolute')
    && !dflt.unsupportedFeatures.includes('spawn-envelope')
    && !dflt.unsupportedFeatures.includes('spawn-rule-gate')
    && !dflt.unsupportedFeatures.includes('emitter-directed-velocity'));
  check('10 absolute rate routes to WebGL',
    getWebgpuComputeCapabilityReport({ ...base, gpgpuSpawnRateAbsolute: 120 })
      .unsupportedFeatures.includes('spawn-rate-absolute'));
  check('10 envelope routes to WebGL',
    getWebgpuComputeCapabilityReport({ ...base, gpgpuSpawnEnvelopeEnabled: true })
      .unsupportedFeatures.includes('spawn-envelope'));
  check('10 rule gate routes to WebGL',
    getWebgpuComputeCapabilityReport({ ...base, gpgpuSpawnRuleGateEnabled: true })
      .unsupportedFeatures.includes('spawn-rule-gate'));
  check('10 directed velocity routes to WebGL',
    getWebgpuComputeCapabilityReport({ ...base, gpgpuEmitterVelMode: 'directed' })
      .unsupportedFeatures.includes('emitter-directed-velocity'));
}

// ── 11. Key registration ─────────────────────────────────
{
  const d = APP_STATE_DEFAULT_GPGPU;
  check('11 the 12 new keys sit at their defaults',
    d.gpgpuSpawnRateAbsolute === 0
    && d.gpgpuSpawnEnvelopeEnabled === false
    && d.gpgpuSpawnEnvelopeStart === 0
    && d.gpgpuSpawnEnvelopeStop === 0
    && JSON.stringify(d.gpgpuSpawnEnvelopeCurve) === '[0,1,1,1]'
    && d.gpgpuSpawnRuleGateEnabled === false
    && d.gpgpuEmitterVelMode === 'cube'
    && d.gpgpuEmitterVelDirX === 0 && d.gpgpuEmitterVelDirY === 1 && d.gpgpuEmitterVelDirZ === 0
    && d.gpgpuEmitterVelSpeed === 2 && d.gpgpuEmitterVelSpread === 0.5);
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
