// Grammar 2.0 stage 3, slice S2 — Retimer
// (lib/cacheRetimer.ts + the retimer parameter on
// buildPointCacheCloud in lib/pointCache.ts): the pure
// playback-side frame mapping. Verified here:
// - identity: an enabled retimer with the identity values
//   (rate 1, full range, forward, interpolation 'inherit')
//   reproduces the legacy frame choice AND the legacy
//   interpolated positions bit-exactly, for linear and
//   nearest manifests, looping and clamped;
// - rate: 2x / 0.5x pick exactly the frames the mapping
//   states (frame numbers measured, not eyeballed);
// - range: the segment start / end, its stretching under a
//   slower rate, and the loop wrap INSIDE the segment
//   (end frame interpolates back to the start frame);
// - reverse: starts at the segment end, walks backwards,
//   clamps / wraps at the segment start;
// - interpolation: 'inherit' keeps the manifest's
//   declaration, an explicit override replaces it — in
//   both directions (linear manifest + nearest override,
//   nearest manifest + linear override);
// - boundaries: non-loop clamps hold the segment end frame
//   exactly; a single-frame segment always yields that
//   frame;
// - refusals: inverted / out-of-range ranges, a zero /
//   negative / NaN rate, a non-integer frame and a zero
//   frame count are all refused with a reason;
// - the config bridge: disabled resolves to null (the
//   legacy path), enabled identity resolves and reports
//   identity, enabled invalid returns the reason;
// - both cache kinds: a state cache (S0) converted through
//   stateCacheToPointCacheData plays through the SAME
//   mapping as a point cache built from the same frames.
// Design: kalokagathia-pro/STAGE3_DESIGN.md §2 S2.
// NOT covered here (unconfirmed, real-browser check): the
// live driver's on-screen playback (rAF + sequence clock),
// and the panel wiring itself.
import { build } from 'esbuild';
import { unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.s3s2-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};

await build({
  stdin: {
    contents: `
      export { resolveCacheRetimer, resolveCacheRetimerFromConfig, cacheRetimerFrameFloat, cacheRetimerBracket, resolveCacheRetimerInterpolation, isCacheRetimerIdentity, CACHE_RETIMER_IDENTITY } from './lib/cacheRetimer.ts';
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
  cacheRetimerBracket, resolveCacheRetimerInterpolation, isCacheRetimerIdentity,
  CACHE_RETIMER_IDENTITY,
  buildPointCache, buildPointCacheCloud, pointCacheFrameFloat,
  assembleStateCache, stateCacheToPointCacheData,
} = lib;

const bits = (arr) => Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
const bitEqual = (a, b) => bits(a).equals(bits(b));
const R = (settings, frameCount = 8) => {
  const r = resolveCacheRetimer(settings, frameCount);
  if (!r.ok) throw new Error(`unexpected refusal: ${r.error}`);
  return r.resolved;
};
const IDENTITY = { rate: 1, startFrame: 0, endFrame: -1, reverse: false, interpolation: 'inherit' };

// Frame f of the fixture: point 0 at [f*10, f, -f],
// point 1 at [100 + f, 200, 300 - f] — every frame's
// positions are distinct and exactly representable.
const FRAMES = 8;
const FPS = 10;
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
const framePos = (f) => new Float32Array([f * 10, f, -f, 100 + f, 200, 300 - f]);

// ── 1. Identity: frame choice matches the legacy mapping ──
{
  const cache = makeCache('linear');
  const identity = R(IDENTITY);
  check('1 identity resolves as identity', isCacheRetimerIdentity(identity, FRAMES));
  check('1 identity end sentinel resolves to last frame', identity.endFrame === FRAMES - 1);
  const times = [0, 0.05, 0.13, 0.37, 0.75, 0.99, 1.3, 2.9];
  for (const loop of [true, false]) {
    const all = times.every((t) => cacheRetimerFrameFloat(identity, FRAMES, FPS, t, loop) === pointCacheFrameFloat(cache, t, loop));
    check(`1 identity frameFloat == legacy (loop=${loop})`, all);
  }
}

// ── 2. Identity: interpolated positions are bit-identical ──
{
  for (const interpolation of ['linear', 'nearest']) {
    const cache = makeCache(interpolation);
    const identity = R(IDENTITY);
    const times = [0, 0.05, 0.13, 0.37, 0.75, 0.99, 1.3, 2.9];
    for (const loop of [true, false]) {
      const all = times.every((t) => bitEqual(
        buildPointCacheCloud(cache, t, loop).positions,
        buildPointCacheCloud(cache, t, loop, identity).positions,
      ));
      check(`2 identity cloud bit-equal (${interpolation}, loop=${loop})`, all);
    }
    // No retimer argument at all is the same legacy path.
    const legacy = buildPointCacheCloud(cache, 0.37, true);
    check(`2 no-retimer cloud is the legacy cloud (${interpolation})`,
      bitEqual(legacy.positions, buildPointCacheCloud(cache, 0.37, true, null).positions));
  }
}

// ── 3. Rate: measured frame numbers ──
{
  const fast = R({ ...IDENTITY, rate: 2 });
  check('3 rate 2: t=0.10 -> frame 2', cacheRetimerFrameFloat(fast, FRAMES, FPS, 0.10, true) === 2);
  check('3 rate 2: t=0.25 -> frame 5', cacheRetimerFrameFloat(fast, FRAMES, FPS, 0.25, true) === 5);
  check('3 rate 2: non-loop t=1.0 clamps to frame 7', cacheRetimerFrameFloat(fast, FRAMES, FPS, 1.0, false) === 7);
  const slow = R({ ...IDENTITY, rate: 0.5 });
  check('3 rate 0.5: t=0.40 -> frame 2', cacheRetimerFrameFloat(slow, FRAMES, FPS, 0.40, true) === 2);
  check('3 rate 0.5: t=0.10 -> frame 0.5', cacheRetimerFrameFloat(slow, FRAMES, FPS, 0.10, true) === 0.5);
  const cache = makeCache('linear');
  const cloud = buildPointCacheCloud(cache, 0.10, true, fast);
  check('3 rate 2 cloud at t=0.10 is frame 2 exactly', bitEqual(cloud.positions, framePos(2)));
}

// ── 4. Range: segment mapping, stretching, segment wrap ──
{
  const seg = R({ rate: 1, startFrame: 2, endFrame: 5, reverse: false, interpolation: 'inherit' });
  check('4 range non-loop t=0 -> start frame 2', cacheRetimerFrameFloat(seg, FRAMES, FPS, 0, false) === 2);
  check('4 range non-loop t=0.10 -> frame 3', cacheRetimerFrameFloat(seg, FRAMES, FPS, 0.10, false) === 3);
  check('4 range non-loop t=0.30 -> end frame 5', cacheRetimerFrameFloat(seg, FRAMES, FPS, 0.30, false) === 5);
  check('4 range non-loop t=5 clamps at end frame 5', cacheRetimerFrameFloat(seg, FRAMES, FPS, 5, false) === 5);
  check('4 range loop t=0.40 wraps to start frame 2', cacheRetimerFrameFloat(seg, FRAMES, FPS, 0.40, true) === 2);
  check('4 range loop t=0.50 -> frame 3', cacheRetimerFrameFloat(seg, FRAMES, FPS, 0.50, true) === 3);
  const stretched = R({ rate: 0.5, startFrame: 2, endFrame: 5, reverse: false, interpolation: 'inherit' });
  check('4 range stretched by rate 0.5: t=0.60 -> end frame 5',
    cacheRetimerFrameFloat(stretched, FRAMES, FPS, 0.60, false) === 5);
  const cache = makeCache('linear');
  check('4 range cloud at t=0 is frame 2 exactly',
    bitEqual(buildPointCacheCloud(cache, 0, false, seg).positions, framePos(2)));
  // Segment loop wrap interpolation: t=0.35 sits halfway
  // between the end frame (5) and the wrapped start (2).
  const wrapCloud = buildPointCacheCloud(cache, 0.35, true, seg);
  check('4 segment wrap interpolates end->start (x = 35)', wrapCloud.positions[0] === 35,
    `x=${wrapCloud.positions[0]}`);
  const bracket = cacheRetimerBracket(seg, 5.5, true, 'linear');
  check('4 bracket at 5.5 wraps i1 to the segment start',
    bracket.i0 === 5 && bracket.i1 === 2 && bracket.frac === 0.5);
}

// ── 5. Reverse ──
{
  const rev = R({ rate: 1, startFrame: 2, endFrame: 5, reverse: true, interpolation: 'inherit' });
  check('5 reverse non-loop t=0 -> end frame 5', cacheRetimerFrameFloat(rev, FRAMES, FPS, 0, false) === 5);
  check('5 reverse non-loop t=0.20 -> frame 3', cacheRetimerFrameFloat(rev, FRAMES, FPS, 0.20, false) === 3);
  check('5 reverse non-loop t=1 clamps at start frame 2', cacheRetimerFrameFloat(rev, FRAMES, FPS, 1, false) === 2);
  check('5 reverse loop t=0.40 completes the cycle -> frame 5', cacheRetimerFrameFloat(rev, FRAMES, FPS, 0.40, true) === 5);
  check('5 reverse loop t=0.50 -> frame 4', cacheRetimerFrameFloat(rev, FRAMES, FPS, 0.50, true) === 4);
  const cache = makeCache('linear');
  check('5 reverse cloud at t=0 is frame 5 exactly',
    bitEqual(buildPointCacheCloud(cache, 0, false, rev).positions, framePos(5)));
  // Reverse + loop wrap: halfway from the start frame
  // backwards wraps to the end frame side.
  const wrapBracket = cacheRetimerBracket(rev, 1.5, true, 'linear');
  check('5 reverse wrap bracket interpolates start<-end',
    wrapBracket.i0 === 5 && wrapBracket.i1 === 2 && wrapBracket.frac === 0.5,
    JSON.stringify(wrapBracket));
}

// ── 6. Interpolation: inherit vs override, both ways ──
{
  const linearCache = makeCache('linear');
  const nearestCache = makeCache('nearest');
  const nearestOverride = R({ ...IDENTITY, interpolation: 'nearest' });
  const linearOverride = R({ ...IDENTITY, interpolation: 'linear' });
  // t=0.15 -> frameFloat 1.5, exactly between frames 1 and 2.
  check('6 linear manifest + inherit at 1.5 blends (x = 15)',
    buildPointCacheCloud(linearCache, 0.15, true).positions[0] === 15);
  check('6 linear manifest + nearest override at 1.5 snaps to frame 2 (x = 20)',
    buildPointCacheCloud(linearCache, 0.15, true, nearestOverride).positions[0] === 20);
  check('6 nearest manifest + inherit at 1.5 snaps to frame 2 (x = 20)',
    buildPointCacheCloud(nearestCache, 0.15, true).positions[0] === 20);
  check('6 nearest manifest + linear override at 1.5 blends (x = 15)',
    buildPointCacheCloud(nearestCache, 0.15, true, linearOverride).positions[0] === 15);
  check('6 resolution: inherit keeps the manifest declaration',
    resolveCacheRetimerInterpolation(R(IDENTITY), 'nearest') === 'nearest'
    && resolveCacheRetimerInterpolation(nearestOverride, 'linear') === 'nearest');
  // Nearest below the half-way point snaps down.
  check('6 nearest at frameFloat 2.4 picks frame 2',
    cacheRetimerBracket(nearestOverride, 2.4, true, 'nearest').i0 === 2);
}

// ── 7. Boundaries ──
{
  const cache = makeCache('linear');
  const identity = R(IDENTITY);
  check('7 non-loop far-future holds the last frame exactly',
    bitEqual(buildPointCacheCloud(cache, 100, false, identity).positions, framePos(7)));
  check('7 legacy non-loop far-future agrees',
    bitEqual(buildPointCacheCloud(cache, 100, false).positions, framePos(7)));
  const single = R({ rate: 1, startFrame: 3, endFrame: 3, reverse: false, interpolation: 'inherit' });
  const singleBracket = cacheRetimerBracket(single, cacheRetimerFrameFloat(single, FRAMES, FPS, 0.35, true), true, 'linear');
  check('7 single-frame segment brackets only itself',
    singleBracket.i0 === 3 && singleBracket.i1 === 3);
  check('7 single-frame segment cloud is frame 3 at any time',
    bitEqual(buildPointCacheCloud(cache, 0.35, true, single).positions, framePos(3))
    && bitEqual(buildPointCacheCloud(cache, 2.9, false, single).positions, framePos(3)));
  const neg = R(IDENTITY);
  check('7 negative clock time reads as time 0',
    cacheRetimerFrameFloat(neg, FRAMES, FPS, -3, true) === pointCacheFrameFloat(cache, -3, true));
}

// ── 8. Refusals ──
{
  const bad = [
    ['start after end', { rate: 1, startFrame: 5, endFrame: 2, reverse: false, interpolation: 'inherit' }, 8],
    ['start out of range', { rate: 1, startFrame: 8, endFrame: -1, reverse: false, interpolation: 'inherit' }, 8],
    ['negative start', { rate: 1, startFrame: -1, endFrame: -1, reverse: false, interpolation: 'inherit' }, 8],
    ['end out of range', { rate: 1, startFrame: 0, endFrame: 8, reverse: false, interpolation: 'inherit' }, 8],
    ['end below the -1 sentinel', { rate: 1, startFrame: 0, endFrame: -2, reverse: false, interpolation: 'inherit' }, 8],
    ['non-integer start', { rate: 1, startFrame: 1.5, endFrame: -1, reverse: false, interpolation: 'inherit' }, 8],
    ['rate zero', { rate: 0, startFrame: 0, endFrame: -1, reverse: false, interpolation: 'inherit' }, 8],
    ['rate negative', { rate: -1, startFrame: 0, endFrame: -1, reverse: false, interpolation: 'inherit' }, 8],
    ['rate NaN', { rate: NaN, startFrame: 0, endFrame: -1, reverse: false, interpolation: 'inherit' }, 8],
    ['bad interpolation', { rate: 1, startFrame: 0, endFrame: -1, reverse: false, interpolation: 'smooth' }, 8],
    ['zero frame count', { rate: 1, startFrame: 0, endFrame: -1, reverse: false, interpolation: 'inherit' }, 0],
  ];
  for (const [name, settings, frameCount] of bad) {
    const r = resolveCacheRetimer(settings, frameCount);
    check(`8 refused: ${name}`, !r.ok && typeof r.error === 'string' && r.error.length > 0);
  }
}

// ── 9. Config bridge ──
{
  const base = {
    pointCacheRetimerEnabled: false,
    pointCacheRetimerRate: 1,
    pointCacheRetimerStartFrame: 0,
    pointCacheRetimerEndFrame: -1,
    pointCacheRetimerReverse: false,
    pointCacheRetimerInterpolation: 'inherit',
  };
  const disabled = resolveCacheRetimerFromConfig(base, FRAMES);
  check('9 disabled config resolves to null (legacy path)', disabled.ok && disabled.resolved === null);
  const enabled = resolveCacheRetimerFromConfig({ ...base, pointCacheRetimerEnabled: true }, FRAMES);
  check('9 enabled identity config resolves and is identity',
    enabled.ok && enabled.resolved !== null && isCacheRetimerIdentity(enabled.resolved, FRAMES));
  const invalid = resolveCacheRetimerFromConfig(
    { ...base, pointCacheRetimerEnabled: true, pointCacheRetimerRate: 0 }, FRAMES);
  check('9 enabled invalid config returns the reason', !invalid.ok && invalid.error.length > 0);
  check('9 identity constant matches the config defaults',
    CACHE_RETIMER_IDENTITY.rate === base.pointCacheRetimerRate
    && CACHE_RETIMER_IDENTITY.startFrame === base.pointCacheRetimerStartFrame
    && CACHE_RETIMER_IDENTITY.endFrame === base.pointCacheRetimerEndFrame
    && CACHE_RETIMER_IDENTITY.reverse === base.pointCacheRetimerReverse
    && CACHE_RETIMER_IDENTITY.interpolation === base.pointCacheRetimerInterpolation);
}

// ── 10. Both cache kinds through the same mapping ──
{
  // A state cache whose frames encode the frame index the
  // same way as the point-cache fixture (texSize 2 = 4
  // points; point i of frame f at x = f*10 + i).
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
    check('10 state cache converts to the point-cache shape', converted.ok);
    if (converted.ok) {
      const rev = R({ rate: 1, startFrame: 0, endFrame: -1, reverse: true, interpolation: 'inherit' });
      const cloud = buildPointCacheCloud(converted.data, 0, false, rev);
      check('10 state cache + reverse retimer at t=0 shows its last frame',
        cloud.positions[0] === 70 && cloud.positions[3] === 71 && cloud.positions[1] === 7,
        `positions[0..3]=${[...cloud.positions.slice(0, 4)].join(',')}`);
      const identity = R(IDENTITY);
      const all = [0, 0.13, 0.75, 2.9].every((t) => cacheRetimerFrameFloat(identity, FRAMES, FPS, t, true)
        === pointCacheFrameFloat(converted.data, t, true));
      check('10 converted cache reads the identity mapping like a point cache', all);
    }
  }
}

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
