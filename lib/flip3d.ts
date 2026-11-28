// FLIP 3D completion (Phase 19 stage 2): the data side and CPU
// mirror of the atlas-packed 3D FLIP solver whose GLSL lives in
// components/gpgpuShaderSimulationFlip3d.ts and whose pass
// orchestration lives in components/gpgpuFlip3dPasses.ts.
//
// The 3D grid reuses the Pyro grid's atlas machinery verbatim
// (lib/pyroGrid.ts): layouts, resolution rule, cell<->uv mapping
// and the GLSL sampling chunk are shared, not re-implemented —
// the atlas boundary behaviour (tile seams, edge clamps) is the
// accident-prone part and it is already pinned by the Pyro test
// suite. What FLIP adds on top of the atlas is the particle <->
// grid transfer, the liquid/air distinction and the free
// surface; none of that exists in the (Eulerian) Pyro solver.
//
// Free surface model (honest scope): a PSEUDO level set built
// from the P2G occupancy — chi (liquid occupancy, 0 = air,
// 1 = liquid) is the box-blurred P2G weight, phi = (0.5 - chi)
// * 2h with h = 1 cell. No signed-distance reinitialisation is
// performed; the surface tension curvature is therefore taken
// from chi/phi gradients (see flip3dCurvatureAt), which only
// needs the normal field, not an accurate distance.
//
// Discretisation follows the FLIP / Pyro precedent (the MAC-
// consistent pair): divergence uses backward differences, the
// gradient subtraction uses forward differences, so div(grad p)
// is the compact 7-point Laplacian. The pressure solve's free-
// surface boundary condition: only liquid cells (chi >= 0.5)
// carry pressure; an air neighbour contributes pressure 0
// (atmospheric) and is excluded from the Jacobi denominator.
//
// Field layout for every CPU mirror below: cell index
// (z * n + y) * n + x; velocities interleaved xyz per cell.

import {
  PYRO_GRID_LAYOUTS,
  PYRO_GRID_RESOLUTIONS,
  pyroGridAtlasSize,
  pyroGridCellUv,
  resolvePyroGridResolution,
} from './pyroGrid';
import type { GpuTier } from './gpuTier';

export {
  PYRO_GRID_LAYOUTS as FLIP3D_LAYOUTS,
  PYRO_GRID_RESOLUTIONS as FLIP3D_RESOLUTIONS,
  pyroGridAtlasSize as flip3dAtlasSize,
};

/** Atlas uv of a cell's centre texel — the shared pyro mapping. */
export function flip3dCellUv(
  n: number,
  cell: { x: number; y: number; z: number },
): { u: number; v: number } | null {
  return pyroGridCellUv(n, cell);
}

/** Resolution rule — the shared pyro rule, re-exported under the
 *  FLIP name so callers never reach across solvers. */
export function resolveFlip3dResolution(tier: GpuTier, override: number): number {
  return resolvePyroGridResolution(tier, override);
}

/** Mode resolution: anything but the literal '3d' is the legacy
 *  2D layer (the identity guarantee lives here — a missing or
 *  corrupt key can never allocate the 3D solver). */
export function flip3dMode(config: { gpgpuFlipMode?: string }): '2d' | '3d' {
  return config.gpgpuFlipMode === '3d' ? '3d' : '2d';
}

export function flip3dActive(config: {
  gpgpuFlipMode?: string;
  gpgpuFlipEnabled?: boolean;
  gpgpuFluidEnabled?: boolean;
}): boolean {
  return flip3dMode(config) === '3d'
    && Boolean(config.gpgpuFlipEnabled)
    && Boolean(config.gpgpuFluidEnabled);
}

/** Grid domain: the cube centred on the origin whose half
 *  extent matches the 2D field's planar extent (bounce radius
 *  times fluid scale), so x/z line up with the legacy field and
 *  y gets the same extent. */
export function flip3dHalfExtent(config: {
  gpgpuBounceRadius: number;
  gpgpuFluidScale: number;
}): number {
  return Math.max(1e-3, (config.gpgpuBounceRadius || 0) * (config.gpgpuFluidScale || 0));
}

/** Viscosity Jacobi iterations (fixed at 4 in v1 — see the
 *  design: viscosity needs damping of the low modes, not the
 *  pressure solve's exactness; a key would widen the verified
 *  surface for no measured gain). */
export const FLIP3D_VISCOSITY_ITERATIONS = 4;

/** Full-screen pass count of one 3D step (clears and the P2G
 *  point draws are not counted, the FLIP accounting convention):
 *  composite 1 + phi build 1 + phi advect 1 + viscosity Jacobi
 *  (0 or 4) + curvature/tension (0 or 2) + vorticity (0 or 2) +
 *  pressure Jacobi N + subtract 1. */
export function flip3dPassCount(args: {
  pressureIterations: number;
  viscosity?: number;
  surfaceTension?: number;
  vorticity?: boolean;
}): number {
  return 3
    + Math.max(0, Math.floor(args.pressureIterations))
    + 1
    + ((args.viscosity ?? 0) > 0 ? FLIP3D_VISCOSITY_ITERATIONS : 0)
    + ((args.surfaceTension ?? 0) > 0 ? 2 : 0)
    + (args.vorticity ? 2 : 0);
}

// ── CPU mirrors (the unit tests pin the shipped arithmetic) ──

export function flip3dIndex(n: number, x: number, y: number, z: number): number {
  return (z * n + y) * n + x;
}

const clampCell = (v: number, n: number) => Math.max(0, Math.min(n - 1, v));

/** Occupancy chi from raw P2G weights: coverage against the
 *  uniform-pool average weight, then the 3x3x3 box blur the phi
 *  build pass applies (the blur is load-bearing — curvature on
 *  the unblurred occupancy is noise). Mirrors FLIP3D_PHI_FRAG,
 *  which folds the normalisation and the blur into one pass. */
export function flip3dChiFromWeights(weights: Float32Array, n: number, avgWeight: number): Float32Array {
  const total = n * n * n;
  const raw = new Float32Array(total);
  const avg = Math.max(avgWeight, 1e-4);
  for (let i = 0; i < total; i++) raw[i] = Math.min(1, Math.max(0, weights[i] / avg));
  const chi = new Float32Array(total);
  for (let z = 0; z < n; z++) {
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        let sum = 0;
        for (let dz = -1; dz <= 1; dz++) {
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              sum += raw[flip3dIndex(n, clampCell(x + dx, n), clampCell(y + dy, n), clampCell(z + dz, n))];
            }
          }
        }
        chi[flip3dIndex(n, x, y, z)] = sum / 27;
      }
    }
  }
  return chi;
}

/** Pseudo level set from occupancy: phi = (0.5 - chi) * 2h,
 *  h = 1 cell. Negative inside the liquid, zero at chi = 0.5. */
export function flip3dPhiFromChi(chi: Float32Array): Float32Array {
  const phi = new Float32Array(chi.length);
  for (let i = 0; i < chi.length; i++) phi[i] = (0.5 - chi[i]) * 2;
  return phi;
}

/** Surface normal from phi's gradient (central differences,
 *  edge-clamped taps). Zero vector where the gradient vanishes. */
export function flip3dNormal(
  phi: Float32Array, n: number, x: number, y: number, z: number,
): { x: number; y: number; z: number } {
  const gx = (phi[flip3dIndex(n, clampCell(x + 1, n), y, z)] - phi[flip3dIndex(n, clampCell(x - 1, n), y, z)]) * 0.5;
  const gy = (phi[flip3dIndex(n, x, clampCell(y + 1, n), z)] - phi[flip3dIndex(n, x, clampCell(y - 1, n), z)]) * 0.5;
  const gz = (phi[flip3dIndex(n, x, y, clampCell(z + 1, n))] - phi[flip3dIndex(n, x, y, clampCell(z - 1, n))]) * 0.5;
  const len = Math.hypot(gx, gy, gz);
  if (len < 1e-9) return { x: 0, y: 0, z: 0 };
  return { x: gx / len, y: gy / len, z: gz / len };
}

/** Mean curvature kappa = div(normal). Sign convention: phi
 *  grows toward the air, so a convex liquid drop (sphere) has
 *  normals diverging outward and kappa > 0; a flat surface has
 *  kappa ~ 0; a concave pocket flips the sign. The CSF force
 *  f = sigma * kappa * grad(chi) then pulls a drop's surface
 *  cells inward (grad chi points into the liquid, opposite the
 *  outward normal) — the tests pin this sign chain. */
export function flip3dCurvatureAt(
  phi: Float32Array, n: number, x: number, y: number, z: number,
): number {
  const nxp = flip3dNormal(phi, n, clampCell(x + 1, n), y, z).x;
  const nxm = flip3dNormal(phi, n, clampCell(x - 1, n), y, z).x;
  const nyp = flip3dNormal(phi, n, x, clampCell(y + 1, n), z).y;
  const nym = flip3dNormal(phi, n, x, clampCell(y - 1, n), z).y;
  const nzp = flip3dNormal(phi, n, x, y, clampCell(z + 1, n)).z;
  const nzm = flip3dNormal(phi, n, x, y, clampCell(z - 1, n)).z;
  return (nxp - nxm) * 0.5 + (nyp - nym) * 0.5 + (nzp - nzm) * 0.5;
}

function flip3dDivergenceAt(vel: Float32Array, n: number, x: number, y: number, z: number): number {
  const c = flip3dIndex(n, x, y, z) * 3;
  const lx = flip3dIndex(n, clampCell(x - 1, n), y, z) * 3;
  const ly = flip3dIndex(n, x, clampCell(y - 1, n), z) * 3;
  const lz = flip3dIndex(n, x, y, clampCell(z - 1, n)) * 3;
  return (vel[c] - vel[lx]) + (vel[c + 1] - vel[ly + 1]) + (vel[c + 2] - vel[lz + 2]);
}

export function flip3dMaxDivergence(vel: Float32Array, chi: Float32Array, n: number): number {
  let max = 0;
  for (let z = 0; z < n; z++) {
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        if (chi[flip3dIndex(n, x, y, z)] < 0.5) continue;
        max = Math.max(max, Math.abs(flip3dDivergenceAt(vel, n, x, y, z)));
      }
    }
  }
  return max;
}

const DIRS = [
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
] as const;

/** Pressure projection mirror (FLIP3D_JACOBI_FRAG +
 *  FLIP3D_SUBTRACT_FRAG): Jacobi from zero pressure, the
 *  divergence recomputed from the fixed input velocity every
 *  iteration (the FLIP convention — no divergence texture).
 *  Air cells keep pressure 0 and their velocity verbatim. */
export function flip3dPressureProject(
  velIn: Float32Array, chi: Float32Array, n: number, iterations: number,
): { vel: Float32Array; pressure: Float32Array } {
  const total = n * n * n;
  const liquid = (x: number, y: number, z: number) => {
    if (x < 0 || y < 0 || z < 0 || x >= n || y >= n || z >= n) return false;
    return chi[flip3dIndex(n, x, y, z)] >= 0.5;
  };
  let presIn = new Float32Array(total);
  let presOut = new Float32Array(total);
  for (let it = 0; it < Math.max(0, Math.floor(iterations)); it++) {
    for (let z = 0; z < n; z++) {
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          const idx = flip3dIndex(n, x, y, z);
          if (!liquid(x, y, z)) { presOut[idx] = 0; continue; }
          // Free-surface BC, solver-consistent form: an air
          // neighbour contributes pressure 0 to the sum but
          // still counts in the diagonal (denominator) — the
          // standard MAC-style treatment. (Excluding air from
          // the denominator as well would leave a residual
          // divergence of airCount * p at surface cells,
          // because the gradient step reads air pressure as 0;
          // the design note's "exclude from the denominator"
          // is therefore realised as "exclude from the sum".
          // Domain-exterior neighbours are excluded from both:
          // the gradient there is zero by the clamped fetch.)
          let sum = 0;
          let count = 0;
          for (const [dx, dy, dz] of DIRS) {
            const nx = x + dx; const ny = y + dy; const nz = z + dz;
            if (nx < 0 || ny < 0 || nz < 0 || nx >= n || ny >= n || nz >= n) continue;
            count += 1;
            if (liquid(nx, ny, nz)) sum += presIn[flip3dIndex(n, nx, ny, nz)];
          }
          presOut[idx] = count > 0
            ? (sum - flip3dDivergenceAt(velIn, n, x, y, z)) / count
            : 0;
        }
      }
    }
    const swap = presIn; presIn = presOut; presOut = swap;
  }
  const vel = new Float32Array(velIn);
  for (let z = 0; z < n; z++) {
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        if (!liquid(x, y, z)) continue;
        const idx = flip3dIndex(n, x, y, z);
        const pC = presIn[idx];
        for (let axis = 0; axis < 3; axis++) {
          const [dx, dy, dz] = DIRS[axis * 2];
          const nx = x + dx; const ny = y + dy; const nz = z + dz;
          const outside = nx < 0 || ny < 0 || nz < 0 || nx >= n || ny >= n || nz >= n;
          // Liquid neighbour: its pressure. In-domain air:
          // 0 (atmospheric). Domain exterior: pC itself (zero
          // normal gradient — the GLSL clamped fetch reads the
          // boundary cell's own pressure the same way).
          const pNext = outside
            ? pC
            : liquid(nx, ny, nz)
              ? presIn[flip3dIndex(n, nx, ny, nz)]
              : 0;
          vel[idx * 3 + axis] -= pNext - pC;
        }
      }
    }
  }
  return { vel, pressure: presIn };
}

/** Viscosity mirror (FLIP3D_VISCOSITY_FRAG): implicit
 *  Helmholtz (I - alpha * lap) u = u* by Jacobi, alpha =
 *  nu * dt / h^2 with h = 1 cell. Non-liquid neighbours (and
 *  the domain exterior) are replaced by the centre value —
 *  zero-gradient at the free surface — which makes the solve
 *  conserve the liquid's total momentum exactly. alpha = 0 is
 *  the identity. Air cells keep their velocity verbatim. */
export function flip3dViscositySolve(
  velIn: Float32Array, chi: Float32Array, n: number, alpha: number, iterations: number,
): Float32Array {
  const cur = new Float32Array(velIn);
  if (!(alpha > 0)) return cur;
  const next = new Float32Array(velIn);
  const iters = Math.max(0, Math.floor(iterations));
  for (let it = 0; it < iters; it++) {
    for (let z = 0; z < n; z++) {
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          const idx = flip3dIndex(n, x, y, z);
          if (chi[idx] < 0.5) { for (let a = 0; a < 3; a++) next[idx * 3 + a] = cur[idx * 3 + a]; continue; }
          for (let a = 0; a < 3; a++) {
            let sum = 0;
            for (const [dx, dy, dz] of DIRS) {
              const nx = x + dx, ny = y + dy, nz = z + dz;
              const inside = nx >= 0 && ny >= 0 && nz >= 0 && nx < n && ny < n && nz < n;
              const nb = inside && chi[flip3dIndex(n, nx, ny, nz)] >= 0.5
                ? cur[flip3dIndex(n, nx, ny, nz) * 3 + a]
                : cur[idx * 3 + a];
              sum += nb;
            }
            next[idx * 3 + a] = (velIn[idx * 3 + a] + alpha * sum) / (1 + 6 * alpha);
          }
        }
      }
    }
    cur.set(next);
  }
  return cur;
}

// ── Transfer grammar (Layer 1 WP6 B1): PIC / FLIP / APIC ──
//
// The shipped solver's transfer family is the PIC/FLIP blend
// the velocity tail performs (components/
// gpgpuShaderSimulationVelocityMainTail.ts, the FLIP 3D
// coupling block): picVel = the gathered grid velocity,
// flipVel = the particle velocity plus the gathered grid
// change, target = mix(picVel, flipVel, gpgpuFlipBlend) and
// vel = mix(vel, target, gpgpuFlipTransfer). The scheme
// declaration below names which member of that family a
// transfer uses — 'pic' pins the blend to 0, 'flip' is the
// blend family itself (the shipped behaviour), 'apic' adds
// the affine velocity matrix the PIC/FLIP pair discards.
// This is a grammar surface only: no key is registered here
// and no pass reads the scheme yet; the resolver is written
// so a future key can carry the value verbatim (the legacy
// numeric gpgpuFlipTransfer is a strength, not a scheme, and
// resolves to the shipped 'flip' family).

export type Flip3dTransferScheme = 'pic' | 'flip' | 'apic';

export const FLIP3D_TRANSFER_SCHEMES: readonly Flip3dTransferScheme[] = ['pic', 'flip', 'apic'];

/** Scheme resolution: only the literal scheme names select a
 *  scheme; anything else (missing, garbage, the legacy numeric
 *  strength) resolves to 'flip', the family that contains the
 *  shipped behaviour — the same defensive shape as flip3dMode. */
export function resolveFlip3dTransferScheme(value: unknown): Flip3dTransferScheme {
  if (value === 'pic' || value === 'flip' || value === 'apic') return value;
  return 'flip';
}

/** Particle state for the transfer mirrors. Positions are in
 *  grid coordinates — the splat's g space, where cell centres
 *  sit at integer coordinates and the domain spans
 *  [-0.5, n - 0.5] per axis. vel is interleaved xyz per
 *  particle; affine is the APIC velocity-gradient matrix,
 *  9 per particle, row-major (read only by the 'apic'
 *  scheme; the PIC/FLIP pair neither reads nor produces it). */
export type Flip3dParticles = {
  pos: Float32Array;
  vel: Float32Array;
  affine: Float32Array;
};

type Flip3dStencilNode = { cell: number; w: number; dx: number; dy: number; dz: number };

/** The trilinear stencil of FLIP3D_SPLAT_VERT: base =
 *  floor(g), the 8 kernel cells base + {0,1}^3, axis weights
 *  mix(1 - frac, frac, offset). Out-of-domain cells are
 *  dropped exactly as the vertex shader clips them, and
 *  zero-weight nodes contribute nothing, so both are omitted.
 *  The same stencil serves P2G and G2P (adjoint transfers —
 *  the pairing APIC's conservation properties rest on). */
function flip3dStencil(particles: Flip3dParticles, p: number, n: number): Flip3dStencilNode[] {
  const gx = particles.pos[p * 3];
  const gy = particles.pos[p * 3 + 1];
  const gz = particles.pos[p * 3 + 2];
  const bx = Math.floor(gx);
  const by = Math.floor(gy);
  const bz = Math.floor(gz);
  const fx = gx - bx;
  const fy = gy - by;
  const fz = gz - bz;
  const nodes: Flip3dStencilNode[] = [];
  for (let oz = 0; oz <= 1; oz++) {
    for (let oy = 0; oy <= 1; oy++) {
      for (let ox = 0; ox <= 1; ox++) {
        const cx = bx + ox;
        const cy = by + oy;
        const cz = bz + oz;
        if (cx < 0 || cy < 0 || cz < 0 || cx >= n || cy >= n || cz >= n) continue;
        const w = (ox ? fx : 1 - fx) * (oy ? fy : 1 - fy) * (oz ? fz : 1 - fz);
        if (w <= 0) continue;
        nodes.push({ cell: flip3dIndex(n, cx, cy, cz), w, dx: cx - gx, dy: cy - gy, dz: cz - gz });
      }
    }
  }
  return nodes;
}

/** P2G mirror (FLIP3D_SPLAT_VERT): momentum and weight
 *  deposits over the trilinear stencil. PIC and FLIP deposit
 *  the particle velocity itself; APIC deposits the affine
 *  reconstruction v + C * (x_node - x_p), which is what lets
 *  the grid see sub-cell rotational structure. */
export function flip3dP2GTransfer(
  particles: Flip3dParticles, n: number, scheme: Flip3dTransferScheme,
): { momentum: Float32Array; weights: Float32Array } {
  const total = n * n * n;
  const momentum = new Float32Array(total * 3);
  const weights = new Float32Array(total);
  const count = Math.floor(particles.pos.length / 3);
  for (let p = 0; p < count; p++) {
    const vx = particles.vel[p * 3];
    const vy = particles.vel[p * 3 + 1];
    const vz = particles.vel[p * 3 + 2];
    const a = p * 9;
    for (const node of flip3dStencil(particles, p, n)) {
      let dvx = vx;
      let dvy = vy;
      let dvz = vz;
      if (scheme === 'apic') {
        const af = particles.affine;
        dvx += af[a] * node.dx + af[a + 1] * node.dy + af[a + 2] * node.dz;
        dvy += af[a + 3] * node.dx + af[a + 4] * node.dy + af[a + 5] * node.dz;
        dvz += af[a + 6] * node.dx + af[a + 7] * node.dy + af[a + 8] * node.dz;
      }
      momentum[node.cell * 3] += dvx * node.w;
      momentum[node.cell * 3 + 1] += dvy * node.w;
      momentum[node.cell * 3 + 2] += dvz * node.w;
      weights[node.cell] += node.w;
    }
  }
  return { momentum, weights };
}

/** Composite mirror (FLIP3D_COMPOSITE_FRAG): grid velocity =
 *  momentum / weight where particles deposited, 0 (air)
 *  where the weight is at or below the shader's 1e-6 floor. */
export function flip3dGridVelocityFromTransfer(
  momentum: Float32Array, weights: Float32Array,
): Float32Array {
  const vel = new Float32Array(momentum.length);
  for (let i = 0; i < weights.length; i++) {
    const w = weights[i];
    if (w > 1e-6) {
      vel[i * 3] = momentum[i * 3] / w;
      vel[i * 3 + 1] = momentum[i * 3 + 1] / w;
      vel[i * 3 + 2] = momentum[i * 3 + 2] / w;
    }
  }
  return vel;
}

/** APIC affine update: C = B * D^-1 with B = sum_i w_i v_i
 *  (x_i - x_p)^T and D = sum_i w_i (x_i - x_p)(x_i - x_p)^T
 *  over the stencil (Jiang et al. 2015, in the general-kernel
 *  form — D is evaluated from the actual trilinear weights,
 *  not the quadratic-B-spline constant). For an affine grid
 *  field this reproduces its gradient exactly. A (near-)
 *  singular D — a particle sitting exactly on a node, where
 *  the stencil collapses to one point — yields the zero
 *  matrix: no sub-cell structure is observable there. */
function flip3dApicAffine(
  gridVel: Float32Array, nodes: Flip3dStencilNode[],
): Float32Array {
  const B = new Float64Array(9);
  const D = new Float64Array(9);
  for (const node of nodes) {
    const vx = gridVel[node.cell * 3];
    const vy = gridVel[node.cell * 3 + 1];
    const vz = gridVel[node.cell * 3 + 2];
    const d = [node.dx, node.dy, node.dz];
    const v = [vx, vy, vz];
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        B[r * 3 + c] += node.w * v[r] * d[c];
        D[r * 3 + c] += node.w * d[r] * d[c];
      }
    }
  }
  const out = new Float32Array(9);
  const [a, b, c] = [D[0], D[1], D[2]];
  const [d, e, f] = [D[3], D[4], D[5]];
  const [g, h, i] = [D[6], D[7], D[8]];
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return out;
  // Inverse via the adjugate (D is symmetric, so the
  // cofactor matrix is its own transpose's adjugate either
  // way — the full form is written out for clarity).
  const inv = [
    (e * i - f * h) / det, (c * h - b * i) / det, (b * f - c * e) / det,
    (f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det,
    (d * h - e * g) / det, (b * g - a * h) / det, (a * e - b * d) / det,
  ];
  for (let r = 0; r < 3; r++) {
    for (let col = 0; col < 3; col++) {
      out[r * 3 + col] = B[r * 3] * inv[col]
        + B[r * 3 + 1] * inv[3 + col]
        + B[r * 3 + 2] * inv[6 + col];
    }
  }
  return out;
}

/** G2P mirror (the velocity tail's FLIP 3D coupling block,
 *  in grid units — the world scale and domain fade are
 *  presentation concerns of the tail, not of the transfer):
 *  picVel = sum_i w_i vNew_i; flipVel = v_p + sum_i w_i
 *  (vNew_i - vBase_i); target = picVel for 'pic', the
 *  blend mix for 'flip', picVel for 'apic' (the affine
 *  matrix, not the blend, carries what PIC would lose);
 *  vel' = mix(v_p, target, strength) — the gpgpuFlipBlend /
 *  gpgpuFlipTransfer arithmetic verbatim, both inputs on
 *  their keys' [0, 1] contract. The 'apic' scheme also
 *  returns the updated affine matrices (from the NEW grid
 *  velocity); the other schemes return zero affines. A
 *  particle whose stencil has no in-domain node is left
 *  untouched (the tail's domain fade made the same choice). */
export function flip3dG2PTransfer(
  gridVel: Float32Array, gridBaseVel: Float32Array,
  particles: Flip3dParticles, n: number,
  scheme: Flip3dTransferScheme, blend: number, strength: number,
): { vel: Float32Array; affine: Float32Array } {
  const count = Math.floor(particles.pos.length / 3);
  const vel = new Float32Array(particles.vel);
  const affine = new Float32Array(count * 9);
  for (let p = 0; p < count; p++) {
    const nodes = flip3dStencil(particles, p, n);
    if (nodes.length === 0) {
      if (scheme === 'apic') affine.set(particles.affine.subarray(p * 9, p * 9 + 9), p * 9);
      continue;
    }
    let picX = 0;
    let picY = 0;
    let picZ = 0;
    let dX = 0;
    let dY = 0;
    let dZ = 0;
    for (const node of nodes) {
      const nvx = gridVel[node.cell * 3];
      const nvy = gridVel[node.cell * 3 + 1];
      const nvz = gridVel[node.cell * 3 + 2];
      picX += node.w * nvx;
      picY += node.w * nvy;
      picZ += node.w * nvz;
      dX += node.w * (nvx - gridBaseVel[node.cell * 3]);
      dY += node.w * (nvy - gridBaseVel[node.cell * 3 + 1]);
      dZ += node.w * (nvz - gridBaseVel[node.cell * 3 + 2]);
    }
    const vx = particles.vel[p * 3];
    const vy = particles.vel[p * 3 + 1];
    const vz = particles.vel[p * 3 + 2];
    let tx = picX;
    let ty = picY;
    let tz = picZ;
    if (scheme === 'flip') {
      tx = picX + blend * ((vx + dX) - picX);
      ty = picY + blend * ((vy + dY) - picY);
      tz = picZ + blend * ((vz + dZ) - picZ);
    }
    vel[p * 3] = vx + (tx - vx) * strength;
    vel[p * 3 + 1] = vy + (ty - vy) * strength;
    vel[p * 3 + 2] = vz + (tz - vz) * strength;
    if (scheme === 'apic') {
      affine.set(flip3dApicAffine(gridVel, nodes), p * 9);
    }
  }
  return { vel, affine };
}

// ── Collision grammar (Layer 1 WP6 B1, F11): the solver's
// boundary-condition declaration ──
//
// The 3D solver today has no explicit solid boundary: the
// grid solves treat the domain exterior and non-liquid
// neighbours with zero-gradient (clamped-fetch) replacements,
// which is a free-slip-flavoured implicit condition. This
// grammar names the condition so a solver surface can declare
// it — and so the choice FLIP solvers actually offer (free
// slip, no slip, or viscous slip between them) exists as an
// authoring form with a CPU twin. Grammar surface only: no
// key is registered and no pass consumes the spec yet.

export type Flip3dBoundaryCondition = 'free-slip' | 'no-slip' | 'viscous-slip';

export const FLIP3D_BOUNDARY_CONDITIONS: readonly Flip3dBoundaryCondition[] = [
  'free-slip', 'no-slip', 'viscous-slip',
];

/** A collision declaration: the boundary condition plus, for
 *  'viscous-slip', the tangential friction coefficient in
 *  [0, 1] — 0 makes viscous slip coincide with free slip,
 *  1 with no slip, so the three conditions form one family. */
export type Flip3dCollisionSpec = {
  boundary: Flip3dBoundaryCondition;
  slipFriction: number;
};

export const FLIP3D_DEFAULT_COLLISION_SPEC: Flip3dCollisionSpec = {
  boundary: 'free-slip',
  slipFriction: 0,
};

/** Tolerant resolution of an authored collision declaration:
 *  a bare boundary name, or an object with boundary /
 *  slipFriction fields. Unknown names fall back to
 *  'free-slip' (the solver's implicit condition), a missing
 *  or non-finite friction to 0, and the friction is clamped
 *  to [0, 1]. Anything else resolves to the default spec. */
export function resolveFlip3dCollisionSpec(value: unknown): Flip3dCollisionSpec {
  let boundary: Flip3dBoundaryCondition = FLIP3D_DEFAULT_COLLISION_SPEC.boundary;
  let slipFriction = 0;
  const readBoundary = (v: unknown) => {
    if (v === 'free-slip' || v === 'no-slip' || v === 'viscous-slip') boundary = v;
  };
  if (typeof value === 'string') {
    readBoundary(value);
  } else if (value !== null && typeof value === 'object') {
    const obj = value as { boundary?: unknown; slipFriction?: unknown };
    readBoundary(obj.boundary);
    if (typeof obj.slipFriction === 'number' && Number.isFinite(obj.slipFriction)) {
      slipFriction = Math.max(0, Math.min(1, obj.slipFriction));
    }
  }
  return { boundary, slipFriction };
}

/** Collision twin: the velocity after meeting a solid whose
 *  outward normal (pointing into the fluid) is `normal`
 *  (need not be unit; a zero normal means no surface and the
 *  velocity passes verbatim). A separating velocity
 *  (v . n >= 0) is untouched under every condition. A
 *  penetrating one loses its normal component; the
 *  tangential remainder is kept whole by free slip, removed
 *  by no slip, and scaled by (1 - slipFriction) under
 *  viscous slip. */
export function flip3dCollideVelocity(
  vel: { x: number; y: number; z: number },
  normal: { x: number; y: number; z: number },
  spec: Flip3dCollisionSpec,
): { x: number; y: number; z: number } {
  const len = Math.hypot(normal.x, normal.y, normal.z);
  if (len < 1e-9) return { x: vel.x, y: vel.y, z: vel.z };
  const nx = normal.x / len;
  const ny = normal.y / len;
  const nz = normal.z / len;
  const vn = vel.x * nx + vel.y * ny + vel.z * nz;
  if (vn >= 0) return { x: vel.x, y: vel.y, z: vel.z };
  const tx = vel.x - vn * nx;
  const ty = vel.y - vn * ny;
  const tz = vel.z - vn * nz;
  if (spec.boundary === 'no-slip') return { x: 0, y: 0, z: 0 };
  if (spec.boundary === 'viscous-slip') {
    const keep = 1 - Math.max(0, Math.min(1, spec.slipFriction));
    return { x: tx * keep, y: ty * keep, z: tz * keep };
  }
  return { x: tx, y: ty, z: tz };
}

// ── Surface-tension authoring surface (WP6 B1): the sigma
// resolution and the CSF force twin ──

/** Sigma resolution — verbatim the pass runner's rule
 *  (components/gpgpuFlip3dPasses.ts): the authored key
 *  gpgpuFlipSurfaceTension, floored at 0, IS the uSigma the
 *  tension pass receives; there is no second scaling. */
export function flip3dSurfaceTensionSigma(config: {
  gpgpuFlipSurfaceTension?: number;
}): number {
  return Math.max(0, config.gpgpuFlipSurfaceTension || 0);
}

/** CSF force twin (FLIP3D_TENSION_FRAG): the velocity delta
 *  dt * sigma * kappa * grad(chi) at one cell, with kappa
 *  from flip3dCurvatureAt and grad(chi) the central
 *  difference of chi — the pass's exact inputs (phi and chi
 *  are the phi target's r/g channels). Outside the surface
 *  band (|phi| > 2) or where chi <= 0.001 the pass adds
 *  nothing and the twin returns zero. sigma is the resolved
 *  key value (see flip3dSurfaceTensionSigma). */
export function flip3dSurfaceTensionDelta(
  phi: Float32Array, chi: Float32Array, n: number,
  x: number, y: number, z: number,
  sigma: number, dt: number,
): { x: number; y: number; z: number } {
  const idx = flip3dIndex(n, x, y, z);
  if (Math.abs(phi[idx]) > 2 || chi[idx] <= 0.001) return { x: 0, y: 0, z: 0 };
  const gx = (chi[flip3dIndex(n, clampCell(x + 1, n), y, z)] - chi[flip3dIndex(n, clampCell(x - 1, n), y, z)]) * 0.5;
  const gy = (chi[flip3dIndex(n, x, clampCell(y + 1, n), z)] - chi[flip3dIndex(n, x, clampCell(y - 1, n), z)]) * 0.5;
  const gz = (chi[flip3dIndex(n, x, y, clampCell(z + 1, n))] - chi[flip3dIndex(n, x, y, clampCell(z - 1, n))]) * 0.5;
  const kappa = flip3dCurvatureAt(phi, n, x, y, z);
  const s = dt * sigma * kappa;
  return { x: s * gx, y: s * gy, z: s * gz };
}

// Runtime status for the passes -> diagnostics consumers (the
// pyro store's shape). Written by the pass runner each stepped
// frame; never written while the mode is 2D.
export type Flip3dRuntimeStatus = {
  active: boolean;
  resolution: number;
  passesPerStep: number;
  framesStepped: number;
};

let flip3dStatus: Flip3dRuntimeStatus = {
  active: false,
  resolution: 0,
  passesPerStep: 0,
  framesStepped: 0,
};

export function setFlip3dRuntimeStatus(next: Flip3dRuntimeStatus): void {
  flip3dStatus = next;
}

export function getFlip3dRuntimeStatus(): Flip3dRuntimeStatus {
  return flip3dStatus;
}
