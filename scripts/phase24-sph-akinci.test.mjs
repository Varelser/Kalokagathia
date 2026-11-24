// Phase 24 — SPH surface tension, Akinci form (§9-1 candidate E):
// a two-term model (Akinci spline-kernel cohesion + colour-field
// curvature correction) added beside the Phase AB cohesion.
//
// What is pinned here (node side):
//   - OFF identity: with the new key at 0, the built velocity
//     shader is the stock string byte-for-byte (and matches its
//     recorded phase18 baseline hash); no Akinci text or uniform
//     name appears anywhere in the stock string. The variant
//     exists only behind the sphAkinci builder option.
//   - The variant predicate: sphAkinci follows the new key's
//     sign (and SPH being on), nothing else.
//   - Routing: the new key alone requests 'sph-surface-tension'
//     in the capability report (WebGL fallback), like the
//     legacy key.
//   - TS twin (sphSurfaceTensionAkinciForce): kernel sign shape
//     (weakly repulsive close, attractive mid-range, zero at
//     q = 1); a droplet surface particle is pulled inward; an
//     interior particle at the symmetry centre feels ~zero; no
//     neighbours means exactly zero; the force is finite and
//     under its analytic bound.
//   - No heating: a small droplet integrated with the TS force
//     alone (fixed dt, semi-implicit Euler, the shader's
//     strength * dt * 1.0 application) for 400 steps never
//     spreads past 1.05x its initial radius of gyration and
//     never goes NaN — the Phase AB failure mode.
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { readFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.p24akinci-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};
const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex');

await build({
  stdin: {
    contents: `
      export {
        SIM_VEL_FRAG, SIM_VEL_FRAG_PHASE19, SIM_VEL_FRAG_PHASE20, SIM_VEL_FRAG_PHASE24,
        buildVelocityFragment,
      } from './components/gpgpuShaderSimulationVelocity.ts';
      export { VEL_FRAG_PREAMBLE, VEL_FRAG_PREAMBLE_PHASE24, buildVelocityPreamble } from './components/gpgpuShaderSimulationVelocityPreamble.ts';
      export {
        VEL_FRAG_MAIN_SPH_GRAINS, VEL_FRAG_MAIN_SPH_GRAINS_PHASE19, VEL_FRAG_MAIN_SPH_GRAINS_PHASE24,
        buildVelocitySphGrains,
      } from './components/gpgpuShaderSimulationVelocityMainSphGrains.ts';
      export { velocityVariantOptions } from './components/useGpgpuSimulationAssets.ts';
      export {
        sphSurfaceTensionAkinciForce, sphAkinciCohesionKernel,
        SPH_AKINCI_COHESION_SCALE, SPH_AKINCI_CURVATURE_GAIN,
      } from './lib/gpgpuLifecycle.ts';
      export { getWebgpuComputeCapabilityReport } from './lib/webgpuComputeFoundation.ts';
      export { DEFAULT_CONFIG } from './lib/appStateConfigDefaults.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});
const M = await import(pathToFileURL(BUNDLE).href);
unlinkSync(BUNDLE);

// ── (a) OFF byte identity ────────────────────────────────────
check('stock velocity shader carries no Akinci text',
  !M.SIM_VEL_FRAG.includes('Akinci') && !M.SIM_VEL_FRAG.includes('uSphSurfaceTensionAkinci'));
check("buildVelocityFragment('') === SIM_VEL_FRAG", M.buildVelocityFragment('') === M.SIM_VEL_FRAG);
check('buildVelocitySphGrains() === stock chunk', M.buildVelocitySphGrains() === M.VEL_FRAG_MAIN_SPH_GRAINS);
check('buildVelocityPreamble() === stock preamble', M.buildVelocityPreamble() === M.VEL_FRAG_PREAMBLE);
check('phase19/phase20 strings carry no Akinci text',
  !M.SIM_VEL_FRAG_PHASE19.includes('Akinci') && !M.SIM_VEL_FRAG_PHASE20.includes('Akinci')
  && !M.VEL_FRAG_MAIN_SPH_GRAINS_PHASE19.includes('Akinci'));
const baseline = JSON.parse(readFileSync(join(ROOT, 'scripts', 'phase18-shader-hash.baseline.json'), 'utf8'));
check('stock SIM_VEL_FRAG hash === recorded baseline',
  sha256(M.SIM_VEL_FRAG) === baseline.parts.SIM_VEL_FRAG.sha256);
check('stock SPH/Grains chunk hash === recorded baseline',
  sha256(M.VEL_FRAG_MAIN_SPH_GRAINS) === baseline.parts.VEL_FRAG_MAIN_SPH_GRAINS.sha256);
check('SIM_VEL_FRAG_PHASE24 hash === recorded pin',
  sha256(M.SIM_VEL_FRAG_PHASE24) === baseline.parts.SIM_VEL_FRAG_PHASE24.sha256);
check('buildVelocityFragment(phase24) === SIM_VEL_FRAG_PHASE24',
  M.buildVelocityFragment('', '', { grainsFullScan: true, flip3dCouple: true, steeringSeek: true, sphAkinci: true }) === M.SIM_VEL_FRAG_PHASE24);
check('buildVelocityFragment(akinci-only) differs from stock',
  M.buildVelocityFragment('', '', { sphAkinci: true }) !== M.SIM_VEL_FRAG);
check('akinci variant splices the uniform + application',
  M.SIM_VEL_FRAG_PHASE24.includes('uniform float uSphSurfaceTensionAkinci;')
  && M.SIM_VEL_FRAG_PHASE24.includes('akinciCohesionForce + akinciCurvatureForce'));
check('new key default is 0', M.DEFAULT_CONFIG.gpgpuSphSurfaceTensionAkinci === 0);

// ── variant predicate + routing ──────────────────────────────
const pred = (over) => M.velocityVariantOptions({ ...M.DEFAULT_CONFIG, ...over }).sphAkinci;
check('predicate: key 0 → variant off', pred({ gpgpuSphEnabled: true, gpgpuSphSurfaceTensionAkinci: 0 }) === false);
check('predicate: key > 0 + SPH on → variant on', pred({ gpgpuSphEnabled: true, gpgpuSphSurfaceTensionAkinci: 1 }) === true);
check('predicate: key > 0 + SPH off → variant off', pred({ gpgpuSphEnabled: false, gpgpuSphSurfaceTensionAkinci: 1 }) === false);
const report = (over) => M.getWebgpuComputeCapabilityReport({ ...M.DEFAULT_CONFIG, ...over });
check("routing: Akinci key alone requests 'sph-surface-tension'",
  report({ gpgpuSphEnabled: true, gpgpuSphSurfaceTensionAkinci: 1 }).requestedFeatures.includes('sph-surface-tension'));
check('routing: both keys 0 → no surface-tension request',
  !report({ gpgpuSphEnabled: true }).requestedFeatures.includes('sph-surface-tension'));

// ── (b) TS twin properties ───────────────────────────────────
const K = M.sphAkinciCohesionKernel;
check('kernel: q=0 is -1/64 (weak repulsion)', Math.abs(K(0) - -0.015625) < 1e-12);
check('kernel: q=0.25 is negative', K(0.25) < 0);
check('kernel: q=0.5 peaks at +1/64', Math.abs(K(0.5) - 0.015625) < 1e-12);
check('kernel: q=0.75 is positive', K(0.75) > 0);
check('kernel: q>=1 is zero', K(1) === 0 && K(1.5) === 0);

// A small lattice droplet: spacing 11, radius 22, kernel radius
// 20 (nearest neighbours sit at q = 0.55, the attractive range).
function latticeBall(spacing, radius) {
  const pts = [];
  const n = Math.ceil(radius / spacing);
  for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) for (let k = -n; k <= n; k++) {
    const p = { x: i * spacing, y: j * spacing, z: k * spacing };
    if (Math.hypot(p.x, p.y, p.z) <= radius + 1e-9) pts.push(p);
  }
  return pts;
}
const H = 20;
const ball = latticeBall(11, 22);
const asNeighbours = (pts, self) => pts.filter((p) => p !== self).map((pos) => ({ pos }));

const centre = ball.find((p) => p.x === 0 && p.y === 0 && p.z === 0);
const fCentre = M.sphSurfaceTensionAkinciForce(centre, asNeighbours(ball, centre), H, 1);
check('interior (symmetry centre) force is ~zero',
  Math.hypot(fCentre.x, fCentre.y, fCentre.z) < 1e-9,
  `|F| = ${Math.hypot(fCentre.x, fCentre.y, fCentre.z)}`);

const surface = ball.find((p) => p.x === 22 && p.y === 0 && p.z === 0);
const fSurface = M.sphSurfaceTensionAkinciForce(surface, asNeighbours(ball, surface), H, 1);
const inward = -fSurface.x; // centre is at -x from this particle
check('surface particle is pulled inward', fSurface.x < 0 && inward > 0.1,
  `F = (${fSurface.x}, ${fSurface.y}, ${fSurface.z})`);
check('surface force is along the inward axis (y/z ~ 0)',
  Math.abs(fSurface.y) < 1e-9 && Math.abs(fSurface.z) < 1e-9);

const fNone = M.sphSurfaceTensionAkinciForce({ x: 0, y: 0, z: 0 }, [], H, 1);
check('no neighbours → exactly zero', fNone.x === 0 && fNone.y === 0 && fNone.z === 0);
const fZero = M.sphSurfaceTensionAkinciForce(surface, asNeighbours(ball, surface), H, 0);
check('strength 0 → exactly zero', fZero.x === 0 && fZero.y === 0 && fZero.z === 0);

// Boundedness on a disordered cloud (deterministic LCG jitter).
let seed = 1234567;
const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const cloud = [];
for (let i = 0; i < 120; i++) cloud.push({ x: (rand() - 0.5) * 50, y: (rand() - 0.5) * 50, z: (rand() - 0.5) * 50 });
let boundOk = true;
let boundDetail = '';
for (const p of cloud) {
  const ns = cloud.filter((q) => q !== p);
  const inRange = ns.filter((q) => Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z) < H).length;
  const f = M.sphSurfaceTensionAkinciForce(p, ns.map((pos) => ({ pos })), H, 1);
  const mag = Math.hypot(f.x, f.y, f.z);
  const bound = 0.5 * inRange + (6 * inRange / (H * H)) * M.SPH_AKINCI_CURVATURE_GAIN + 1e-9;
  if (!Number.isFinite(mag) || mag > bound) { boundOk = false; boundDetail = `|F| = ${mag}, bound = ${bound}`; break; }
}
check('force is finite and under its analytic bound on a disordered cloud', boundOk, boundDetail);

// ── (c) no heating under the force alone ─────────────────────
{
  // Near-equilibrium droplet: lattice spacing 11 (q = 0.55 at
  // h = 20), small deterministic jitter, zero initial velocity.
  let s2 = 987654321;
  const rnd = () => { s2 = (s2 * 1103515245 + 12345) & 0x7fffffff; return s2 / 0x7fffffff; };
  const pts = latticeBall(11, 22).map((p) => ({
    pos: { x: p.x + (rnd() - 0.5), y: p.y + (rnd() - 0.5), z: p.z + (rnd() - 0.5) },
    vel: { x: 0, y: 0, z: 0 },
  }));
  const gyration = () => {
    const c = { x: 0, y: 0, z: 0 };
    for (const p of pts) { c.x += p.pos.x; c.y += p.pos.y; c.z += p.pos.z; }
    c.x /= pts.length; c.y /= pts.length; c.z /= pts.length;
    let acc = 0;
    for (const p of pts) acc += (p.pos.x - c.x) ** 2 + (p.pos.y - c.y) ** 2 + (p.pos.z - c.z) ** 2;
    return Math.sqrt(acc / pts.length);
  };
  const dt = 0.01;
  const steps = 400;
  const rg0 = gyration();
  let rgMax = rg0;
  let finite = true;
  for (let step = 0; step < steps; step++) {
    const forces = pts.map((p) => M.sphSurfaceTensionAkinciForce(
      p.pos, pts.filter((q) => q !== p).map((q) => ({ pos: q.pos })), H, 1));
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const f = forces[i];
      p.vel.x += f.x * 1 * dt * 1.0;
      p.vel.y += f.y * 1 * dt * 1.0;
      p.vel.z += f.z * 1 * dt * 1.0;
      p.pos.x += p.vel.x * dt;
      p.pos.y += p.vel.y * dt;
      p.pos.z += p.vel.z * dt;
      if (!Number.isFinite(p.pos.x + p.pos.y + p.pos.z + p.vel.x + p.vel.y + p.vel.z)) finite = false;
    }
    rgMax = Math.max(rgMax, gyration());
  }
  check('droplet integration stays finite (no NaN)', finite);
  check(`droplet never spreads past 1.05x initial gyration (max ${rgMax.toFixed(3)} vs ${(rg0 * 1.05).toFixed(3)})`,
    rgMax <= rg0 * 1.05, `rg0 = ${rg0}, rgMax = ${rgMax}`);
}

console.log(failures === 0 ? 'phase24-sph-akinci: ALL PASS' : `phase24-sph-akinci: ${failures} FAIL`);
process.exit(failures === 0 ? 0 : 1);
