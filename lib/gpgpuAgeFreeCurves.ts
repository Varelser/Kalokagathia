/**
 * Age free curves (Grammar 2.0 stage 2, slice B4): the single
 * resolution point for wiring the free control-point curve
 * asset (lib/freeCurve.ts, Phase AJ) onto the age axis of the
 * five fixed 5-point age-curve targets (Phase U / AC).
 *
 * Each target (size / opacity / velocity / force / rotation)
 * gains a FREE MODE: while the target's own Enabled key and
 * its new FreeEnabled key are both on, the shader evaluates
 * the target's free curve (up to FREE_CURVE_MAX_POINTS knots
 * at free positions) instead of the fixed 5-point curve. The
 * 5-point asset is not migrated or merged — the two coexist,
 * the free mode simply replaces the evaluation source while
 * it stands, so every existing preset keeps its meaning.
 *
 * Semantics pinned here and consumed identically by the
 * runtime, the passes and the capability report:
 *
 *   - variant (shader string) stands: Enabled && FreeEnabled.
 *   - identity suppression (the passes' rule that a flat
 *     curve disables the target's block outright) follows
 *     the FREE curve's identity while FreeEnabled is on and
 *     the 5-point identity otherwise — a non-flat 5-point
 *     asset cannot resurrect a target the author flattened
 *     in free mode, and vice versa.
 *   - capability: 'age-free-curves' is requested only while
 *     some target's free mode stands with a non-identity
 *     curve (the only case where behaviour can diverge from
 *     the WGSL route).
 *
 * Supply follows the free curve's established form: two
 * padded float arrays (knots T / values V, FREE_CURVE_MAX_
 * POINTS long, unused slots repeating the last point so the
 * GLSL loops need no count) as plain uniforms — no sampler
 * is spent, so no texture-unit accounting changes anywhere.
 *
 * The GLSL twins are generated per target from the one
 * template below (the attractor-unit generator's discipline):
 * kaloEvalAgeFree<Target> mirrors evaluateFreeCurve and
 * kaloAgeFreeIntegral<Target> (rotation only — the spin rate
 * is integrated in closed form, exactly like the 5-point
 * kaloCurveIntegral5) mirrors integrateFreeCurve.
 */
import type { ParticleConfig } from '../types';
import { normalizeAgeCurvePoints, isAgeCurveIdentity } from './ageCurve';
import {
  FREE_CURVE_MAX_POINTS,
  isFreeCurveIdentity,
  normalizeFreeCurvePoints,
  type FreeCurvePoint,
} from './freeCurve';

export type AgeCurveTarget = 'size' | 'opacity' | 'velocity' | 'force' | 'rotation';

export const AGE_CURVE_TARGETS: readonly AgeCurveTarget[] = [
  'size', 'opacity', 'velocity', 'force', 'rotation',
];

type AgeFreeConfig = Pick<
  ParticleConfig,
  | 'gpgpuAgeCurveSizeEnabled' | 'gpgpuAgeCurveSizePoints' | 'gpgpuAgeCurveSizeFreeEnabled' | 'gpgpuAgeCurveSizeFreePoints'
  | 'gpgpuAgeCurveOpacityEnabled' | 'gpgpuAgeCurveOpacityPoints' | 'gpgpuAgeCurveOpacityFreeEnabled' | 'gpgpuAgeCurveOpacityFreePoints'
  | 'gpgpuAgeCurveVelocityEnabled' | 'gpgpuAgeCurveVelocityPoints' | 'gpgpuAgeCurveVelocityFreeEnabled' | 'gpgpuAgeCurveVelocityFreePoints'
  | 'gpgpuAgeCurveForceEnabled' | 'gpgpuAgeCurveForcePoints' | 'gpgpuAgeCurveForceFreeEnabled' | 'gpgpuAgeCurveForceFreePoints'
  | 'gpgpuAgeCurveRotationEnabled' | 'gpgpuAgeCurveRotationPoints' | 'gpgpuAgeCurveRotationFreeEnabled' | 'gpgpuAgeCurveRotationFreePoints'
>;

type AgeFreeBoolKey = {
  [K in keyof AgeFreeConfig]: AgeFreeConfig[K] extends boolean ? K : never;
}[keyof AgeFreeConfig];
type AgeFreePointsKey = {
  [K in keyof AgeFreeConfig]: AgeFreeConfig[K] extends number[] ? K : never;
}[keyof AgeFreeConfig];

interface AgeCurveTargetKeys {
  cap: string;
  enabled: AgeFreeBoolKey;
  points: AgeFreePointsKey;
  freeEnabled: AgeFreeBoolKey;
  freePoints: AgeFreePointsKey;
}

export const AGE_CURVE_TARGET_KEYS: Record<AgeCurveTarget, AgeCurveTargetKeys> = {
  size: {
    cap: 'Size',
    enabled: 'gpgpuAgeCurveSizeEnabled',
    points: 'gpgpuAgeCurveSizePoints',
    freeEnabled: 'gpgpuAgeCurveSizeFreeEnabled',
    freePoints: 'gpgpuAgeCurveSizeFreePoints',
  },
  opacity: {
    cap: 'Opacity',
    enabled: 'gpgpuAgeCurveOpacityEnabled',
    points: 'gpgpuAgeCurveOpacityPoints',
    freeEnabled: 'gpgpuAgeCurveOpacityFreeEnabled',
    freePoints: 'gpgpuAgeCurveOpacityFreePoints',
  },
  velocity: {
    cap: 'Velocity',
    enabled: 'gpgpuAgeCurveVelocityEnabled',
    points: 'gpgpuAgeCurveVelocityPoints',
    freeEnabled: 'gpgpuAgeCurveVelocityFreeEnabled',
    freePoints: 'gpgpuAgeCurveVelocityFreePoints',
  },
  force: {
    cap: 'Force',
    enabled: 'gpgpuAgeCurveForceEnabled',
    points: 'gpgpuAgeCurveForcePoints',
    freeEnabled: 'gpgpuAgeCurveForceFreeEnabled',
    freePoints: 'gpgpuAgeCurveForceFreePoints',
  },
  rotation: {
    cap: 'Rotation',
    enabled: 'gpgpuAgeCurveRotationEnabled',
    points: 'gpgpuAgeCurveRotationPoints',
    freeEnabled: 'gpgpuAgeCurveRotationFreeEnabled',
    freePoints: 'gpgpuAgeCurveRotationFreePoints',
  },
};

export interface ResolvedAgeFreeCurve {
  /** Normalised knot list (2..FREE_CURVE_MAX_POINTS points). */
  points: FreeCurvePoint[];
  /** Padded knot positions for the shader uniform (last point repeated). */
  flatT: number[];
  /** Padded knot values for the shader uniform (last point repeated). */
  flatV: number[];
  /** True when every knot value is exactly 1. */
  identity: boolean;
}

/** Pad a knot list to FREE_CURVE_MAX_POINTS by repeating the
 *  last point (the emission curve's convention), split into
 *  the two uniform arrays. */
export function padFreeCurveArrays(points: readonly FreeCurvePoint[]): { flatT: number[]; flatV: number[] } {
  const flatT: number[] = [];
  const flatV: number[] = [];
  const last = points[points.length - 1] ?? { t: 1, v: 1 };
  for (let i = 0; i < FREE_CURVE_MAX_POINTS; i++) {
    const point = points[i] ?? last;
    flatT.push(point.t);
    flatV.push(point.v);
  }
  return { flatT, flatV };
}

export function resolveAgeFreeCurve(config: AgeFreeConfig, target: AgeCurveTarget): ResolvedAgeFreeCurve {
  const keys = AGE_CURVE_TARGET_KEYS[target];
  const points = normalizeFreeCurvePoints(config[keys.freePoints]);
  const { flatT, flatV } = padFreeCurveArrays(points);
  return { points, flatT, flatV, identity: isFreeCurveIdentity(points) };
}

/** The target's free-mode switch (independent of its Enabled). */
export function ageFreeEnabled(config: AgeFreeConfig, target: AgeCurveTarget): boolean {
  return !!config[AGE_CURVE_TARGET_KEYS[target].freeEnabled];
}

/**
 * The shader variant for a target stands while BOTH the
 * target's Enabled and its FreeEnabled are on. At the key
 * defaults (FreeEnabled false everywhere) no variant ever
 * stands, so the stock shader strings stay byte-identical.
 */
export function ageFreeVariantOn(config: AgeFreeConfig, target: AgeCurveTarget): boolean {
  const keys = AGE_CURVE_TARGET_KEYS[target];
  return !!config[keys.enabled] && !!config[keys.freeEnabled];
}

/**
 * Identity suppression for a target, free-aware: while the
 * free mode switch is on, the FREE curve's identity decides
 * (the evaluation source is the free asset, flat or not);
 * otherwise the 5-point identity decides, exactly as before
 * B4. A disabled target is always suppressed.
 */
export function ageCurveTargetSuppressed(config: AgeFreeConfig, target: AgeCurveTarget): boolean {
  const keys = AGE_CURVE_TARGET_KEYS[target];
  if (!config[keys.enabled]) return true;
  if (config[keys.freeEnabled]) return resolveAgeFreeCurve(config, target).identity;
  return isAgeCurveIdentity(normalizeAgeCurvePoints(config[keys.points]));
}

/**
 * The capability predicate: some target's free mode stands
 * with a non-identity curve — the only configuration whose
 * behaviour the WGSL route cannot reproduce.
 */
export function ageFreeCurvesActive(config: AgeFreeConfig): boolean {
  return AGE_CURVE_TARGETS.some(
    (target) => ageFreeVariantOn(config, target) && !resolveAgeFreeCurve(config, target).identity,
  );
}

/**
 * Closed-form integral of a free curve from 0 to x (x clamped
 * to [0, 1]): the area under the piecewise-linear shape with
 * endpoint hold — the head before the first knot contributes
 * first.v per unit, each full segment its trapezoid, the
 * partial segment the exact quadratic, and the tail beyond
 * the last knot contributes last.v per unit. An all-ones
 * curve integrates to exactly x. The GLSL twin
 * (kaloAgeFreeIntegral<Target>, generated below) follows the
 * same segment arithmetic over the padded arrays.
 */
export function integrateFreeCurve(points: readonly FreeCurvePoint[], xInput: number): number {
  const x = Math.min(1, Math.max(0, xInput));
  if (points.length === 0) return x;
  const first = points[0];
  const last = points[points.length - 1];
  let area = Math.min(x, first.t) * first.v;
  if (x <= first.t) return area;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (x <= a.t) return area;
    const d = Math.min(x, b.t) - a.t;
    const span = b.t - a.t;
    const f = span > 0 ? d / span : 0;
    area += d * a.v + ((b.v - a.v) * d * f) / 2;
    if (x <= b.t) return area;
  }
  area += (x - last.t) * last.v;
  return area;
}

// ── GLSL twins (generated per target) ────────────────────

/**
 * The uniform declarations + evaluation function for one
 * target's free curve, generated from the one template so
 * every consumer shader carries the same text. The eval
 * mirrors evaluateFreeCurve (same clamping, same endpoint
 * hold, knots over the padded arrays — the Phase AJ
 * kaloEvalFreeCurve form with per-target uniform names).
 */
export function ageFreeEvalGlsl(target: AgeCurveTarget): string {
  const cap = AGE_CURVE_TARGET_KEYS[target].cap;
  return `  // Age free curve (Grammar 2.0 stage 2, B4): the ${target}
  // target's free control-point asset (lib/freeCurve.ts) as
  // two padded float arrays — unused slots repeat the last
  // point, so the loop needs no count. GLSL twin of
  // evaluateFreeCurve; generated by ageFreeEvalGlsl in
  // lib/gpgpuAgeFreeCurves.ts.
  uniform float uAgeCurve${cap}FreeT[${FREE_CURVE_MAX_POINTS}];
  uniform float uAgeCurve${cap}FreeV[${FREE_CURVE_MAX_POINTS}];
  float kaloEvalAgeFree${cap}(float x) {
    float xx = clamp(x, 0.0, 1.0);
    if (xx <= uAgeCurve${cap}FreeT[0]) return uAgeCurve${cap}FreeV[0];
    for (int i = 1; i < ${FREE_CURVE_MAX_POINTS}; i++) {
      if (xx <= uAgeCurve${cap}FreeT[i]) {
        float span = uAgeCurve${cap}FreeT[i] - uAgeCurve${cap}FreeT[i - 1];
        float f = span > 0.0 ? (xx - uAgeCurve${cap}FreeT[i - 1]) / span : 0.0;
        return mix(uAgeCurve${cap}FreeV[i - 1], uAgeCurve${cap}FreeV[i], f);
      }
    }
    return uAgeCurve${cap}FreeV[${FREE_CURVE_MAX_POINTS - 1}];
  }
`;
}

/**
 * The closed-form integral twin (rotation only): the area
 * under the free curve from 0 to x over the padded arrays,
 * segment arithmetic identical to integrateFreeCurve.
 */
export function ageFreeIntegralGlsl(target: AgeCurveTarget): string {
  const cap = AGE_CURVE_TARGET_KEYS[target].cap;
  return `  // Closed-form integral of the ${target} free curve from
  // 0 to x (endpoint hold + trapezoids + the exact quadratic
  // on the partial segment). GLSL twin of integrateFreeCurve
  // in lib/gpgpuAgeFreeCurves.ts.
  float kaloAgeFreeIntegral${cap}(float x) {
    float xx = clamp(x, 0.0, 1.0);
    float area = min(xx, uAgeCurve${cap}FreeT[0]) * uAgeCurve${cap}FreeV[0];
    if (xx <= uAgeCurve${cap}FreeT[0]) return area;
    for (int i = 1; i < ${FREE_CURVE_MAX_POINTS}; i++) {
      float t0 = uAgeCurve${cap}FreeT[i - 1];
      float t1 = uAgeCurve${cap}FreeT[i];
      if (xx <= t0) return area;
      float d = min(xx, t1) - t0;
      float span = t1 - t0;
      float f = span > 0.0 ? d / span : 0.0;
      area += d * uAgeCurve${cap}FreeV[i - 1] + (uAgeCurve${cap}FreeV[i] - uAgeCurve${cap}FreeV[i - 1]) * d * f * 0.5;
      if (xx <= t1) return area;
    }
    area += (xx - uAgeCurve${cap}FreeT[${FREE_CURVE_MAX_POINTS - 1}]) * uAgeCurve${cap}FreeV[${FREE_CURVE_MAX_POINTS - 1}];
    return area;
  }
`;
}
