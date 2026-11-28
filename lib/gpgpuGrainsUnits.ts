/**
 * Grains DEM — unit-system declaration and Hertz–Mindlin
 * correspondence (Layer 1 WP12, row C4 remainder; phase-D
 * branch 2 ruling (a): declaration and correspondence
 * verification only).
 *
 * This module changes NO behaviour. The DEM engine's numbers
 * (lib/gpgpuGrains.ts) are the proven spike operating point
 * rescaled by particle mass, with the repose table calibrated
 * on the real GPU; those values are the canonical form and
 * stay exactly as they are. What was missing — and what this
 * module adds, alongside the untouched constants — is:
 *
 *   (i)   a declaration of the unit system the numbers live
 *         in (what one unit of length / mass / time is), with
 *         the physical dimension of every DEM constant;
 *   (ii)  the correspondence to the standard Hertz–Mindlin
 *         form, stated as an EQUIVALENT STIFFNESS AT A CHOSEN
 *         OPERATING OVERLAP (see the limitation below), with
 *         the pure functions the verification test uses.
 *
 * The precedent for this shape is lib/gpgpuVellum.ts: the
 * legacy solver's stiffnesses are effective values, and the
 * physical-units definition (XPBD compliance) was added
 * alongside them without moving the canonical numbers.
 *
 * LIMITATION (read before citing the correspondence): the
 * product's contact law is a LINEAR penalty spring
 * (F = kn * delta); Hertz–Mindlin is nonlinear
 * (F ~ delta^(3/2)). The two can only be made to agree at one
 * chosen operating overlap delta_op, and only in the sense
 * stated (tangent-stiffness match or force/secant match).
 * Away from delta_op the forces diverge as sqrt(delta /
 * delta_op) — the test quantifies the band. Nothing here is
 * an all-range equivalence, and the tangential ratio has NO
 * Hertz–Mindlin counterpart at all (see
 * demMindlinTangentialRatio / the note at the bottom).
 *
 * Nobody imports this module yet (declaration + verification
 * only, pinned by scripts/layer1-wp12-dem-units.test.mjs).
 */

import {
  GRAINS_DEM_BOUNDARY_ROLLING_SCALE,
  GRAINS_DEM_DT,
  GRAINS_DEM_FLOOR_MU_RATIO,
  GRAINS_DEM_KN_PER_MASS,
  GRAINS_DEM_REFERENCE_RADIUS,
  GRAINS_DEM_REPOSE_TABLE,
} from './gpgpuGrains';

// ---------------------------------------------------------------------
// (i) The unit system, declared.
//
// Length: the scene world unit — the unit the grain Size key
//   is expressed in. The reference grain has radius
//   GRAINS_DEM_REFERENCE_RADIUS = 0.5 of these.
// Mass:   the mass of the reference grain is 1 by definition.
//   resolveGrainsDemPlan scales mass as (R / R_ref)^3, a pure
//   volume ratio, which is exactly a uniform-density law with
//   implied density rho = 1 / ((4/3) * pi * R_ref^3) = 6 / pi
//   mass units per cubic length unit. The solid-sphere
//   inertia (2/5) m R^2 in the plan is the same uniform
//   density assumption.
// Time:   the second. The substep GRAINS_DEM_DT is in
//   seconds, velocities are length / second and gravity
//   accelerations are length / second^2, so forces are
//   mass * length / second^2 throughout.
// ---------------------------------------------------------------------

export interface GrainsDemUnitSystem {
  /** What one unit of length is. */
  length: string;
  /** What one unit of mass is. */
  mass: string;
  /** What one unit of time is. */
  time: string;
  /** Radius at which a grain's mass is exactly 1 (length). */
  referenceRadius: number;
  /** Mass of the reference grain (mass units, = 1). */
  referenceMass: number;
  /**
   * Uniform density implied by the mass law
   * m = (R / R_ref)^3: rho = referenceMass /
   * ((4/3) * pi * referenceRadius^3) = 6 / pi.
   */
  impliedDensity: number;
}

export const GRAINS_DEM_UNIT_SYSTEM: GrainsDemUnitSystem = {
  length: 'scene world unit (the unit of the grain Size key)',
  mass: 'mass of the reference grain (radius 0.5 length units)',
  time: 'second',
  referenceRadius: GRAINS_DEM_REFERENCE_RADIUS,
  referenceMass: 1,
  impliedDensity: 6 / Math.PI,
};

/** Mass of a grain of the given radius under the declared law. */
export function grainsDemMassForRadius(radius: number): number {
  return Math.pow(radius / GRAINS_DEM_UNIT_SYSTEM.referenceRadius, 3)
    * GRAINS_DEM_UNIT_SYSTEM.referenceMass;
}

/** The same mass from the declared density: rho * (4/3) pi R^3. */
export function grainsDemMassFromDensity(radius: number): number {
  return GRAINS_DEM_UNIT_SYSTEM.impliedDensity * (4 / 3) * Math.PI * radius * radius * radius;
}

// ---------------------------------------------------------------------
// Dimensions of the DEM constants and of the resolved plan
// quantities. `value` references the constant itself (never a
// copy) for the scalar constants; plan quantities are resolved
// per scene, so their value is null and `expression` says how
// resolveGrainsDemPlan forms them. Dimensions use L (length),
// M (mass), T (time).
// ---------------------------------------------------------------------

export interface GrainsDemDimensionRow {
  /** Constant or plan-field name, as in lib/gpgpuGrains.ts. */
  name: string;
  /** The constant's own value, or null for resolved quantities. */
  value: number | null;
  /** How a resolved quantity is formed (empty for constants). */
  expression: string;
  /** Physical dimension in L / M / T. */
  dimension: string;
  /** The unit the value is expressed in. */
  unit: string;
}

export const GRAINS_DEM_DIMENSIONS: readonly GrainsDemDimensionRow[] = [
  {
    name: 'GRAINS_DEM_DT', value: GRAINS_DEM_DT, expression: '',
    dimension: 'T', unit: 'second',
  },
  {
    name: 'GRAINS_DEM_REFERENCE_RADIUS', value: GRAINS_DEM_REFERENCE_RADIUS, expression: '',
    dimension: 'L', unit: 'length unit',
  },
  {
    // kn = GRAINS_DEM_KN_PER_MASS * mass, and kn itself is a
    // stiffness (force / length = M / T^2), so the per-mass
    // constant carries M^-1 of that: 1 / T^2. Its square root
    // is the contact angular-frequency scale per unit mass.
    name: 'GRAINS_DEM_KN_PER_MASS', value: GRAINS_DEM_KN_PER_MASS, expression: '',
    dimension: 'T^-2', unit: '1 / second^2 (stiffness per unit mass)',
  },
  {
    name: 'GRAINS_DEM_FLOOR_MU_RATIO', value: GRAINS_DEM_FLOOR_MU_RATIO, expression: '',
    dimension: '1', unit: 'dimensionless',
  },
  {
    name: 'GRAINS_DEM_BOUNDARY_ROLLING_SCALE', value: GRAINS_DEM_BOUNDARY_ROLLING_SCALE, expression: '',
    dimension: '1', unit: 'dimensionless',
  },
  // Resolved plan quantities (GrainsDemPlan in lib/gpgpuGrains.ts).
  {
    name: 'mass', value: null, expression: '(radius / R_ref)^3',
    dimension: 'M', unit: 'mass unit',
  },
  {
    name: 'inertia', value: null, expression: '(2/5) * mass * radius^2',
    dimension: 'M L^2', unit: 'mass unit * length unit^2',
  },
  {
    name: 'kn', value: null, expression: 'GRAINS_DEM_KN_PER_MASS * mass * DemStiffness',
    dimension: 'M T^-2', unit: 'force / length = mass unit / second^2',
  },
  {
    name: 'kt', value: null, expression: 'kn * DemTangentialRatio',
    dimension: 'M T^-2', unit: 'force / length = mass unit / second^2',
  },
  {
    // cn = 2 * zeta * sqrt(kn * m*) with the pair reduced mass
    // m* = mass / 2 for equal grains: a dashpot coefficient.
    name: 'cn', value: null, expression: '2 * zeta * sqrt(kn * mass * 0.5)',
    dimension: 'M T^-1', unit: 'force / velocity = mass unit / second',
  },
  {
    name: 'ct', value: null, expression: 'cn (same as normal)',
    dimension: 'M T^-1', unit: 'force / velocity = mass unit / second',
  },
  {
    name: 'muS / muFloor / rollingFriction / localDamping', value: null, expression: 'keys / repose table',
    dimension: '1', unit: 'dimensionless',
  },
];

/**
 * Dimensions of the repose calibration table's columns
 * (GRAINS_DEM_REPOSE_TABLE, values untouched — measured on
 * the real GPU in this unit system). The rolling cap is
 * coeff * R * F_n, so the coefficient is dimensionless:
 * (M L^2 T^-2) / (L * M L T^-2) = 1.
 */
export const GRAINS_DEM_REPOSE_DIMENSIONS = {
  angleDeg: 'plane angle, expressed in degrees (dimensionless)',
  muS: 'dimensionless (sliding friction coefficient)',
  rollingFriction: 'dimensionless (torque cap = coeff * R * F_n)',
} as const;

/** Re-exported so the table's values are reachable from here. */
export { GRAINS_DEM_REPOSE_TABLE };

// ---------------------------------------------------------------------
// (ii) Hertz–Mindlin correspondence.
//
// Standard form, two spheres (radii R1, R2; Young's moduli
// E1, E2; Poisson ratios nu1, nu2):
//   1 / R* = 1 / R1 + 1 / R2
//   1 / E* = (1 - nu1^2) / E1 + (1 - nu2^2) / E2
//   F_n(delta) = (4/3) * E* * sqrt(R*) * delta^(3/2)
//   tangent stiffness  dF/ddelta = 2 * E* * sqrt(R* * delta)
//   secant stiffness   F / delta = (4/3) * E* * sqrt(R* * delta)
// For identical grains (E, nu): E* = E / (2 * (1 - nu^2)).
// ---------------------------------------------------------------------

/** Effective radius R* of a pair. */
export function hertzEffectiveRadius(r1: number, r2: number): number {
  return 1 / (1 / r1 + 1 / r2);
}

/** Effective modulus E* of a pair. */
export function hertzEffectiveModulus(
  e1: number, nu1: number, e2: number, nu2: number,
): number {
  return 1 / ((1 - nu1 * nu1) / e1 + (1 - nu2 * nu2) / e2);
}

/** Hertz normal force at overlap delta. */
export function hertzNormalForce(eStar: number, rStar: number, delta: number): number {
  return (4 / 3) * eStar * Math.sqrt(rStar) * Math.pow(delta, 1.5);
}

/** Hertz tangent stiffness dF/ddelta at overlap delta. */
export function hertzTangentStiffness(eStar: number, rStar: number, delta: number): number {
  return 2 * eStar * Math.sqrt(rStar * delta);
}

/** Hertz secant stiffness F/delta at overlap delta. */
export function hertzSecantStiffness(eStar: number, rStar: number, delta: number): number {
  return (4 / 3) * eStar * Math.sqrt(rStar * delta);
}

/** The product's linear penalty force at overlap delta. */
export function demLinearPenaltyForce(kn: number, delta: number): number {
  return kn * delta;
}

/**
 * The E* whose Hertz TANGENT stiffness at the operating
 * overlap deltaOp equals the product's kn:
 *   E* = kn / (2 * sqrt(R* * deltaOp)).
 * Under this match the force ratio is
 *   F_hertz(delta) / F_linear(delta) = (2/3) * sqrt(delta / deltaOp),
 * so at deltaOp itself the Hertz force is 2/3 of the linear
 * force — the match is in stiffness, not in force.
 */
export function demEstarTangentMatch(kn: number, rStar: number, deltaOp: number): number {
  return kn / (2 * Math.sqrt(rStar * deltaOp));
}

/**
 * The E* whose Hertz FORCE at deltaOp equals the linear
 * force kn * deltaOp (a secant-stiffness match):
 *   E* = 3 * kn / (4 * sqrt(R* * deltaOp)) = 1.5 * tangent match.
 * Under this match the force ratio is sqrt(delta / deltaOp).
 */
export function demEstarSecantMatch(kn: number, rStar: number, deltaOp: number): number {
  return (3 * kn) / (4 * Math.sqrt(rStar * deltaOp));
}

/** Young's modulus of either grain of an identical pair, from E*. */
export function demYoungsModulusFromEstar(eStar: number, nu: number): number {
  return 2 * (1 - nu * nu) * eStar;
}

export interface DemHertzCorrespondence {
  /** Effective radius of the pair (R / 2 for equal grains). */
  rStar: number;
  /** The operating overlap the equivalence is stated at. */
  deltaOp: number;
  /** deltaOp relative to the grain radius. */
  deltaOpRatio: number;
  /** E* under the tangent-stiffness match. */
  eStarTangent: number;
  /** E* under the force (secant) match. */
  eStarSecant: number;
  /** Young's modulus (identical pair, given nu), tangent match. */
  youngsTangent: number;
  /** Young's modulus (identical pair, given nu), secant match. */
  youngsSecant: number;
  /**
   * Force ratio F_hertz / F_linear at deltaOp under the
   * tangent match: exactly 2/3 (see demEstarTangentMatch).
   */
  forceRatioAtOpTangentMatch: number;
}

/**
 * The correspondence summary for a pair of equal grains of
 * the given radius under the plan's kn, stated at the chosen
 * operating overlap deltaOp and Poisson ratio nu. All values
 * carry the pressure dimension M L^-1 T^-2 for the moduli.
 */
export function demHertzCorrespondence(
  kn: number, radius: number, deltaOp: number, nu: number,
): DemHertzCorrespondence {
  const rStar = hertzEffectiveRadius(radius, radius);
  const eStarTangent = demEstarTangentMatch(kn, rStar, deltaOp);
  const eStarSecant = demEstarSecantMatch(kn, rStar, deltaOp);
  return {
    rStar,
    deltaOp,
    deltaOpRatio: deltaOp / radius,
    eStarTangent,
    eStarSecant,
    youngsTangent: demYoungsModulusFromEstar(eStarTangent, nu),
    youngsSecant: demYoungsModulusFromEstar(eStarSecant, nu),
    forceRatioAtOpTangentMatch:
      hertzNormalForce(eStarTangent, rStar, deltaOp) / demLinearPenaltyForce(kn, deltaOp),
  };
}

/**
 * Static operating-overlap estimate: a single grain resting
 * under its own weight, kn * delta = m * g. The mass cancels
 * against kn = GRAINS_DEM_KN_PER_MASS * m, so at stiffness
 * multiplier 1 the resting overlap is g / 20000 length units
 * for ANY grain size (a pile's bottom layer under N layers
 * of load sits ~N times deeper). This is an estimate of
 * where the operating point sits, not a measured value.
 */
export function demStaticSelfWeightOverlap(gravity: number, stiffnessMul = 1): number {
  return gravity / (GRAINS_DEM_KN_PER_MASS * stiffnessMul);
}

/**
 * Mindlin tangential-to-normal TANGENT stiffness ratio for
 * identical grains under no slip: kt / kn = 2 (1 - nu) /
 * (2 - nu). Over the physical range nu in [0, 0.5] this spans
 * [2/3, 1]. The product's default tangential ratio (kt = kn *
 * DemTangentialRatio, default 0.5) lies BELOW that range: the
 * Poisson ratio it would imply is 2/3, which no material has.
 * The product's tangential spring is therefore a spike-tuned
 * effective value with no Hertz–Mindlin counterpart — the
 * correspondence of this module covers the NORMAL law only,
 * and the tangential ratio is recorded here as a known
 * non-correspondence rather than dressed up as one.
 */
export function demMindlinTangentialRatio(nu: number): number {
  return (2 * (1 - nu)) / (2 - nu);
}

/** Inverse of demMindlinTangentialRatio: nu = 2 (1 - r) / (2 - r). */
export function demPoissonFromTangentialRatio(ratio: number): number {
  return (2 * (1 - ratio)) / (2 - ratio);
}
