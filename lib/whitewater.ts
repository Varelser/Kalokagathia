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
function dmHash11(n: number): number {
  const fract = (v: number): number => v - Math.floor(v);
  let x = fract(n * 0.1031);
  let y = fract(n * 0.1030);
  let z = fract(n * 0.0973);
  const d = x * (y + 33.33) + y * (x + 33.33) + z * (z + 33.33);
  x += d; y += d; z += d;
  return fract((x + y) * z);
}

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
