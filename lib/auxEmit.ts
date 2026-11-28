// Aux child-emitter mode (Grammar 2.0 stage 1, slice 1D-2).
//
// Design: kalokagathia-pro/STAGE1_1D_SPAWN_DESIGN.md §2 / §5.
// The chain gains a fifth event mode, `emit` (mode id 5): a
// LIVING source particle behaves as an emitter and sheds the
// next level's particles continuously, instead of firing on a
// discrete event (death / bounce / birth). The per-tick spawn
// probability is the emission rate converted from per-second —
// rate / 60 at the shaders' 60 Hz tick — rolled on the existing
// (slot, tick, candidate) gate hash, so an emitter set to
// 30 / s fires on about half of the ticks a free slot watches
// it. The spawn velocity is shaped by the emission shape:
//
//   sphere — all directions (the legacy burst distribution)
//   cone   — a cone around the parent's velocity direction;
//            gpgpuAuxEmitSpread widens it (0 = straight ahead)
//   disc   — a disc perpendicular to the parent's velocity;
//            the spread is the disc's axial thickness
//   point  — almost no velocity: the child is placed at the
//            emitter and drifts
//
// The emitter's lifetime is the source particle's own life —
// no separate emitter-lifetime key exists. The grandchild's
// life is the level's usual Life key, and the child inherits
// the emitter's attribute slots / species through the slice
// 1D-1 inheritance texture exactly like every other mode.
//
// This module is the pure, unit-tested source of truth for the
// rate conversion and the shape distributions; the GLSL lives
// in components/gpgpuShaderAux.ts (the emit variants of the
// event chunks) and mirrors the twin below term for term.

import type { ParticleConfig } from '../types';

export type AuxEmitShape = ParticleConfig['gpgpuAuxEmitShape'];

/** Shape ids as consumed by the shaders' uAuxEmitShape. */
export const AUX_EMIT_SHAPE_IDS: Record<AuxEmitShape, number> = {
  sphere: 0,
  cone: 1,
  disc: 2,
  point: 3,
};

/** The emit mode id in AUX_MODE_IDS (mode 4 is ruleSpawn, 1D-3). */
export const AUX_EMIT_MODE_ID = 5;

/**
 * The level-1 shaders carry the emit variant while the level-1
 * mode is 'emit' (the mode is a uniform, but the emit branch
 * and its uniforms are spliced text — the Phase 19/20 variant
 * discipline). Every other mode assembles the stock strings.
 */
export function auxEmitLevel1Active(
  config: Pick<ParticleConfig, 'gpgpuAuxMode'>,
): boolean {
  return config.gpgpuAuxMode === 'emit';
}

/** The chain shaders carry the emit variant while the shared
 *  Aux2 mode is 'emit' (levels 2 and 3 share the parameter
 *  set, so one flag serves both). */
export function auxEmitChainActive(
  config: Pick<ParticleConfig, 'gpgpuAux2Mode'>,
): boolean {
  return config.gpgpuAux2Mode === 'emit';
}

/**
 * Per-tick spawn probability for an emission rate: the rate
 * is per second and the event scan ticks at 60 Hz, so the
 * gate is rate / 60 clamped to [0, 1] (a rate at or above 60
 * fires on every tick). Non-finite rates never fire.
 */
export function auxEmitTickProbability(ratePerSecond: number): number {
  if (!Number.isFinite(ratePerSecond)) return 0;
  const p = ratePerSecond / 60;
  if (p < 0) return 0;
  if (p > 1) return 1;
  return p;
}

type Vec3 = readonly [number, number, number];

function normOr(v: Vec3, fallback: Vec3): [number, number, number] {
  const l = Math.hypot(v[0], v[1], v[2]);
  if (l > 0.01) return [v[0] / l, v[1] / l, v[2] / l];
  return [fallback[0], fallback[1], fallback[2]];
}

/**
 * Twin of the GLSL auxEmitVelocity / auxChainEmitVelocity.
 * `h3` is the hash direction sample in [-0.5, 0.5]^3 (the
 * shaders' auxHash3 output), `hA` / `hB` are scalar hash
 * samples in [0, 1): hA drives the speed factor (the legacy
 * 0.35 + 0.65 h distribution shared with deathBurst) and, on
 * disc, hB is the angle around the disc. The thresholds and
 * fallbacks mirror the GLSL exactly.
 */
export function auxEmitVelocity(
  shape: AuxEmitShape,
  parentVel: Vec3,
  h3: Vec3,
  hA: number,
  hB: number,
  speed: number,
  spread: number,
): [number, number, number] {
  const mag = speed * (0.35 + 0.65 * hA);
  if (shape === 'point') {
    return [h3[0] * speed * 0.04, h3[1] * speed * 0.04, h3[2] * speed * 0.04];
  }
  if (shape === 'sphere') {
    const dir = normOr(h3, [0, 1, 0]);
    return [dir[0] * mag, dir[1] * mag, dir[2] * mag];
  }
  const pl = Math.hypot(parentVel[0], parentVel[1], parentVel[2]);
  let axis: [number, number, number];
  if (pl > 0.001) {
    axis = [parentVel[0] / pl, parentVel[1] / pl, parentVel[2] / pl];
  } else {
    axis = normOr(h3, [0, 1, 0]);
  }
  if (shape === 'cone') {
    const d: Vec3 = [
      axis[0] + h3[0] * (spread * 2),
      axis[1] + h3[1] * (spread * 2),
      axis[2] + h3[2] * (spread * 2),
    ];
    const dl = Math.hypot(d[0], d[1], d[2]);
    const dir: [number, number, number] = dl > 0.001
      ? [d[0] / dl, d[1] / dl, d[2] / dl]
      : axis;
    return [dir[0] * mag, dir[1] * mag, dir[2] * mag];
  }
  // disc: planar basis perpendicular to the axis.
  const helper: Vec3 = Math.abs(axis[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const cx = axis[1] * helper[2] - axis[2] * helper[1];
  const cy = axis[2] * helper[0] - axis[0] * helper[2];
  const cz = axis[0] * helper[1] - axis[1] * helper[0];
  const cl = Math.hypot(cx, cy, cz);
  const u: [number, number, number] = [cx / cl, cy / cl, cz / cl];
  const v: [number, number, number] = [
    axis[1] * u[2] - axis[2] * u[1],
    axis[2] * u[0] - axis[0] * u[2],
    axis[0] * u[1] - axis[1] * u[0],
  ];
  const ang = hB * 6.2831853;
  const ca = Math.cos(ang);
  const sa = Math.sin(ang);
  const axial = h3[0] * spread * speed * 0.5;
  return [
    (u[0] * ca + v[0] * sa) * mag + axis[0] * axial,
    (u[1] * ca + v[1] * sa) * mag + axis[1] * axial,
    (u[2] * ca + v[2] * sa) * mag + axis[2] * axial,
  ];
}
