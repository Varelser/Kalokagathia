// Emitter common base (Grammar 2.0 stage 2, slice E0+E1).
//
// Design: kalokagathia-pro/STAGE2_DESIGN.md §2 E0/E1.
//
// Before this module the "emitter" existed only implicitly:
// the bake scattered from the origin with the emit-shape keys,
// and the runtime respawn re-placed at the origin ball (or the
// light ball) with no position / rotation / scale of its own.
// The emitter definition now lives here as one shape —
//
//   { shape, respawnShape, transform, initialVelocity }
//
// — and both placement routes read it: the bake
// (lib/gpgpuInitialData.ts, via GpgpuEmitOptions.transform)
// and the respawn (the position pass's emitter variants,
// whose uniforms the passes resolve from the helpers below).
//
// Identity discipline: every key defaults to the legacy
// behaviour — respawnShape 'auto' (the legacy placement: the
// origin ball, or the light ball while the emit shape is
// 'light') and an identity transform (origin / no rotation /
// scale 1). While both hold, the bake arrays are bit-
// identical and the position shader string is the shipped
// one; the emitter variants are spliced only past that line.
//
// The transform applies to POSITIONS only, on both routes:
// the bake's initial velocity stays the legacy world-axis
// cube scatter (it is not part of the placement law), and the
// respawn never reset velocity. Rotation is Euler XYZ in
// degrees, composed as M = Rx * Ry * Rz (column-vector
// convention, so Z applies first); the matrix elements are
// produced once here and consumed by both the JS twin
// (applyEmitterTransform) and the shader uniform (the passes
// upload the same array into a THREE.Matrix3), so the two
// routes cannot drift.

import type { ParticleConfig } from '../types';
import type { GpgpuEmitShape } from './gpgpuEmitShapes';

export type { GpgpuEmitShape };

/** Respawn placement selector: 'auto' = the legacy placement. */
export type GpgpuRespawnShape = 'auto' | GpgpuEmitShape;

export interface GpgpuEmitterTransform {
  posX: number;
  posY: number;
  posZ: number;
  /** Euler angles in degrees. */
  rotX: number;
  rotY: number;
  rotZ: number;
  /** Uniform scale of the sampled local position. */
  scale: number;
}

export const IDENTITY_EMITTER_TRANSFORM: GpgpuEmitterTransform = {
  posX: 0, posY: 0, posZ: 0, rotX: 0, rotY: 0, rotZ: 0, scale: 1,
};

export interface GpgpuEmitterDef {
  /** Bake emit shape (the pre-existing gpgpuEmitShape key). */
  shape: GpgpuEmitShape;
  /** Respawn placement selector (gpgpuRespawnShape). */
  respawnShape: GpgpuRespawnShape;
  transform: GpgpuEmitterTransform;
  /**
   * Initial velocity specification. 'cube' is the legacy
   * semantics — a uniform cube scatter of half-extent `speed`
   * (the historical ±2) at the bake and no reset on respawn.
   * 'directed' (stage 2, E2) is the general port of the spawn
   * event's cohort velocity: the velocity of
   * directedInitialVelocity in lib/gpgpuLifecycle.ts with the
   * authored axis as its base, applied at the bake and on the
   * spawn-gate activation frame.
   */
  initialVelocity:
    | { mode: 'cube'; speed: number }
    | { mode: 'directed'; dirX: number; dirY: number; dirZ: number; speed: number; spread: number };
}

type EmitterConfig = Pick<ParticleConfig,
  | 'gpgpuEmitShape' | 'gpgpuRespawnShape'
  | 'gpgpuEmitterPosX' | 'gpgpuEmitterPosY' | 'gpgpuEmitterPosZ'
  | 'gpgpuEmitterRotX' | 'gpgpuEmitterRotY' | 'gpgpuEmitterRotZ'
  | 'gpgpuEmitterScale'
  | 'gpgpuEmitterVelMode' | 'gpgpuEmitterVelDirX' | 'gpgpuEmitterVelDirY' | 'gpgpuEmitterVelDirZ'
  | 'gpgpuEmitterVelSpeed' | 'gpgpuEmitterVelSpread'>;

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

/** Resolve the emitter transform from the config keys. */
export function resolveEmitterTransform(config: EmitterConfig): GpgpuEmitterTransform {
  return {
    posX: finiteOr(config.gpgpuEmitterPosX ?? 0, 0),
    posY: finiteOr(config.gpgpuEmitterPosY ?? 0, 0),
    posZ: finiteOr(config.gpgpuEmitterPosZ ?? 0, 0),
    rotX: finiteOr(config.gpgpuEmitterRotX ?? 0, 0),
    rotY: finiteOr(config.gpgpuEmitterRotY ?? 0, 0),
    rotZ: finiteOr(config.gpgpuEmitterRotZ ?? 0, 0),
    scale: finiteOr(config.gpgpuEmitterScale ?? 1, 1),
  };
}

/** Emitter velocity speed clamp (the spawn event's range). */
export function clampEmitterVelSpeed(v: number): number {
  if (!Number.isFinite(v)) return 2;
  return Math.max(0, Math.min(50, v));
}

/** Emitter velocity spread clamp (the spawn event's range). */
export function clampEmitterVelSpread(v: number): number {
  if (!Number.isFinite(v)) return 0.5;
  return Math.max(0, Math.min(1, v));
}

/** The full emitter definition for a config. */
export function resolveEmitterDef(config: EmitterConfig): GpgpuEmitterDef {
  return {
    shape: config.gpgpuEmitShape,
    respawnShape: config.gpgpuRespawnShape ?? 'auto',
    transform: resolveEmitterTransform(config),
    initialVelocity: config.gpgpuEmitterVelMode === 'directed'
      ? {
          mode: 'directed',
          dirX: finiteOr(config.gpgpuEmitterVelDirX ?? 0, 0),
          dirY: finiteOr(config.gpgpuEmitterVelDirY ?? 1, 1),
          dirZ: finiteOr(config.gpgpuEmitterVelDirZ ?? 0, 0),
          speed: clampEmitterVelSpeed(config.gpgpuEmitterVelSpeed ?? 2),
          spread: clampEmitterVelSpread(config.gpgpuEmitterVelSpread ?? 0.5),
        }
      : { mode: 'cube', speed: 2 },
  };
}

/** True while the directed initial-velocity port is in play. */
export function emitterVelocityDirectedActive(
  config: Pick<ParticleConfig, 'gpgpuEmitterVelMode'>,
): boolean {
  return config.gpgpuEmitterVelMode === 'directed';
}

/**
 * The directed velocity's base direction for a config: the
 * authored axis normalised, with the +Y fallback for a zero
 * or non-finite axis (the event grammar's origin fallback,
 * applied to the axis itself). The bake, the velocity-pass
 * uniform and directedInitialVelocity all consume this exact
 * vector, so the routes cannot drift.
 */
export function resolveEmitterBaseDirection(
  config: Pick<ParticleConfig, 'gpgpuEmitterVelDirX' | 'gpgpuEmitterVelDirY' | 'gpgpuEmitterVelDirZ'>,
): { x: number; y: number; z: number } {
  const x = finiteOr(config.gpgpuEmitterVelDirX ?? 0, 0);
  const y = finiteOr(config.gpgpuEmitterVelDirY ?? 1, 1);
  const z = finiteOr(config.gpgpuEmitterVelDirZ ?? 0, 0);
  const len = Math.hypot(x, y, z);
  if (!(len > 0.0001)) return { x: 0, y: 1, z: 0 };
  return { x: x / len, y: y / len, z: z / len };
}

/** Exact identity test — the transform keys at their defaults. */
export function emitterTransformIsIdentity(t: GpgpuEmitterTransform): boolean {
  return t.posX === 0 && t.posY === 0 && t.posZ === 0
    && t.rotX === 0 && t.rotY === 0 && t.rotZ === 0
    && t.scale === 1;
}

/** True while the config's transform moves any placement. */
export function emitterTransformActive(config: EmitterConfig): boolean {
  return !emitterTransformIsIdentity(resolveEmitterTransform(config));
}

/** True while the respawn uses the shared shape law (not 'auto'). */
export function emitterRespawnShapeActive(config: EmitterConfig): boolean {
  return (config.gpgpuRespawnShape ?? 'auto') !== 'auto';
}

/**
 * Rotation * scale matrix elements, column-major (the layout
 * THREE.Matrix3.elements and a GLSL mat3 constructor both
 * use): elements[0..2] is the first column. M = Rx * Ry * Rz,
 * every entry pre-scaled by t.scale, so a point transforms as
 * pos + M * p on both the JS and the GLSL route.
 */
export function emitterRotScaleElements(t: GpgpuEmitterTransform): number[] {
  const rx = (t.rotX * Math.PI) / 180;
  const ry = (t.rotY * Math.PI) / 180;
  const rz = (t.rotZ * Math.PI) / 180;
  const cx = Math.cos(rx), sx = Math.sin(rx);
  const cy = Math.cos(ry), sy = Math.sin(ry);
  const cz = Math.cos(rz), sz = Math.sin(rz);
  // Ry * Rz (row-major working form)
  const a00 = cy * cz, a01 = -cy * sz, a02 = sy;
  const a10 = sz, a11 = cz, a12 = 0;
  const a20 = -sy * cz, a21 = sy * sz, a22 = cy;
  // Rx * (Ry * Rz)
  const m00 = a00, m01 = a01, m02 = a02;
  const m10 = cx * a10 - sx * a20, m11 = cx * a11 - sx * a21, m12 = cx * a12 - sx * a22;
  const m20 = sx * a10 + cx * a20, m21 = sx * a11 + cx * a21, m22 = sx * a12 + cx * a22;
  const s = t.scale;
  // Column-major: [m00, m10, m20, m01, m11, m21, m02, m12, m22]
  return [
    m00 * s, m10 * s, m20 * s,
    m01 * s, m11 * s, m21 * s,
    m02 * s, m12 * s, m22 * s,
  ];
}

/**
 * JS twin of the shader's emitter transform statement
 * (`pos = uEmitterPos + uEmitterRotScale * pos`): scale and
 * rotation from emitterRotScaleElements, then translation.
 * Callers skip it entirely while the transform is identity,
 * which keeps the identity route bit-exact by construction.
 */
export function applyEmitterTransform(
  t: GpgpuEmitterTransform,
  x: number, y: number, z: number,
): [number, number, number] {
  const e = emitterRotScaleElements(t);
  return [
    e[0] * x + e[3] * y + e[6] * z + t.posX,
    e[1] * x + e[4] * y + e[7] * z + t.posY,
    e[2] * x + e[5] * y + e[8] * z + t.posZ,
  ];
}
