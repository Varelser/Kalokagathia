// Grammar 2.0 stage 3, slice S2 follow-up — Retimer speed
// curve (lib/cacheRetimer.ts): a free-drawn curve whose
// value at a normalised playback position is the
// instantaneous speed multiplier relative to rate. The
// warp is the curve's ANALYTIC integral (piecewise linear
// curve -> piecewise quadratic integral), normalised by
// its total, so the pass duration is exactly what rate
// alone dictates and only the distribution moves.
// Verified here:
// - identity: an enabled IDENTITY curve resolves to no
//   curve at all and the mapping (frame choice AND cloud
//   positions) is bit-identical to the legacy mapping;
//   a disabled curve with non-identity points is likewise
//   inert; a degenerate point list coerces to identity by
//   the free-curve asset convention;
// - constant curve: value 2 everywhere normalises away —
//   the mapping equals the no-curve mapping exactly;
// - analytic values: ramp (progress = u^2) and ease-out
//   (progress = 2u - u^2) hit their closed-form frame
//   positions exactly at measured times;
// - freeze: a zero-valued stretch holds the frame exactly
//   while playback time passes through it;
// - duration preservation: at t = span / (fps * rate) the
//   non-loop pass sits exactly on the end frame for every
//   curve, and just before it does not;
// - reverse: the exact time mirror of the forward warped
//   pass (forward + reverse = start + end);
// - loop: the cycle wraps with the warped offset, and the
//   segment bracket still wraps end -> start;
// - range + rate compose with the curve as specified;
// - refusals: an all-zero curve is refused with a reason;
// - the config bridge carries the two new keys;
// - both cache kinds: a converted state cache plays
//   through the same warped mapping.
// Design: kalokagathia-pro/STAGE3_DESIGN.md §2 S2 and the
// S2 speed-curve slice record. NOT covered (unconfirmed,
// real-browser check): the live driver's on-screen
// playback and the panel editor wiring itself.
import { build } from 'esbuild';
import { unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.s3s2c-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};

await build({
  stdin: {
    contents: `
      export { resolveCacheRetimer, resolveCacheRetimerFromConfig, cacheRetimerFrameFloat, cacheRetimerBracket, cacheRetimerSpeedCurveProgress, isCacheRetimerIdentity } from './lib/cacheRetimer.ts';
      export { normalizeFreeCurvePoints } from './lib/freeCurve.ts';
      export { buildPointCache, buildPointCacheCloud, pointCacheFrameFloat } from './lib/pointCache.ts';
      export { assembleStateCache, stateCacheToPointCacheData } from './lib/gpgpuStateCache.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});
const lib = await import(pathToFileURL(BUNDLE).href);
unlinkSync(BUNDLE);
const {
  resolveCacheRetimer, resolveCacheRetimerFromConfig, cacheRetimerFrameFloat,
  cacheRetimerBracket, cacheRetimerSpeedCurveProgress, isCacheRetimerIdentity,
  buildPointCache, buildPointCacheCloud, pointCacheFrameFloat,
  assembleStateCache, stateCacheToPointCacheData,
} = lib;

const bits = (arr) => Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
const bitEqual = (a, b) => bits(a).equals(bits(b));
const FRAMES = 8;
const FPS = 10;
const BASE = { rate: 1, startFrame: 0, endFrame: -1, reverse: false, interpolation: 'inherit' };
const R = (settings, frameCount = FRAMES) => {
  const r = resolveCacheRetimer(settings, frameCount);
  if (!r.ok) throw new Error(`unexpected refusal: ${r.error}`);
  return r.resolved;
};
const withCurve = (points, extra = {}) => R({ ...BASE, ...extra, speedCurveEnabled: true, speedCurvePoints: points });

const makeCache = (interpolation) => {
  const frames = [];
  for (let f = 0; f < FRAMES; f++) {
    frames.push(new Float32Array([f * 10, f, -f, 100 + f, 200, 300 - f]));
  }
  return buildPointCache({
    format: 'pointcache-manifest-v2', version: 2, fps: FPS, count: 2,
    startFrame: 0, frameCount: FRAMES, loop: true, interpolation,
    coordinates: { up: 'y', unit: 'm' }, attributes: [], files: [],
  }, frames);
};

// ── 1. Identity curve: no curve resolved, mapping bit-exact ──
{
  const identityCurve = withCurve([0, 1, 1, 1]);
  check('1 identity curve resolves to no curve', identityCurve.speedCurve === null);
  check('1 identity curve retimer is identity', isCacheRetimerIdentity(identityCurve, FRAMES));
  const cache = makeCache('linear');
  const times = [0, 0.05, 0.13, 0.37, 0.75, 0.99, 1.3, 2.9];
  for (const loop of [true, false]) {
    check(`1 identity curve frameFloat == legacy (loop=${loop})`,
      times.every((t) => cacheRetimerFrameFloat(identityCurve, FRAMES, FPS, t, loop) === pointCacheFrameFloat(cache, t, loop)));
    check(`1 identity curve cloud bit-equal (loop=${loop})`,
      times.every((t) => bitEqual(
        buildPointCacheCloud(cache, t, loop).positions,
        buildPointCacheCloud(cache, t, loop, identityCurve).positions,
      )));
  }
  const disabled = R({ ...BASE, speedCurveEnabled: false, speedCurvePoints: [0, 0, 1, 4] });
  check('1 disabled curve is inert even with wild points', disabled.speedCurve === null
    && cacheRetimerFrameFloat(disabled, FRAMES, FPS, 0.37, true) === pointCacheFrameFloat(cache, 0.37, true));
  const degenerate = withCurve([0.5, 3]);
  check('1 single-point list coerces to identity (asset convention)', degenerate.speedCurve === null);
}

// ── 2. Constant curve normalises away ──
{
  const constant2 = withCurve([0, 2, 1, 2]);
  check('2 constant-2 curve is resolved (non-identity points)', constant2.speedCurve !== null);
  const cache = makeCache('linear');
  const times = [0, 0.1, 0.25, 0.35, 0.7, 0.9, 1.7];
  for (const loop of [true, false]) {
    check(`2 constant-2 frameFloat == no-curve mapping (loop=${loop})`,
      times.every((t) => cacheRetimerFrameFloat(constant2, FRAMES, FPS, t, loop)
        === cacheRetimerFrameFloat(R(BASE), FRAMES, FPS, t, loop)),
      times.map((t) => `${t}:${cacheRetimerFrameFloat(constant2, FRAMES, FPS, t, loop)}`).join(' '));
  }
}

// ── 3. Analytic warp values ──
{
  const ramp = withCurve([0, 0, 1, 2]); // c(u) = 2u, progress = u^2
  check('3 ramp progress(0.5) == 0.25', cacheRetimerSpeedCurveProgress(ramp.speedCurve, 0.5) === 0.25);
  check('3 ramp progress(0) == 0 and progress(1) == 1',
    cacheRetimerSpeedCurveProgress(ramp.speedCurve, 0) === 0
    && cacheRetimerSpeedCurveProgress(ramp.speedCurve, 1) === 1);
  check('3 ramp non-loop t=0.35 -> frame 1.75', cacheRetimerFrameFloat(ramp, FRAMES, FPS, 0.35, false) === 1.75,
    String(cacheRetimerFrameFloat(ramp, FRAMES, FPS, 0.35, false)));
  const easeOut = withCurve([0, 2, 1, 0]); // c(u) = 2 - 2u, progress = 2u - u^2
  check('3 ease-out progress(0.5) == 0.75', cacheRetimerSpeedCurveProgress(easeOut.speedCurve, 0.5) === 0.75);
  check('3 ease-out non-loop t=0.35 -> frame 5.25', cacheRetimerFrameFloat(easeOut, FRAMES, FPS, 0.35, false) === 5.25);
  const cache = makeCache('linear');
  check('3 ramp cloud at t=0.35 blends frames 1/2 at 0.75 (x = 17.5)',
    buildPointCacheCloud(cache, 0.35, false, ramp).positions[0] === 17.5,
    String(buildPointCacheCloud(cache, 0.35, false, ramp).positions[0]));
  // Monotonicity on a wiggly curve, endpoints exact.
  const wiggly = withCurve([0, 0.2, 0.3, 3, 0.6, 0, 1, 1.5]);
  let prev = 0;
  let mono = true;
  for (let i = 0; i <= 100; i++) {
    const p = cacheRetimerSpeedCurveProgress(wiggly.speedCurve, i / 100);
    if (p < prev) mono = false;
    prev = p;
  }
  check('3 wiggly progress is monotonic non-decreasing with exact endpoints', mono && prev === 1);
}

// ── 4. Freeze stretch (curve value 0) ──
{
  const freeze = withCurve([0, 1, 0.25, 0, 0.75, 0, 1, 1]);
  check('4 freeze progress is flat across the zero stretch',
    cacheRetimerSpeedCurveProgress(freeze.speedCurve, 0.25) === 0.5
    && cacheRetimerSpeedCurveProgress(freeze.speedCurve, 0.5) === 0.5
    && cacheRetimerSpeedCurveProgress(freeze.speedCurve, 0.75) === 0.5);
  const f1 = cacheRetimerFrameFloat(freeze, FRAMES, FPS, 0.21, false);
  const f2 = cacheRetimerFrameFloat(freeze, FRAMES, FPS, 0.35, false);
  const f3 = cacheRetimerFrameFloat(freeze, FRAMES, FPS, 0.49, false);
  check('4 frame holds at 3.5 while time crosses the frozen stretch', f1 === 3.5 && f2 === 3.5 && f3 === 3.5,
    `${f1} ${f2} ${f3}`);
}

// ── 5. Duration preservation ──
{
  for (const [name, points] of [['ramp', [0, 0, 1, 2]], ['freeze', [0, 1, 0.25, 0, 0.75, 0, 1, 1]], ['ease-out', [0, 2, 1, 0]]]) {
    const curved = withCurve(points);
    check(`5 ${name}: at t = span/(fps*rate) = 0.7 the pass is exactly on the end frame`,
      cacheRetimerFrameFloat(curved, FRAMES, FPS, 0.7, false) === 7);
    check(`5 ${name}: just before (t=0.69) the end frame is not reached`,
      cacheRetimerFrameFloat(curved, FRAMES, FPS, 0.69, false) < 7);
  }
  const rampRate2 = withCurve([0, 0, 1, 2], { rate: 2 });
  check('5 rate 2 + ramp: t=0.175 -> frame 1.75 (same as rate 1 at t=0.35)',
    cacheRetimerFrameFloat(rampRate2, FRAMES, FPS, 0.175, false) === 1.75);
  check('5 rate 2 + ramp: pass ends at t=0.35 exactly',
    cacheRetimerFrameFloat(rampRate2, FRAMES, FPS, 0.35, false) === 7);
}

// ── 6. Reverse is the exact time mirror ──
{
  const fwd = withCurve([0, 0, 1, 2]);
  const rev = withCurve([0, 0, 1, 2], { reverse: true });
  const times = [0, 0.1, 0.23, 0.35, 0.5, 0.69];
  for (const loop of [true, false]) {
    check(`6 reverse mirrors forward (loop=${loop})`,
      times.every((t) => cacheRetimerFrameFloat(rev, FRAMES, FPS, t, loop)
        === 7 - cacheRetimerFrameFloat(fwd, FRAMES, FPS, t, loop)));
  }
  check('6 reverse at t=0 shows the end frame', cacheRetimerFrameFloat(rev, FRAMES, FPS, 0, false) === 7);
}

// ── 7. Loop wrap and segment composition ──
{
  const ramp = withCurve([0, 0, 1, 2]);
  check('7 loop t=0.8 completes the cycle -> frame 0', cacheRetimerFrameFloat(ramp, FRAMES, FPS, 0.8, true) === 0);
  check('7 loop t=0.9 -> frame 0.125', cacheRetimerFrameFloat(ramp, FRAMES, FPS, 0.9, true) === 0.125,
    String(cacheRetimerFrameFloat(ramp, FRAMES, FPS, 0.9, true)));
  const ff = cacheRetimerFrameFloat(ramp, FRAMES, FPS, 0.76, true);
  const bracket = cacheRetimerBracket(ramp, ff, true, 'linear');
  check('7 loop warped frame near the end brackets end->start wrap',
    bracket.i0 === 7 && bracket.i1 === 0 && ff > 7 && ff < 8, `ff=${ff} ${JSON.stringify(bracket)}`);
  const seg = withCurve([0, 0, 1, 2], { startFrame: 2, endFrame: 5 });
  check('7 segment [2,5] + ramp non-loop t=0.15 -> frame 2.75',
    cacheRetimerFrameFloat(seg, FRAMES, FPS, 0.15, false) === 2.75,
    String(cacheRetimerFrameFloat(seg, FRAMES, FPS, 0.15, false)));
  const nearest = withCurve([0, 0, 1, 2], { interpolation: 'nearest' });
  const nb = cacheRetimerBracket(nearest, cacheRetimerFrameFloat(nearest, FRAMES, FPS, 0.35, false), false, 'nearest');
  check('7 nearest override still snaps under the curve (frame 2)', nb.i0 === 2 && nb.i1 === 2);
}

// ── 8. Refusal: all-zero curve ──
{
  const r = resolveCacheRetimer({ ...BASE, speedCurveEnabled: true, speedCurvePoints: [0, 0, 1, 0] }, FRAMES);
  check('8 all-zero curve is refused with a reason', !r.ok && typeof r.error === 'string' && r.error.length > 0);
}

// ── 9. Config bridge ──
{
  const base = {
    pointCacheRetimerEnabled: true,
    pointCacheRetimerRate: 1,
    pointCacheRetimerStartFrame: 0,
    pointCacheRetimerEndFrame: -1,
    pointCacheRetimerReverse: false,
    pointCacheRetimerInterpolation: 'inherit',
    pointCacheRetimerSpeedCurveEnabled: false,
    pointCacheRetimerSpeedCurvePoints: [0, 1, 1, 1],
  };
  const off = resolveCacheRetimerFromConfig(base, FRAMES);
  check('9 curve keys off: resolved without a curve', off.ok && off.resolved !== null && off.resolved.speedCurve === null);
  const on = resolveCacheRetimerFromConfig(
    { ...base, pointCacheRetimerSpeedCurveEnabled: true, pointCacheRetimerSpeedCurvePoints: [0, 0, 1, 2] }, FRAMES);
  check('9 curve keys on: curve resolved through the bridge',
    on.ok && on.resolved !== null && on.resolved.speedCurve !== null
    && cacheRetimerFrameFloat(on.resolved, FRAMES, FPS, 0.35, false) === 1.75);
  const identityOn = resolveCacheRetimerFromConfig(
    { ...base, pointCacheRetimerSpeedCurveEnabled: true, pointCacheRetimerSpeedCurvePoints: [0, 1, 1, 1] }, FRAMES);
  check('9 curve on with identity points is still the identity retimer',
    identityOn.ok && identityOn.resolved !== null && isCacheRetimerIdentity(identityOn.resolved, FRAMES));
  const zero = resolveCacheRetimerFromConfig(
    { ...base, pointCacheRetimerSpeedCurveEnabled: true, pointCacheRetimerSpeedCurvePoints: [0, 0, 1, 0] }, FRAMES);
  check('9 all-zero curve through the bridge returns the reason', !zero.ok && zero.error.length > 0);
}

// ── 10. State cache through the same warped mapping ──
{
  const framesIn = [];
  for (let f = 0; f < FRAMES; f++) {
    const positions = new Float32Array(4 * 4);
    const velocities = new Float32Array(4 * 4);
    for (let i = 0; i < 4; i++) {
      positions[i * 4] = f * 10 + i;
      positions[i * 4 + 1] = f;
      positions[i * 4 + 2] = -f;
      positions[i * 4 + 3] = 0;
    }
    framesIn.push({ positions, velocities });
  }
  const assembled = assembleStateCache({ fps: FPS, texSize: 2, frames: framesIn });
  check('10 state cache assembles', assembled.ok);
  if (assembled.ok) {
    const converted = stateCacheToPointCacheData(assembled.cache);
    check('10 state cache converts', converted.ok);
    if (converted.ok) {
      const ramp = withCurve([0, 0, 1, 2]);
      const cloud = buildPointCacheCloud(converted.data, 0.35, false, ramp);
      check('10 state cache + ramp at t=0.35 blends frames 1/2 at 0.75 (x = 17.5)',
        cloud.positions[0] === 17.5, String(cloud.positions[0]));
    }
  }
}

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
