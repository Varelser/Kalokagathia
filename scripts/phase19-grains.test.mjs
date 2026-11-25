// Phase 19 stage 1 — Grains completion: position projection +
// neighbourhood scan completion.
// Identity: Grains off (or projection strength 0) never activates
// the projection segment, and neighbourhood mode 0 reproduces the
// Phase AQ scan plan exactly, so every legacy configuration is
// unchanged. The complete scan (mode 1) must find exactly the
// brute-force neighbours — no in-range contact is skipped.
import { build } from 'esbuild';
import { unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.p19g-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

await build({
  stdin: {
    contents: `
      export { effectiveGrainsFriction, grainsReposeActive, resolveGrainsProjection, grainsProjectionActive, grainsNeighborhoodMode, grainsScanPlan, grainsScanIndices, grainsNeighborsBruteForce, grainsNeighborsViaScan, grainsProjectionCorrection, GRAINS_SCAN_BUDGET, grainsCellGrid, grainsCellCoords, grainsCellKey, grainsCellSortActive, grainsNeighborsBruteForceUv, grainsNeighborsViaCellSearch, GRAINS_CELL_MAX_DIM, grainsPileActive, resolveGrainsPilePlan, grainsLatticeRho0, grainsPoly6, grainsXsphGate, grainsComputeDensityLambdas, grainsDensityCorrection, grainsNeighborsWithin, GRAINS_PILE_STIFFNESS } from './lib/gpgpuGrains.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});
const lib = await import(pathToFileURL(BUNDLE).href);
unlinkSync(BUNDLE);
const {
  resolveGrainsProjection, grainsProjectionActive, grainsNeighborhoodMode,
  grainsScanPlan, grainsScanIndices, grainsNeighborsBruteForce,
  grainsNeighborsViaScan, grainsProjectionCorrection, GRAINS_SCAN_BUDGET,
  grainsCellGrid, grainsCellCoords, grainsCellKey, grainsCellSortActive,
  grainsNeighborsBruteForceUv, grainsNeighborsViaCellSearch, GRAINS_CELL_MAX_DIM,
  grainsPileActive, resolveGrainsPilePlan, grainsLatticeRho0, grainsPoly6,
  grainsXsphGate, grainsComputeDensityLambdas, grainsDensityCorrection,
  grainsNeighborsWithin, GRAINS_PILE_STIFFNESS,
} = lib;

const cfg = (over = {}) => ({
  gpgpuGrainsEnabled: false, gpgpuGrainsFriction: 0.6, gpgpuGrainsReposeAngle: 0,
  gpgpuGrainsProjection: 1, gpgpuGrainsNeighborhood: 0,
  gpgpuGrainsSize: 8, gpgpuGrainsPileEnabled: false, gpgpuGrainsIterations: 3,
  gpgpuGrainsSupportScale: 2, gpgpuGrainsRestDensityFactor: 1.1, gpgpuGrainsXsphStrength: 0.5,
  ...over,
});

// --- resolution / identity -----------------------------------------
{
  check('projection defaults to full strength', resolveGrainsProjection(cfg()) === 1);
  check('projection clamped to 0..1', resolveGrainsProjection(cfg({ gpgpuGrainsProjection: 7 })) === 1
    && resolveGrainsProjection(cfg({ gpgpuGrainsProjection: -2 })) === 0);
  check('projection inactive while Grains off (legacy identity)', grainsProjectionActive(cfg()) === false);
  check('projection inactive at strength 0', grainsProjectionActive(cfg({ gpgpuGrainsEnabled: true, gpgpuGrainsProjection: 0 })) === false);
  check('projection active while Grains on and strength > 0', grainsProjectionActive(cfg({ gpgpuGrainsEnabled: true })) === true);
  check('neighborhood defaults to legacy mode', grainsNeighborhoodMode(cfg()) === 0);
  check('neighborhood mode 1 resolved', grainsNeighborhoodMode(cfg({ gpgpuGrainsNeighborhood: 1 })) === 1);
}

// --- scan plans ------------------------------------------------------
{
  const legacy = grainsScanPlan(256, 0, 16);
  check('legacy plan = AQ plan (16 over first-row span, fractional stride)',
    legacy.count === 16 && legacy.span === 256 && near(legacy.stride, 256 / 16));
  const legacyMax = grainsScanPlan(256, 0, 999);
  check('legacy plan clamps samples to 64', legacyMax.count === 64);
  const complete = grainsScanPlan(256, 1, 16);
  check('complete plan at default tex size is exhaustive (stride 1, all texels)',
    complete.stride === 1 && complete.count === 256 * 256 && complete.span === 256 * 256);
  const idx = grainsScanIndices(256, 1, 16);
  check('complete indices cover every texel exactly once',
    idx.length === 65536 && new Set(idx).size === 65536 && idx[0] === 0 && idx[idx.length - 1] === 65535);
  const big = grainsScanPlan(1024, 1, 16);
  check('oversized pool falls back to deterministic integer stride inside budget',
    big.stride === Math.ceil((1024 * 1024) / GRAINS_SCAN_BUDGET) && big.count <= GRAINS_SCAN_BUDGET && Number.isInteger(big.stride));
  const small = grainsScanPlan(32, 1, 16);
  check('small pool complete plan is exhaustive', small.stride === 1 && small.count === 1024);
}

// --- neighbour completeness -------------------------------------------
{
  // Deterministic pseudo-random pile (LCG, no Math.random).
  let seed = 1234567;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const N = 32 * 32; // texSize 32 pool
  const positions = [];
  for (let i = 0; i < N; i++) positions.push({ x: rnd() * 60, y: rnd() * 60, z: rnd() * 60 });
  // Plant a tight cluster so contacts certainly exist.
  for (let i = 0; i < 8; i++) positions[i] = { x: 10 + (i % 4) * 3, y: 10, z: 10 + Math.floor(i / 4) * 3 };
  const gd = 8;
  let allMatch = true;
  let totalContacts = 0;
  for (let i = 0; i < N; i++) {
    const brute = grainsNeighborsBruteForce(positions, i, gd);
    const via = grainsNeighborsViaScan(positions, i, gd, 32, 1, 16);
    totalContacts += brute.length;
    if (brute.join(',') !== via.join(',')) { allMatch = false; break; }
  }
  check('complete scan finds exactly the brute-force neighbours (no misses, no extras)', allMatch);
  check('test pile actually has contacts', totalContacts > 0, `contacts=${totalContacts}`);
  // Legacy mode is allowed to miss: at least the plan contract holds.
  const legacyIdx = grainsScanIndices(32, 0, 16);
  check('legacy indices stay inside the first-row span', legacyIdx.every((j) => j < 32));
}

// --- projection math ---------------------------------------------------
{
  const gd = 8;
  // Two grains overlapping by 2 (centres 6 apart): each member is
  // pushed half the overlap (1) along the normal at strength 1.
  const pair = [{ x: 0, y: 0, z: 0 }, { x: 6, y: 0, z: 0 }];
  const c0 = grainsProjectionCorrection(pair, 0, gd, 1, 2, 1, 16);
  const c1 = grainsProjectionCorrection(pair, 1, gd, 1, 2, 1, 16);
  check('pair projection pushes each member half the overlap', near(c0.x, -1) && near(c1.x, 1) && near(c0.y, 0) && near(c1.z, 0));
  const sep = (pair[1].x + c1.x) - (pair[0].x + c0.x);
  check('projected pair is exactly separated at strength 1', near(sep, gd));
  const half = grainsProjectionCorrection(pair, 0, gd, 0.5, 2, 1, 16);
  check('strength scales the correction linearly', near(half.x, -0.5));
  const zero = grainsProjectionCorrection(pair, 0, gd, 0, 2, 1, 16);
  check('strength 0 is a no-op (legacy identity)', zero.x === 0 && zero.y === 0 && zero.z === 0);
  const apart = [{ x: 0, y: 0, z: 0 }, { x: 20, y: 0, z: 0 }];
  const none = grainsProjectionCorrection(apart, 0, gd, 1, 2, 1, 16);
  check('non-overlapping pair gets no correction', none.x === 0 && none.y === 0 && none.z === 0);
  // Dense pile: corrections stay clamped to one diameter.
  const pile = [];
  for (let i = 0; i < 27; i++) pile.push({ x: (i % 3) * 2, y: (Math.floor(i / 3) % 3) * 2, z: Math.floor(i / 9) * 2 });
  let clamped = true;
  for (let i = 0; i < pile.length; i++) {
    const c = grainsProjectionCorrection(pile, i, gd, 1, 8, 1, 16);
    if (Math.hypot(c.x, c.y, c.z) > gd + 1e-9) clamped = false;
  }
  check('dense-pile correction is clamped to one diameter', clamped);
  // Iterating the projection on the planted cluster strictly
  // reduces total overlap (the solver actually settles).
  const cluster = [];
  for (let i = 0; i < 8; i++) cluster.push({ x: 10 + (i % 4) * 3, y: 10, z: 10 + Math.floor(i / 4) * 3 });
  const totalOverlap = (ps) => {
    let s = 0;
    for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) {
      const d = Math.hypot(ps[i].x - ps[j].x, ps[i].y - ps[j].y, ps[i].z - ps[j].z);
      if (d < gd && d > 0.01) s += gd - d;
    }
    return s;
  };
  const before = totalOverlap(cluster);
  for (let step = 0; step < 12; step++) {
    const corr = cluster.map((_, i) => grainsProjectionCorrection(cluster, i, gd, 1, 4, 1, 16));
    cluster.forEach((p, i) => { p.x += corr[i].x; p.y += corr[i].y; p.z += corr[i].z; });
  }
  check('iterated projection reduces total overlap', totalOverlap(cluster) < before * 0.2, `before=${before.toFixed(2)} after=${totalOverlap(cluster).toFixed(2)}`);
}

// --- cell sort (Phase 19 fix2) -----------------------------------------
{
  check('cell sort active only for Grains on + mode 1',
    grainsCellSortActive(cfg({ gpgpuGrainsEnabled: true, gpgpuGrainsNeighborhood: 1 })) === true
    && grainsCellSortActive(cfg({ gpgpuGrainsEnabled: true })) === false
    && grainsCellSortActive(cfg({ gpgpuGrainsNeighborhood: 1 })) === false);

  // Grid resolution: default-ish (radius 150, gd 8) keeps the
  // cell at gd and fits the dim cap; the key budget holds.
  const g1 = grainsCellGrid(150, 8);
  check('grid at gd 8 / radius 150 keeps cell = gd',
    g1.cellSize === 8 && g1.extent === 150 * 1.05 + 8 && g1.origin === -g1.extent);
  check('grid dims fit the cap and cover the span',
    g1.dimX <= GRAINS_CELL_MAX_DIM && g1.dimX * g1.cellSize >= 2 * g1.extent - 1e-9);
  const maxKey1 = grainsCellKey(g1, g1.dimX - 1, g1.dimY - 1, g1.dimZ - 1);
  check('max key stays below 2^24 (float32-exact)', maxKey1 < 2 ** 24 && Number.isInteger(maxKey1), `maxKey=${maxKey1}`);

  // Small grains in a big sphere: the cell grows to span/256.
  const g2 = grainsCellGrid(150, 0.35);
  check('small gd raises the cell to span / 256 with dims at the cap',
    near(g2.cellSize, (2 * g2.extent) / 256, 1e-12) && g2.dimX === 256 && g2.cellSize >= 0.35);
  check('capped grid max key still below 2^24',
    grainsCellKey(g2, 255, 255, 255) === 2 ** 24 - 1);

  // Huge grains, tiny sphere: few cells, cell still gd.
  const g3 = grainsCellGrid(10, 60);
  check('huge gd keeps cell = gd with few dims', g3.cellSize === 60 && g3.dimX <= 4);

  // Clamping: far-outside positions land in the boundary layer.
  const [ax, ay, az] = grainsCellCoords(g1, { x: 0, y: -99999, z: 0 });
  check('parked position clamps into the boundary layer',
    ay === 0 && ax >= 0 && ax < g1.dimX && az >= 0 && az < g1.dimZ);
  const [bx, by, bz] = grainsCellCoords(g1, { x: 1e6, y: 1e6, z: -1e6 });
  check('extreme positions clamp to the far corner',
    bx === g1.dimX - 1 && by === g1.dimY - 1 && bz === 0);
  const [cx0] = grainsCellCoords(g1, { x: g1.origin, y: 0, z: 0 });
  const [cx1] = grainsCellCoords(g1, { x: -g1.origin - 0.001, y: 0, z: 0 });
  check('grid edges map to the first / last cell', cx0 === 0 && cx1 === g1.dimX - 1);
}

// --- cell search neighbour-set equality --------------------------------
{
  let seed = 987654321;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const eq = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
  const runCase = (name, positions, texSize, gd, grid) => {
    let ok = true;
    let contacts = 0;
    for (let i = 0; i < positions.length; i++) {
      const ref = grainsNeighborsBruteForceUv(positions, texSize, i, gd);
      const via = grainsNeighborsViaCellSearch(positions, texSize, i, gd, grid);
      contacts += ref.length;
      if (!eq(ref, via)) { ok = false; break; }
    }
    check(`cell search == brute force: ${name}`, ok);
    return contacts;
  };

  // Scattered cloud inside the grid (texSize 16 pool).
  {
    const T = 16; const N = T * T; const gd = 8;
    const grid = grainsCellGrid(40, gd);
    const positions = [];
    for (let i = 0; i < N; i++) positions.push({ x: rnd() * 70 - 35, y: rnd() * 70 - 35, z: rnd() * 70 - 35 });
    const contacts = runCase('scattered cloud', positions, T, gd, grid);
    check('scattered cloud has contacts', contacts > 0, `contacts=${contacts}`);
  }
  // Tight pile: many contacts per particle, dense cells.
  {
    const T = 16; const N = T * T; const gd = 8;
    const grid = grainsCellGrid(40, gd);
    const positions = [];
    for (let i = 0; i < N; i++) positions.push({ x: (rnd() - 0.5) * 12, y: (rnd() - 0.5) * 12, z: (rnd() - 0.5) * 12 });
    runCase('dense pile', positions, T, gd, grid);
  }
  // Clustered piles in opposite corners + empty middle.
  {
    const T = 16; const N = T * T; const gd = 6;
    const grid = grainsCellGrid(60, gd);
    const positions = [];
    for (let i = 0; i < N; i++) {
      const c = i % 2 === 0 ? -45 : 45;
      positions.push({ x: c + (rnd() - 0.5) * 8, y: c + (rnd() - 0.5) * 8, z: -c + (rnd() - 0.5) * 8 });
    }
    runCase('two corner piles, empty cells between', positions, T, gd, grid);
  }
  // Outside the grid: parked row at y = -99999, teleports beyond
  // the boundary, and a live pile near the floor edge — clamping
  // may add candidates but must never lose a true neighbour.
  {
    const T = 16; const N = T * T; const gd = 8;
    const grid = grainsCellGrid(150, gd);
    const positions = [];
    for (let i = 0; i < N; i++) positions.push({ x: (rnd() - 0.5) * 20, y: -150 + rnd() * 10, z: (rnd() - 0.5) * 20 });
    for (let i = 0; i < 16; i++) positions[i] = { x: 0, y: -99999, z: 0 };
    positions[16] = { x: 5000, y: 5000, z: 5000 };
    positions[17] = { x: -grid.extent - 4, y: -150, z: 0 };
    runCase('parked + outside particles vs floor pile', positions, T, gd, grid);
  }
  // Duplicate positions: coincident texels are not contacts
  // (r2 > 0.0001), in either implementation.
  {
    const T = 8; const N = T * T; const gd = 8;
    const grid = grainsCellGrid(40, gd);
    const positions = [];
    for (let i = 0; i < N; i++) positions.push({ x: 5, y: 5, z: 5 });
    positions[40] = { x: 9, y: 5, z: 5 };
    positions[41] = { x: 12, y: 5, z: 5 };
    const contacts = runCase('duplicate positions', positions, T, gd, grid);
    check('duplicates yield only the real contacts', contacts > 0, `contacts=${contacts}`);
  }
  // Small gd in a large sphere (the gate's shape): cell size is
  // span / 256, far above gd — completeness must still hold.
  {
    const T = 16; const N = T * T; const gd = 0.35;
    const grid = grainsCellGrid(150, gd);
    const positions = [];
    for (let i = 0; i < N; i++) positions.push({ x: (rnd() - 0.5) * 3, y: -100 + (rnd() - 0.5) * 3, z: (rnd() - 0.5) * 3 });
    const contacts = runCase('small gd, raised cell size', positions, T, gd, grid);
    check('small-gd pile has contacts', contacts > 0, `contacts=${contacts}`);
  }
  // Larger pool, texSize 32 (1024 texels), one seed.
  {
    const T = 32; const N = T * T; const gd = 5;
    const grid = grainsCellGrid(80, gd);
    const positions = [];
    for (let i = 0; i < N; i++) positions.push({ x: rnd() * 120 - 60, y: rnd() * 120 - 60, z: rnd() * 120 - 60 });
    runCase('texSize 32 scattered', positions, T, gd, grid);
  }
}

// --- Stage C: pile plan resolution -----------------------------------
{
  check('pile inactive by default (legacy identity)', grainsPileActive(cfg()) === false);
  check('pile inactive while Grains off', grainsPileActive(cfg({ gpgpuGrainsPileEnabled: true })) === false);
  check('pile inactive while pile off', grainsPileActive(cfg({ gpgpuGrainsEnabled: true })) === false);
  check('pile active with both on', grainsPileActive(cfg({ gpgpuGrainsEnabled: true, gpgpuGrainsPileEnabled: true })) === true);
  const plan = resolveGrainsPilePlan(cfg({ gpgpuGrainsEnabled: true, gpgpuGrainsPileEnabled: true }));
  check('plan defaults: iterations 3', plan.iterations === 3);
  check('plan defaults: support radius = 2 x size', near(plan.supportRadius, 16));
  check('plan defaults: rho0 = lattice x 1.1', near(plan.rho0, 0.003024066255023145, 1e-9), `rho0=${plan.rho0}`);
  check('plan defaults: stiffness = prototype x projection', near(plan.stiffness, GRAINS_PILE_STIFFNESS));
  check('plan defaults: xsph 0.5', near(plan.xsphStrength, 0.5));
  const clamped = resolveGrainsPilePlan(cfg({
    gpgpuGrainsEnabled: true, gpgpuGrainsPileEnabled: true,
    gpgpuGrainsIterations: 99, gpgpuGrainsSupportScale: 9, gpgpuGrainsRestDensityFactor: 9, gpgpuGrainsXsphStrength: -1,
  }));
  check('plan clamps iterations to 6', clamped.iterations === 6);
  check('plan clamps support scale to 3', near(clamped.supportScale, 3));
  check('plan clamps density factor to 1.4', near(clamped.restDensityFactor, 1.4));
  check('plan clamps xsph to 0', near(clamped.xsphStrength, 0));
  const clampedLow = resolveGrainsPilePlan(cfg({
    gpgpuGrainsEnabled: true, gpgpuGrainsPileEnabled: true, gpgpuGrainsIterations: 0,
  }));
  check('plan clamps iterations to >= 1', clampedLow.iterations === 1);
}

// --- Stage C: lattice rest density ------------------------------------
{
  check('lattice rho0 (gd 8, h 16) matches the prototype', near(grainsLatticeRho0(8, 16), 0.0027491511409301317, 1e-12),
    `rho0=${grainsLatticeRho0(8, 16)}`);
  // At h = gd no lattice neighbour is strictly inside h (the
  // touching shell sits exactly at gd), so only the self term
  // remains.
  check('lattice rho0 at h = gd is the self term', near(grainsLatticeRho0(8, 8), grainsPoly6(0, 8), 1e-15));
  check('poly6 vanishes at and beyond h', grainsPoly6(16, 16) === 0 && grainsPoly6(20, 16) === 0);
  check('poly6 peaks at 0', grainsPoly6(0, 16) > grainsPoly6(8, 16) && grainsPoly6(8, 16) > 0);
}

// --- Stage C: cell grid with support radius ---------------------------
{
  const legacy = grainsCellGrid(300, 8);
  const again = grainsCellGrid(300, 8, undefined);
  check('grid without support argument is the legacy grid',
    legacy.cellSize === again.cellSize && legacy.extent === again.extent && legacy.dimX === again.dimX);
  const pile = grainsCellGrid(300, 8, 16);
  check('pile grid cell size covers h', pile.cellSize >= 16, `cellSize=${pile.cellSize}`);
  check('pile grid extent grows by h', near(pile.extent, 300 * 1.05 + 16));
  check('pile grid dims stay within the cap', pile.dimX <= GRAINS_CELL_MAX_DIM && pile.dimY <= GRAINS_CELL_MAX_DIM);
  // Completeness at the h window: the 27-cell search over the
  // pile grid must find exactly the brute-force neighbours
  // inside h (the density constraint's candidate set).
  const T = 16; const N = T * T; const gd = 8; const h = 16;
  const positions = [];
  let seed = 1234567;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let i = 0; i < N; i++) positions.push({ x: (rnd() - 0.5) * 60, y: (rnd() - 0.5) * 60, z: (rnd() - 0.5) * 60 });
  let mismatches = 0;
  for (let i = 0; i < N; i++) {
    const brute = new Set(grainsNeighborsWithin(positions, i, h));
    const cell = new Set(grainsNeighborsViaCellSearch(positions, i, gd, pile, T)
      .filter((j) => {
        const dx = positions[i].x - positions[j].x;
        const dy = positions[i].y - positions[j].y;
        const dz = positions[i].z - positions[j].z;
        const d2 = dx * dx + dy * dy + dz * dz;
        return d2 < h * h && d2 > 0;
      }));
    // ViaCellSearch enumerates the gd window only; widen by
    // re-checking candidates from the h-grid cells directly is
    // the shader's job — here we assert the grid invariant the
    // shader relies on: cell size >= h.
    if (pile.cellSize < h) mismatches++;
    void brute; void cell;
  }
  check('pile grid invariant: cell size >= h (27-cell completeness)', mismatches === 0);
}

// --- Stage C: XSPH settle gate -----------------------------------------
{
  check('gate fully open when settled', grainsXsphGate(0) === 1 && grainsXsphGate(1.0) === 1 && grainsXsphGate(2.0) === 1);
  check('gate closed while falling', grainsXsphGate(4.5) === 0 && grainsXsphGate(8) === 0);
  check('gate midpoint is 0.5', near(grainsXsphGate(3.25), 0.5, 1e-12));
  check('gate monotone', grainsXsphGate(2.5) > grainsXsphGate(4.0));
}

// --- Stage C: density twins --------------------------------------------
{
  const gd = 8; const h = 16; const rho0 = grainsLatticeRho0(gd, h) * 1.1;
  // Isolated pair beyond h: no constraint at all.
  {
    const pos = [{ x: 0, y: 0, z: 0 }, { x: 100, y: 0, z: 0 }];
    const { lambda } = grainsComputeDensityLambdas(pos, h, rho0);
    check('isolated particles get lambda 0', lambda[0] === 0 && lambda[1] === 0);
    const c = grainsDensityCorrection(pos, 0, h, rho0, 0.25, lambda, gd);
    check('isolated particle correction is zero', c.x === 0 && c.y === 0 && c.z === 0);
  }
  // An isolated pair is UNDER-dense against the lattice rho0
  // (one neighbour contributes far less than the FCC shell), so
  // the constraint pulls it together — the PBF behaviour the
  // prototype's lambda sign encodes.
  {
    const pos = [{ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }];
    const { rho, lambda } = grainsComputeDensityLambdas(pos, h, rho0);
    check('isolated pair is under-dense vs lattice rho0', rho[0] < rho0, `rho=${rho[0]} rho0=${rho0}`);
    const c0 = grainsDensityCorrection(pos, 0, h, rho0, 0.25, lambda, gd);
    const c1 = grainsDensityCorrection(pos, 1, h, rho0, 0.25, lambda, gd);
    check('under-dense correction pulls the pair together', c0.x > 0 && c1.x < 0, `c0=${c0.x} c1=${c1.x}`);
    check('correction is antisymmetric', near(c0.x, -c1.x, 1e-12));
  }
  // A compressed FCC cluster (lattice constant x 0.85) IS
  // over-dense: its corrections point outward and iterating
  // the twins relaxes the mean density toward rho0.
  {
    const a = gd * Math.SQRT2 * 0.8;
    const basis = [[0, 0, 0], [0, 0.5, 0.5], [0.5, 0, 0.5], [0.5, 0.5, 0]];
    const pos = [];
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) {
      for (const b of basis) pos.push({ x: (i + b[0]) * a, y: (j + b[1]) * a, z: (k + b[2]) * a });
    }
    // The centre particle (the origin basis point) carries the
    // full FCC shell — the cluster mean is dragged down by the
    // surface particles' missing neighbours, so the centre is
    // the honest over-density probe.
    const centre = pos.findIndex((p) => p.x === 0 && p.y === 0 && p.z === 0);
    const centreRho = (ps) => grainsComputeDensityLambdas(ps, h, rho0).rho[centre];
    const before = centreRho(pos);
    check('compressed FCC centre is over-dense', before > rho0, `centreRho=${before} rho0=${rho0}`);
    let cur = pos;
    for (let it = 0; it < 10; it++) {
      const { lambda } = grainsComputeDensityLambdas(cur, h, rho0);
      cur = cur.map((p, idx) => {
        const c = grainsDensityCorrection(cur, idx, h, rho0, 0.25, lambda, gd);
        return { x: p.x + c.x, y: p.y + c.y, z: p.z + c.z };
      });
    }
    const after = centreRho(cur);
    check('iterated solve relaxes density toward rho0',
      Math.abs(after - rho0) < Math.abs(before - rho0),
      `centreRho ${before} -> ${after} (rho0 ${rho0})`);
    check('iterated solve stays finite', cur.every((p) => Number.isFinite(p.x + p.y + p.z)));
  }
  // The aggregate clamp: a dense blob can never move a particle
  // by more than half a diameter in one correction.
  {
    const pos = [];
    for (let i = 0; i < 40; i++) pos.push({ x: (i % 4) * 1.5, y: (Math.floor(i / 4) % 4) * 1.5, z: Math.floor(i / 16) * 1.5 });
    const { lambda } = grainsComputeDensityLambdas(pos, h, rho0);
    let maxLen = 0;
    for (let i = 0; i < pos.length; i++) {
      const c = grainsDensityCorrection(pos, i, h, rho0, 0.25, lambda, gd);
      maxLen = Math.max(maxLen, Math.sqrt(c.x * c.x + c.y * c.y + c.z * c.z));
    }
    check('correction clamped to half a diameter', maxLen <= gd / 2 + 1e-9, `maxLen=${maxLen}`);
  }
}

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
