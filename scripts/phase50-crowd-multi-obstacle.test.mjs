// Crowd multi-obstacle stage — the crowd state machine over
// more than one obstacle (Gate 43's M8 limit was: analytic SDF
// primitive only). Design: CROWD_MULTI_OBSTACLE_RECORD.md.
// - CPU spec: crowdSelectObstacle (min sd, ties keep the
//   earlier obstacle, NaN never wins, empty -> -1) and
//   crowdStateForObstacles (winner drives the stage-1 table;
//   one obstacle === crowdStateFor bit for bit; zero obstacles
//   === sdfEnabled false).
// - Boundaries: the winner in the hysteresis band uses ITS
//   velNormal (not another obstacle's); a nearer obstacle in
//   the band with vn <= 0 does not capture the particle even
//   when a farther one is approaching; IDLE is reachable only
//   when no obstacle captures.
// - resolveCrowd: the new key defaults off and resolves.
// - GLSL: the crowd chunk carries the selection block (mesh
//   body loop + single mesh), the winner-only normal, and the
//   cHasObstacle guard; the preamble declares the flag; the
//   sampler count is unchanged (the mesh texture was already
//   bound); the default (non-crowd) assembly is byte-identical.
// - WGSL: untouched (no mesh SDF subsystem on that route);
//   VEL_UNIFORM_BYTES stays 768.
import { build } from 'esbuild';
import { readFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.p50cm-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};

await build({
  stdin: {
    contents: `
      export { CROWD_STATE_IDS, crowdSelectObstacle, crowdStateFor, crowdStateForObstacles, resolveCrowd } from './lib/steering.ts';
      export { buildMainForcesFragment, VEL_FRAG_MAIN_FORCES, VEL_FRAG_FORCE_STEER_SEEK_CROWD } from './components/gpgpuShaderSimulationVelocityMainForces.ts';
      export { buildVelocityPreamble } from './components/gpgpuShaderSimulationVelocityPreamble.ts';
      export { buildVelocityFragment, SIM_VEL_FRAG } from './components/gpgpuShaderSimulationVelocity.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});
const lib = await import(pathToFileURL(BUNDLE).href);
unlinkSync(BUNDLE);
const { CROWD_STATE_IDS, crowdSelectObstacle, crowdStateFor, crowdStateForObstacles, resolveCrowd } = lib;

const P = { avoidRange: 30, avoidHysteresis: 0.2, idleSpeed: 0.05, idleSpeedOut: 0.1, idleRadius: 50 };
const REST = { speed: 5, distToTarget: 500, towardTarget: 1 };
const O = (sd, velNormal = 0) => ({ sd, velNormal });

// ── Selection ─────────────────────────────────────────────────
check('select: empty -> -1', crowdSelectObstacle([]) === -1);
check('select: single -> 0', crowdSelectObstacle([O(7)]) === 0);
check('select: min sd wins (not first)', crowdSelectObstacle([O(50), O(12), O(30)]) === 1);
check('select: min sd wins (not last)', crowdSelectObstacle([O(12), O(50), O(30)]) === 0);
check('select: negative sd (inside) is most imminent', crowdSelectObstacle([O(3), O(-2), O(10)]) === 1);
check('select: tie keeps the earlier obstacle', crowdSelectObstacle([O(10), O(10), O(10)]) === 0);
check('select: tie at the tail keeps the earlier of the two', crowdSelectObstacle([O(20), O(8), O(8)]) === 1);
check('select: NaN never wins', crowdSelectObstacle([O(Number.NaN), O(40)]) === 1);
check('select: all NaN -> -1', crowdSelectObstacle([O(Number.NaN), O(Number.NaN)]) === -1);
check('select: +Infinity (out of domain) loses to any finite sd', crowdSelectObstacle([O(Number.POSITIVE_INFINITY), O(90)]) === 1);
check('select: five obstacles (the 1 + 4 cap) — last can win', crowdSelectObstacle([O(80), O(70), O(60), O(50), O(4)]) === 4);

// ── State over obstacles ──────────────────────────────────────
check('state: no obstacles -> MOVE (far from target)', crowdStateForObstacles([], REST, P) === CROWD_STATE_IDS.move);
check('state: no obstacles -> IDLE still reachable',
  crowdStateForObstacles([], { speed: 0.01, distToTarget: 10, towardTarget: 0 }, P) === CROWD_STATE_IDS.idle);
check('state: one obstacle inside Rin -> AVOID', crowdStateForObstacles([O(29)], REST, P) === CROWD_STATE_IDS.avoid);
check('state: one obstacle at Rin exactly -> not AVOID (stage-1 boundary)',
  crowdStateForObstacles([O(30)], REST, P) === crowdStateFor({ ...REST, sdfEnabled: true, sd: 30, velNormal: 0 }, P));
check('state: far obstacle + near obstacle inside Rin -> AVOID',
  crowdStateForObstacles([O(500), O(10)], REST, P) === CROWD_STATE_IDS.avoid);
check('state: near obstacle inside Rin wins over a band obstacle leaving',
  crowdStateForObstacles([O(33, 1), O(10, -1)], REST, P) === CROWD_STATE_IDS.avoid);
check('state: winner in band + leaving (vn > 0) -> AVOID persists',
  crowdStateForObstacles([O(33, 0.5), O(90, -1)], REST, P) === CROWD_STATE_IDS.avoid);
check('state: winner in band + approaching (vn <= 0) -> MOVE, even if another obstacle leaves',
  crowdStateForObstacles([O(33, -0.5), O(35, 2)], REST, P) === CROWD_STATE_IDS.move);
check('state: winner beyond Rout -> MOVE regardless of vn',
  crowdStateForObstacles([O(36.5, 3)], REST, P) === CROWD_STATE_IDS.move);
check('state: winner beyond Rout at exactly Rout -> MOVE (band is sd < Rout)',
  crowdStateForObstacles([O(36, 3)], REST, P) === CROWD_STATE_IDS.move);
check('state: AVOID beats IDLE (near target but inside Rin)',
  crowdStateForObstacles([O(5)], { speed: 0.01, distToTarget: 1, towardTarget: 0 }, P) === CROWD_STATE_IDS.avoid);
check('state: NaN obstacle is invisible to the machine',
  crowdStateForObstacles([O(Number.NaN), O(100)], REST, P) === CROWD_STATE_IDS.move);

// ── Single-obstacle equivalence with crowdStateFor (sweep) ────
{
  let ok = true;
  let detail = '';
  for (const sd of [-5, 0, 10, 29.999, 30, 33, 35.999, 36, 60, 500]) {
    for (const vn of [-2, 0, 0.5, 3]) {
      for (const rest of [REST, { speed: 0.01, distToTarget: 10, towardTarget: 0 }, { speed: 0.07, distToTarget: 10, towardTarget: -1 }]) {
        const a = crowdStateForObstacles([O(sd, vn)], rest, P);
        const b = crowdStateFor({ ...rest, sdfEnabled: true, sd, velNormal: vn }, P);
        if (a !== b) { ok = false; detail = `sd=${sd} vn=${vn} rest=${JSON.stringify(rest)}: ${a} !== ${b}`; }
      }
    }
  }
  check('equivalence: one obstacle === crowdStateFor over the boundary sweep', ok, detail);
}
{
  let ok = true;
  for (const rest of [REST, { speed: 0.01, distToTarget: 10, towardTarget: 0 }, { speed: 5, distToTarget: 10, towardTarget: 1 }]) {
    const a = crowdStateForObstacles([], rest, P);
    const b = crowdStateFor({ ...rest, sdfEnabled: false, sd: -100, velNormal: 0 }, P);
    if (a !== b) ok = false;
  }
  check('equivalence: zero obstacles === crowdStateFor with sdfEnabled false', ok);
}

// ── resolveCrowd ──────────────────────────────────────────────
{
  const r = resolveCrowd({});
  check('resolve: multiObstacleEnabled defaults false', r.multiObstacleEnabled === false, JSON.stringify(r));
  const c = resolveCrowd({ gpgpuCrowdMultiObstacleEnabled: true });
  check('resolve: multiObstacleEnabled true passes through', c.multiObstacleEnabled === true);
}

// ── GLSL ──────────────────────────────────────────────────────
{
  const chunk = lib.VEL_FRAG_FORCE_STEER_SEEK_CROWD;
  check('GLSL: selection is gated by the multi flag', chunk.includes('if (uCrowdMultiObstacleEnabled) {'));
  check('GLSL: multi-body loop over the atlas bodies', chunk.includes('float bSd = meshSdfBodyDistance(bi, pos);') && chunk.includes('if (bi >= uMeshSdfBodyCount) break;'));
  check('GLSL: single mesh body is an obstacle too', chunk.includes('float mSd = meshSdfDistance(pos);'));
  check('GLSL: analytic primitive evaluated first', chunk.indexOf('float oSd = abSdfDistance(pos);') < chunk.indexOf('float bSd = meshSdfBodyDistance(bi, pos);'));
  check('GLSL: winner-only normals (analytic / single mesh / atlas body)',
    chunk.includes('if (bestObs == -1) cNormal = abSdfNormal(pos);')
    && chunk.includes('else if (bestObs == 4) cNormal = meshSdfNormal(pos);')
    && chunk.includes('else cNormal = meshSdfBodyNormal(bestObs, pos);'));
  check('GLSL: state guard is cHasObstacle with the stage-1 conditions verbatim',
    chunk.includes('if (cHasObstacle && (cSd < cRin || (cSd < cRout && cVn > 0.0))) {'));
  check('GLSL: AVOID law unchanged (strength * sw^2 * delta * 45)',
    chunk.includes('vel += cNormal * (uCrowdAvoidStrength * cSw * cSw) * uDelta * 45.0;'));
  check('GLSL: default main-forces assembly unchanged', lib.buildMainForcesFragment() === lib.VEL_FRAG_MAIN_FORCES);
  check('GLSL: default velocity fragment is the stock string', lib.buildVelocityFragment('') === lib.SIM_VEL_FRAG);
  const plain = lib.buildVelocityPreamble({ steeringSeek: true });
  const crowd = lib.buildVelocityPreamble({ steeringSeek: true, crowd: true });
  check('GLSL: crowd preamble declares the multi flag', crowd.includes('uniform bool  uCrowdMultiObstacleEnabled;'));
  check('GLSL: plain preamble carries no crowd uniforms (unchanged)', !plain.includes('uCrowd'));
  const countSamplers = (s) => (s.match(/uniform sampler/g) || []).length;
  check('A7: no new samplers in the crowd variant', countSamplers(crowd) === countSamplers(plain), `${countSamplers(plain)} -> ${countSamplers(crowd)}`);
}

// ── WGSL (untouched route) ────────────────────────────────────
{
  const wgsl = readFileSync(join(ROOT, 'lib/webgpuCompute.ts'), 'utf8');
  check('WGSL: uniform buffer stays 768 bytes (no expansion)', wgsl.includes('const VEL_UNIFORM_BYTES = 768;'));
  check('WGSL: crowd params carry the flag for parity (documented unused)',
    wgsl.includes('multiObstacleEnabled: boolean;'));
}

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
