/**
 * Grammar 2.0 stage 2, slice B3 (Speed absolute setting /
 * per-particle relative drag / Spin channel): standalone
 * node test.
 *
 * Pins:
 *  1 resolution (lib/gpgpuSpeedDragSpin.ts): clamps at every
 *    boundary (target ≤ the 350 hard ceiling, blend [0,1],
 *    rate [0,100], wind speed [0,350], spin speed ±720 deg/s,
 *    random / damping ranges, slots normalised to -1..3) and
 *    the three activity predicates — all false at the
 *    defaults, so nothing about B3 is ever required of a
 *    stock config.
 *  2 the CPU twins against hand computation: the target-speed
 *    blend (hard set / partial / slot-scaled / zero velocity
 *    untouched / ceiling), the relative drag's exponential
 *    approach to the wind velocity (slot 0 = no pull), the
 *    wind velocity law (legacy direction keys + 0.0001,
 *    normalised, × the new speed key), and the spin law —
 *    accumulation (the angle actually advances with time,
 *    unlike the closed forms it replaces), damping applied
 *    to omega before the increment, the [0, 2π) wrap, the
 *    slot factor scaling the increment only, and the reset
 *    state (hash phase × 2π, omega = base × hash multiplier).
 *  3 the identity rule: the five stock shader strings
 *    (velocity / position / points vertex / points fragment /
 *    geometry vertex) keep their pre-B3 sha256 pins.
 *  4 texture-unit accounting measured from the built shader
 *    strings: the B3 velocity variants consume NO sampler
 *    (float/int uniforms only), so the velocity fragment
 *    stays at 16 units in every B3 combination; the spin
 *    draw variants add exactly one sampler each (points
 *    vertex 8 → 9, geometry vertex 2 → 3).
 *  5 the capability split: each active B3 feature requests
 *    its own id ('target-speed' / 'rel-drag' / 'spin-channel')
 *    and each is reported unsupported (WebGL fallback); the
 *    defaults request none of them.
 *  6 key registration: the 11 new keys sit at their defaults.
 */
import { build } from 'esbuild';
import { unlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.s2b3-bundle-${process.pid}.mjs`);
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
      export { resolveTargetSpeed, targetSpeedActive, applyTargetSpeed, resolveRelDrag, resolveRelDragWindVelocity, relDragActive, applyRelDrag, resolveSpin, spinChannelActive, spinPhaseHash, spinSpeedHash, spinSpeedMultiplier, spinInitialState, spinStep, b3SlotAttrActive, TAU, SPEED_HARD_CEILING } from './lib/gpgpuSpeedDragSpin.ts';
      export { buildVelocityFragment, SIM_VEL_FRAG } from './components/gpgpuShaderSimulationVelocity.ts';
      export { SIM_POS_FRAG } from './components/gpgpuShaderSimulationPosition.ts';
      export { buildMainForcesFragment, VEL_FRAG_FORCE_CHUNKS } from './components/gpgpuShaderSimulationVelocityMainForces.ts';
      export { buildDrawVert, buildDrawFrag, DRAW_VERT, DRAW_FRAG } from './components/gpgpuShaderPoints.ts';
      export { buildGeomVertShader, GEOM_VERT } from './components/gpgpuShaderVolumes.ts';
      export { SPIN_FRAG } from './components/gpgpuSpinPass.ts';
      export { getWebgpuComputeCapabilityReport } from './lib/webgpuComputeFoundation.ts';
      export { APP_STATE_DEFAULT_GPGPU } from './lib/appStateDefaultGpgpu.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, format: 'esm', platform: 'node', outfile: BUNDLE, logLevel: 'silent',
});
const lib = await import(pathToFileURL(BUNDLE).href);
unlinkSync(BUNDLE);
const {
  resolveTargetSpeed, targetSpeedActive, applyTargetSpeed, resolveRelDrag, resolveRelDragWindVelocity,
  relDragActive, applyRelDrag, resolveSpin, spinChannelActive, spinPhaseHash, spinSpeedHash,
  spinSpeedMultiplier, spinInitialState, spinStep, b3SlotAttrActive, TAU, SPEED_HARD_CEILING,
  buildVelocityFragment, SIM_VEL_FRAG, SIM_POS_FRAG, buildMainForcesFragment, VEL_FRAG_FORCE_CHUNKS,
  buildDrawVert, buildDrawFrag, DRAW_VERT, DRAW_FRAG, buildGeomVertShader, GEOM_VERT, SPIN_FRAG,
  getWebgpuComputeCapabilityReport, APP_STATE_DEFAULT_GPGPU: D,
} = lib;
const cfg = (over) => ({ ...D, ...over });

// --- 1. resolution + predicates --------------------------------------
{
  const t = resolveTargetSpeed(cfg({}));
  check('target speed resolves inert at defaults', t.speed === 0 && t.blend === 1 && t.slot === -1, JSON.stringify(t));
  check('target speed clamps to the 350 hard ceiling', resolveTargetSpeed(cfg({ gpgpuTargetSpeed: 9999 })).speed === SPEED_HARD_CEILING);
  check('target speed clamps negatives / non-finite to 0', resolveTargetSpeed(cfg({ gpgpuTargetSpeed: -5 })).speed === 0 && resolveTargetSpeed(cfg({ gpgpuTargetSpeed: NaN })).speed === 0);
  check('blend clamps to [0, 1]', resolveTargetSpeed(cfg({ gpgpuTargetSpeedBlend: 2 })).blend === 1 && resolveTargetSpeed(cfg({ gpgpuTargetSpeedBlend: -1 })).blend === 0);
  check('slot normalises out-of-range to -1', resolveTargetSpeed(cfg({ gpgpuTargetSpeedSlot: 9 })).slot === -1 && resolveTargetSpeed(cfg({ gpgpuTargetSpeedSlot: 2 })).slot === 2);
  check('targetSpeedActive only while positive', !targetSpeedActive(cfg({})) && targetSpeedActive(cfg({ gpgpuTargetSpeed: 0.5 })));

  const d = resolveRelDrag(cfg({}));
  check('rel drag resolves inert at defaults', d.rate === 0 && d.windSpeed === 30 && d.slot === -1, JSON.stringify(d));
  check('rel drag rate clamps to [0, 100]', resolveRelDrag(cfg({ gpgpuRelDragRate: 500 })).rate === 100 && resolveRelDrag(cfg({ gpgpuRelDragRate: -1 })).rate === 0);
  check('relDragActive only while rate > 0', !relDragActive(cfg({})) && relDragActive(cfg({ gpgpuRelDragRate: 0.1 })));

  const s = resolveSpin(cfg({}));
  check('spin resolves inert at defaults', s.speedRad === 0 && s.random === 0 && s.damping === 0 && s.slot === -1, JSON.stringify(s));
  check('spin speed converts deg→rad and clamps ±720', approx(resolveSpin(cfg({ gpgpuSpinSpeed: 180 })).speedRad, Math.PI) && approx(resolveSpin(cfg({ gpgpuSpinSpeed: 9999 })).speedRad, 4 * Math.PI));
  check('spinChannelActive only while enabled', !spinChannelActive(cfg({})) && spinChannelActive(cfg({ gpgpuSpinEnabled: true })));

  check('b3SlotAttrActive false at defaults', !b3SlotAttrActive(cfg({})));
  check('b3SlotAttrActive needs feature + slot together',
    b3SlotAttrActive(cfg({ gpgpuTargetSpeed: 10, gpgpuTargetSpeedSlot: 1 }))
    && !b3SlotAttrActive(cfg({ gpgpuTargetSpeed: 10 }))
    && !b3SlotAttrActive(cfg({ gpgpuTargetSpeedSlot: 1 }))
    && b3SlotAttrActive(cfg({ gpgpuRelDragRate: 2, gpgpuRelDragSlot: 0 }))
    && b3SlotAttrActive(cfg({ gpgpuSpinEnabled: true, gpgpuSpinSlot: 3 })));
}

// --- 2. CPU twins ------------------------------------------------------
{
  // Target speed: |(3,4,0)| = 5.
  const hard = applyTargetSpeed([3, 4, 0], 10, 1);
  check('target speed hard set scales to the target magnitude', approx(Math.hypot(...hard), 10) && approx(hard[0], 6) && approx(hard[1], 8), hard.join(','));
  const soft = applyTargetSpeed([3, 4, 0], 10, 0.5);
  check('target speed blend 0.5 lands halfway', approx(Math.hypot(...soft), 7.5), String(Math.hypot(...soft)));
  check('target speed leaves a zero velocity untouched (no direction)', applyTargetSpeed([0, 0, 0], 10, 1).join(',') === '0,0,0');
  const slotted = applyTargetSpeed([3, 4, 0], 10, 1, 0.5);
  check('target speed slot factor scales the target', approx(Math.hypot(...slotted), 5), String(Math.hypot(...slotted)));
  check('target speed never exceeds the hard ceiling', approx(Math.hypot(...applyTargetSpeed([3, 4, 0], 9999, 1)), 350));

  // Wind velocity law: zero direction keys → the +0.0001
  // epsilon direction, normalised, at the speed key.
  const wv = resolveRelDragWindVelocity(cfg({ gpgpuWindX: 0, gpgpuWindY: 0, gpgpuWindZ: 0, gpgpuRelDragWindSpeed: 30 }));
  check('wind velocity magnitude equals the speed key', approx(Math.hypot(wv.x, wv.y, wv.z), 30, 1e-6), String(Math.hypot(wv.x, wv.y, wv.z)));
  check('wind velocity follows the epsilon direction when keys are zero', approx(wv.x, wv.y, 1e-9) && approx(wv.y, wv.z, 1e-9));
  const wx = resolveRelDragWindVelocity(cfg({ gpgpuWindX: 1, gpgpuWindY: 0, gpgpuWindZ: 0, gpgpuRelDragWindSpeed: 10 }));
  check('wind velocity follows the direction keys', wx.x > 9.99 && Math.abs(wx.y) < 0.01, JSON.stringify(wx));

  // Relative drag: k = 1 − exp(−rate·dt) = 1 − exp(−1).
  const pulled = applyRelDrag([0, 0, 0], { x: 10, y: 0, z: 0 }, 2, 0.5);
  check('rel drag approaches the wind velocity exponentially', approx(pulled[0], 10 * (1 - Math.exp(-1)), 1e-9), String(pulled[0]));
  check('rel drag with slot factor 0 does not pull', applyRelDrag([1, 2, 3], { x: 10, y: 0, z: 0 }, 2, 0.5, 0).join(',') === '1,2,3');
  check('rel drag converges to the wind velocity', approx(applyRelDrag([0, 0, 0], { x: 10, y: 0, z: 0 }, 2, 100)[0], 10, 1e-6));

  // Spin hashes: range, determinism, decorrelation.
  let hashOk = true; let decorrelated = true;
  for (let i = 0; i < 64; i++) {
    const u = (i % 8) / 8; const v = Math.floor(i / 8) / 8;
    const p = spinPhaseHash(u, v); const h = spinSpeedHash(u, v);
    if (!(p >= 0 && p < 1 && h >= 0 && h < 1)) hashOk = false;
    if (p === h) decorrelated = false;
    if (spinPhaseHash(u, v) !== p) hashOk = false;
  }
  check('spin hashes are deterministic [0, 1) values', hashOk);
  check('phase and speed hashes are decorrelated', decorrelated);
  check('speed multiplier is exactly 1 at random 0', spinSpeedMultiplier(0.3, 0.7, 0) === 1);
  check('speed multiplier stays in [1−r, 1+r]', (() => { const m = spinSpeedMultiplier(0.3, 0.7, 0.5); return m >= 0.5 && m <= 1.5; })());

  // Spin state law.
  const spin = resolveSpin(cfg({ gpgpuSpinSpeed: 90 })); // π/2 rad/s
  const init = spinInitialState(0.25, 0.5, spin);
  check('spin reset state: angle = phase × 2π, omega = base rate', approx(init.angle, spinPhaseHash(0.25, 0.5) * TAU, 1e-12) && approx(init.omega, Math.PI / 2, 1e-12), JSON.stringify(init));
  let st = init;
  for (let i = 0; i < 60; i++) st = spinStep(st, 1 / 60, spin);
  check('spin accumulates: 60 steps of 1/60 s at 90°/s advance the angle by π/2',
    approx(st.angle, (init.angle + Math.PI / 2) % TAU, 1e-9) && approx(st.omega, Math.PI / 2, 1e-12), JSON.stringify(st));
  const damped = spinStep({ angle: 0, omega: 2 }, 0.5, resolveSpin(cfg({ gpgpuSpinDamping: 2 })));
  check('spin damping decays omega before the increment', approx(damped.omega, 2 * Math.exp(-1), 1e-12) && approx(damped.angle, 2 * Math.exp(-1) * 0.5, 1e-12), JSON.stringify(damped));
  const wrapped = spinStep({ angle: TAU - 0.1, omega: 1 }, 0.5, resolveSpin(cfg({})));
  check('spin angle wraps into [0, 2π)', approx(wrapped.angle, 0.4, 1e-12), String(wrapped.angle));
  const slotHeld = spinStep({ angle: 1, omega: 2 }, 0.5, resolveSpin(cfg({ gpgpuSpinDamping: 2 })), 0);
  check('spin slot factor 0 holds the angle but omega still decays (slot never enters the state)',
    slotHeld.angle === 1 && approx(slotHeld.omega, 2 * Math.exp(-1), 1e-12), JSON.stringify(slotHeld));
}

// --- 3. identity pins ----------------------------------------------------
{
  check('stock velocity fragment sha256 pin (pre-B3)', sha256(SIM_VEL_FRAG) === '5c1925996726e4f97ff037d8dccfeb848e63a8aca3e755a32736e84c5c49e637', sha256(SIM_VEL_FRAG));
  check('stock position fragment sha256 pin (pre-B3)', sha256(SIM_POS_FRAG) === 'f01a1a6ccd9e0df88a5ff7c91157e21607a5b2652790d5beb2148f156f3a1e49', sha256(SIM_POS_FRAG));
  check('stock points vertex sha256 pin (pre-B3)', sha256(DRAW_VERT) === '24ad38d4b2840ab2a41d4b9ee7e40727b6ded006a3cd8ac525ad2367b780b529', sha256(DRAW_VERT));
  check('stock points fragment sha256 pin (pre-B3)', sha256(DRAW_FRAG) === 'ca59f9933380321e9a686f7bd664409f96055bdf32f5e88ce1d01b9b606ad56c', sha256(DRAW_FRAG));
  check('stock geometry vertex sha256 pin (pre-B3)', sha256(GEOM_VERT) === '3123bc1869559b312371f2c821248d7fa836410ee6a2b11ce16c10b3ecc669fe', sha256(GEOM_VERT));
  check('default builders reproduce the stock strings', buildVelocityFragment('') === SIM_VEL_FRAG && buildDrawVert() === DRAW_VERT && buildDrawFrag() === DRAW_FRAG && buildGeomVertShader() === GEOM_VERT);
  check('stock strings carry no B3 identifiers', !SIM_VEL_FRAG.includes('uTargetSpeed') && !SIM_VEL_FRAG.includes('uRelDrag') && !DRAW_VERT.includes('uSpinTex') && !GEOM_VERT.includes('uSpinTex'));
}

// --- 4. variants + texture units -----------------------------------------
{
  check('velocity stock sampler count is 16', samplerCount(SIM_VEL_FRAG) === 16, String(samplerCount(SIM_VEL_FRAG)));
  const both = buildVelocityFragment('', undefined, { relDrag: true, targetSpeed: true });
  check('B3 velocity variant carries both features', both.includes('uRelDragWindVel') && both.includes('uniform float uTargetSpeed;') && both.includes(VEL_FRAG_FORCE_CHUNKS['rel-drag']));
  check('B3 velocity variant still measures 16 samplers (float/int uniforms only)', samplerCount(both) === 16, String(samplerCount(both)));
  const dragOnly = buildVelocityFragment('', undefined, { relDrag: true });
  check('rel-drag-only variant measures 16 samplers', samplerCount(dragOnly) === 16 && dragOnly.includes(VEL_FRAG_FORCE_CHUNKS['rel-drag']) && !dragOnly.includes('uTargetSpeed'));
  const targetOnly = buildVelocityFragment('', undefined, { targetSpeed: true });
  check('target-speed-only variant measures 16 samplers', samplerCount(targetOnly) === 16 && targetOnly.includes('uTargetSpeed') && !targetOnly.includes(VEL_FRAG_FORCE_CHUNKS['rel-drag']));
  check('default main-forces assembly excludes the rel-drag chunk', !buildMainForcesFragment().includes(VEL_FRAG_FORCE_CHUNKS['rel-drag']));
  check('rel-drag variant assembly includes the chunk exactly once', buildMainForcesFragment(undefined, { relDrag: true }).split(VEL_FRAG_FORCE_CHUNKS['rel-drag']).length === 2);

  const spinVert = buildDrawVert({ spinChannel: true });
  const spinFrag = buildDrawFrag({ spinChannel: true });
  check('points spin variant samples the state texture in the vertex', spinVert.includes('uniform sampler2D uSpinTex;') && spinVert.includes('vSpinAngle = texture2D(uSpinTex, particleUv).x;'));
  check('points spin variant replaces the analytic sprite rotation', spinFrag.includes('float spriteRotAngle = vSpinAngle;') && !spinFrag.includes('uSpriteRotSpeed * seedMul'));
  check('points vertex sampler count 8 → 9 with spin', samplerCount(DRAW_VERT) === 8 && samplerCount(spinVert) === 9, `${samplerCount(DRAW_VERT)} → ${samplerCount(spinVert)}`);
  const spinGeom = buildGeomVertShader({ spinChannel: true });
  check('geometry spin variant overrides the analytic angle with the state', spinGeom.includes('uniform sampler2D uSpinTex;') && spinGeom.includes('spinAng = texture2D(uSpinTex, aTexCoord).x;'));
  check('geometry vertex sampler count 2 → 3 with spin', samplerCount(GEOM_VERT) === 2 && samplerCount(spinGeom) === 3, `${samplerCount(GEOM_VERT)} → ${samplerCount(spinGeom)}`);
  check('spin pass fragment carries the state law', SPIN_FRAG.includes('uResetAll') && SPIN_FRAG.includes('exp(-uSpinDamping * uDelta)') && SPIN_FRAG.includes('mod(prev.x + omega * slotFactor * uDelta, 6.2831853)'));
}

// --- 5. capability ---------------------------------------------------------
{
  const idle = getWebgpuComputeCapabilityReport(cfg({}));
  check('defaults request no B3 feature', !idle.requestedFeatures.includes('target-speed') && !idle.requestedFeatures.includes('rel-drag') && !idle.requestedFeatures.includes('spin-channel'));
  const t = getWebgpuComputeCapabilityReport(cfg({ gpgpuTargetSpeed: 40 }));
  check("active target speed requests 'target-speed', unsupported", t.requestedFeatures.includes('target-speed') && t.unsupportedFeatures.includes('target-speed') && t.canRunRequestedConfig === false);
  const d = getWebgpuComputeCapabilityReport(cfg({ gpgpuRelDragRate: 2 }));
  check("active rel drag requests 'rel-drag', unsupported", d.requestedFeatures.includes('rel-drag') && d.unsupportedFeatures.includes('rel-drag') && d.canRunRequestedConfig === false);
  const s = getWebgpuComputeCapabilityReport(cfg({ gpgpuSpinEnabled: true }));
  check("enabled spin requests 'spin-channel', unsupported", s.requestedFeatures.includes('spin-channel') && s.unsupportedFeatures.includes('spin-channel') && s.canRunRequestedConfig === false);
}

// --- 6. key defaults -------------------------------------------------------
{
  check('11 B3 keys at inert defaults',
    D.gpgpuTargetSpeed === 0 && D.gpgpuTargetSpeedBlend === 1 && D.gpgpuTargetSpeedSlot === -1
    && D.gpgpuRelDragRate === 0 && D.gpgpuRelDragWindSpeed === 30 && D.gpgpuRelDragSlot === -1
    && D.gpgpuSpinEnabled === false && D.gpgpuSpinSpeed === 0 && D.gpgpuSpinRandom === 0
    && D.gpgpuSpinDamping === 0 && D.gpgpuSpinSlot === -1);
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
