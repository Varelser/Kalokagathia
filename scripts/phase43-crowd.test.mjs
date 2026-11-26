// Phase 43 (Round 84 gap 2) — crowd state machine + lanes,
// against the design (R83-02 #8) and the numeric spec
// (R84-02 #2), incl. the avoid-promotion lines M1/M6/M7/M8:
// - CPU twin: the P1-P5 transition table at its boundaries,
//   lane assignment / centre / look-ahead, lateral direction
//   incl. the +Y degenerate fallback, resolveCrowd defaults
//   and clamps, crowdAvoidStrength
// - M7/A1: OFF assemblies byte-identical (default fragment,
//   steering-only variant); the crowd variant swaps the chunk
//   and omits the standalone steer-avoid chunk
// - M1: WGSL carries formula-identical twins of BOTH GLSL
//   avoid terms (Phase 15 steer-avoid, Phase AB life-avoid)
//   plus the crowd state machine and lanes; uniform tail
//   indices 164-180 written; buffer 736 bytes
// - M6: the AVOID branch applies the avoid law with no seek
//   application in either twin (string-level)
// - A7: no new samplers (16 in default and crowd variants)
import { build } from 'esbuild';
import { readFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.p43-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

await build({
  stdin: {
    contents: `
      export { CROWD_STATE_IDS, crowdAvoidRangeResolved, crowdAvoidStrength, crowdLaneCenterOffset, crowdLaneIndex, crowdLaneLookAhead, crowdLateralDir, crowdStateFor, resolveCrowd } from './lib/steering.ts';
      export { buildMainForcesFragment, VEL_FRAG_MAIN_FORCES, VEL_FRAG_FORCE_STEER_SEEK, VEL_FRAG_FORCE_STEER_SEEK_CROWD, VEL_FRAG_FORCE_STEER_AVOID } from './components/gpgpuShaderSimulationVelocityMainForces.ts';
      export { buildVelocityPreamble } from './components/gpgpuShaderSimulationVelocityPreamble.ts';
      export { buildVelocityFragment, SIM_VEL_FRAG } from './components/gpgpuShaderSimulationVelocity.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});
const lib = await import(pathToFileURL(BUNDLE).href);
unlinkSync(BUNDLE);
const { CROWD_STATE_IDS, crowdAvoidRangeResolved, crowdAvoidStrength, crowdLaneCenterOffset, crowdLaneIndex, crowdLaneLookAhead, crowdLateralDir, crowdStateFor, resolveCrowd } = lib;

// ── Transition table (P1-P5) ──────────────────────────────────
const P = { avoidRange: 30, avoidHysteresis: 0.2, idleSpeed: 0.05, idleSpeedOut: 0.1, idleRadius: 50 };
const S = (over) => crowdStateFor({ sdfEnabled: true, sd: 100, velNormal: 0, speed: 5, distToTarget: 500, towardTarget: 1, ...over }, P);
check('P1: sd < Rin -> AVOID', S({ sd: 29.9 }) === CROWD_STATE_IDS.avoid);
check('P1: sd == Rin is NOT avoid entry (strict <)', S({ sd: 30 }) === CROWD_STATE_IDS.move);
check('P2: band + moving away -> AVOID persists', S({ sd: 35, velNormal: 0.5 }) === CROWD_STATE_IDS.avoid);
check('P2: band + moving toward -> MOVE (band does not capture)', S({ sd: 35, velNormal: -0.5 }) === CROWD_STATE_IDS.move);
check('P2: band + vn == 0 -> MOVE', S({ sd: 35, velNormal: 0 }) === CROWD_STATE_IDS.move);
check('P2: sd == Rout (36) + moving away -> MOVE', S({ sd: 36, velNormal: 0.5 }) === CROWD_STATE_IDS.move);
check('P1 beats P3: close to target AND inside Rin -> AVOID', S({ sd: 10, distToTarget: 10, speed: 0 }) === CROWD_STATE_IDS.avoid);
check('P3: near target + slow -> IDLE', S({ distToTarget: 49, speed: 0.04 }) === CROWD_STATE_IDS.idle);
check('P3: near target + fast -> MOVE', S({ distToTarget: 49, speed: 0.5 }) === CROWD_STATE_IDS.move);
check('P3 band: speed in [idle, idleOut) + not approaching -> IDLE', S({ distToTarget: 49, speed: 0.08, towardTarget: -0.2 }) === CROWD_STATE_IDS.idle);
check('P3 band: speed in band + approaching -> MOVE', S({ distToTarget: 49, speed: 0.08, towardTarget: 0.2 }) === CROWD_STATE_IDS.move);
check('P3: at idleRadius exactly -> MOVE (strict <)', S({ distToTarget: 50, speed: 0 }) === CROWD_STATE_IDS.move);
check('P5: far + fast -> MOVE', S({}) === CROWD_STATE_IDS.move);
check('no SDF: sd ignored -> MOVE/IDLE only', crowdStateFor({ sdfEnabled: false, sd: -100, velNormal: 0, speed: 5, distToTarget: 500, towardTarget: 1 }, P) === CROWD_STATE_IDS.move);
check('range fallback: 0 -> max(size*1.5, 1)', crowdAvoidRangeResolved(0, 10) === 15 && crowdAvoidRangeResolved(0, 0.2) === 1 && crowdAvoidRangeResolved(7, 10) === 7);
check('avoid strength: positive key wins, 0 -> 1', crowdAvoidStrength(2.5) === 2.5 && crowdAvoidStrength(0) === 1);

// ── Lanes ─────────────────────────────────────────────────────
check('lane: slot 0 -> lane 0', crowdLaneIndex(0, 4) === 0);
check('lane: slot 0.25 (count 4) -> lane 1', crowdLaneIndex(0.25, 4) === 1);
check('lane: slot 0.999 -> last lane', crowdLaneIndex(0.999, 4) === 3);
check('lane: slot 1 clamps to last lane', crowdLaneIndex(1, 4) === 3);
check('lane: NaN slot -> lane 0', crowdLaneIndex(Number.NaN, 4) === 0);
check('lane: count 1 always lane 0', crowdLaneIndex(0.9, 1) === 0);
check('lane centres: count 2, width 20, offset 0 -> -20/+20',
  crowdLaneCenterOffset(0, 2, 20, 0) === -20 && crowdLaneCenterOffset(1, 2, 20, 0) === 20);
check('lane centres: count 1 -> the base offset', crowdLaneCenterOffset(0, 1, 20, 7) === 7);
check('lane look-ahead: lane i scales (1 + 0.25 i) * scale',
  crowdLaneLookAhead(20, 2, 1.5) === 20 * 1.5 * 1.5);
{
  const d1 = crowdLateralDir({ x: 1, y: 0, z: 0 });
  check('lateral: tangent +X -> (0,0,-1)', near(d1.x, 0) && near(d1.y, 0) && near(d1.z, -1), JSON.stringify(d1));
  const d2 = crowdLateralDir({ x: 0, y: 0, z: 1 });
  check('lateral: tangent +Z -> (1,0,0)', near(d2.x, 1) && near(d2.y, 0) && near(d2.z, 0), JSON.stringify(d2));
  const d3 = crowdLateralDir({ x: 0, y: 1, z: 0 });
  check('lateral: tangent +Y (degenerate) -> +Z cross fallback (1,0,0)... via (-y,x,0) of (0,1,0) = (-1,0,0)',
    near(d3.x, -1) && near(d3.y, 0) && near(d3.z, 0), JSON.stringify(d3));
  const d4 = crowdLateralDir({ x: 0, y: 0, z: 0 });
  check('lateral: zero tangent -> +X', near(d4.x, 1) && near(d4.y, 0) && near(d4.z, 0), JSON.stringify(d4));
}

// ── resolveCrowd ──────────────────────────────────────────────
{
  const r = resolveCrowd({});
  check('resolve: defaults per spec R84-02', r.enabled === false && r.avoidRange === 0 && near(r.avoidHysteresis, 0.2)
    && near(r.idleSpeed, 0.05) && near(r.idleSpeedOut, 0.1) && r.idleRadius === 0 && near(r.idleDamping, 0.9)
    && r.laneCount === 1 && r.laneWidth === 20 && r.laneOffset === 0 && r.laneLateralGain === 1 && r.laneLookAheadScale === 1,
    JSON.stringify(r));
  const c = resolveCrowd({ gpgpuCrowdEnabled: true, gpgpuCrowdLaneCount: 9, gpgpuCrowdAvoidHysteresis: 5, gpgpuCrowdIdleDamping: -1 });
  check('resolve: clamps (laneCount 4, hysteresis 1, damping 0)', c.enabled === true && c.laneCount === 4 && c.avoidHysteresis === 1 && c.idleDamping === 0, JSON.stringify(c));
}

// ── GLSL assemblies (M7/A1) ───────────────────────────────────
check('GLSL: default main-forces assembly unchanged', lib.buildMainForcesFragment() === lib.VEL_FRAG_MAIN_FORCES);
check('GLSL: default velocity fragment is the stock string', lib.buildVelocityFragment('') === lib.SIM_VEL_FRAG);
{
  const steerOnly = lib.buildMainForcesFragment(undefined, { steeringSeek: true });
  check('GLSL: steering-only variant keeps the plain chunk, no crowd chunk',
    steerOnly.includes(lib.VEL_FRAG_FORCE_STEER_SEEK) && !steerOnly.includes('cState == 2'));
  const crowd = lib.buildMainForcesFragment(undefined, { steeringSeek: true, crowd: true });
  check('GLSL: crowd variant swaps in the crowd chunk', crowd.includes(lib.VEL_FRAG_FORCE_STEER_SEEK_CROWD));
  check('GLSL: crowd variant omits the standalone steer-avoid chunk (no double push)',
    !crowd.includes(lib.VEL_FRAG_FORCE_STEER_AVOID));
  const crowdNoSteer = lib.buildMainForcesFragment(undefined, { crowd: true });
  check('GLSL: crowd without steering keeps steer-avoid (chunk never spliced)',
    crowdNoSteer.includes(lib.VEL_FRAG_FORCE_STEER_AVOID));
}
{
  const plain = lib.buildVelocityPreamble({ steeringSeek: true });
  check('GLSL: steering preamble carries no crowd uniforms', !plain.includes('uCrowd'));
  const crowd = lib.buildVelocityPreamble({ steeringSeek: true, crowd: true });
  check('GLSL: crowd preamble declares the crowd uniform set',
    crowd.includes('uniform float uCrowdAvoidRange;') && crowd.includes('uniform int   uCrowdLaneCount;') && crowd.includes('uniform float uCrowdAvoidStrength;'));
  const countSamplers = (s) => (s.match(/uniform sampler2D/g) || []).length;
  check('A7: sampler count stays 16 in the crowd variant preamble',
    countSamplers(crowd) === countSamplers(plain), `${countSamplers(plain)} -> ${countSamplers(crowd)}`);
}
// M6 (string level): the crowd chunk's AVOID branch applies the
// avoid law and the seek application lives in the MOVE branch.
{
  const chunk = lib.VEL_FRAG_FORCE_STEER_SEEK_CROWD;
  check('M6/GLSL: AVOID applies the Phase 15 law (strength * sw^2 * delta * 45)',
    chunk.includes('vel += cNormal * (uCrowdAvoidStrength * cSw * cSw) * uDelta * 45.0;'));
  check('M6/GLSL: seek application is inside the MOVE (else-if sApply) branch only',
    chunk.includes('} else if (sApply) {'));
  check('GLSL: IDLE damps with pow(idleDamping, delta * 60)',
    chunk.includes('vel *= pow(clamp(uCrowdIdleDamping, 0.0, 1.0), uDelta * 60.0);'));
  check('GLSL: transition conditions mirror crowdStateFor',
    chunk.includes('cSd < cRin || (cSd < cRout && cVn > 0.0)')
    && chunk.includes('cSpd < uCrowdIdleSpeed || (cSpd < uCrowdIdleSpeedOut && cToward <= 0.0)'));
  check('GLSL: lane spring engages only outside the lane width',
    chunk.includes('if (abs(cLatDev) > uCrowdLaneWidth)'));
}

// ── WGSL (M1) ─────────────────────────────────────────────────
const wgsl = readFileSync(join(ROOT, 'lib/webgpuCompute.ts'), 'utf8');
check('WGSL: uniform buffer is 736 bytes', wgsl.includes('const VEL_UNIFORM_BYTES = 736;'));
check('WGSL: struct tail carries the crowd + avoid fields',
  wgsl.includes('crowdLaneLookAheadScale : f32,') && wgsl.includes('steerAvoid : f32,') && wgsl.includes('lifeAvoid : f32,'));
check('WGSL: SDF query twins exist (kaloSdfDistance / kaloSdfNormal)',
  wgsl.includes('fn kaloSdfDistance(p: vec3f) -> f32') && wgsl.includes('fn kaloSdfNormal(p: vec3f) -> vec3f'));
check('M1/WGSL: steer-avoid twin (Phase 15 formula, crowd stand-down)',
  wgsl.includes('if (u.steerAvoid > 0.0 && u.sdfEnabled > 0.5 && u.crowdEnabled < 0.5)')
  && wgsl.includes('vel += kaloSdfNormal(pos) * (u.steerAvoid * sw * sw) * u.delta * 45.0;'));
check('M1/WGSL: life-avoid twin (Phase AB formula, vision-range fallback)',
  wgsl.includes('if (u.lifeAvoid > 0.0 && u.sdfEnabled > 0.5)')
  && wgsl.includes('vel += kaloSdfNormal(pos) * (u.lifeAvoid * aw * aw) * u.delta * 45.0;'));
check('M6/WGSL: crowd AVOID branch applies the avoid law, seek in the else-if',
  wgsl.includes('vel += cNormal * (u.crowdAvoidStrength * cSw * cSw) * u.delta * 45.0;')
  && wgsl.includes('} else if (sApply) {'));
check('WGSL: crowd IDLE damping mirrors GLSL',
  wgsl.includes('vel *= pow(clamp(u.crowdIdleDamping, 0.0, 1.0), u.delta * 60.0);'));
check('WGSL: uniform writes cover indices 164-180',
  wgsl.includes('velU[164] = f ? f.steerAvoid : 0;') && wgsl.includes('velU[171] = cw ? cw.avoidStrength : 1;') && wgsl.includes('velI[176] = cw ? cw.laneCount : 1;'));

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
