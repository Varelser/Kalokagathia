import { dmHash11 } from './gpgpuRandom';
// Whitewater (Phase BC): the foam layer derived from the FLIP
// field (Phase AT). This module is the TS twin of the GLSL in
// components/gpgpuShaderWhitewater.ts — the field operators
// (vorticity / divergence / foam factor), the spawn gate and the
// field<->world mapping mirror the shader term for term, so the
// unit tests (phasebc_test.mjs) measure the shipped logic.
//
// The system is a ONE-WAY dependent of the FLIP layer: foam
// slots sample the projected 64x64 field, spawn where the
// field's agitation (vorticity magnitude + convergence) passes
// the threshold, are carried by the field, age and die. Nothing
// is ever written back into the field, the FLIP pipeline or the
// main pool.
//
// Honest scope: the FLIP layer is a 2D planar (xz) solver, so
// the foam lives on a thin sheet around the field plane. There
// is no free surface, no curvature / energy criterion and no
// foam-vs-spray separation — one foam population only.

/** Foam pool texture side (WW_TEX_SIZE in the shader file). */
export const WHITEWATER_TEX_SIZE = 64;
/** FLIP field grid side (FLUID_SIZE). */
export const WHITEWATER_FIELD_SIZE = 64;
/** Upward pop speed a fresh foam particle is born with. */
export const WHITEWATER_POP_SPEED = 5.0;
/** Random spread added to the spawn velocity (per axis, ±half). */
export const WHITEWATER_SPREAD_SPEED = 4.0;
/** Foam sheet half-thickness, as a fraction of the field extent. */
export const WHITEWATER_SHEET_FRACTION = 0.06;
/** Rate at which a live foam particle relaxes onto the field flow. */
export const WHITEWATER_CARRY_RATE = 4.0;

/** The shader hash (Phase DM vector hash11), same form as GLSL. */

export function whitewaterHash(n: number): number {
  return dmHash11(n);
}

const clampI = (i: number) => Math.max(0, Math.min(WHITEWATER_FIELD_SIZE - 1, i));

/** Field sample: interleaved xy per cell, index j * 64 + i
 *  (i = world-x cell, j = world-z cell; xy = (vx, vz)). */
export function whitewaterFieldAt(field: Float32Array, i: number, j: number): { x: number; y: number } {
  const k = (clampI(j) * WHITEWATER_FIELD_SIZE + clampI(i)) * 2;
  return { x: field[k], y: field[k + 1] };
}

/** Vorticity about the vertical axis, per-cell units, central
 *  differences with edge-clamped taps (mirrors wwVorticity):
 *  omega = dvz/dx - dvx/dz. */
export function whitewaterVorticity(field: Float32Array, i: number, j: number): number {
  const vR = whitewaterFieldAt(field, i + 1, j);
  const vL = whitewaterFieldAt(field, i - 1, j);
  const vT = whitewaterFieldAt(field, i, j + 1);
  const vB = whitewaterFieldAt(field, i, j - 1);
  return (vR.y - vL.y - (vT.x - vB.x)) * 0.5;
}

/** Divergence with backward differences — the same one-sided
 *  stencil the pressure Jacobi solves against (mirrors
 *  wwDivergence). Negative = convergence. */
export function whitewaterDivergence(field: Float32Array, i: number, j: number): number {
  const vC = whitewaterFieldAt(field, i, j);
  const vL = whitewaterFieldAt(field, i - 1, j);
  const vB = whitewaterFieldAt(field, i, j - 1);
  return (vC.x - vL.x) + (vC.y - vB.y);
}

/** Agitation source: vorticity magnitude + convergence. Still
 *  water scores exactly 0 everywhere. */
export function whitewaterSource(field: Float32Array, i: number, j: number): number {
  return Math.abs(whitewaterVorticity(field, i, j)) + Math.max(0, -whitewaterDivergence(field, i, j));
}

/** Foam factor in [0, 1]: 0 at or below the threshold, 1 once
 *  the source reaches twice the threshold (mirrors
 *  wwFoamFactor). */
export function whitewaterFoamFactor(source: number, threshold: number): number {
  const t = Math.max(threshold, 0.001);
  return Math.min(1, Math.max(0, (source - t) / t));
}

/** The candidate cell a slot probes on a given 60 Hz tick —
 *  a deterministic hash of (slot, tick), as in findWwSpawn. */
export function whitewaterCandidateCell(wwIdx: number, tick: number): { i: number; j: number } {
  return {
    i: Math.floor(whitewaterHash(wwIdx * 3.71 + tick * 13.13) * WHITEWATER_FIELD_SIZE),
    j: Math.floor(whitewaterHash(wwIdx * 7.93 + tick * 5.37) * WHITEWATER_FIELD_SIZE),
  };
}

/** Spawn gate roll for (slot, tick), as in findWwSpawn. */
export function whitewaterSpawnGate(wwIdx: number, tick: number): number {
  return whitewaterHash(wwIdx * 11.17 + tick * 7.71);
}

export interface WhitewaterSpawn {
  spawned: boolean;
  cellI: number;
  cellJ: number;
  factor: number;
  /** World position (before the in-cell jitter the shader adds). */
  x: number;
  y: number;
  z: number;
  /** Spawn velocity (before the hash spread the shader adds). */
  vx: number;
  vy: number;
  vz: number;
}

/** The full spawn decision for one slot on one tick, mirroring
 *  findWwSpawn minus the hash jitter / spread (which only move
 *  the particle inside its cell / inside the spread bound). */
export function whitewaterSpawnDecision(args: {
  field: Float32Array;
  wwIdx: number;
  tick: number;
  threshold: number;
  amount: number;
  bounceRadius: number;
  fluidScale: number;
  fluidInfluence: number;
}): WhitewaterSpawn {
  const { field, wwIdx, tick, threshold, amount, bounceRadius, fluidScale, fluidInfluence } = args;
  const { i, j } = whitewaterCandidateCell(wwIdx, tick);
  const factor = whitewaterFoamFactor(whitewaterSource(field, i, j), threshold);
  const gate = whitewaterSpawnGate(wwIdx, tick);
  const extent = bounceRadius * fluidScale;
  const fv = whitewaterFieldAt(field, i, j);
  const fScale = fluidInfluence * 60;
  const y01 = whitewaterHash(wwIdx * 5.13 + tick * 3.31);
  return {
    spawned: gate < Math.min(1, Math.max(0, factor * amount)),
    cellI: i,
    cellJ: j,
    factor,
    x: ((i + 0.5) / WHITEWATER_FIELD_SIZE - 0.5) * 2 * extent,
    y: (y01 * 2 - 1) * extent * WHITEWATER_SHEET_FRACTION,
    z: ((j + 0.5) / WHITEWATER_FIELD_SIZE - 0.5) * 2 * extent,
    vx: fv.x * fScale,
    vy: (0.25 + 0.75 * whitewaterHash(wwIdx * 9.31 + tick)) * WHITEWATER_POP_SPEED,
    vz: fv.y * fScale,
  };
}

/** Expected spawn count over the whole pool for one tick: the
 *  sum of the per-slot spawn probabilities (each slot probes its
 *  own hashed cell). This is the quantity the unit tests assert
 *  on: 0 in still water, growing with the field's vorticity. */
export function whitewaterExpectedSpawns(args: {
  field: Float32Array;
  tick: number;
  threshold: number;
  amount: number;
  slots?: number;
}): number {
  const slots = args.slots ?? WHITEWATER_TEX_SIZE * WHITEWATER_TEX_SIZE;
  let sum = 0;
  for (let s = 0; s < slots; s++) {
    const { i, j } = whitewaterCandidateCell(s, args.tick);
    const factor = whitewaterFoamFactor(whitewaterSource(args.field, i, j), args.threshold);
    sum += Math.min(1, Math.max(0, factor * args.amount));
  }
  return sum;
}

/** Life variation at spawn (mirrors the passes): the key's life
 *  scaled into [0.6, 1.4) by the (slot, tick) hash. */
export function whitewaterSpawnLife(wwIdx: number, tick: number, baseLife: number): number {
  return baseLife * (0.6 + 0.8 * whitewaterHash(wwIdx * 11.3 + tick));
}

/** Field uv -> world xz (the inverse of the mapping the
 *  velocity pass samples the field with). */
export function whitewaterWorldFromFieldUv(
  u: number, v: number, bounceRadius: number, fluidScale: number,
): { x: number; z: number } {
  const extent = bounceRadius * fluidScale;
  return { x: (u - 0.5) * 2 * extent, z: (v - 0.5) * 2 * extent };
}

/** World xz -> field uv (the velocity pass's sampling map). */
export function whitewaterFieldUvFromWorld(
  x: number, z: number, bounceRadius: number, fluidScale: number,
): { u: number; v: number } {
  const extent = bounceRadius * fluidScale;
  return { u: x / extent * 0.5 + 0.5, v: z / extent * 0.5 + 0.5 };
}

// ── Whitewater 3D (Phase 19 stage 2) ─────────────────────────
// The 3D twin of components/gpgpuShaderWhitewater3d.ts, active
// only while the FLIP mode is '3d'. The 2D system above is
// untouched: in 3D mode the spawn source moves from the planar
// field's thin sheet to the FLIP3D free surface — a candidate
// cell must sit in the surface band (|phi| <= 1.5 cells), on
// the liquid side (chi >= 0.5), and pass the same agitation
// gate (now with the full 3D curl vector). The birth position
// is projected onto the surface (phi = 0) along the phi
// gradient, and the birth pop runs along the surface normal
// instead of straight up. Still one foam population (no
// foam/spray split) and still one-way: nothing is written back
// into the grid. Field layout matches lib/flip3d.ts: cell
// index (z * n + y) * n + x, velocities interleaved xyz.

/** Surface band half-width, in cells (the sheet's replacement). */
export const WHITEWATER3D_SURFACE_BAND = 1.5;

const clampCell3 = (v: number, n: number) => Math.max(0, Math.min(n - 1, v));
const idx3 = (n: number, x: number, y: number, z: number) => (z * n + y) * n + x;

/** The candidate cell a slot probes on a tick — the (slot,
 *  tick) hash extended to 3D with an independent constant for
 *  k (mirrors findWw3Spawn). */
export function whitewater3dCandidateCell(wwIdx: number, tick: number, n: number): { i: number; j: number; k: number } {
  return {
    i: Math.floor(whitewaterHash(wwIdx * 3.71 + tick * 13.13) * n),
    j: Math.floor(whitewaterHash(wwIdx * 7.93 + tick * 5.37) * n),
    k: Math.floor(whitewaterHash(wwIdx * 13.71 + tick * 7.37) * n),
  };
}

/** Grid velocity at a cell (edge-clamped), cells/second. */
export function whitewater3dFieldAt(
  vel: Float32Array, n: number, x: number, y: number, z: number,
): { x: number; y: number; z: number } {
  const c = idx3(n, clampCell3(x, n), clampCell3(y, n), clampCell3(z, n)) * 3;
  return { x: vel[c], y: vel[c + 1], z: vel[c + 2] };
}

/** Full 3D curl, per-cell units, central differences with
 *  edge-clamped taps (mirrors ww3Curl). */
export function whitewater3dCurl(
  vel: Float32Array, n: number, x: number, y: number, z: number,
): { x: number; y: number; z: number } {
  const duzDy = (whitewater3dFieldAt(vel, n, x, y + 1, z).z - whitewater3dFieldAt(vel, n, x, y - 1, z).z) * 0.5;
  const duyDz = (whitewater3dFieldAt(vel, n, x, y, z + 1).y - whitewater3dFieldAt(vel, n, x, y, z - 1).y) * 0.5;
  const duxDz = (whitewater3dFieldAt(vel, n, x, y, z + 1).x - whitewater3dFieldAt(vel, n, x, y, z - 1).x) * 0.5;
  const duzDx = (whitewater3dFieldAt(vel, n, x + 1, y, z).z - whitewater3dFieldAt(vel, n, x - 1, y, z).z) * 0.5;
  const duyDx = (whitewater3dFieldAt(vel, n, x + 1, y, z).y - whitewater3dFieldAt(vel, n, x - 1, y, z).y) * 0.5;
  const duxDy = (whitewater3dFieldAt(vel, n, x, y + 1, z).x - whitewater3dFieldAt(vel, n, x, y - 1, z).x) * 0.5;
  return { x: duzDy - duyDz, y: duxDz - duzDx, z: duyDx - duxDy };
}

/** Divergence with backward differences (mirrors ww3Divergence). */
export function whitewater3dDivergence(vel: Float32Array, n: number, x: number, y: number, z: number): number {
  const vC = whitewater3dFieldAt(vel, n, x, y, z);
  const vL = whitewater3dFieldAt(vel, n, x - 1, y, z);
  const vB = whitewater3dFieldAt(vel, n, x, y - 1, z);
  const vD = whitewater3dFieldAt(vel, n, x, y, z - 1);
  return (vC.x - vL.x) + (vC.y - vB.y) + (vC.z - vD.z);
}

/** Agitation source: |curl| + convergence (mirrors ww3Source). */
export function whitewater3dSource(vel: Float32Array, n: number, x: number, y: number, z: number): number {
  const w = whitewater3dCurl(vel, n, x, y, z);
  return Math.hypot(w.x, w.y, w.z) + Math.max(0, -whitewater3dDivergence(vel, n, x, y, z));
}

/** Surface normal from phi's gradient (the flip3dNormal
 *  arithmetic, kept local so this module stays dependency-free
 *  like the 2D twin). */
export function whitewater3dNormal(
  phi: Float32Array, n: number, x: number, y: number, z: number,
): { x: number; y: number; z: number } {
  const gx = (phi[idx3(n, clampCell3(x + 1, n), y, z)] - phi[idx3(n, clampCell3(x - 1, n), y, z)]) * 0.5;
  const gy = (phi[idx3(n, x, clampCell3(y + 1, n), z)] - phi[idx3(n, x, clampCell3(y - 1, n), z)]) * 0.5;
  const gz = (phi[idx3(n, x, y, clampCell3(z + 1, n))] - phi[idx3(n, x, y, clampCell3(z - 1, n))]) * 0.5;
  const len = Math.hypot(gx, gy, gz);
  if (len < 1e-9) return { x: 0, y: 0, z: 0 };
  return { x: gx / len, y: gy / len, z: gz / len };
}

export interface Whitewater3dSpawn {
  spawned: boolean;
  cellI: number;
  cellJ: number;
  cellK: number;
  factor: number;
  /** World birth position, projected onto the surface. */
  x: number;
  y: number;
  z: number;
  /** Birth velocity: grid PIC + normal pop (before hash spread). */
  vx: number;
  vy: number;
  vz: number;
}

/** The full 3D spawn decision for one slot on one tick,
 *  mirroring findWw3Spawn minus the in-cell jitter / spread. */
export function whitewater3dSpawnDecision(args: {
  vel: Float32Array;
  phi: Float32Array;
  chi: Float32Array;
  n: number;
  wwIdx: number;
  tick: number;
  threshold: number;
  amount: number;
  halfExtent: number;
  /** Grid -> particle velocity scale (pyroGridVelScale form). */
  velScale: number;
}): Whitewater3dSpawn {
  const { vel, phi, chi, n, wwIdx, tick, threshold, amount, halfExtent, velScale } = args;
  const { i, j, k } = whitewater3dCandidateCell(wwIdx, tick, n);
  const idx = idx3(n, i, j, k);
  const phiHere = phi[idx];
  const inBand = Math.abs(phiHere) <= WHITEWATER3D_SURFACE_BAND && chi[idx] >= 0.5;
  const factor = inBand ? whitewaterFoamFactor(whitewater3dSource(vel, n, i, j, k), threshold) : 0;
  const gate = whitewaterSpawnGate(wwIdx, tick);
  const spawned = gate < Math.min(1, Math.max(0, factor * amount));
  const normal = whitewater3dNormal(phi, n, i, j, k);
  const cellWorld = (2 * halfExtent) / n;
  // Cell centre in world, then projected onto phi = 0 along the
  // gradient: world offset = -normal * phi (phi is in cells).
  const cx = ((i + 0.5) / n - 0.5) * 2 * halfExtent - normal.x * phiHere * cellWorld;
  const cy = ((j + 0.5) / n - 0.5) * 2 * halfExtent - normal.y * phiHere * cellWorld;
  const cz = ((k + 0.5) / n - 0.5) * 2 * halfExtent - normal.z * phiHere * cellWorld;
  const gv = whitewater3dFieldAt(vel, n, i, j, k);
  const pop = (0.25 + 0.75 * whitewaterHash(wwIdx * 9.31 + tick)) * WHITEWATER_POP_SPEED;
  return {
    spawned,
    cellI: i,
    cellJ: j,
    cellK: k,
    factor,
    x: cx,
    y: cy,
    z: cz,
    vx: gv.x * velScale + normal.x * pop,
    vy: gv.y * velScale + normal.y * pop,
    vz: gv.z * velScale + normal.z * pop,
  };
}

/** Expected spawn count over the pool for one tick (the 3D
 *  analogue of whitewaterExpectedSpawns). */
export function whitewater3dExpectedSpawns(args: {
  vel: Float32Array;
  phi: Float32Array;
  chi: Float32Array;
  n: number;
  tick: number;
  threshold: number;
  amount: number;
  slots?: number;
}): number {
  const slots = args.slots ?? WHITEWATER_TEX_SIZE * WHITEWATER_TEX_SIZE;
  let sum = 0;
  for (let s = 0; s < slots; s++) {
    const { i, j, k } = whitewater3dCandidateCell(s, args.tick, args.n);
    const idx = idx3(args.n, i, j, k);
    if (Math.abs(args.phi[idx]) > WHITEWATER3D_SURFACE_BAND || args.chi[idx] < 0.5) continue;
    const factor = whitewaterFoamFactor(whitewater3dSource(args.vel, args.n, i, j, k), args.threshold);
    sum += Math.min(1, Math.max(0, factor * args.amount));
  }
  return sum;
}
