/**
 * Vellum constraint solver foundation (Phase AR).
 *
 * The solver is a GPU position-based (PBD-family) distance-
 * constraint solve over the pool's own texel grid: a structured
 * bake lays the pool out as a sheet (plane grid) or a shell
 * (lat/long sphere), so texel adjacency IS the cloth topology —
 * no connection table texture is needed. The projection itself
 * runs in a dedicated position-side pass
 * (components/gpgpuShaderSimulationVellum.ts); this module owns
 * the CPU side: the deterministic bake, the config resolution
 * every consumer shares, and the honest scope notes.
 *
 * Honest scope (do not oversell): this is a PBD-family position
 * projection, NOT Houdini Vellum's XPBD. There is no per-
 * constraint Δλ accumulation and no compliance in physical
 * units — stiffness is the effective value "correction rate ×
 * iteration count" and shifts with dt. Projection is Jacobi-style
 * (per-texel corrections averaged over the live-link count — the
 * plain sum diverges at stiffness 1, measured in the phase's unit
 * probe) with a bounded iteration count, so strong pulls leave residual
 * stretch and fast impacts leave interpenetration. Self-collision
 * is not solved. Pressure is a normal-direction force, not a
 * volume-preserving pressure constraint. Tearing is link
 * severing, not fracture-surface generation.
 *
 * Phase BB adds the two constraint usages the AR scope lacked:
 * stitch and glue. Stitch is a velocity-coupling pass over the
 * structural links (lib/gpgpuShaderSimulationVellum.ts,
 * SIM_VELLUM_VEL_FRAG): after the projection, each texel's
 * velocity is blended toward the average of its live-link
 * neighbours, so a pull on one end of the sheet accelerates the
 * other end through the links instead of only re-posing it —
 * momentum exchange along the seams, still not XPBD (no Δλ, no
 * compliance). Glue is a zero-rest-length distance link from
 * each texel to its own bake point, solved inside the
 * projection with its own rate and an optional break threshold
 * (displacement from the bake point, tracked in the state
 * texture's .b channel). It is glue-to-target where the target
 * is the pool's own baked shape — the pool is a single piece of
 * cloth, so Houdini's cross-piece point-to-point glue has no
 * second piece to bind to here.
 */

import type { ParticleConfig } from '../types';
import { createSeededRng } from './seededRng';

export type VellumMode = 'sheet' | 'shell';
export type VellumPinMode = 'none' | 'top' | 'corners' | 'topCorners';

/** Hard budget from the phase brief: projection iterations. */
export const VELLUM_SUBSTEP_MAX = 4;

/** Sheet full width / height as a multiple of the bounce radius. */
export const VELLUM_SHEET_SPAN = 1.2;
/** Shell radius as a multiple of the bounce radius. */
export const VELLUM_SHELL_RADIUS = 0.75;

export interface VellumBakeData {
  posData: Float32Array;
  velData: Float32Array;
}

/**
 * Structured grid bake: the pool's initial positions laid out in
 * texel order (index = iy * texSize + ix, the same row-major
 * layout as every other bake). Pure and deterministic — the only
 * random draws are the per-particle initial ages, taken from the
 * seeded RNG in index order exactly like buildGpgpuInitialData,
 * so the same (texSize, mode, radius, seed) always produces the
 * same arrays. Velocities start at zero: the cloth's motion comes
 * from the scene's forces, not from a seeded scatter.
 *
 * Sheet: an XY-plane grid centred on the origin, ix → +x,
 * iy → −y (row 0 is the TOP edge, y = +span/2), z = 0.
 * Shell: a lat/long sphere, ix → longitude (wrapping), iy →
 * polar angle from +y (row 0 is the top pole ring).
 */
export function buildVellumBakeData(
  texSize: number,
  mode: VellumMode,
  bounceRadius: number,
  seed: number,
  ageMax = 8,
): VellumBakeData {
  const count = texSize * texSize;
  const posData = new Float32Array(count * 4);
  const velData = new Float32Array(count * 4);
  const random = createSeededRng(seed);
  const n = Math.max(2, texSize);
  if (mode === 'shell') {
    const r = bounceRadius * VELLUM_SHELL_RADIUS;
    for (let iy = 0; iy < n; iy++) {
      const phi = (Math.PI * (iy + 0.5)) / n;
      const sinPhi = Math.sin(phi);
      const cosPhi = Math.cos(phi);
      for (let ix = 0; ix < n; ix++) {
        const theta = (2 * Math.PI * ix) / n;
        const i = iy * n + ix;
        posData[i * 4] = r * sinPhi * Math.cos(theta);
        posData[i * 4 + 1] = r * cosPhi;
        posData[i * 4 + 2] = r * sinPhi * Math.sin(theta);
        posData[i * 4 + 3] = random() * ageMax;
      }
    }
  } else {
    const span = bounceRadius * VELLUM_SHEET_SPAN;
    for (let iy = 0; iy < n; iy++) {
      const y = (0.5 - iy / (n - 1)) * span;
      for (let ix = 0; ix < n; ix++) {
        const x = (ix / (n - 1) - 0.5) * span;
        const i = iy * n + ix;
        posData[i * 4] = x;
        posData[i * 4 + 1] = y;
        posData[i * 4 + 2] = 0;
        posData[i * 4 + 3] = random() * ageMax;
      }
    }
  }
  return { posData, velData };
}

export interface VellumResolved {
  /** Master switch: the Enabled key. Everything else is inert while false. */
  active: boolean;
  /** 0 = sheet, 1 = shell (x wraps). */
  modeId: 0 | 1;
  /** 0 = none, 1 = top edge, 2 = four corners, 3 = top edge + bottom corners. */
  pinId: 0 | 1 | 2 | 3;
  /** Structural + shear correction rate per iteration, 0..1. */
  stiffness: number;
  /** Bend (2-away) correction rate per iteration, 0..1. */
  bend: number;
  /** Projection iterations per frame, 1..VELLUM_SUBSTEP_MAX. */
  substeps: number;
  /** Normal-direction pressure force (0 = off, sign flips the side). */
  pressure: number;
  /** Tear strain threshold (> 1 while on, 0 = off). */
  tear: number;
  /** Velocity damping while active, fraction per 1/60 s frame, 0..0.5. */
  damping: number;
  /** Stitch (Phase BB): velocity-coupling rate over the structural
   *  links, 0..1. 0 = the coupling pass never runs (legacy). */
  stitch: number;
  /** Glue (Phase BB): correction rate of the bake-point links in
   *  the projection, 0..1. 0 = no glue links (legacy). */
  glue: number;
  /** Glue break (Phase BB): world-unit displacement from the
   *  bake point at which a glue bond releases. 0 = unbreakable. */
  glueBreak: number;
}

export const VELLUM_PIN_IDS: Record<VellumPinMode, 0 | 1 | 2 | 3> = {
  none: 0,
  top: 1,
  corners: 2,
  topCorners: 3,
};

/**
 * The single resolution point for the Vellum keys. Every consumer
 * (runtime bake, pass uniforms, capability registry) reads the
 * solver through here so the clamps can never drift apart.
 */
export function resolveVellum(config: ParticleConfig): VellumResolved {
  const tearRaw = Math.max(0, config.gpgpuVellumTear || 0);
  return {
    active: !!config.gpgpuVellumEnabled,
    modeId: config.gpgpuVellumMode === 'shell' ? 1 : 0,
    pinId: VELLUM_PIN_IDS[config.gpgpuVellumPin] ?? 1,
    stiffness: Math.max(0, Math.min(1, config.gpgpuVellumStiffness ?? 0.8)),
    bend: Math.max(0, Math.min(1, config.gpgpuVellumBend ?? 0.3)),
    substeps: Math.max(1, Math.min(VELLUM_SUBSTEP_MAX, Math.round(config.gpgpuVellumSubsteps ?? 2))),
    pressure: Math.max(-5, Math.min(5, config.gpgpuVellumPressure ?? 0)),
    // A tear threshold at or below 1 would sever every link on
    // the first frame (rest-length noise); the usable range
    // starts at 1.05. 0 stays off.
    tear: tearRaw > 0 ? Math.max(1.05, Math.min(3, tearRaw)) : 0,
    damping: Math.max(0, Math.min(0.5, config.gpgpuVellumDamping ?? 0.05)),
    stitch: Math.max(0, Math.min(1, config.gpgpuVellumStitch ?? 0)),
    glue: Math.max(0, Math.min(1, config.gpgpuVellumGlue ?? 0)),
    glueBreak: Math.max(0, config.gpgpuVellumGlueBreak ?? 0),
  };
}

/** Tear state pool / pass engage only while the solver and the tear key are both on. */
export function vellumTearActive(config: ParticleConfig): boolean {
  const v = resolveVellum(config);
  return v.active && v.tear > 0;
}

/**
 * State pool / state pass engage (Phase BB): the state texture
 * carries link survival (.r / .g, tear) and glue survival (.b),
 * so the pool must exist while EITHER severing rule is live —
 * tear on, or glue on with a finite break threshold. Unbreakable
 * glue (break 0) never reads the texture.
 */
export function vellumStatePoolActive(config: ParticleConfig): boolean {
  const v = resolveVellum(config);
  return v.active && (v.tear > 0 || (v.glue > 0 && v.glueBreak > 0));
}
