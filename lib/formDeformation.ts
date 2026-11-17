/**
 * Form-dedicated deformation (Phase AA2: Disperse / Twist /
 * Fractal Field).
 *
 * Form's Disperse, Twist and Fractal Field are DEDICATED controls
 * over a base form: they deform the PLACEMENT of a form that stays
 * itself, as opposed to the motion systems (Flow / Vortex / Spiral)
 * that move particles over time and were previously combined to
 * approximate the look. This module implements that placement
 * deformation as a pure function over baked morph points, in
 * normalised cloud space, applied in the morph bake before the
 * replica grammar (so every replica copy inherits the same deformed
 * form) and before jitter / world scale:
 *
 *  - Disperse: each point is pushed away from the form centre by
 *    amount * (0.35 + 0.65 * hash(index)) along the radial direction
 *    (or along a fixed axis), so the form loosens unevenly instead
 *    of scaling uniformly. The hash is per-point and deterministic,
 *    so the loosened form is a fixed shape, not noise per frame.
 *  - Twist: rotation around an axis by an angle proportional to the
 *    point's coordinate ALONG that axis (angle = amount * coord),
 *    the classic Form twist: the form's cross-sections shear
 *    rotationally as they advance along the axis.
 *  - Fractal Field: displacement by a seeded 3D value-noise fBm
 *    (the "base form + fractal displacement" composition): each
 *    axis is offset by an independent noise channel sampled at
 *    point * frequency + evolution, scaled by amount. `evolution`
 *    is a config value (it can be sequenced / modulated like any
 *    key), never a wall clock, so bakes stay deterministic.
 *
 * Identity: with all three amounts at 0 the function returns the
 * input point EXACTLY (the bake additionally skips the call
 * entirely in that case, so legacy bakes stay bit-identical).
 */

export type FormDisperseDirection = 'radial' | 'x' | 'y' | 'z';
export type FormTwistAxis = 'x' | 'y' | 'z';

export interface FormDeformationOptions {
  disperseAmount: number;
  disperseDirection: FormDisperseDirection;
  twistAmount: number;
  twistAxis: FormTwistAxis;
  fractalAmount: number;
  fractalFrequency: number;
  fractalEvolution: number;
}

export const DEFAULT_FORM_DEFORMATION: FormDeformationOptions = {
  disperseAmount: 0,
  disperseDirection: 'radial',
  twistAmount: 0,
  twistAxis: 'y',
  fractalAmount: 0,
  fractalFrequency: 1.5,
  fractalEvolution: 0,
};

export function isFormDeformationActive(opts: FormDeformationOptions | null | undefined): boolean {
  if (!opts) return false;
  return opts.disperseAmount !== 0 || opts.twistAmount !== 0 || opts.fractalAmount !== 0;
}

export function clampDisperseAmount(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(2, v));
}
export function clampTwistAmount(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(-4, Math.min(4, v));
}
export function clampFractalAmount(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(2, v));
}
export function clampFractalFrequency(v: number): number {
  if (!Number.isFinite(v) || v <= 0) return 1.5;
  return Math.min(8, v);
}

/** Deterministic per-index hash in [0, 1) (integer math only). */
export function formPointHash(index: number): number {
  let h = Math.imul((index | 0) + 1, 0x27d4eb2d) ^ 0x9e3779b1;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

/** 3D lattice hash in [-1, 1): integer math, platform-independent. */
function lattice3(ix: number, iy: number, iz: number, seed: number): number {
  let h =
    Math.imul(ix | 0, 0x27d4eb2d) ^
    Math.imul(iy | 0, 0x165667b1) ^
    Math.imul(iz | 0, 0x1b56c4e9) ^
    Math.imul(seed | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h ^= h >>> 13;
  return ((h >>> 0) / 4294967296) * 2 - 1;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Trilinear value noise in [-1, 1] at (x, y, z) for one channel seed. */
export function formNoise3(x: number, y: number, z: number, channelSeed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fx = smooth(x - ix);
  const fy = smooth(y - iy);
  const fz = smooth(z - iz);
  const c000 = lattice3(ix, iy, iz, channelSeed);
  const c100 = lattice3(ix + 1, iy, iz, channelSeed);
  const c010 = lattice3(ix, iy + 1, iz, channelSeed);
  const c110 = lattice3(ix + 1, iy + 1, iz, channelSeed);
  const c001 = lattice3(ix, iy, iz + 1, channelSeed);
  const c101 = lattice3(ix + 1, iy, iz + 1, channelSeed);
  const c011 = lattice3(ix, iy + 1, iz + 1, channelSeed);
  const c111 = lattice3(ix + 1, iy + 1, iz + 1, channelSeed);
  const x00 = c000 + (c100 - c000) * fx;
  const x10 = c010 + (c110 - c010) * fx;
  const x01 = c001 + (c101 - c001) * fx;
  const x11 = c011 + (c111 - c011) * fx;
  const y0 = x00 + (x10 - x00) * fy;
  const y1 = x01 + (x11 - x01) * fy;
  return y0 + (y1 - y0) * fz;
}

/** Two-octave fBm of formNoise3, gain-normalised to [-1, 1]. */
export function formFractalNoise(x: number, y: number, z: number, channelSeed: number): number {
  const a = formNoise3(x, y, z, channelSeed);
  const b = formNoise3(x * 2.13 + 5.2, y * 2.13 + 1.3, z * 2.13 + 2.8, channelSeed + 77);
  return (a * 0.667 + b * 0.333);
}

/** Twist angle (radians) applied to a point: amount * (coordinate along the axis). */
export function formTwistAngleAt(
  p: { x: number; y: number; z: number },
  opts: FormDeformationOptions,
): number {
  const amount = clampTwistAmount(opts.twistAmount);
  if (amount === 0) return 0;
  const coord = opts.twistAxis === 'x' ? p.x : opts.twistAxis === 'z' ? p.z : p.y;
  return amount * coord;
}

/** Rotate (x, y, z) around `axis` by `angle` radians. */
export function rotateAroundAxis(
  p: { x: number; y: number; z: number },
  axis: FormTwistAxis,
  angle: number,
): { x: number; y: number; z: number } {
  if (angle === 0) return { ...p };
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  if (axis === 'x') return { x: p.x, y: p.y * c - p.z * s, z: p.y * s + p.z * c };
  if (axis === 'z') return { x: p.x * c - p.y * s, y: p.x * s + p.y * c, z: p.z };
  return { x: p.x * c - p.z * s, y: p.y, z: p.x * s + p.z * c };
}

/**
 * Apply the full deformation (Disperse -> Twist -> Fractal) to one
 * normalised point. `index` is the particle's bake index (the
 * disperse hash source). Amounts are clamped here so direct callers
 * and the bake agree.
 */
export function applyFormDeformation(
  p: { x: number; y: number; z: number },
  index: number,
  opts: FormDeformationOptions,
): { x: number; y: number; z: number } {
  let { x, y, z } = p;
  // The twist angle keys off the ORIGINAL point's coordinate along
  // the axis (the base form's height), captured before disperse —
  // formTwistAngleAt(p, opts) therefore returns exactly the angle
  // applied here, which the bake relies on to rotate normals.
  const twistAngle = formTwistAngleAt(p, opts);

  const disperse = clampDisperseAmount(opts.disperseAmount);
  if (disperse !== 0) {
    const push = disperse * (0.35 + 0.65 * formPointHash(index));
    if (opts.disperseDirection === 'x') x += push;
    else if (opts.disperseDirection === 'y') y += push;
    else if (opts.disperseDirection === 'z') z += push;
    else {
      const len = Math.hypot(x, y, z);
      if (len > 1e-9) {
        x += (x / len) * push;
        y += (y / len) * push;
        z += (z / len) * push;
      } else {
        // A point at the exact centre has no radial direction; use
        // its hash direction on the XY circle instead (defined, not random).
        const a = formPointHash(index + 7919) * Math.PI * 2;
        x += Math.cos(a) * push;
        y += Math.sin(a) * push;
      }
    }
  }

  if (twistAngle !== 0) {
    const r = rotateAroundAxis({ x, y, z }, opts.twistAxis, twistAngle);
    x = r.x;
    y = r.y;
    z = r.z;
  }

  const fractal = clampFractalAmount(opts.fractalAmount);
  if (fractal !== 0) {
    const freq = clampFractalFrequency(opts.fractalFrequency);
    const evo = Number.isFinite(opts.fractalEvolution) ? opts.fractalEvolution : 0;
    const nx = x * freq + evo;
    const ny = y * freq + evo * 0.7;
    const nz = z * freq - evo * 0.4;
    x += formFractalNoise(nx, ny, nz, 11) * fractal * 0.5;
    y += formFractalNoise(nx, ny, nz, 47) * fractal * 0.5;
    z += formFractalNoise(nx, ny, nz, 83) * fractal * 0.5;
  }

  return { x, y, z };
}
