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
