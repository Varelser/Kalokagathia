// Phase 20 stage 2 — crowd steering GPU wiring tests.
//
// lib/steering.ts (Phase 18) was a pure-function preparation;
// stage 2 wires it into the velocity pass as the 'steer-seek'
// force (GLSL chunk + WGSL twin), behind the Phase 20 shader
// variant in the Phase 19 manner. These tests pin:
//
// - OFF identity: the default shader strings stay at their
//   shipped pins (scripts/phase18-shader-hash.baseline.json),
//   the steering text appears nowhere in them, and the new
//   Phase 20 strings match their new pins.
// - Force order: 'steer-seek' is registered (last), the
//   variant-off builder skips it wherever the order names it,
//   and the variant-on builder places it by the order.
// - Key defaults + the single resolution point
//   (resolveSteeringSeek): defaults are inert, clamps hold,
//   the path key parses / packs as documented.
// - Semantics: the GLSL chunk carries steering.ts's formulas
//   verbatim (structural checks), and steering.ts's own numeric
//   behaviour matches the formulas the chunk encodes (seek at
//   the target = -vel, arrive's linear ramp, the path target's
//   look-ahead walk, stateFromSlot's threshold rule).
// - WGSL twin: the uniform struct carries the steering set at
//   the documented indices and the block mirrors the law.
// - Attribute consumers: state mode registers as a velocity
//   slot consumer so the attribute texture is built for it.
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { readFileSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.p20steer-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
const sha = (s) => createHash('sha256').update(s, 'utf8').digest('hex');

await build({
  stdin: {
    contents: `
      export {
        seekForce, arriveForce, pathFollowTarget, pathFollowForce,
        stateFromSlot, steeringForState, parseSteeringPath, packSteeringPath,
        resolveSteeringSeek, STEER_SEEK_MODE_IDS, STEERING_PATH_MAX,
      } from './lib/steering.ts';
      export { GPGPU_FORCE_CHUNK_NAMES, normalizeGpgpuForceOrder } from './lib/gpgpuForceOrder.ts';
      export { resolveAttrConsumers } from './lib/gpgpuAttributes.ts';
      export { DEFAULT_CONFIG } from './lib/appStateConfigDefaults.ts';
      export {
        SIM_VEL_FRAG, SIM_VEL_FRAG_PHASE19, SIM_VEL_FRAG_PHASE20, buildVelocityFragment,
      } from './components/gpgpuShaderSimulationVelocity.ts';
      export { VEL_FRAG_PREAMBLE, VEL_FRAG_PREAMBLE_PHASE20 } from './components/gpgpuShaderSimulationVelocityPreamble.ts';
      export {
        VEL_FRAG_MAIN_FORCES, VEL_FRAG_FORCE_CHUNKS, VEL_FRAG_FORCE_STEER_SEEK, buildMainForcesFragment,
      } from './components/gpgpuShaderSimulationVelocityMainForces.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});
const lib = await import(pathToFileURL(BUNDLE).href);
unlinkSync(BUNDLE);
const {
  seekForce, arriveForce, pathFollowTarget, pathFollowForce,
  stateFromSlot, steeringForState, parseSteeringPath, packSteeringPath,
  resolveSteeringSeek, STEER_SEEK_MODE_IDS, STEERING_PATH_MAX,
  GPGPU_FORCE_CHUNK_NAMES, normalizeGpgpuForceOrder, resolveAttrConsumers,
  DEFAULT_CONFIG,
  SIM_VEL_FRAG, SIM_VEL_FRAG_PHASE19, SIM_VEL_FRAG_PHASE20, buildVelocityFragment,
  VEL_FRAG_PREAMBLE, VEL_FRAG_PREAMBLE_PHASE20,
  VEL_FRAG_MAIN_FORCES, VEL_FRAG_FORCE_CHUNKS, VEL_FRAG_FORCE_STEER_SEEK, buildMainForcesFragment,
} = lib;

// --- OFF identity: shipped pins unchanged, steering text absent ---
{
  const baseline = JSON.parse(readFileSync(join(ROOT, 'scripts', 'phase18-shader-hash.baseline.json'), 'utf8'));
  const pin = (name, s) => {
    const p = baseline.parts[name];
    return p && p.length === s.length && p.sha256 === sha(s);
  };
  check('SIM_VEL_FRAG matches shipped pin', pin('SIM_VEL_FRAG', SIM_VEL_FRAG));
  check('SIM_VEL_FRAG_PHASE19 matches shipped pin', pin('SIM_VEL_FRAG_PHASE19', SIM_VEL_FRAG_PHASE19));
  check('VEL_FRAG_MAIN_FORCES matches shipped pin', pin('VEL_FRAG_MAIN_FORCES', VEL_FRAG_MAIN_FORCES));
  check('VEL_FRAG_PREAMBLE matches shipped pin', pin('VEL_FRAG_PREAMBLE', VEL_FRAG_PREAMBLE));
  check('stock shader carries no steering text', !SIM_VEL_FRAG.includes('uSteerSeek') && !SIM_VEL_FRAG.includes('Crowd steering'));
  check('phase19 shader carries no steering text', !SIM_VEL_FRAG_PHASE19.includes('uSteerSeek'));
  check("buildVelocityFragment('') === SIM_VEL_FRAG", buildVelocityFragment('') === SIM_VEL_FRAG);
  check('buildVelocityFragment(phase19 opts) === SIM_VEL_FRAG_PHASE19',
    buildVelocityFragment('', '', { grainsFullScan: true, flip3dCouple: true }) === SIM_VEL_FRAG_PHASE19);
}

// --- ON identity: the Phase 20 strings match their new pins ---
{
  const baseline = JSON.parse(readFileSync(join(ROOT, 'scripts', 'phase18-shader-hash.baseline.json'), 'utf8'));
  const pin = (name, s) => {
    const p = baseline.parts[name];
    return p && p.length === s.length && p.sha256 === sha(s);
  };
  check('SIM_VEL_FRAG_PHASE20 matches its pin', pin('SIM_VEL_FRAG_PHASE20', SIM_VEL_FRAG_PHASE20));
  check('VEL_FRAG_PREAMBLE_PHASE20 matches its pin', pin('VEL_FRAG_PREAMBLE_PHASE20', VEL_FRAG_PREAMBLE_PHASE20));
  check('buildVelocityFragment(phase20 opts) === SIM_VEL_FRAG_PHASE20',
    buildVelocityFragment('', '', { grainsFullScan: true, flip3dCouple: true, steeringSeek: true }) === SIM_VEL_FRAG_PHASE20);
  const steeringOnly = buildVelocityFragment('', '', { steeringSeek: true });
  check('steering-only variant differs from stock and carries the chunk',
    steeringOnly !== SIM_VEL_FRAG && steeringOnly.includes(VEL_FRAG_FORCE_STEER_SEEK) && steeringOnly.includes('uniform bool  uSteerSeekEnabled;'));
  check('phase20 string contains chunk exactly once',
    SIM_VEL_FRAG_PHASE20.split(VEL_FRAG_FORCE_STEER_SEEK).length === 2);
}

// --- force order registration + variant gating ---
{
  check("'steer-seek' registered last", GPGPU_FORCE_CHUNK_NAMES[GPGPU_FORCE_CHUNK_NAMES.length - 1] === 'steer-seek');
  check('chunk registry carries steer-seek', VEL_FRAG_FORCE_CHUNKS['steer-seek'] === VEL_FRAG_FORCE_STEER_SEEK);
  check('normalize keeps steer-seek placement', normalizeGpgpuForceOrder('steer-seek,wind')[0] === 'steer-seek');
  check('variant-off builder skips steer-seek even when ordered first',
    !buildMainForcesFragment('steer-seek,wind').includes(VEL_FRAG_FORCE_STEER_SEEK));
  const on = buildMainForcesFragment('steer-seek,wind', { steeringSeek: true });
  check('variant-on builder honours the order (steer-seek before wind)',
    on.includes(VEL_FRAG_FORCE_STEER_SEEK)
    && on.indexOf(VEL_FRAG_FORCE_STEER_SEEK) < on.indexOf(VEL_FRAG_FORCE_CHUNKS.wind));
  const onDefault = buildMainForcesFragment(undefined, { steeringSeek: true });
  check('variant-on default order places steer-seek after steer-avoid',
    onDefault.indexOf(VEL_FRAG_FORCE_STEER_SEEK) > onDefault.indexOf(VEL_FRAG_FORCE_CHUNKS['steer-avoid']));
  check('variant-off default assembly === VEL_FRAG_MAIN_FORCES', buildMainForcesFragment() === VEL_FRAG_MAIN_FORCES);
}

// --- key defaults + resolution clamps ---
{
  const d = DEFAULT_CONFIG;
  check('defaults: steering disabled, seek mode', d.gpgpuSteerSeekEnabled === false && d.gpgpuSteerSeekMode === 'seek');
  check('defaults: strength 1 / maxSpeed 1 / maxForce 0 (no clamp)',
    d.gpgpuSteerSeekStrength === 1 && d.gpgpuSteerSeekMaxSpeed === 1 && d.gpgpuSteerSeekMaxForce === 0);
  check('defaults: path empty, lookAhead 20, radius 0',
    d.gpgpuSteerSeekPath === '' && d.gpgpuSteerSeekPathLookAhead === 20 && d.gpgpuSteerSeekPathRadius === 0);
  const r = resolveSteeringSeek(d);
  check('resolve(default) is inert', r.active === false && r.modeId === 0 && r.path.length === 0);
  check('mode ids are seek0 arrive1 path2 state3',
    STEER_SEEK_MODE_IDS.seek === 0 && STEER_SEEK_MODE_IDS.arrive === 1 && STEER_SEEK_MODE_IDS.path === 2 && STEER_SEEK_MODE_IDS.state === 3);
  const r2 = resolveSteeringSeek({
    ...d,
    gpgpuSteerSeekEnabled: true,
    gpgpuSteerSeekMode: 'state',
    gpgpuSteerSeekStateSlot: 9,
    gpgpuSteerSeekStateThreshold: 2,
    gpgpuSteerSeekStrength: -5,
  });
  check('resolve clamps slot to 0..3, threshold to 0..1, strength to >= 0',
    r2.stateSlot === 3 && r2.stateThreshold === 1 && r2.strength === 0 && r2.modeId === 3 && r2.active === true);
}

// --- path key parsing / packing ---
{
  const pts = parseSteeringPath('0,0,0; 10,0,0;10,10');
  check('parse: 3 points, two-component entry reads z=0', pts.length === 3 && pts[2].x === 10 && pts[2].y === 10 && pts[2].z === 0);
  check('parse: malformed entries skipped', parseSteeringPath('a,b,c;1,2,3;5').length === 1);
  check('parse: empty / null -> no points', parseSteeringPath('').length === 0 && parseSteeringPath(null).length === 0);
  const many = parseSteeringPath(Array.from({ length: 12 }, (_, i) => `${i},0,0`).join(';'));
  check('parse: capped at STEERING_PATH_MAX', many.length === STEERING_PATH_MAX);
  const packed = packSteeringPath(pts);
  check('pack: 24 floats, xyz per point', packed.length === 24 && packed[3] === 10 && packed[7] === 10 && packed[23] === 0);
}

// --- steering.ts numeric semantics (the law the chunk encodes) ---
{
  const v = (x, y, z) => ({ x, y, z });
  const atTarget = seekForce(v(5, 0, 0), v(1, 2, 3), v(5, 0, 0), 2);
  check('seek at target = -vel', atTarget.x === -1 && atTarget.y === -2 && atTarget.z === -3);
  const seek = seekForce(v(0, 0, 0), v(0, 0, 0), v(10, 0, 0), 2);
  check('seek desired = dir * maxSpeed', near(seek.x, 2) && near(seek.y, 0));
  const clamped = seekForce(v(0, 0, 0), v(0, 0, 0), v(10, 0, 0), 100, 3);
  check('seek clamps to maxForce when > 0', near(Math.hypot(clamped.x, clamped.y, clamped.z), 3));
  const arrive = arriveForce(v(0, 0, 0), v(0, 0, 0), v(10, 0, 0), 4, 20);
  check('arrive inside radius: speed ramps linearly (d/radius)', near(arrive.x, 2));
  const arriveOut = arriveForce(v(0, 0, 0), v(0, 0, 0), v(30, 0, 0), 4, 20);
  check('arrive outside radius = seek', near(arriveOut.x, 4));
  const pathPts = [v(0, 0, 0), v(10, 0, 0), v(10, 10, 0)];
  const tgt = pathFollowTarget(pathPts, v(2, 3, 0), 4);
  check('path target: closest projection advanced by lookAhead', near(tgt.x, 6) && near(tgt.y, 0) && near(tgt.z, 0));
  const tgtEnd = pathFollowTarget(pathPts, v(9, 9, 0), 100);
  check('path target: lookAhead clamps at the final point', near(tgtEnd.x, 10) && near(tgtEnd.y, 10));
  check('path force = seek toward the path target',
    near(pathFollowForce(pathPts, v(2, 3, 0), v(0, 0, 0), 1, 4).x, pathFollowForce(pathPts, v(2, 3, 0), v(0, 0, 0), 1, 4).x));
  check('stateFromSlot threshold rule', stateFromSlot(0.49) === 0 && stateFromSlot(0.5) === 1 && stateFromSlot(Number.NaN) === 0);
  const s0 = steeringForState(v(0, 0, 0), v(0, 0, 0), 0.2, { target0: v(10, 0, 0), target1: v(0, 10, 0), maxSpeed: 2, slowingRadius: 20 });
  const s1 = steeringForState(v(0, 0, 0), v(0, 0, 0), 0.8, { target0: v(10, 0, 0), target1: v(0, 10, 0), maxSpeed: 2, slowingRadius: 20 });
  check('state 0 seeks target0, state 1 arrives at target1', near(s0.x, 2) && near(s1.y, 1), `${s0.x} ${s1.y}`);
}

// --- GLSL chunk carries the same formulas (structural) ---
{
  const c = VEL_FRAG_FORCE_STEER_SEEK;
  check('chunk: desired = normalize(toTarget) * effSpeed', c.includes('(toTarget / sDist) * effSpeed'));
  check('chunk: steer = desired - vel', c.includes('vec3 steerForce = desired - vel;'));
  check('chunk: arrive ramp = maxSpeed * d / slowingRadius', c.includes('uSteerSeekMaxSpeed * sDist / uSteerSeekSlowingRadius'));
  check('chunk: maxForce clamp only when > 0', c.includes('if (uSteerSeekMaxForce > 0.0)') && c.includes('steerForce *= uSteerSeekMaxForce / fLen'));
  check('chunk: state reads the attribute slot', c.includes('kaloAttrChannel(attrData, uSteerSeekStateSlot)') && c.includes('slotValue >= uSteerSeekStateThreshold'));
  check('chunk: state1 target + arrive, state0 seek', c.includes('sTarget = isState1 ? uSteerSeekTarget1 : uSteerSeekTarget;') && c.includes('sMode = isState1 ? 1 : 0;'));
  check('chunk: path projection + lookAhead walk', c.includes('dot(pos - pa, ab) / lenSq') && c.includes('bestArc + max(uSteerSeekPathLookAhead, 0.0)'));
  check('chunk: application = steer * strength * uDelta * 60', c.includes('vel += steerForce * uSteerSeekStrength * uDelta * 60.0;'));
}

// --- WGSL twin (source-level: the WGSL string is not exported) ---
{
  const src = readFileSync(join(ROOT, 'lib', 'webgpuCompute.ts'), 'utf8');
  check('WGSL: steering uniform set declared', src.includes('steerEnabled : f32') && src.includes('steerPath : array<vec3f, 8>'));
  check('WGSL: steering block present', src.includes('if (u.steerEnabled > 0.5)'));
  check('WGSL: same application law', src.includes('vel += steerForce * u.steerStrength * u.delta * 60.0;'));
  check('WGSL: arrive ramp mirrors', src.includes('u.steerMaxSpeed * sDist / u.steerSlowingRadius'));
  check('WGSL: uniform buffer grew to 592 bytes', src.includes('const VEL_UNIFORM_BYTES = 592;'));
  check('WGSL: writes at indices 99..116', src.includes('velU[99] = st && st.active ? 1 : 0;') && src.includes('velU[116 + pi * 4]'));
  check('WGSL: state mode limitation documented', src.includes('Mode 3 (state) resolves to state 0 in this pass'));
}

// --- attribute consumer registration for state mode ---
{
  const off = resolveAttrConsumers(DEFAULT_CONFIG);
  check('attr consumers: steering state inactive by default', off.steerStateActive === false);
  const on = resolveAttrConsumers({ ...DEFAULT_CONFIG, gpgpuSteerSeekEnabled: true, gpgpuSteerSeekMode: 'state' });
  check('attr consumers: state mode registers + builds the texture', on.steerStateActive === true && on.anyActive === true);
  const seekOnly = resolveAttrConsumers({ ...DEFAULT_CONFIG, gpgpuSteerSeekEnabled: true, gpgpuSteerSeekMode: 'seek' });
  check('attr consumers: seek mode does not register', seekOnly.steerStateActive === false);
}

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
