// Phase 19 stage 2 — FLIP completion (3D grid / grid viscosity
// / surface tension / whitewater 3D free surface).
// Identity: gpgpuFlipMode defaults to '2d', the new keys default
// to 0, and the legacy 2D shader files are hash-pinned to their
// stage-0 values, so the 2D path is untouched by construction.
// The numerics are pinned through the CPU mirrors in
// lib/flip3d.ts and the whitewater3d* twin in lib/whitewater.ts.
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { readFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.p19f-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

await build({
  stdin: {
    contents: `
      export { flip3dCellUv, resolveFlip3dResolution, flip3dMode, flip3dActive, flip3dHalfExtent, flip3dPassCount, flip3dIndex, flip3dChiFromWeights, flip3dPhiFromChi, flip3dNormal, flip3dCurvatureAt, flip3dMaxDivergence, flip3dPressureProject, flip3dViscositySolve, FLIP3D_VISCOSITY_ITERATIONS } from './lib/flip3d.ts';
      export { pyroGridCellUv, resolvePyroGridResolution, pyroGridAtlasSize, PYRO_GRID_LAYOUTS } from './lib/pyroGrid.ts';
      export { whitewater3dCandidateCell, whitewater3dSource, whitewater3dSpawnDecision, whitewater3dExpectedSpawns, WHITEWATER3D_SURFACE_BAND } from './lib/whitewater.ts';
      export { APP_STATE_DEFAULT_GPGPU } from './lib/appStateDefaultGpgpu.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});
const lib = await import(pathToFileURL(BUNDLE).href);
unlinkSync(BUNDLE);
const {
  flip3dCellUv, resolveFlip3dResolution, flip3dMode, flip3dActive,
  flip3dPassCount, flip3dIndex, flip3dChiFromWeights, flip3dPhiFromChi,
  flip3dCurvatureAt, flip3dMaxDivergence, flip3dPressureProject,
  flip3dViscositySolve, FLIP3D_VISCOSITY_ITERATIONS,
  pyroGridCellUv, resolvePyroGridResolution, pyroGridAtlasSize, PYRO_GRID_LAYOUTS,
  whitewater3dCandidateCell, whitewater3dSpawnDecision, whitewater3dExpectedSpawns,
  APP_STATE_DEFAULT_GPGPU,
} = lib;

// Deterministic pseudo-random source (LCG, no Math.random).
let seed = 987654321;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

// --- identity pins ---------------------------------------------------
{
  const d = APP_STATE_DEFAULT_GPGPU;
  check("flip mode defaults to '2d' (legacy identity)", d.gpgpuFlipMode === '2d');
  check('flip 3d resolution defaults to 0 (tier auto)', d.gpgpuFlip3dResolution === 0);
  check('flip viscosity defaults to 0 (no passes)', d.gpgpuFlipViscosity === 0);
  check('flip surface tension defaults to 0 (no passes)', d.gpgpuFlipSurfaceTension === 0);
  check("mode resolution: missing/garbage key resolves to '2d'",
    flip3dMode({}) === '2d' && flip3dMode({ gpgpuFlipMode: 'bogus' }) === '2d'
    && flip3dMode({ gpgpuFlipMode: '3d' }) === '3d');
  check('active requires mode 3d + flip on + fluid on',
    flip3dActive({ gpgpuFlipMode: '3d', gpgpuFlipEnabled: true, gpgpuFluidEnabled: true }) === true
    && flip3dActive({ gpgpuFlipMode: '3d', gpgpuFlipEnabled: false, gpgpuFluidEnabled: true }) === false
    && flip3dActive({ gpgpuFlipMode: '2d', gpgpuFlipEnabled: true, gpgpuFluidEnabled: true }) === false);
  const sha = (p) => createHash('sha256').update(readFileSync(join(ROOT, p))).digest('hex');
  check('legacy 2D FLIP shader file untouched (stage-0 hash pin)',
    sha('components/gpgpuShaderSimulationFluid.ts') === 'af00b60b87eff189ff85c3e18cce20d4e684f476b62c2be294c521a9a6d37a4c',
    sha('components/gpgpuShaderSimulationFluid.ts'));
  check('legacy 2D whitewater shader file untouched (stage-0 hash pin)',
    sha('components/gpgpuShaderWhitewater.ts') === '5c2014a994c3e53668a57d5ed3d59bcee9845789bdc66cb0509f3eba886c2984',
    sha('components/gpgpuShaderWhitewater.ts'));
}

// --- atlas sharing -----------------------------------------------------
{
  let uvMatch = true;
  let roundtrip = true;
  for (const n of [32, 48, 64, 96]) {
    const layout = PYRO_GRID_LAYOUTS[n];
    const size = pyroGridAtlasSize(n);
    const cells = [
      { x: 0, y: 0, z: 0 },
      { x: n - 1, y: n - 1, z: n - 1 },
      { x: 0, y: n - 1, z: layout.cols },
      { x: n - 1, y: 0, z: layout.cols * layout.rows - 1 },
      { x: Math.floor(n / 2), y: Math.floor(n / 3), z: Math.floor(n / 2) },
    ];
    for (const c of cells) {
      const a = flip3dCellUv(n, c);
      const b = pyroGridCellUv(n, c);
      if (!a || !b || a.u !== b.u || a.v !== b.v) uvMatch = false;
      // Inverse (the GLSL pyroCellOf arithmetic): uv -> cell.
      const px = a.u * size.width;
      const py = a.v * size.height;
      const tileX = Math.floor(px / n);
      const tileY = Math.floor(py / n);
      const back = {
        x: Math.floor(px - tileX * n),
        y: Math.floor(py - tileY * n),
        z: tileY * layout.cols + tileX,
      };
      if (back.x !== c.x || back.y !== c.y || back.z !== c.z) roundtrip = false;
    }
  }
  check('flip3d atlas uv equals the shared pyro mapping at all resolutions / boundary cells', uvMatch);
  check('atlas uv -> cell roundtrip is exact (incl. tile boundaries)', roundtrip);

  let resMatch = true;
  for (const tier of ['entry', 'standard', 'high', 'flagship']) {
    for (const ov of [0, 32, 48, 64, 96, 999]) {
      if (resolveFlip3dResolution(tier, ov) !== resolvePyroGridResolution(tier, ov)) resMatch = false;
    }
  }
  check('flip3d resolution rule equals the shared pyro rule (tier x override table)', resMatch);
  check('tier defaults: entry 32 / standard 48 / high 64',
    resolveFlip3dResolution('entry', 0) === 32
    && resolveFlip3dResolution('standard', 0) === 48
    && resolveFlip3dResolution('high', 0) === 64);
  check('pass count: base 20 at 16 pressure iterations, +4 viscosity, +2 tension',
    flip3dPassCount({ pressureIterations: 16 }) === 20
    && flip3dPassCount({ pressureIterations: 16, viscosity: 1 }) === 24
    && flip3dPassCount({ pressureIterations: 16, surfaceTension: 1 }) === 22
    && FLIP3D_VISCOSITY_ITERATIONS === 4);
}

// --- pressure projection with a free surface ---------------------------
{
  const n = 8;
  const total = n * n * n;
  const chi = new Float32Array(total);
  for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    chi[flip3dIndex(n, x, y, z)] = y < n / 2 ? 1 : 0;
  }
  // Hydrostatic rest: still liquid under a free surface stays still.
  const zeroVel = new Float32Array(total * 3);
  const rest = flip3dPressureProject(zeroVel, chi, n, 16);
  let restMax = 0;
  for (const v of rest.vel) restMax = Math.max(restMax, Math.abs(v));
  check('hydrostatic rest: zero velocity projects to zero velocity', restMax === 0, `max=${restMax}`);
  // Divergent liquid motion: divergence collapses, air pressure
  // stays pinned at 0 (atmospheric), air velocity is untouched.
  const vel = new Float32Array(total * 3);
  for (let i = 0; i < total; i++) {
    const y = Math.floor(i / n) % n;
    if (y < n / 2) { vel[i * 3] = rnd() * 2 - 1; vel[i * 3 + 1] = rnd() * 2 - 1; vel[i * 3 + 2] = rnd() * 2 - 1; }
  }
  const divBefore = flip3dMaxDivergence(vel, chi, n);
  const proj = flip3dPressureProject(vel, chi, n, 60);
  const divAfter = flip3dMaxDivergence(proj.vel, chi, n);
  check('projection reduces max divergence by >4x', divAfter < divBefore * 0.25, `before=${divBefore.toFixed(3)} after=${divAfter.toFixed(4)}`);
  let airP = 0;
  let airVelSame = true;
  for (let z = 0; z < n; z++) for (let y = n / 2; y < n; y++) for (let x = 0; x < n; x++) {
    const idx = flip3dIndex(n, x, y, z);
    airP = Math.max(airP, Math.abs(proj.pressure[idx]));
    for (let a = 0; a < 3; a++) if (proj.vel[idx * 3 + a] !== vel[idx * 3 + a]) airVelSame = false;
  }
  check('air cells keep pressure exactly 0 (free-surface BC)', airP === 0, `max=${airP}`);
  check('air cells keep their velocity verbatim (grid solves no air)', airVelSame);
}

// --- grid viscosity ------------------------------------------------------
{
  const n = 8;
  const total = n * n * n;
  const chi = new Float32Array(total).fill(1);
  const vel = new Float32Array(total * 3);
  for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const idx = flip3dIndex(n, x, y, z);
    vel[idx * 3] = Math.sin(x * 0.9) * 2 + y * 0.3;
    vel[idx * 3 + 1] = Math.cos(z * 0.7) * 1.5;
    vel[idx * 3 + 2] = Math.sin((x + z) * 0.5);
  }
  const identity = flip3dViscositySolve(vel, chi, n, 0, FLIP3D_VISCOSITY_ITERATIONS);
  check('viscosity alpha 0 is the identity', identity.every((v, i) => v === vel[i]));
  const solved = flip3dViscositySolve(vel, chi, n, 0.5, FLIP3D_VISCOSITY_ITERATIONS);
  const energy = (v) => { let s = 0; for (const x of v) s += x * x; return s; };
  check('viscosity reduces kinetic energy', energy(solved) < energy(vel),
    `before=${energy(vel).toFixed(2)} after=${energy(solved).toFixed(2)}`);
  let momOk = true;
  for (let a = 0; a < 3; a++) {
    let before = 0; let after = 0;
    for (let i = 0; i < total; i++) { before += vel[i * 3 + a]; after += solved[i * 3 + a]; }
    if (!near(after, before, 1e-6 * Math.max(1, Math.abs(before)))) momOk = false;
  }
  check('viscosity conserves total momentum (zero-gradient boundaries)', momOk);
}

// --- surface tension curvature -------------------------------------------
{
  const n = 16;
  const total = n * n * n;
  const centre = (n - 1) / 2;
  const radius = 5;
  const sphereChi = (sign) => {
    const chi = new Float32Array(total);
    for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const dist = Math.hypot(x - centre, y - centre, z - centre);
      chi[flip3dIndex(n, x, y, z)] = Math.max(0, Math.min(1, 0.5 + sign * (radius - dist) / 2));
    }
    return chi;
  };
  // Convex drop: kappa > 0 and roughly axis-symmetric.
  const phiDrop = flip3dPhiFromChi(sphereChi(1));
  const kAxes = [
    flip3dCurvatureAt(phiDrop, n, Math.round(centre + radius), Math.round(centre), Math.round(centre)),
    flip3dCurvatureAt(phiDrop, n, Math.round(centre), Math.round(centre + radius), Math.round(centre)),
    flip3dCurvatureAt(phiDrop, n, Math.round(centre), Math.round(centre), Math.round(centre + radius)),
  ];
  check('drop curvature is positive on all axes', kAxes.every((k) => k > 0.05), kAxes.map((k) => k.toFixed(3)).join(','));
  const kMean = (kAxes[0] + kAxes[1] + kAxes[2]) / 3;
  check('drop curvature is roughly axis-symmetric', kAxes.every((k) => Math.abs(k - kMean) < 0.45 * kMean),
    kAxes.map((k) => k.toFixed(3)).join(','));
  // Concave pocket (air bubble in liquid): sign flips.
  const phiBubble = flip3dPhiFromChi(sphereChi(-1));
  const kBubble = flip3dCurvatureAt(phiBubble, n, Math.round(centre + radius), Math.round(centre), Math.round(centre));
  check('concave pocket curvature flips sign', kBubble < -0.05, `k=${kBubble.toFixed(3)}`);
  // Flat surface: kappa ~ 0.
  const flatChi = new Float32Array(total);
  for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    flatChi[flip3dIndex(n, x, y, z)] = Math.max(0, Math.min(1, 0.5 + (centre - y) / 2));
  }
  const phiFlat = flip3dPhiFromChi(flatChi);
  const kFlat = flip3dCurvatureAt(phiFlat, n, 8, 8, 8);
  check('flat surface curvature is ~0', Math.abs(kFlat) < 1e-6, `k=${kFlat}`);
  // CSF direction: at the drop's +x surface cell, grad(chi)
  // points inward (-x) and kappa > 0, so sigma*kappa*grad(chi)
  // pulls the surface inward (the drop rounds itself).
  const chiDrop = sphereChi(1);
  const sx = Math.round(centre + radius);
  const sy = Math.round(centre);
  const gradChiX = (chiDrop[flip3dIndex(n, sx + 1, sy, sy)] - chiDrop[flip3dIndex(n, sx - 1, sy, sy)]) * 0.5;
  check('CSF force at a drop surface points inward (kappa>0, grad chi inward)',
    kAxes[0] > 0 && gradChiX < 0, `kappa=${kAxes[0].toFixed(3)} gradChiX=${gradChiX.toFixed(3)}`);
}

// --- whitewater 3D ---------------------------------------------------------
{
  const n = 16;
  const total = n * n * n;
  const chi = new Float32Array(total);
  const weights = new Float32Array(total);
  for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    if (y < n / 2) weights[flip3dIndex(n, x, y, z)] = 1;
  }
  const chiBlurred = flip3dChiFromWeights(weights, n, 1);
  const phi = flip3dPhiFromChi(chiBlurred);
  const still = new Float32Array(total * 3);
  const stillSpawns = whitewater3dExpectedSpawns({ vel: still, phi, chi: chiBlurred, n, tick: 3, threshold: 0.3, amount: 1 });
  check('whitewater 3d: still field spawns nothing', stillSpawns === 0, `spawns=${stillSpawns}`);
  // Agitated: strong vertical shear of vx across the liquid.
  const agit = new Float32Array(total * 3);
  for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    agit[flip3dIndex(n, x, y, z) * 3] = y * 2.0;
  }
  const agitSpawns = whitewater3dExpectedSpawns({ vel: agit, phi, chi: chiBlurred, n, tick: 3, threshold: 0.3, amount: 1 });
  check('whitewater 3d: agitated surface spawns foam', agitSpawns > 0, `spawns=${agitSpawns.toFixed(1)}`);
  // Deep field (phi far from the band everywhere): no spawns
  // even with the same agitation.
  const deepPhi = new Float32Array(total).fill(5);
  const deepChi = new Float32Array(total).fill(1);
  const deepSpawns = whitewater3dExpectedSpawns({ vel: agit, phi: deepPhi, chi: deepChi, n, tick: 3, threshold: 0.3, amount: 1 });
  check('whitewater 3d: no spawns away from the surface band', deepSpawns === 0, `spawns=${deepSpawns}`);
  // A concrete spawn: position lands inside the domain and on
  // the liquid surface layer (y below the mid-plane + band).
  let found = null;
  for (let s = 0; s < 512 && !found; s++) {
    const d = whitewater3dSpawnDecision({
      vel: agit, phi, chi: chiBlurred, n, wwIdx: s, tick: 3,
      threshold: 0.3, amount: 1, halfExtent: 100, velScale: 0.05,
    });
    if (d.spawned) found = d;
  }
  check('whitewater 3d: a spawn decision fires under agitation', found !== null);
  if (found) {
    check('whitewater 3d: spawn position is inside the domain cube',
      Math.abs(found.x) <= 100 && Math.abs(found.y) <= 100 && Math.abs(found.z) <= 100,
      `(${found.x.toFixed(1)}, ${found.y.toFixed(1)}, ${found.z.toFixed(1)})`);
    check('whitewater 3d: spawn sits on the surface layer, not the old thin sheet',
      found.y < 30, `y=${found.y.toFixed(1)}`);
    const cand = whitewater3dCandidateCell(0, 0, n);
    check('whitewater 3d: candidate cells cover all three axes',
      cand.i >= 0 && cand.i < n && cand.j >= 0 && cand.j < n && cand.k >= 0 && cand.k < n);
  }
}

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
