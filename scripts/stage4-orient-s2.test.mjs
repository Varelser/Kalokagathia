// Limit plan stage 4, slice S2 — Orientation channel
// (STAGE4_DESIGN_MATERIALS §2, posture 案A): a full quaternion
// posture accumulated in a dedicated ping-pong RT pair
// (components/gpgpuOrientPass.ts), resolved by
// lib/gpgpuOrient.ts, consumed innermost by the
// instanced-geometry vertex (align ∘ spin ∘ orient).
//
// What is pinned here (node side):
//  (a) Analytic angle (gate G4-1 (a) pre-run): with damping 0
//      and random 0 the CPU twin's accumulated angle after N
//      steps equals omega × elapsed time within 2% relative
//      (in practice exact — same-axis increments compose
//      additively), about the fixed Y axis.
//  (b) Normalisation: the quaternion stays unit-length over
//      long runs, mixed-axis velocity mode included, and the
//      matrix form (quatToMat3Columns, the GLSL helper's twin)
//      rotates vectors exactly like quatRotateVec.
//  (c) Modulations: damping decays the increment by
//      exp(−damping · t) (age clock and elapsed clock),
//      random spreads per-particle rates via the shared hash
//      multiplier, the slot factor scales the increment only,
//      velocity mode takes its axis from the velocity and a
//      zero velocity takes no increment. Reset state is the
//      identity posture exactly; the step law is
//      deterministic (same inputs → identical state).
//  (d) Byte-identity at the defaults: the channel is off at
//      the defaults, the stock geometry vertex string keeps
//      its pre-S2 sha256 pin, buildGeomVert('') returns it
//      unchanged, no uOrientTex appears in any stock string,
//      and the orient variant adds exactly one sampler
//      (geometry vertex 2 → 3). The velocity fragment is
//      never touched by this slice (its string is not built
//      here at all — the pass output is not a velocity input).
//  (e) Capability split: an enabled channel requests
//      'orient-channel' and it is reported unsupported
//      (WebGL fallback); the defaults request nothing.
//  (f) Key registration: the 6 new keys sit at their defaults.
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { readFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.s4s2-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};
const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const samplerCount = (s) => (s.match(/uniform sampler[23]D /g) || []).length;
const approx = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

await build({
  stdin: {
    contents: `
      export { resolveOrient, resolveOrientMode, orientChannelActive, orientInitialState, orientOmega, orientStep, quatIdentity, quatNormalize, quatMultiply, quatFromAxisAngle, quatRotateVec, quatToMat3Columns, quatAngle, clampOrientSpeedRad, ORIENT_FIXED_AXIS } from './lib/gpgpuOrient.ts';
      export { spinSpeedMultiplier } from './lib/gpgpuSpeedDragSpin.ts';
      export { buildGeomVertShader, buildGeomVert, GEOM_VERT } from './components/gpgpuShaderVolumes.ts';
      export { ORIENT_FRAG } from './components/gpgpuOrientPass.ts';
      export { orientChannelVariantOn, spinChannelVariantOn } from './components/useGpgpuDrawAssets.ts';
      export { getWebgpuComputeCapabilityReport } from './lib/webgpuComputeFoundation.ts';
      export { DEFAULT_CONFIG } from './lib/appStateConfigDefaults.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});
try {
  const m = await import(pathToFileURL(BUNDLE).href);
  const {
    resolveOrient, orientChannelActive, orientInitialState, orientOmega, orientStep,
    quatMultiply, quatFromAxisAngle, quatRotateVec, quatToMat3Columns, quatAngle,
    spinSpeedMultiplier, buildGeomVertShader, buildGeomVert, GEOM_VERT, ORIENT_FRAG,
    orientChannelVariantOn, getWebgpuComputeCapabilityReport, DEFAULT_CONFIG,
  } = m;
  const cfg = (patch) => ({ ...DEFAULT_CONFIG, ...patch });
  const resolved = (patch) => resolveOrient(cfg(patch));

  // ── (f) registration & resolution ──────────────────────
  check('defaults: channel off', DEFAULT_CONFIG.gpgpuOrientEnabled === false && orientChannelActive(DEFAULT_CONFIG) === false);
  check('defaults: mode/speed/random/damping/slot', DEFAULT_CONFIG.gpgpuOrientMode === 'axis'
    && DEFAULT_CONFIG.gpgpuOrientSpeed === 1 && DEFAULT_CONFIG.gpgpuOrientRandom === 0
    && DEFAULT_CONFIG.gpgpuOrientDamping === 0 && DEFAULT_CONFIG.gpgpuOrientSlot === -1,
    JSON.stringify({ mode: DEFAULT_CONFIG.gpgpuOrientMode, speed: DEFAULT_CONFIG.gpgpuOrientSpeed }));
  check('resolve: unknown mode falls back to axis', resolved({ gpgpuOrientMode: 'spin-align' }).mode === 'axis');
  check('resolve: speed clamp ±4π rad/s', resolved({ gpgpuOrientSpeed: 999 }).speedRad === Math.PI * 4
    && resolved({ gpgpuOrientSpeed: -999 }).speedRad === -Math.PI * 4
    && resolved({ gpgpuOrientSpeed: NaN }).speedRad === 0);
  check('resolve: random/damping clamps', resolved({ gpgpuOrientRandom: 7 }).random === 1
    && resolved({ gpgpuOrientDamping: -2 }).damping === 0 && resolved({ gpgpuOrientDamping: 99 }).damping === 10);
  check('resolve: slot normalised', resolved({ gpgpuOrientSlot: 2 }).slot === 2 && resolved({ gpgpuOrientSlot: 9 }).slot === -1);

  // ── reset / determinism ────────────────────────────────
  const init = orientInitialState();
  check('reset state is the identity posture exactly', init.quat[0] === 0 && init.quat[1] === 0 && init.quat[2] === 0 && init.quat[3] === 1 && init.elapsed === 0);
  const oA = resolved({ gpgpuOrientEnabled: true, gpgpuOrientSpeed: 1.3, gpgpuOrientRandom: 0.5 });
  let s1 = orientInitialState();
  let s2 = orientInitialState();
  for (let i = 0; i < 37; i++) {
    s1 = orientStep(s1, 1 / 60, oA, { u: 0.25, v: 0.75 });
    s2 = orientStep(s2, 1 / 60, oA, { u: 0.25, v: 0.75 });
  }
  check('determinism: identical runs give identical state', s1.quat.every((v, i) => v === s2.quat[i]) && s1.elapsed === s2.elapsed);

  // ── (a) analytic angle ─────────────────────────────────
  const oPlain = resolved({ gpgpuOrientEnabled: true, gpgpuOrientSpeed: 0.9 });
  let st = orientInitialState();
  const N = 50;
  const DT = 1 / 60;
  for (let i = 0; i < N; i++) st = orientStep(st, DT, oPlain, { u: 0.3, v: 0.6 });
  const analytic = 0.9 * N * DT; // 0.75 rad < π, no wrap ambiguity
  const got = quatAngle(st.quat);
  check('(a) accumulated angle matches omega × time within 2%', Math.abs(got - analytic) / analytic <= 0.02, `got ${got}, analytic ${analytic}`);
  check('(a) rotation is about +Y: x/z stay 0, y = sin(angle/2)', approx(st.quat[0], 0, 1e-12) && approx(st.quat[2], 0, 1e-12)
    && approx(st.quat[1], Math.sin(analytic / 2), 1e-9) && approx(st.quat[3], Math.cos(analytic / 2), 1e-9),
    JSON.stringify(st.quat));
  check('(a) negative speed rotates the other way', (() => {
    let sn = orientInitialState();
    const oNeg = resolved({ gpgpuOrientEnabled: true, gpgpuOrientSpeed: -0.9 });
    for (let i = 0; i < N; i++) sn = orientStep(sn, DT, oNeg, {});
    return sn.quat[1] < 0 && approx(quatAngle(sn.quat), analytic, 1e-9);
  })());

  // ── (b) normalisation & matrix twin ────────────────────
  let sm = orientInitialState();
  const oVel = resolved({ gpgpuOrientEnabled: true, gpgpuOrientMode: 'velocity', gpgpuOrientSpeed: 2.1, gpgpuOrientRandom: 0.4 });
  for (let i = 0; i < 2000; i++) {
    const vel = [Math.sin(i * 0.7), Math.cos(i * 1.3), Math.sin(i * 0.31 + 2)];
    sm = orientStep(sm, 1 / 60, oVel, { u: 0.11, v: 0.87, vel });
  }
  const qlen = Math.hypot(...sm.quat);
  check('(b) quaternion stays unit over 2000 mixed-axis steps', approx(qlen, 1, 1e-9), `len ${qlen}`);
  const cols = quatToMat3Columns(sm.quat);
  const applyMat = (v) => [
    cols[0] * v[0] + cols[3] * v[1] + cols[6] * v[2],
    cols[1] * v[0] + cols[4] * v[1] + cols[7] * v[2],
    cols[2] * v[0] + cols[5] * v[1] + cols[8] * v[2],
  ];
  let matOk = true;
  for (const v of [[1, 0, 0], [0, 1, 0], [0, 0, 1], [0.3, -0.7, 1.1]]) {
    const a = quatRotateVec(sm.quat, v);
    const b = applyMat(v);
    if (!a.every((x, i) => approx(x, b[i], 1e-9))) matOk = false;
  }
  check('(b) quatToMat3Columns rotates exactly like quatRotateVec', matOk);
  const q90 = quatFromAxisAngle([0, 1, 0], Math.PI / 2);
  const rotated = quatRotateVec(q90, [0, 0, 1]);
  check('(b) +90° about Y maps +Z to +X', approx(rotated[0], 1, 1e-12) && approx(rotated[1], 0, 1e-12) && approx(rotated[2], 0, 1e-12), JSON.stringify(rotated));
  const qq = quatMultiply(q90, q90);
  check('(b) Hamilton composition: 90° ⊗ 90° = 180° about Y', approx(quatAngle(qq), Math.PI, 1e-12) && approx(Math.abs(qq[1]), 1, 1e-12));

  // ── (c) modulations ────────────────────────────────────
  // Damping, elapsed clock: increments shrink by exp(−d·t);
  // total angle < undamped total and matches the left-Riemann
  // sum of the decayed rate (the step law's own quadrature).
  const oDamp = resolved({ gpgpuOrientEnabled: true, gpgpuOrientSpeed: 1, gpgpuOrientDamping: 0.8 });
  let sd = orientInitialState();
  let expect = 0;
  for (let i = 0; i < 60; i++) {
    expect += Math.exp(-0.8 * sd.elapsed) * (1 / 60);
    sd = orientStep(sd, 1 / 60, oDamp, {});
  }
  check('(c) damping (elapsed clock): angle = Σ exp(−d·t)·dt', approx(quatAngle(sd.quat), expect, 1e-9), `got ${quatAngle(sd.quat)} expect ${expect}`);
  check('(c) damping (age clock): age overrides elapsed', approx(orientOmega(oDamp, 0, 0, 2), Math.exp(-1.6), 1e-12)
    && (() => { const sAge = orientStep(orientInitialState(), 0.5, oDamp, { age: 2 }); return approx(quatAngle(sAge.quat), Math.exp(-1.6) * 0.5, 1e-9); })());
  // Random: per-particle multiplier is the shared Spin hash form.
  const oRand = resolved({ gpgpuOrientEnabled: true, gpgpuOrientSpeed: 1, gpgpuOrientRandom: 0.6 });
  check('(c) random multiplier is spinSpeedMultiplier (shared hash)', orientOmega(oRand, 0.13, 0.42, 0) === spinSpeedMultiplier(0.13, 0.42, 0.6));
  let r1 = orientInitialState();
  let r2 = orientInitialState();
  for (let i = 0; i < 30; i++) {
    r1 = orientStep(r1, 1 / 60, oRand, { u: 0.13, v: 0.42 });
    r2 = orientStep(r2, 1 / 60, oRand, { u: 0.91, v: 0.05 });
  }
  check('(c) random spreads per-particle angles', Math.abs(quatAngle(r1.quat) - quatAngle(r2.quat)) > 0.01,
    `${quatAngle(r1.quat)} vs ${quatAngle(r2.quat)}`);
  // Slot factor scales the increment only.
  const sSlot = orientStep(orientInitialState(), 0.25, oPlain, { slotFactor: 2 });
  const sNoSlot = orientStep(orientInitialState(), 0.25, oPlain, {});
  check('(c) slot factor scales the increment', approx(quatAngle(sSlot.quat), 2 * quatAngle(sNoSlot.quat), 1e-9));
  check('(c) slot factor 0 freezes the posture', quatAngle(orientStep(orientInitialState(), 0.25, oPlain, { slotFactor: 0 }).quat) === 0);
  // Velocity mode axis / zero velocity.
  const sVel = orientStep(orientInitialState(), 0.2, resolved({ gpgpuOrientEnabled: true, gpgpuOrientMode: 'velocity', gpgpuOrientSpeed: 1 }), { vel: [0, 0, 5] });
  check('(c) velocity mode rotates about the velocity axis (+Z)', approx(sVel.quat[2], Math.sin(0.1), 1e-12) && approx(sVel.quat[0], 0, 1e-12) && approx(sVel.quat[1], 0, 1e-12));
  const sZero = orientStep(orientInitialState(), 0.2, resolved({ gpgpuOrientEnabled: true, gpgpuOrientMode: 'velocity', gpgpuOrientSpeed: 1 }), { vel: [0, 0, 0] });
  check('(c) velocity mode: zero velocity takes no increment', sZero.quat[3] === 1 && quatAngle(sZero.quat) === 0);
  // GLSL twin carries the same law's pieces.
  check('(c) ORIENT_FRAG carries the step law (hash, quat mul, mode, reset identity)',
    ORIENT_FRAG.includes('kaloOrientSpeedHash') && ORIENT_FRAG.includes('kaloOrientQuatMul')
    && ORIENT_FRAG.includes('uOrientMode') && ORIENT_FRAG.includes('vec4(0.0, 0.0, 0.0, 1.0)')
    && ORIENT_FRAG.includes('exp(-uOrientDamping * tState)'));

  // ── (d) byte-identity at defaults ──────────────────────
  check('(d) variant predicate off at defaults', orientChannelVariantOn(DEFAULT_CONFIG) === false
    && orientChannelVariantOn(cfg({ gpgpuOrientEnabled: true })) === true);
  check('(d) stock GEOM_VERT keeps its pre-S2 sha256 pin', sha256(GEOM_VERT) === '3123bc1869559b312371f2c821248d7fa836410ee6a2b11ce16c10b3ecc669fe', sha256(GEOM_VERT));
  check('(d) buildGeomVert(\'\') returns the stock string unchanged', buildGeomVert('') === GEOM_VERT);
  check('(d) no uOrientTex / kaloQuatMat3 in the stock string', !GEOM_VERT.includes('uOrientTex') && !GEOM_VERT.includes('kaloQuatMat3'));
  const orientVert = buildGeomVertShader({ orientChannel: true });
  check('(d) orient variant adds exactly one sampler (2 → 3)', samplerCount(GEOM_VERT) === 2 && samplerCount(orientVert) === 3,
    `${samplerCount(GEOM_VERT)} → ${samplerCount(orientVert)}`);
  check('(d) orient variant composes innermost (align ∘ spin ∘ orient)',
    orientVert.includes('totalRot = totalRot * kaloQuatMat3(texture2D(uOrientTex, aTexCoord));')
    && orientVert.indexOf('mat3 totalRot = rot * spin;') < orientVert.indexOf('totalRot = totalRot * kaloQuatMat3'));
  const bothVert = buildGeomVertShader({ spinChannel: true, orientChannel: true });
  check('(d) spin + orient variants coexist (+1 sampler each)', samplerCount(bothVert) === 4 && bothVert.includes('uSpinTex') && bothVert.includes('uOrientTex'));
  // Wiring pins (source text): the scene mounts the pass only
  // while the channel stands, the mesh assets rebuild the
  // variant string on the enable key, and the visual sync
  // binds the texture to the geometry material only.
  const sceneSrc = readFileSync(join(ROOT, 'components', 'sceneGpgpuSystem.tsx'), 'utf8');
  const meshSrc = readFileSync(join(ROOT, 'components', 'useGpgpuMeshAssets.ts'), 'utf8');
  const visualSrc = readFileSync(join(ROOT, 'components', 'gpgpuVisualUpdates.ts'), 'utf8');
  check('(d) wiring: scene runs GpgpuOrientPass while active (WebGL only)',
    sceneSrc.includes('new GpgpuOrientPass(texSize)') && sceneSrc.includes('orientChannelActive(config) && !routing.useWebGPU')
    && sceneSrc.includes('captureOrientStats'));
  check('(d) wiring: mesh assets rebuild on gpgpuOrientEnabled with the orient variant',
    meshSrc.includes('orientChannel: orient') && meshSrc.includes('config.gpgpuOrientEnabled') && meshSrc.includes('uOrientTex:'));
  check('(d) wiring: visual sync binds uOrientTex on the geometry material only',
    visualSrc.includes('geomMat.uniforms.uOrientTex') && !visualSrc.includes('drawMat.uniforms.uOrientTex'));

  // ── (e) capability split ───────────────────────────────
  const supOff = getWebgpuComputeCapabilityReport(DEFAULT_CONFIG);
  check('(e) defaults request no orient feature', !supOff.requestedFeatures.includes('orient-channel') && supOff.canRunRequestedConfig);
  const supOn = getWebgpuComputeCapabilityReport(cfg({ gpgpuOrientEnabled: true }));
  check('(e) enabled channel requests orient-channel, reported unsupported (WebGL fallback)',
    supOn.requestedFeatures.includes('orient-channel') && supOn.unsupportedFeatures.includes('orient-channel') && !supOn.canRunRequestedConfig);

  console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
  process.exitCode = failures === 0 ? 0 : 1;
} finally {
  try { unlinkSync(BUNDLE); } catch { /* already gone */ }
}
