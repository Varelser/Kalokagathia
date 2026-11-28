import { quatFromAxisAngle, quatToMat3Columns, type Quat } from './gpgpuOrient';

// ── Gaussian splat draw (Layer 1 WP7 Phase C1) ─────────────
// CPU twins for the splat primitive in
// components/gpgpuShaderSplats.ts. A splat is carried as a
// centre (the pool position texture), a per-splat scale triple
// and a rotation quaternion — the covariance is never stored,
// it is composed as Σ = R · diag(s²) · Rᵀ wherever it is
// needed (the 3DGS standard decomposition, and the same form
// the column-data input of Phase C3 will carry). The vertex
// shader projects Σ through the EWA Jacobian of the
// perspective divide at the splat centre and expands the
// instanced quad along the projected ellipse's principal
// axes; the fragment evaluates the Gaussian in "sigma units",
// where the quad edge sits at SPLAT_CUTOFF_SIGMA along each
// axis, so the weight is exp(−½·|g|²) with |g| ≤ cutoff.
//
// The dedicated parameter textures (NOT the WP2 attribute
// channels — a splat needs 8+ floats of raw, unnormalised
// data, which the named-scalar slot bus cannot carry):
//   uSplatParamTex (RGBA float): (scale.x, scale.y, scale.z, opacity)
//   uSplatRotTex   (RGBA float): quaternion (x, y, z, w), the
//     uOrientTex sign convention; kaloQuatMat3 /
//     quatToMat3Columns is the shared rotation twin.

/** Gaussian cutoff: the quad spans ±this many sigma along
 *  each principal axis; fragments past it are discarded. */
export const SPLAT_CUTOFF_SIGMA = 3;

/** Channels of the parameter texture: scale xyz + opacity. */
export const SPLAT_PARAM_CHANNELS = 4;
/** Channels of the rotation texture: quaternion xyzw. */
export const SPLAT_ROT_CHANNELS = 4;

export type SplatScale = readonly [number, number, number];
/** 3×3 matrix as 9 values in row-major order. */
export type Mat3Rows = readonly number[];
/** Symmetric 2×2 matrix as [a, b, c] for [[a, b], [b, c]]. */
export type Cov2 = readonly [number, number, number];

const IDENTITY_QUAT: Quat = [0, 0, 0, 1];

function rowsFromColumns(cols: readonly number[]): number[][] {
  return [
    [cols[0], cols[3], cols[6]],
    [cols[1], cols[4], cols[7]],
    [cols[2], cols[5], cols[8]],
  ];
}

function covFromRotationRows(r: number[][], s2: readonly number[]): number[] {
  const out = new Array(9).fill(0);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      out[i * 3 + j] = r[i][0] * s2[0] * r[j][0]
        + r[i][1] * s2[1] * r[j][1]
        + r[i][2] * s2[2] * r[j][2];
    }
  }
  return out;
}

function applyCov(w: number[][], cov: Mat3Rows): number[] {
  // W · Σ · Wᵀ with Σ symmetric.
  const out = new Array(9).fill(0);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      let sum = 0;
      for (let k = 0; k < 3; k++) {
        for (let l = 0; l < 3; l++) {
          sum += w[i][k] * cov[k * 3 + l] * w[j][l];
        }
      }
      out[i * 3 + j] = sum;
    }
  }
  return out;
}

/**
 * The world-space covariance Σ = R · diag(s²) · Rᵀ of a splat
 * with the given scale triple and rotation quaternion,
 * returned row-major. Term for term with the composition in
 * the splat vertex shader.
 */
export function splatCovariance(scale: SplatScale, quat: Quat = IDENTITY_QUAT): number[] {
  const r = rowsFromColumns(quatToMat3Columns(quat));
  return covFromRotationRows(r, [scale[0] * scale[0], scale[1] * scale[1], scale[2] * scale[2]]);
}

/**
 * Σ rotated into view space: Σv = W · Σ · Wᵀ. `viewColumns`
 * is the view rotation as 9 values in GLSL mat3 constructor
 * order (column-major — the quatToMat3Columns convention),
 * i.e. mat3(modelViewMatrix) read column by column.
 */
export function splatViewCovariance(cov: Mat3Rows, viewColumns: readonly number[]): number[] {
  return applyCov(rowsFromColumns(viewColumns), cov);
}

/**
 * The EWA Jacobian of the perspective divide at view-space
 * centre t, for NDC projection x' = fx·(x / −z),
 * y' = fy·(y / −z) (fx = projectionMatrix[0][0],
 * fy = projectionMatrix[1][1]). Returned as a 2×3 matrix in
 * row-major order: [fx/−tz, 0, fx·tx/tz²,  0, fy/−tz, fy·ty/tz²].
 */
export function splatProjectionJacobian(
  t: readonly [number, number, number],
  fx: number,
  fy: number,
): number[] {
  const [tx, ty, tz] = t;
  return [
    fx / -tz, 0, (fx * tx) / (tz * tz),
    0, fy / -tz, (fy * ty) / (tz * tz),
  ];
}

/** Σ′ = J · Σv · Jᵀ, the projected 2×2 covariance. */
export function splatProjectCovariance(
  covView: Mat3Rows,
  t: readonly [number, number, number],
  fx: number,
  fy: number,
): Cov2 {
  const j = splatProjectionJacobian(t, fx, fy);
  const mul = (row: number, col: number): number => {
    // (J · Σv)[row][col]
    let sum = 0;
    for (let k = 0; k < 3; k++) sum += j[row * 3 + k] * covView[k * 3 + col];
    return sum;
  };
  const a = mul(0, 0) * j[0] + mul(0, 1) * j[1] + mul(0, 2) * j[2];
  const b = mul(0, 0) * j[3] + mul(0, 1) * j[4] + mul(0, 2) * j[5];
  const c = mul(1, 0) * j[3] + mul(1, 1) * j[4] + mul(1, 2) * j[5];
  return [a, b, c];
}

export interface SplatEllipse {
  /** Principal radii in NDC, cutoff included (cutoff·√λ). */
  radius1: number;
  radius2: number;
  /** Eigenvalues of the projected covariance (λ1 ≥ λ2 ≥ 0). */
  lambda1: number;
  lambda2: number;
  /** Rotation angle of the first principal axis, radians. */
  angle: number;
  /** Unit principal axes in NDC xy. */
  axis1: [number, number];
  axis2: [number, number];
}

/**
 * The principal axes of a projected covariance. Term for term
 * with the eigen decomposition in the splat vertex shader.
 */
export function splatEllipseFromCov2(cov2: Cov2, cutoff: number = SPLAT_CUTOFF_SIGMA): SplatEllipse {
  const [a, b, c] = cov2;
  const mid = 0.5 * (a + c);
  const diff = 0.5 * (a - c);
  const disc = Math.sqrt(diff * diff + b * b);
  const lambda1 = Math.max(mid + disc, 0);
  const lambda2 = Math.max(mid - disc, 0);
  const angle = 0.5 * Math.atan2(2 * b, a - c);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    radius1: cutoff * Math.sqrt(lambda1),
    radius2: cutoff * Math.sqrt(lambda2),
    lambda1,
    lambda2,
    angle,
    axis1: [cos, sin],
    axis2: [-sin, cos],
  };
}

/** The full projection chain: scale + quat + view → ellipse. */
export function splatProjectedEllipse(args: {
  scale: SplatScale;
  quat?: Quat;
  viewColumns: readonly number[];
  centerView: readonly [number, number, number];
  fx: number;
  fy: number;
  cutoff?: number;
}): SplatEllipse {
  const cov = splatCovariance(args.scale, args.quat ?? IDENTITY_QUAT);
  const covView = splatViewCovariance(cov, args.viewColumns);
  const cov2 = splatProjectCovariance(covView, args.centerView, args.fx, args.fy);
  return splatEllipseFromCov2(cov2, args.cutoff ?? SPLAT_CUTOFF_SIGMA);
}

/**
 * The Gaussian weight at sigma-unit offset g — the fragment
 * shader's exp(−½·|g|²).
 */
export function splatGaussianWeight(gx: number, gy: number): number {
  return Math.exp(-0.5 * (gx * gx + gy * gy));
}

/** Whether a sigma-unit offset survives the cutoff discard. */
export function splatWithinCutoff(gx: number, gy: number, cutoff: number = SPLAT_CUTOFF_SIGMA): boolean {
  return gx * gx + gy * gy <= cutoff * cutoff;
}

/**
 * The quaternion rotating the +X axis onto `dir` (the splat's
 * local X is its stretch axis — see the velocity supply in
 * buildSplatParamData). A zero / non-finite direction resolves
 * to the identity. The antiparallel case turns π about +Y
 * (any perpendicular axis is equally valid there; +Y is the
 * fixed choice so the bake is deterministic).
 */
export function splatQuatFromDirection(dir: readonly [number, number, number]): Quat {
  const len = Math.hypot(dir[0], dir[1], dir[2]);
  if (!(len > 1e-12)) return [0, 0, 0, 1];
  const dx = dir[0] / len;
  const dy = dir[1] / len;
  const dz = dir[2] / len;
  if (dx > 1 - 1e-9) return [0, 0, 0, 1];
  if (dx < -1 + 1e-9) return quatFromAxisAngle([0, 1, 0], Math.PI);
  // Rotation axis = x̂ × d̂ = (0, −dz, dy), normalised.
  const axisLen = Math.hypot(dz, dy);
  const axis: [number, number, number] = [0, -dz / axisLen, dy / axisLen];
  const angle = Math.acos(Math.min(1, Math.max(-1, dx)));
  return quatFromAxisAngle(axis, angle);
}

/**
 * The velocity-stretch law (Phase C2): the multiplier applied
 * to a splat's local X scale while the velocity supply is
 * active — 1 + strength · speed, so a particle at rest keeps
 * its authored (round) scale and the elongation grows
 * linearly with speed, the streak form.
 */
export function splatStretchMultiplier(speed: number, strength: number): number {
  return 1 + Math.max(finiteOr(strength, 0), 0) * Math.max(finiteOr(speed, 0), 0);
}

export interface BuildSplatParamDataArgs {
  texSize: number;
  /** Uniform authored scale: a single number (isotropic) or
   *  a per-axis triple. Default 1 (unit splats). */
  scale?: number | SplatScale;
  /** Uniform authored opacity, default 1. */
  opacity?: number;
  /** Uniform authored rotation, default identity. */
  quat?: Quat;
  /** Per-particle multiplier on the scale triple (Phase C2:
   *  the attribute-slot supply, lib/gpgpuSplatSupply.ts).
   *  Null / absent = 1 for every particle. */
  scaleValues?: Float32Array | null;
  /** Per-particle multiplier on the opacity (clamped to
   *  [0, 1] after the multiply). Null / absent = 1. */
  opacityValues?: Float32Array | null;
  /** Seeded velocities, stride 4 (xyzw per texel — the
   *  buildGpgpuInitialData layout), for the velocity-stretch
   *  supply. Only read while `stretch` > 0. */
  velData?: Float32Array | null;
  /** Velocity-stretch strength (Phase C2): while > 0 and
   *  velData is present, each moving particle's quaternion
   *  aligns its local X axis to its velocity direction and
   *  its X scale is multiplied by splatStretchMultiplier.
   *  0 (default) = the velocity supply is off and velData is
   *  never read. */
  stretch?: number;
}

export interface SplatParamData {
  /** uSplatParamTex payload: (scale.x, scale.y, scale.z, opacity) per texel. */
  paramData: Float32Array;
  /** uSplatRotTex payload: quaternion (x, y, z, w) per texel. */
  rotData: Float32Array;
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

/**
 * Bake the two parameter textures' payloads. Phase C1's form
 * is the uniform authored splat; Phase C2 adds the
 * per-particle supplies (attribute-slot multipliers and the
 * velocity-stretch field — resolved by
 * lib/gpgpuSplatSupply.ts; the columns form is C3). With no
 * per-particle input the output is exactly the C1 bake. A
 * pure function of its arguments, like buildAttributeData.
 */
export function buildSplatParamData(args: BuildSplatParamDataArgs): SplatParamData {
  const { texSize } = args;
  const count = texSize * texSize;
  const scaleArg = args.scale ?? 1;
  const scale: SplatScale = typeof scaleArg === 'number'
    ? [scaleArg, scaleArg, scaleArg]
    : [Math.max(finiteOr(scaleArg[0], 1), 0), Math.max(finiteOr(scaleArg[1], 1), 0), Math.max(finiteOr(scaleArg[2], 1), 0)];
  const sx = Math.max(finiteOr(scale[0], 1), 0);
  const sy = Math.max(finiteOr(scale[1], 1), 0);
  const sz = Math.max(finiteOr(scale[2], 1), 0);
  const opacity = Math.min(Math.max(finiteOr(args.opacity ?? 1, 1), 0), 1);
  const quat = args.quat ?? IDENTITY_QUAT;
  const scaleValues = args.scaleValues ?? null;
  const opacityValues = args.opacityValues ?? null;
  const velData = args.velData ?? null;
  const stretch = Math.max(finiteOr(args.stretch ?? 0, 0), 0);
  const stretchOn = stretch > 0 && velData !== null;
  const paramData = new Float32Array(count * SPLAT_PARAM_CHANNELS);
  const rotData = new Float32Array(count * SPLAT_ROT_CHANNELS);
  for (let i = 0; i < count; i++) {
    const scaleMul = scaleValues ? Math.max(finiteOr(scaleValues[i] ?? 1, 1), 0) : 1;
    let px = sx * scaleMul;
    const py = sy * scaleMul;
    const pz = sz * scaleMul;
    let qx = quat[0];
    let qy = quat[1];
    let qz = quat[2];
    let qw = quat[3];
    if (stretchOn) {
      const vx = velData[i * 4] ?? 0;
      const vy = velData[i * 4 + 1] ?? 0;
      const vz = velData[i * 4 + 2] ?? 0;
      const speed = Math.hypot(vx, vy, vz);
      if (speed > 1e-9) {
        const q = splatQuatFromDirection([vx, vy, vz]);
        qx = q[0];
        qy = q[1];
        qz = q[2];
        qw = q[3];
        px *= splatStretchMultiplier(speed, stretch);
      }
    }
    const opacityMul = opacityValues ? finiteOr(opacityValues[i] ?? 1, 1) : 1;
    paramData[i * 4] = px;
    paramData[i * 4 + 1] = py;
    paramData[i * 4 + 2] = pz;
    paramData[i * 4 + 3] = Math.min(Math.max(opacity * opacityMul, 0), 1);
    rotData[i * 4] = qx;
    rotData[i * 4 + 1] = qy;
    rotData[i * 4 + 2] = qz;
    rotData[i * 4 + 3] = qw;
  }
  return { paramData, rotData };
}
