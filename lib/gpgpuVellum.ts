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
 * Honest scope (do not oversell): the LEGACY mode below is a
 * PBD-family position projection, NOT Houdini Vellum's XPBD.
 * There is no per-constraint Δλ accumulation and no compliance
 * in physical units — stiffness is the effective value
 * "correction rate × iteration count" and shifts with dt.
 * Projection is Jacobi-style (per-texel corrections averaged
 * over the live-link count — the plain sum diverges at
 * stiffness 1, measured in the phase's unit probe) with a
 * bounded iteration count, so strong pulls leave residual
 * stretch and fast impacts leave interpenetration. Self-
 * collision is not solved. Legacy pressure is a normal-
 * direction force, not a volume-preserving pressure
 * constraint. Tearing is link severing, not fracture-surface
 * generation.
 *
 * Phase 19 stage 3 adds the XPBD completion behind the
 * gpgpuVellumSolverMode key (default 'legacy' — every word
 * above stays verbatim): 'xpbd' solves the same link set with
 * per-constraint Δλ accumulation and physical compliance
 * (lib/xpbdConstraints.ts, GLSL in
 * components/gpgpuShaderXpbd.ts), adds a global volume-
 * preservation constraint for the shell (volume gradient
 * weights baked below, current volume from a GPU reduction —
 * no readback), and a tear gap + crack visualisation for torn
 * links. The fracture "surface" is defined honestly as three
 * layers — gap separation, crack flagging in the draw, and
 * connected-component separation (labelVellumComponents) — no
 * polygon surface is generated. Self-collision is still not
 * solved in either mode.
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
import { xpbdAlphaFromStiffness } from './xpbdConstraints';

export type VellumSolverMode = 'legacy' | 'xpbd';

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
  // ── XPBD completion (Phase 19 stage 3) ──
  /** Solver mode: 'legacy' (default) runs the AR/BB passes
   *  verbatim; 'xpbd' switches the projection to the Δλ solve.
   *  Every field below is inert in legacy mode. */
  solverMode: VellumSolverMode;
  /** Convenience: active && solverMode === 'xpbd'. */
  xpbd: boolean;
  /** Structural + shear compliance α (physical units, cell
   *  mass 1). Resolution rule: an explicitly set compliance
   *  key wins; while it sits at its 0 default the value is
   *  seeded from the legacy Stiffness mapping so flipping the
   *  mode alone lands near the legacy feel — see the note in
   *  resolveVellum. */
  compliance: number;
  /** Bend compliance α (same rule, seeded from Bend). */
  bendCompliance: number;
  /** Volume preservation (shell only): master switch. */
  volumeEnabled: boolean;
  /** Target volume as a multiple of the rest volume V0. */
  volumeRatio: number;
  /** Volume constraint compliance α (0 = rigid). */
  volumeCompliance: number;
  /** Tear gap: world-unit separation pushed across a dead
   *  link's boundary in the projection; > 0 also enables the
   *  crack visualisation in the draw. 0 = legacy look. */
  tearGap: number;
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
  const solverMode: VellumSolverMode = config.gpgpuVellumSolverMode === 'xpbd' ? 'xpbd' : 'legacy';
  const stiffness = Math.max(0, Math.min(1, config.gpgpuVellumStiffness ?? 0.8));
  const bend = Math.max(0, Math.min(1, config.gpgpuVellumBend ?? 0.3));
  return {
    active: !!config.gpgpuVellumEnabled,
    modeId: config.gpgpuVellumMode === 'shell' ? 1 : 0,
    pinId: VELLUM_PIN_IDS[config.gpgpuVellumPin] ?? 1,
    stiffness,
    bend,
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
    solverMode,
    xpbd: !!config.gpgpuVellumEnabled && solverMode === 'xpbd',
    // Compliance resolution (design 3-2): the compliance keys
    // are the source of truth in xpbd mode. Their default is 0,
    // which in XPBD means RIGID — but a user flipping only the
    // mode switch would then get a rigid cloth instead of the
    // legacy feel, so a compliance key still at exactly 0 is
    // seeded from the legacy Stiffness/Bend mapping. Setting a
    // compliance key to any positive value takes over fully;
    // a truly rigid xpbd cloth is reached by raising Stiffness
    // to 1 (mapping → α 0) with the keys at 0. This seeding is
    // documented in the parameter descriptions.
    compliance: (() => {
      const raw = Math.max(0, config.gpgpuVellumCompliance ?? 0);
      return raw > 0 ? raw : xpbdAlphaFromStiffness(stiffness);
    })(),
    bendCompliance: (() => {
      const raw = Math.max(0, config.gpgpuVellumBendCompliance ?? 0);
      return raw > 0 ? raw : xpbdAlphaFromStiffness(bend);
    })(),
    volumeEnabled: !!config.gpgpuVellumVolumeEnabled,
    volumeRatio: Math.max(0.5, Math.min(2, config.gpgpuVellumVolumeRatio ?? 1)),
    volumeCompliance: Math.max(0, config.gpgpuVellumVolumeCompliance ?? 0),
    tearGap: Math.max(0, config.gpgpuVellumTearGap ?? 0),
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

/** XPBD pool engage (Phase 19 stage 3): the λ textures, volume
 *  reduction chain and component texture exist only while the
 *  solver is active in xpbd mode. Legacy mode allocates none
 *  of them (structural identity). */
export function vellumXpbdPoolActive(config: ParticleConfig): boolean {
  const v = resolveVellum(config);
  return v.active && v.solverMode === 'xpbd';
}

/** Volume constraint engage: xpbd + shell + the volume key.
 *  An open sheet has no enclosed volume, so sheet mode never
 *  engages it (the legacy normal-force pressure stays). */
export function vellumVolumeActive(config: ParticleConfig): boolean {
  const v = resolveVellum(config);
  return v.active && v.solverMode === 'xpbd' && v.modeId === 1 && v.volumeEnabled;
}

// ── Volume gradient bake (Phase 19 stage 3, design 3-3) ──────
//
// The shell's surface is the quad grid over the bake (x wraps,
// y does not): each texel owns the quad to its right/up, split
// into triangles (self, right, up) and (right, rightUp, up).
// The signed volume of the closed surface is the sum of the
// signed tetrahedra those triangles form with the origin,
// V = Σ a·(b×c)/6, and its exact gradient w.r.t. a vertex is
// the sum over adjacent faces of (other two verts ×)/6. Both
// are computed here from the REST positions: the gradient
// weights are static (baked into VellumGradTex), and the
// denominator Σ wᵢ|∇Cᵢ|² is precomputed from the same rest
// shape — the rest-fixed denominator is a documented
// approximation (design 3-3); the current volume itself is
// measured on the GPU every substep by reduction.

export interface VellumVolumeGradientData {
  /** RGBA float data: .rgb = ∇C_i at the rest shape, .a = 0. */
  gradData: Float32Array;
  /** Signed rest volume V0 (positive for the bake's winding). */
  restVolume: number;
  /** Σ wᵢ|∇Cᵢ|² at the rest shape (w = 1 for every texel —
   *  pinning is a position fix, not a mass change, in the
   *  volume solve, matching the GPU apply pass). */
  denom: number;
}

function shellFaces(texSize: number): Array<[number, number, number]> {
  const n = Math.max(2, texSize);
  const idx = (x: number, y: number) => y * n + ((x % n) + n) % n;
  const faces: Array<[number, number, number]> = [];
  for (let y = 0; y < n - 1; y++) {
    for (let x = 0; x < n; x++) {
      const s = idx(x, y);
      const r = idx(x + 1, y);
      const u = idx(x, y + 1);
      const ru = idx(x + 1, y + 1);
      faces.push([s, r, u]);
      faces.push([r, ru, u]);
    }
  }
  return faces;
}

/** Signed volume of a shell-layout position array (xyz or
 *  xyzw per texel — stride is a parameter). CPU mirror of the
 *  GPU reduction pass's level-0 partial sums. */
export function vellumShellSignedVolume(
  pos: ArrayLike<number>,
  texSize: number,
  stride: 3 | 4 = 3,
  offset = 0,
): number {
  let v = 0;
  for (const [ia, ib, ic] of shellFaces(texSize)) {
    const ax = pos[offset + ia * stride], ay = pos[offset + ia * stride + 1], az = pos[offset + ia * stride + 2];
    const bx = pos[offset + ib * stride], by = pos[offset + ib * stride + 1], bz = pos[offset + ib * stride + 2];
    const cx = pos[offset + ic * stride], cy = pos[offset + ic * stride + 1], cz = pos[offset + ic * stride + 2];
    v += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
  }
  return v;
}

export function buildVellumVolumeGradientData(
  restPosData: Float32Array,
  texSize: number,
): VellumVolumeGradientData {
  const n = Math.max(2, texSize);
  const grad = new Float32Array(n * n * 3);
  const p = (i: number) => [restPosData[i * 4], restPosData[i * 4 + 1], restPosData[i * 4 + 2]];
  for (const [ia, ib, ic] of shellFaces(n)) {
    const a = p(ia), b = p(ib), c = p(ic);
    // ∂V/∂a = (b×c)/6, ∂V/∂b = (c×a)/6, ∂V/∂c = (a×b)/6.
    const ga = [(b[1] * c[2] - b[2] * c[1]) / 6, (b[2] * c[0] - b[0] * c[2]) / 6, (b[0] * c[1] - b[1] * c[0]) / 6];
    const gb = [(c[1] * a[2] - c[2] * a[1]) / 6, (c[2] * a[0] - c[0] * a[2]) / 6, (c[0] * a[1] - c[1] * a[0]) / 6];
    const gc = [(a[1] * b[2] - a[2] * b[1]) / 6, (a[2] * b[0] - a[0] * b[2]) / 6, (a[0] * b[1] - a[1] * b[0]) / 6];
    for (let k = 0; k < 3; k++) {
      grad[ia * 3 + k] += ga[k];
      grad[ib * 3 + k] += gb[k];
      grad[ic * 3 + k] += gc[k];
    }
  }
  const gradData = new Float32Array(n * n * 4);
  let denom = 0;
  for (let i = 0; i < n * n; i++) {
    gradData[i * 4] = grad[i * 3];
    gradData[i * 4 + 1] = grad[i * 3 + 1];
    gradData[i * 4 + 2] = grad[i * 3 + 2];
    denom += grad[i * 3] ** 2 + grad[i * 3 + 1] ** 2 + grad[i * 3 + 2] ** 2;
  }
  return { gradData, restVolume: vellumShellSignedVolume(restPosData, n, 4), denom };
}

// ── Connected-component labelling (Phase 19 stage 3, 3-4-3) ──
//
// BFS over the LIVE structural links of a state array (the
// state texture's CPU readback shape: RGBA per texel, .r =
// right-link survival owned by this texel, .g = up-link
// survival). Pure function — the GPU side never labels; the
// runtime calls this on throttled readbacks and writes the
// result into VellumComponentTex. The component list is shaped
// {id, texelCount, centroid, mass} so Phase 20 can adopt a
// component as a rigid-body candidate verbatim.

export interface VellumComponent {
  id: number;
  texelCount: number;
  /** Mean position (only when positions were supplied). */
  centroid: [number, number, number] | null;
  /** Unit mass per texel — mass === texelCount. */
  mass: number;
}

export interface VellumComponentLabels {
  count: number;
  /** Component id per texel (row-major, -1 impossible: every
   *  texel belongs to exactly one component, isolated texels
   *  are singleton components). */
  labels: Int32Array;
  components: VellumComponent[];
}

export function labelVellumComponents(
  stateData: ArrayLike<number>,
  texSize: number,
  modeId: 0 | 1,
  posData?: ArrayLike<number> | null,
  posStride: 3 | 4 = 4,
): VellumComponentLabels {
  const n = Math.max(1, texSize);
  const labels = new Int32Array(n * n).fill(-1);
  const components: VellumComponent[] = [];
  const wrapX = (x: number) => ((x % n) + n) % n;
  const aliveR = (x: number, y: number) => (stateData[(y * n + x) * 4] ?? 1) > 0;
  const aliveU = (x: number, y: number) => (stateData[(y * n + x) * 4 + 1] ?? 1) > 0;
  const queue: number[] = [];
  for (let start = 0; start < n * n; start++) {
    if (labels[start] >= 0) continue;
    const id = components.length;
    let count = 0;
    let sx = 0, sy = 0, sz = 0;
    queue.length = 0;
    queue.push(start);
    labels[start] = id;
    while (queue.length > 0) {
      const cur = queue.pop()!;
      const cx = cur % n;
      const cy = Math.floor(cur / n);
      count++;
      if (posData) {
        sx += posData[cur * posStride];
        sy += posData[cur * posStride + 1];
        sz += posData[cur * posStride + 2];
      }
      const visit = (nx: number, ny: number) => {
        if (ny < 0 || ny >= n) return;
        const wx = modeId === 1 ? wrapX(nx) : nx;
        if (wx < 0 || wx >= n) return;
        const ni = ny * n + wx;
        if (labels[ni] < 0) {
          labels[ni] = id;
          queue.push(ni);
        }
      };
      // Right link is owned by the left endpoint, up link by
      // the lower endpoint — the state texture's rule.
      if (aliveR(cx, cy)) visit(cx + 1, cy);
      if (cx > 0 || modeId === 1) { if (aliveR(modeId === 1 ? wrapX(cx - 1) : cx - 1, cy)) visit(cx - 1, cy); }
      if (aliveU(cx, cy)) visit(cx, cy + 1);
      if (cy > 0 && aliveU(cx, cy - 1)) visit(cx, cy - 1);
    }
    components.push({
      id,
      texelCount: count,
      centroid: posData && count > 0 ? [sx / count, sy / count, sz / count] : null,
      mass: count,
    });
  }
  return { count: components.length, labels, components };
}
