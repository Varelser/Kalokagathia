/**
 * XPBD constraint core (Phase 19 stage 3) — the shared nucleus
 * the Vellum XPBD passes are the first consumer of, and the
 * receiving socket for Phase 20's rigid-body joints.
 *
 * The formulation is Müller et al.'s small-steps XPBD, kept
 * strict: per substep, λ resets to zero, each constraint is
 * solved once with
 *
 *   Δλ = (−C − α̃·λ) / (Σ wᵢ|∇Cᵢ|² + α̃),   α̃ = α / dt_s²
 *   Δxᵢ = Δλ · wᵢ · ∇Cᵢ
 *
 * and velocities are reconstructed afterwards as
 * v = (x_new − x_prev) / dt_s. Compliance α is in physical
 * units with cell mass = 1 as the unit mass (α = 0 is rigid).
 *
 * Everything here is pure CPU code: the Δλ mirror below is the
 * 1-to-1 twin of the GLSL chunk in
 * components/gpgpuShaderXpbd.ts (same snapshot-Jacobi order:
 * every Δλ is computed from the substep's starting positions,
 * then all corrections are applied together), and the cloth
 * mirror further down is the twin of the GPU pass sequence —
 * the unit tests pin the numerics through these mirrors, so a
 * formula change must land in both places at once.
 */

export type XpbdConstraintKind = 'distance' | 'volume' | 'joint-distance';

/** Scale of the legacy Stiffness → α mapping (see below). The
 *  value is calibrated on the CPU mirror: with cell mass 1 and
 *  the sheet's link lengths (~0.1 world units at texSize 64),
 *  α_scale = 0.01 puts k = 0.8 at α ≈ 0.0025, whose steady hang
 *  stretch sits between the k = 0.5 and k = 0.95 mappings in the
 *  mirror probe (monotone in k, finite at both ends). */
export const XPBD_ALPHA_SCALE = 0.01;

/**
 * Jacobi relaxation for the snapshot Δλ apply. The plain
 * snapshot-Jacobi XPBD solve AMPLIFIES the checkerboard mode
 * on a grid at α = 0 (measured in the Phase 19 unit probe:
 * total link strain 0.044 → 58,918 in 8 steps unrelaxed — the
 * same instability family as the legacy projection's plain
 * sum, which its Jacobi average exists to tame). The design's
 * prepared branch is a single relaxation factor on the λ
 * update: corrections are applied scaled by this factor in
 * both the CPU mirror and the GPU apply pass. Calibrated on
 * the mirror probe (ω ∈ {1, 0.5, 0.35, 0.25, 0.2, 0.15}):
 * ω = 0.25 is the largest value at which the checkerboard
 * mode contracts decisively (strain 0.037 → 0.0064 over 8
 * steps; ω = 0.35 still grows slowly, ω ≥ 0.5 diverges), the
 * rigid (α = 0) hanging sheet stays finite with the least
 * stretch of the stable range, and dt-independence holds
 * (relative steady-stretch difference ≈ 0.02).
 */
export const XPBD_JACOBI_RELAXATION = 0.25;

/**
 * Legacy Stiffness k (0..1, a correction RATE) → XPBD compliance
 * α. Used ONLY as the initial value when the solver mode flips
 * to 'xpbd' and the compliance keys still hold their default 0
 * semantics in the UI mapping — the resolution point is
 * lib/gpgpuVellum.ts resolveVellum, which prefers the explicit
 * compliance keys whenever the mode is xpbd (see there). k → 1
 * approaches rigid (α → 0); k → 0 approaches α = α_scale / 1e-4
 * clamped by the caller's range.
 */
export function xpbdAlphaFromStiffness(stiffness: number): number {
  const k = Math.max(0, Math.min(1, stiffness));
  return ((1 - k) / Math.max(k, 1e-4)) * XPBD_ALPHA_SCALE;
}

/** α̃ = α / dt_s² for a substep of length dt_s. */
export function xpbdAlphaTilde(alpha: number, dtSub: number): number {
  const dt = Math.max(dtSub, 1e-6);
  return Math.max(0, alpha) / (dt * dt);
}

/**
 * The Δλ of one constraint, given its current value C, the
 * accumulated λ, α̃ and the denominator Σ wᵢ|∇Cᵢ|² (for a
 * two-point distance constraint with unit gradients this is
 * w_i + w_j). This is the exact expression the GLSL chunk
 * evaluates.
 */
export function xpbdDeltaLambda(
  c: number,
  lambda: number,
  alphaTilde: number,
  denom: number,
): number {
  return (-c - alphaTilde * lambda) / (denom + alphaTilde);
}

/**
 * The shared break rule (Vellum tear / glueBreak and the rigid
 * glue break are already the same shape): a threshold of 0
 * means unbreakable; otherwise the constraint dies — monotonic,
 * never reviving, reset only by a re-bake — once its metric
 * exceeds the threshold.
 */
export function xpbdBreakExceeded(metric: number, threshold: number): boolean {
  return threshold > 0 && metric > threshold;
}

/**
 * Phase 20 receiving socket — the type the rigid solver's
 * joints are modelled on. The centre-distance form landed in
 * Phase 20 stage 1 (lib/rigidBodies.ts RigidJoint); the
 * anchored form — anchor points with rotational coupling via
 * the bodies' inverse mass + inertia, plus a swing angle
 * limit — landed as UE5 #35 G-C (build option jointAnchors).
 * The Δλ solve is the shared xpbdDeltaLambda in both forms.
 */
export interface XpbdJointSpec {
  bodyA: number;
  bodyB: number;
  /** Anchor point in body A's local frame. */
  anchorA: [number, number, number];
  /** Anchor point in body B's local frame. */
  anchorB: [number, number, number];
  restLength: number;
  compliance: number;
  /** xpbdBreakExceeded semantics: 0 = unbreakable. */
  breakThreshold: number;
}

// ── CPU mirror of the GPU XPBD cloth solve ────────────────────
//
// Grid layout matches the Vellum bake: index = iy * n + ix,
// structural links owned by their left (right-links) / lower
// (up-links) endpoint, shear diagonals owned by their quad
// corner, bend links owned by their near endpoint — the same
// ownership the λ textures use on the GPU. The mirror solves
// exactly the GPU's link set: structural + shear (compliance),
// bend (bendCompliance), and glue-to-bake-point links when a
// glue rate is mapped to a compliance by the caller (the GPU
// apply pass folds glue in with the structural α).

export interface XpbdClothMirror {
  n: number;
  /** Current positions, xyz per texel. */
  pos: Float32Array;
  prev: Float32Array;
  vel: Float32Array;
  rest: Float32Array;
  /** Per-texel inverse mass: 0 pinned, 1 otherwise. */
  invMass: Float32Array;
  /** Link survival (structural ownership): right/up per texel. */
  aliveR: Uint8Array;
  aliveU: Uint8Array;
}

export function createXpbdClothMirror(
  rest: Float32Array,
  n: number,
  invMass: Float32Array,
): XpbdClothMirror {
  return {
    n,
    pos: new Float32Array(rest),
    prev: new Float32Array(rest),
    vel: new Float32Array(n * n * 3),
    rest: new Float32Array(rest),
    invMass: new Float32Array(invMass),
    aliveR: new Uint8Array(n * n).fill(1),
    aliveU: new Uint8Array(n * n).fill(1),
  };
}

interface MirrorLink {
  a: number;
  b: number;
  rest: number;
  /** 0 = structural/shear α, 1 = bend α. */
  bend: 0 | 1;
}

function mirrorLinks(m: XpbdClothMirror): MirrorLink[] {
  const { n, rest, aliveR, aliveU } = m;
  const links: MirrorLink[] = [];
  const restLen = (a: number, b: number) => {
    const dx = rest[b * 3] - rest[a * 3];
    const dy = rest[b * 3 + 1] - rest[a * 3 + 1];
    const dz = rest[b * 3 + 2] - rest[a * 3 + 2];
    return Math.hypot(dx, dy, dz);
  };
  const idx = (x: number, y: number) => y * n + x;
  const has = (x: number, y: number) => x >= 0 && y >= 0 && y < n && (x < n || true);
  // Sheet topology (no wrap) — the mirror's tests use sheets;
  // the GPU handles the shell wrap in its texel helpers.
  const inX = (x: number) => x >= 0 && x < n;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = idx(x, y);
      const diagAlive = (cx: number, cy: number, rx: number, ry: number) =>
        (aliveR[idx(cx, cy)] ?? 0) > 0 && (aliveU[idx(rx, ry)] ?? 0) > 0;
      if (inX(x + 1) && aliveR[i]) links.push({ a: i, b: idx(x + 1, y), rest: restLen(i, idx(x + 1, y)), bend: 0 });
      if (y + 1 < n && aliveU[i]) links.push({ a: i, b: idx(x, y + 1), rest: restLen(i, idx(x, y + 1)), bend: 0 });
      // Shear diagonals, survival = min of the quad corner's two
      // structural links (the GPU projection's rule).
      if (inX(x + 1) && y + 1 < n && diagAlive(x, y, x + 1, y))
        links.push({ a: i, b: idx(x + 1, y + 1), rest: restLen(i, idx(x + 1, y + 1)), bend: 0 });
      if (inX(x - 1) && y + 1 < n && (aliveR[idx(x - 1, y)] ?? 0) > 0 && (aliveU[idx(x - 1, y)] ?? 0) > 0)
        links.push({ a: idx(x - 1, y + 1), b: i, rest: restLen(idx(x - 1, y + 1), i), bend: 0 });
      // Bend links (2-away), survival = both structural links
      // along the path.
      if (inX(x + 2) && aliveR[i] && aliveR[idx(x + 1, y)])
        links.push({ a: i, b: idx(x + 2, y), rest: restLen(i, idx(x + 2, y)), bend: 1 });
      if (y + 2 < n && aliveU[i] && aliveU[idx(x, y + 1)])
        links.push({ a: i, b: idx(x, y + 2), rest: restLen(i, idx(x, y + 2)), bend: 1 });
      void has;
    }
  }
  return links;
}

export interface XpbdStepOptions {
  dt: number;
  substeps: number;
  gravity: number;
  compliance: number;
  bendCompliance: number;
  /** Damping fraction per step, applied to the reconstructed
   *  velocity (the GPU pass applies the Vellum damping key the
   *  same way). */
  damping?: number;
  /** Jacobi relaxation for the apply step (defaults to
   *  XPBD_JACOBI_RELAXATION). */
  relaxation?: number;
}

/**
 * One frame of the mirror solve. Returns the largest absolute
 * link strain |d − rest| / rest seen after the solve (the
 * convergence probe the tests use).
 */
export function stepXpbdClothMirror(m: XpbdClothMirror, opts: XpbdStepOptions): number {
  const sub = Math.max(1, Math.round(opts.substeps));
  const dtS = opts.dt / sub;
  const links = mirrorLinks(m);
  const lambda = new Float64Array(links.length);
  const corr = new Float64Array(m.pos.length);
  const aTilde = xpbdAlphaTilde(opts.compliance, dtS);
  const aTildeBend = xpbdAlphaTilde(opts.bendCompliance, dtS);
  for (let s = 0; s < sub; s++) {
    lambda.fill(0);
    // Integrate + predict.
    for (let i = 0; i < m.pos.length; i += 3) {
      const w = m.invMass[i / 3];
      m.prev[i] = m.pos[i]; m.prev[i + 1] = m.pos[i + 1]; m.prev[i + 2] = m.pos[i + 2];
      if (w > 0) {
        m.vel[i + 1] += opts.gravity * dtS;
        m.pos[i] += m.vel[i] * dtS;
        m.pos[i + 1] += m.vel[i + 1] * dtS;
        m.pos[i + 2] += m.vel[i + 2] * dtS;
      }
    }
    // Δλ for every link from the predicted snapshot.
    const dl = new Float64Array(links.length);
    for (let li = 0; li < links.length; li++) {
      const { a, b, rest, bend } = links[li];
      const dx = m.pos[b * 3] - m.pos[a * 3];
      const dy = m.pos[b * 3 + 1] - m.pos[a * 3 + 1];
      const dz = m.pos[b * 3 + 2] - m.pos[a * 3 + 2];
      const d = Math.hypot(dx, dy, dz);
      if (d < 1e-9 || rest < 1e-9) continue;
      const at = bend ? aTildeBend : aTilde;
      dl[li] = xpbdDeltaLambda(d - rest, lambda[li], at, m.invMass[a] + m.invMass[b]);
    }
    // Apply all corrections together (Jacobi), Δx = Δλ·w·∇C.
    corr.fill(0);
    for (let li = 0; li < links.length; li++) {
      const { a, b, rest } = links[li];
      if (dl[li] === 0) continue;
      const dx = m.pos[b * 3] - m.pos[a * 3];
      const dy = m.pos[b * 3 + 1] - m.pos[a * 3 + 1];
      const dz = m.pos[b * 3 + 2] - m.pos[a * 3 + 2];
      const d = Math.hypot(dx, dy, dz);
      if (d < 1e-9 || rest < 1e-9) continue;
      const ux = dx / d, uy = dy / d, uz = dz / d;
      corr[a * 3] -= dl[li] * m.invMass[a] * ux;
      corr[a * 3 + 1] -= dl[li] * m.invMass[a] * uy;
      corr[a * 3 + 2] -= dl[li] * m.invMass[a] * uz;
      corr[b * 3] += dl[li] * m.invMass[b] * ux;
      corr[b * 3 + 1] += dl[li] * m.invMass[b] * uy;
      corr[b * 3 + 2] += dl[li] * m.invMass[b] * uz;
    }
    const relax = opts.relaxation ?? XPBD_JACOBI_RELAXATION;
    for (let i = 0; i < m.pos.length; i++) m.pos[i] += corr[i] * relax;
    // Pins are position fixes to the rest pose.
    for (let t = 0; t < m.invMass.length; t++) {
      if (m.invMass[t] === 0) {
        m.pos[t * 3] = m.rest[t * 3];
        m.pos[t * 3 + 1] = m.rest[t * 3 + 1];
        m.pos[t * 3 + 2] = m.rest[t * 3 + 2];
      }
    }
    // Velocity reconstruction.
    const damp = 1 - Math.max(0, Math.min(0.5, opts.damping ?? 0));
    for (let i = 0; i < m.pos.length; i++) {
      m.vel[i] = ((m.pos[i] - m.prev[i]) / dtS) * damp;
    }
  }
  let maxStrain = 0;
  for (const { a, b, rest } of links) {
    if (rest < 1e-9) continue;
    const d = Math.hypot(
      m.pos[b * 3] - m.pos[a * 3],
      m.pos[b * 3 + 1] - m.pos[a * 3 + 1],
      m.pos[b * 3 + 2] - m.pos[a * 3 + 2],
    );
    maxStrain = Math.max(maxStrain, Math.abs(d - rest) / rest);
  }
  return maxStrain;
}
