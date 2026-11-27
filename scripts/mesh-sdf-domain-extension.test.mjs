// Mesh SDF domain extension (Gate 58h fix, 2026-11-27).
//
// Diagnosis (GATE58H_BAKE_SDF_DIAGNOSIS): the baked domain
// cube (half side ~33.1 world for the gate body) is smaller
// than the crowd avoid shell (Rin 45 / Rout 54). Outside the
// cube the shader query returned +1e6, so in the min(sd)
// synthesis the mesh body vanished and the analytic primitive
// won by default — the switch point on the A-B axis sat on
// the cube face (world x = 56.9) instead of the midpoint
// (45.0), and Gate 58h-r1 measured P(d_B < 40) = 0.314 on the
// real GPU against a CPU-twin prediction of ~0.
//
// Fix: meshSdfDistance / meshSdfBodyDistance (identical copies
// in the velocity helpers and the position pass) return, for
// a point outside the domain cube, the boundary sample plus
// the Euclidean distance to the cube; meshSdfBodyNormal takes
// unclamped taps on the extended field for outside points.
// In-domain values are bit-identical; extended values are
// always positive (the mesh bakes strictly inside the cube),
// so the position push-out (sd < 0) can never fire outside.
//
// Pins:
//  (a) the extended CPU reference (built on queryMeshSdf,
//      the CPU twin of the in-domain query) equals the plain
//      query at in-domain points;
//  (b) the extended field is finite across the whole avoid
//      shell, where the plain query is +Infinity for most
//      directions (the truncation itself);
//  (c) the field is continuous across the cube faces;
//  (d) in the shell band the extended field tracks the
//      analytic sphere (zero crossing 29.8) within per-radius
//      bounds (2.5 world up to Rin, 4.2 at Rout — the in-cube
//      part is the bake's own effective-radius spread, the
//      extension's added error grows beyond the faces);
//  (e) the min(sd) switch point against an analytic sphere
//      90 world units away returns to the midpoint band
//      (world x in [42, 48]); with the plain query it sits on
//      the cube face (x = 56.9);
//  (f) the numeric gradient of the extended field in the
//      shell is a usable normal (|grad| ~ 1, radial);
//  (g) GLSL wiring: both passes carry the extension, the four
//      query/normal function bodies stay byte-identical
//      between the passes, the absent-body +1e6 guard stays,
//      and no new sampler appears.
import { build } from 'esbuild';
import { unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.mesh-sdf-ext-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};

await build({
  stdin: {
    contents: `
      export { bakeMeshSdfGrid, queryMeshSdf } from './lib/meshSdfCollider.ts';
      export { parseObjGeometry, SAMPLE_OBJ_SPHERE } from './lib/objMorph.ts';
      export { VEL_FRAG_HELPERS } from './components/gpgpuShaderSimulationVelocityHelpers.ts';
      export { VEL_FRAG_PREAMBLE } from './components/gpgpuShaderSimulationVelocityPreamble.ts';
      export { SIM_POS_FRAG } from './components/gpgpuShaderSimulationPosition.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});
const lib = await import(pathToFileURL(BUNDLE).href);
unlinkSync(BUNDLE);
const { bakeMeshSdfGrid, queryMeshSdf, parseObjGeometry, SAMPLE_OBJ_SPHERE } = lib;

// ── Bake the gate's sphere at the gate's resolution ─────────
const RES = 64;
const WORLD_SCALE = 30; // gate body: 72 * 0.4166667
const geo = parseObjGeometry(SAMPLE_OBJ_SPHERE);
check('icosphere OBJ parses', !!geo);
const grid = bakeMeshSdfGrid(geo, RES);
check('sphere grid bakes at 64', !!grid && grid.resolution === RES);
const side = grid.sideNorm;
const half = side / 2;
check('domain half side is ~33.1 world at the gate scale',
  Math.abs(half * WORLD_SCALE - 33.1034) < 0.01, `${half * WORLD_SCALE}`);

// ── Extended reference (mirrors the fixed GLSL) ─────────────
function extendedQuery(px, py, pz) {
  const qx = px / side + 0.5, qy = py / side + 0.5, qz = pz / side + 0.5;
  if (qx >= 0 && qx <= 1 && qy >= 0 && qy <= 1 && qz >= 0 && qz <= 1) {
    return queryMeshSdf(grid, px, py, pz);
  }
  const cx = Math.min(Math.max(qx, 0), 1), cy = Math.min(Math.max(qy, 0), 1), cz = Math.min(Math.max(qz, 0), 1);
  const sx = (cx - 0.5) * side, sy = (cy - 0.5) * side, sz = (cz - 0.5) * side;
  return queryMeshSdf(grid, sx, sy, sz) + Math.hypot(px - sx, py - sy, pz - sz);
}

// Deterministic RNG + direction set.
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(58);
const gauss = () => rng() + rng() + rng() + rng() - 2;
const dirs = [];
for (const ax of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) dirs.push(ax);
for (const dg of [[1, 1, 0], [1, -1, 0], [-1, 1, 0], [0, 1, 1], [1, 0, 1], [1, 1, 1], [1, -1, 1], [-1, 1, 1], [1, 1, -1]]) {
  const l = Math.hypot(...dg); dirs.push(dg.map((v) => v / l));
}
for (let i = 0; i < 1024; i++) {
  const v = [gauss(), gauss(), gauss()];
  const l = Math.hypot(...v); if (l < 1e-6) continue;
  dirs.push(v.map((x) => x / l));
}

// ── (a) in-domain identity ──────────────────────────────────
{
  let worst = 0;
  for (let i = 0; i < 200; i++) {
    const p = [(rng() * 2 - 1) * half * 0.98, (rng() * 2 - 1) * half * 0.98, (rng() * 2 - 1) * half * 0.98];
    const a = extendedQuery(...p);
    const b = queryMeshSdf(grid, ...p);
    if (Number.isFinite(a) && Number.isFinite(b)) worst = Math.max(worst, Math.abs(a - b));
  }
  check('(a) extended == plain query at in-domain points', worst < 1e-9, `worst ${worst}`);
}

// ── (b) finiteness across the shell / the truncation ────────
for (const [rWorld, minInfFrac] of [[45, 0.7], [54, 0.95]]) {
  const r = rWorld / WORLD_SCALE;
  let inf = 0, finite = 0;
  for (const d of dirs) {
    const p = d.map((v) => v * r);
    if (queryMeshSdf(grid, ...p) === Infinity) inf += 1;
    if (Number.isFinite(extendedQuery(...p))) finite += 1;
  }
  check(`(b) plain query is truncated at r=${rWorld} (Infinity fraction >= ${minInfFrac})`,
    inf / dirs.length >= minInfFrac, `${inf}/${dirs.length}`);
  check(`(b) extended query is finite everywhere at r=${rWorld}`,
    finite === dirs.length, `${finite}/${dirs.length}`);
}

// ── (c) continuity across the faces ─────────────────────────
{
  let worst = 0;
  for (const d of dirs.slice(0, 15)) {
    const rExit = half / Math.max(...d.map(Math.abs));
    const dm = d.map((v) => v * (rExit - 1e-3));
    const dp = d.map((v) => v * (rExit + 1e-3));
    worst = Math.max(worst, Math.abs(extendedQuery(...dp) - extendedQuery(...dm)));
  }
  check('(c) no jump across the cube faces (delta 1e-3)', worst < 0.01, `worst jump ${worst}`);
}

// ── (d) band accuracy vs the analytic sphere ────────────────
// Bounds are per radius, from the measured field: inside the
// cube the error is the bake's own effective-radius spread
// (zero crossings 27.8..29.8 against the 29.8 reference, so
// up to ~2.0 — pre-existing, not the extension's doing); the
// extension is an upper bound whose added error grows with
// the distance travelled beyond a face at an oblique angle,
// reaching ~3.6 at Rout. Before the fix the same points read
// +1e6 — the state machine needs the field finite, monotone
// and approximately right, which is what these bounds pin.
{
  const bounds = [[34, 2.5], [38, 2.5], [40, 2.5], [45, 2.5], [50, 3.2], [54, 4.2]];
  for (const [rWorld, bound] of bounds) {
    const r = rWorld / WORLD_SCALE;
    let worst = 0; let worstAt = '';
    for (const d of dirs) {
      const p = d.map((v) => v * r);
      const err = Math.abs(extendedQuery(...p) * WORLD_SCALE - (rWorld - 29.8));
      if (err > worst) { worst = err; worstAt = d.map((v) => v.toFixed(2)).join(','); }
    }
    check(`(d) band error at r=${rWorld} within ${bound} world`, worst <= bound, `worst ${worst} at ${worstAt}`);
  }
}

// ── (e) the min(sd) switch point ────────────────────────────
{
  // B at the origin; analytic A (radius 1) centred 3.0 away
  // along -x (90 world units at the gate scale).
  const sdA = (s) => (3.0 - s) - 1.0;
  // Coming from B (where B wins), the switch is the first s at
  // which B stops winning: its value exceeds A's, or it falls
  // out of the domain entirely (+Infinity).
  const scan = (fn) => {
    for (let s = 1.0; s <= 2.5; s += 0.001) {
      const v = fn(-s, 0, 0);
      if (!(Number.isFinite(v) && v <= sdA(s))) return s;
    }
    return NaN;
  };
  const sOld = scan((x, y, z) => queryMeshSdf(grid, x, y, z));
  const sNew = scan(extendedQuery);
  check('(e) plain query: switch sits on the cube face (s ~ half side)',
    Math.abs(sOld - half) < 0.01, `s=${sOld} half=${half}`);
  const xNewWorld = 90 - sNew * WORLD_SCALE;
  check('(e) extended query: switch returns to the midpoint band (world x in [42, 48])',
    xNewWorld >= 42 && xNewWorld <= 48, `x=${xNewWorld}`);
}

// ── (f) gradient of the extended field in the shell ─────────
{
  const e = grid.voxelNorm * 0.5;
  const gradAt = (p) => {
    const g = [];
    for (let ax = 0; ax < 3; ax++) {
      const pp = [...p]; pp[ax] += e;
      const pm = [...p]; pm[ax] -= e;
      g.push((extendedQuery(...pp) - extendedQuery(...pm)) / (2 * e));
    }
    return g;
  };
  let okMag = true, okCos = true, detail = '';
  for (const [rWorld, d] of [[40, [1, 0, 0]], [45, [0, 1, 0]], [50, [Math.SQRT1_2, Math.SQRT1_2, 0]], [54, [1, 0, 0]], [45, [0, 0, -1]]]) {
    const r = rWorld / WORLD_SCALE;
    const p = d.map((v) => v * r);
    const g = gradAt(p);
    const mag = Math.hypot(...g);
    const cos = (g[0] * d[0] + g[1] * d[1] + g[2] * d[2]) / (mag || 1);
    if (!(mag >= 0.6 && mag <= 1.4)) { okMag = false; detail = `r=${rWorld} |g|=${mag}`; }
    if (!(cos >= 0.8)) { okCos = false; detail = `r=${rWorld} cos=${cos}`; }
  }
  check('(f) extended gradient magnitude is SDF-like (0.6..1.4)', okMag, detail);
  check('(f) extended gradient points radially (cos >= 0.8)', okCos, detail);
}

// ── (g) GLSL wiring ─────────────────────────────────────────
{
  const vel = lib.VEL_FRAG_HELPERS;
  const velAll = `${lib.VEL_FRAG_PREAMBLE}\n${lib.VEL_FRAG_HELPERS}`;
  const pos = lib.SIM_POS_FRAG;
  const extract = (src, sig) => {
    const i = src.indexOf(sig);
    if (i < 0) return '';
    const ls = src.lastIndexOf('\n', i) + 1;
    let depth = 0, k = src.indexOf('{', i);
    for (; k < src.length; k++) {
      if (src[k] === '{') depth += 1;
      else if (src[k] === '}') { depth -= 1; if (depth === 0) break; }
    }
    return src.slice(ls, k + 1);
  };
  for (const [name, src, srcAll] of [['velocity', vel, velAll], ['position', pos, pos]]) {
    check(`(g) ${name}: single-body query carries the extension`,
      src.includes('length((q - qc) * uMeshSdfDomainWorld)'));
    check(`(g) ${name}: per-body query carries the extension`,
      src.includes('length((q - qo) * domain)'));
    check(`(g) ${name}: per-body normal has the outside branch`,
      src.includes('any(lessThan(p, domLo))') && src.includes('any(greaterThan(p, domHi))'));
    check(`(g) ${name}: absent body stays +1e6`,
      src.includes('if (domain <= 0.0) return 1.0e6;'));
    const meshSamplers = srcAll.match(/uniform\s+sampler3D\s+uMeshSdf\w*/g) ?? [];
    check(`(g) ${name}: exactly one mesh SDF sampler`, meshSamplers.length === 1, meshSamplers.join(' | '));
  }
  for (const sig of ['float meshSdfDistance(vec3 p)', 'vec3 meshSdfNormal(vec3 p)', 'float meshSdfBodyDistance(int i, vec3 p)', 'vec3 meshSdfBodyNormal(int i, vec3 p)']) {
    check(`(g) copies identical: ${sig}`, extract(vel, sig) !== '' && extract(vel, sig) === extract(pos, sig));
  }
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
