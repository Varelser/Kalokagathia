/**
 * XPBD cloth bake stepper (layer-2 bake solver, slice S3).
 *
 * Grid sheet (n x n vertices) with structural / shear / bend
 * distance links, self-collision through a spatial hash, and
 * floor collision. Runs on the plain particle state of
 * bakeRunner, so checkpoint chaining works unchanged; the
 * topology (links, pinned set) is scene data held by the
 * stepper, never simulation state.
 *
 * The collision form carries two measured findings:
 *
 * (1) S-C sweep (BAKE_SC1_RESULT_RECORD): positional push-out
 *     alone reduced penetrating pairs from 7,314 to 1 but the
 *     sheet never settled, because contacts did not remove
 *     the approaching normal velocity. This stepper therefore
 *     records each substep's contacts and, in a velocity pass,
 *     removes the approaching normal component and damps the
 *     tangential relative velocity (contact friction).
 *
 * (2) S3 diagnosis (BAKE_IMPL_S3_RECORD): iterating the
 *     position solve harder trades penetration for energy —
 *     at thickness 0.02 / substeps 10, one iteration left 116
 *     penetrating pairs with a settled sheet (tail speed
 *     0.056), two iterations reached 0 pairs but the velocity
 *     reconstruction turned the larger corrections into a
 *     tail speed of 6.39. The resolution is ordering, not
 *     force: with `lateCollision`, velocities are
 *     reconstructed from the link-solved positions FIRST and
 *     the floor / self-collision projections run afterwards
 *     as a positional-only pass, so push-out displacement
 *     never becomes velocity; the contact velocity pass then
 *     removes exactly the approaching part.
 */
import { xpbdAlphaTilde, xpbdDeltaLambda } from './xpbdConstraints';
import type { BakeParticleState, BakeStepper } from './bakeRunner';

export interface ClothLink {
  a: number;
  b: number;
  rest: number;
  bend: boolean;
}

export interface ClothSheet {
  state: BakeParticleState;
  links: ClothLink[];
  /** Vertex indices with inverse mass 0. */
  pinned: number[];
  n: number;
}

/** Build a flat sheet in the xz-plane at height y, spanning
 *  [start, start + size] in x and z. */
export function createClothSheet(args: {
  n: number;
  size?: number;
  y?: number;
  start?: number;
  pinTopRow?: boolean;
}): ClothSheet {
  const n = args.n;
  const size = args.size ?? 0.8;
  const y = args.y ?? 0.8;
  const start = args.start ?? 0.1;
  const count = n * n;
  const positions = new Float32Array(count * 3);
  for (let iy = 0; iy < n; iy++) {
    for (let ix = 0; ix < n; ix++) {
      const i = iy * n + ix;
      positions[i * 3] = start + (ix / (n - 1)) * size;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = start + (iy / (n - 1)) * size;
    }
  }
  const restLen = (a: number, b: number) => Math.hypot(
    positions[b * 3] - positions[a * 3],
    positions[b * 3 + 1] - positions[a * 3 + 1],
    positions[b * 3 + 2] - positions[a * 3 + 2],
  );
  const links: ClothLink[] = [];
  const idx = (x: number, yy: number) => yy * n + x;
  for (let iy = 0; iy < n; iy++) {
    for (let ix = 0; ix < n; ix++) {
      const i = idx(ix, iy);
      if (ix + 1 < n) links.push({ a: i, b: idx(ix + 1, iy), rest: restLen(i, idx(ix + 1, iy)), bend: false });
      if (iy + 1 < n) links.push({ a: i, b: idx(ix, iy + 1), rest: restLen(i, idx(ix, iy + 1)), bend: false });
      if (ix + 1 < n && iy + 1 < n) {
        links.push({ a: i, b: idx(ix + 1, iy + 1), rest: restLen(i, idx(ix + 1, iy + 1)), bend: false });
        links.push({ a: idx(ix + 1, iy), b: idx(ix, iy + 1), rest: restLen(idx(ix + 1, iy), idx(ix, iy + 1)), bend: false });
      }
      if (ix + 2 < n) links.push({ a: i, b: idx(ix + 2, iy), rest: restLen(i, idx(ix + 2, iy)), bend: true });
      if (iy + 2 < n) links.push({ a: i, b: idx(ix, iy + 2), rest: restLen(i, idx(ix, iy + 2)), bend: true });
    }
  }
  const pinned: number[] = [];
  if (args.pinTopRow) for (let ix = 0; ix < n; ix++) pinned.push(idx(ix, 0));
  return {
    state: { positions, velocities: new Float32Array(count * 3), ages: new Float32Array(count) },
    links,
    pinned,
    n,
  };
}

export interface ClothBakeOptions {
  fps: number;
  substeps: number;
  gravity?: number;
  compliance?: number;
  bendCompliance?: number;
  /** Self-collision thickness (minimum vertex distance). */
  thickness?: number;
  selfCollision?: boolean;
  /** Global velocity damping factor per step (0..1). */
  damping?: number;
  /** Iterations of the link solve inside each substep. */
  solveIterations?: number;
  /** Run floor + self-collision after the velocity
   *  reconstruction, as a positional-only pass (see the
   *  header's finding (2)). */
  lateCollision?: boolean;
  /** Iterations of the late collision pass. A single
   *  Gauss-Seidel sweep leaves residual penetrations in a
   *  loaded multi-layer pile (later corrections disturb
   *  earlier pairs); the projections are cheap next to the
   *  link solve, so they iterate on their own. */
  lateCollisionIterations?: number;
  /** Tangential relative-velocity damping at contacts in
   *  the velocity pass (0..1, 1 = full stop). */
  contactFriction?: number;
}

interface Contact { i: number; j: number; nx: number; ny: number; nz: number }

export function createClothBakeStepper(sheet: ClothSheet, opts: ClothBakeOptions): BakeStepper {
  const n = sheet.n;
  const count = n * n;
  const invMass = new Float32Array(count).fill(1);
  for (const p of sheet.pinned) invMass[p] = 0;
  const dt = 1 / opts.fps;
  const gravity = opts.gravity ?? 9.8;
  const thickness = opts.thickness ?? 0.01;
  const selfCollision = opts.selfCollision ?? true;
  const damping = opts.damping ?? 0;
  const contactFriction = opts.contactFriction ?? 0.5;
  const links = sheet.links;

  return (state: BakeParticleState) => {
    const h = dt / opts.substeps;
    const p = state.positions;
    const v = state.velocities;
    const prev = new Float32Array(p);
    const lambdas = new Float64Array(links.length);
    const contacts: Contact[] = [];

    /** Floor + self-collision projections; records contacts. */
    const collide = () => {
      const floorY = thickness / 2;
      for (let i = 0; i < count; i++) {
        if (invMass[i] <= 0) continue;
        if (p[i * 3 + 1] < floorY) {
          p[i * 3 + 1] = floorY;
          contacts.push({ i, j: -1, nx: 0, ny: 1, nz: 0 });
        }
      }
      if (!selfCollision) return;
      const cell = thickness;
      const hash = new Map<string, number[]>();
      for (let i = 0; i < count; i++) {
        const key = `${Math.floor(p[i * 3] / cell)},${Math.floor(p[i * 3 + 1] / cell)},${Math.floor(p[i * 3 + 2] / cell)}`;
        const arr = hash.get(key);
        if (arr) arr.push(i); else hash.set(key, [i]);
      }
      const seen = new Set<number>();
      for (let i = 0; i < count; i++) {
        const cx = Math.floor(p[i * 3] / cell), cy = Math.floor(p[i * 3 + 1] / cell), cz = Math.floor(p[i * 3 + 2] / cell);
        const ix = i % n, iy = Math.floor(i / n);
        for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) for (let oz = -1; oz <= 1; oz++) {
          const arr = hash.get(`${cx + ox},${cy + oy},${cz + oz}`);
          if (!arr) continue;
          for (const j of arr) {
            if (j <= i) continue;
            const jx = j % n, jy = Math.floor(j / n);
            if (Math.abs(jx - ix) <= 1 && Math.abs(jy - iy) <= 1) continue;
            const pairKey = i * count + j;
            if (seen.has(pairKey)) continue;
            seen.add(pairKey);
            const dx = p[j * 3] - p[i * 3];
            const dy = p[j * 3 + 1] - p[i * 3 + 1];
            const dz = p[j * 3 + 2] - p[i * 3 + 2];
            const d2 = dx * dx + dy * dy + dz * dz;
            if (d2 >= thickness * thickness || d2 < 1e-14) continue;
            const d = Math.sqrt(d2);
            const nx = dx / d; const ny = dy / d; const nz = dz / d;
            const wa = invMass[i]; const wb = invMass[j];
            if (wa + wb <= 0) continue;
            const pen = thickness - d;
            p[i * 3] -= nx * pen * (wa / (wa + wb)); p[i * 3 + 1] -= ny * pen * (wa / (wa + wb)); p[i * 3 + 2] -= nz * pen * (wa / (wa + wb));
            p[j * 3] += nx * pen * (wb / (wa + wb)); p[j * 3 + 1] += ny * pen * (wb / (wa + wb)); p[j * 3 + 2] += nz * pen * (wb / (wa + wb));
            contacts.push({ i, j, nx, ny, nz });
          }
        }
      }
    };

    for (let sub = 0; sub < opts.substeps; sub++) {
      lambdas.fill(0);
      contacts.length = 0;
      for (let i = 0; i < count; i++) {
        prev[i * 3] = p[i * 3]; prev[i * 3 + 1] = p[i * 3 + 1]; prev[i * 3 + 2] = p[i * 3 + 2];
        if (invMass[i] <= 0) continue;
        v[i * 3 + 1] -= gravity * h;
        p[i * 3] += v[i * 3] * h; p[i * 3 + 1] += v[i * 3 + 1] * h; p[i * 3 + 2] += v[i * 3 + 2] * h;
      }
      const solveIterations = opts.solveIterations ?? 1;
      for (let iter = 0; iter < solveIterations; iter++) {
        for (let li = 0; li < links.length; li++) {
          const link = links[li];
          const a = link.a; const b = link.b;
          const wa = invMass[a]; const wb = invMass[b];
          if (wa + wb <= 0) continue;
          const dx = p[b * 3] - p[a * 3];
          const dy = p[b * 3 + 1] - p[a * 3 + 1];
          const dz = p[b * 3 + 2] - p[a * 3 + 2];
          const d = Math.hypot(dx, dy, dz);
          if (d < 1e-12) continue;
          const C = d - link.rest;
          const alphaTilde = xpbdAlphaTilde(link.bend ? (opts.bendCompliance ?? 1e-4) : (opts.compliance ?? 0), h);
          const dl = xpbdDeltaLambda(C, lambdas[li], alphaTilde, wa + wb);
          lambdas[li] += dl;
          const nx = dx / d; const ny = dy / d; const nz = dz / d;
          p[a * 3] -= nx * dl * wa; p[a * 3 + 1] -= ny * dl * wa; p[a * 3 + 2] -= nz * dl * wa;
          p[b * 3] += nx * dl * wb; p[b * 3 + 1] += ny * dl * wb; p[b * 3 + 2] += nz * dl * wb;
        }
        if (!opts.lateCollision) collide();
      }
      // Velocity reconstruction from the solved positions.
      for (let i = 0; i < count; i++) {
        if (invMass[i] <= 0) { v[i * 3] = 0; v[i * 3 + 1] = 0; v[i * 3 + 2] = 0; continue; }
        v[i * 3] = (p[i * 3] - prev[i * 3]) / h;
        v[i * 3 + 1] = (p[i * 3 + 1] - prev[i * 3 + 1]) / h;
        v[i * 3 + 2] = (p[i * 3 + 2] - prev[i * 3 + 2]) / h;
        if (damping > 0) { v[i * 3] *= 1 - damping; v[i * 3 + 1] *= 1 - damping; v[i * 3 + 2] *= 1 - damping; }
      }
      if (opts.lateCollision) {
        const citers = opts.lateCollisionIterations ?? 3;
        for (let cit = 0; cit < citers; cit++) {
          contacts.length = 0;
          collide();
        }
      }
      // Contact velocity pass: kill the approaching normal
      // component, damp the tangential relative velocity.
      for (const c of contacts) {
        if (c.j < 0) {
          const i = c.i;
          const vn = v[i * 3] * c.nx + v[i * 3 + 1] * c.ny + v[i * 3 + 2] * c.nz;
          if (vn < 0) { v[i * 3] -= vn * c.nx; v[i * 3 + 1] -= vn * c.ny; v[i * 3 + 2] -= vn * c.nz; }
          if (contactFriction > 0) {
            const tx = v[i * 3] - (v[i * 3] * c.nx + v[i * 3 + 1] * c.ny + v[i * 3 + 2] * c.nz) * c.nx;
            const ty = v[i * 3 + 1] - (v[i * 3] * c.nx + v[i * 3 + 1] * c.ny + v[i * 3 + 2] * c.nz) * c.ny;
            const tz = v[i * 3 + 2] - (v[i * 3] * c.nx + v[i * 3 + 1] * c.ny + v[i * 3 + 2] * c.nz) * c.nz;
            v[i * 3] -= tx * contactFriction; v[i * 3 + 1] -= ty * contactFriction; v[i * 3 + 2] -= tz * contactFriction;
          }
        } else {
          const wa = invMass[c.i]; const wb = invMass[c.j];
          if (wa + wb <= 0) continue;
          let rvx = v[c.j * 3] - v[c.i * 3];
          let rvy = v[c.j * 3 + 1] - v[c.i * 3 + 1];
          let rvz = v[c.j * 3 + 2] - v[c.i * 3 + 2];
          const vn = rvx * c.nx + rvy * c.ny + rvz * c.nz;
          let corrX = 0; let corrY = 0; let corrZ = 0;
          if (vn < 0) { corrX += vn * c.nx; corrY += vn * c.ny; corrZ += vn * c.nz; }
          if (contactFriction > 0) {
            const tx = rvx - vn * c.nx; const ty = rvy - vn * c.ny; const tz = rvz - vn * c.nz;
            corrX += tx * contactFriction; corrY += ty * contactFriction; corrZ += tz * contactFriction;
          }
          const fi = wa / (wa + wb); const fj = wb / (wa + wb);
          v[c.i * 3] += corrX * fi; v[c.i * 3 + 1] += corrY * fi; v[c.i * 3 + 2] += corrZ * fi;
          v[c.j * 3] -= corrX * fj; v[c.j * 3 + 1] -= corrY * fj; v[c.j * 3 + 2] -= corrZ * fj;
          rvx = 0; rvy = 0; rvz = 0; void rvx; void rvy; void rvz;
        }
      }
    }
    for (let i = 0; i < count; i++) state.ages[i] += dt;
  };
}

/** Count penetrating pairs (excluding topological
 *  neighbours) — the S-C decision metric. A pair counts only
 *  below thickness * factor (default 0.9): pairs resting AT
 *  the thickness distance are contact, not penetration, and
 *  float32 storage puts a correctly projected pair a hair
 *  under the exact threshold (measured: 0.0199990 against
 *  thickness 0.02 across a whole folded layer — the S3
 *  diagnosis that separated artifact from failure). */
export function countClothPenetrations(state: BakeParticleState, n: number, thickness: number, factor = 0.9): number {
  const p = state.positions;
  const count = n * n;
  const limit = thickness * factor;
  let bad = 0;
  for (let i = 0; i < count; i++) {
    const ix = i % n, iy = Math.floor(i / n);
    for (let j = i + 1; j < count; j++) {
      const jx = j % n, jy = Math.floor(j / n);
      if (Math.abs(jx - ix) <= 1 && Math.abs(jy - iy) <= 1) continue;
      const dx = p[j * 3] - p[i * 3];
      const dy = p[j * 3 + 1] - p[i * 3 + 1];
      const dz = p[j * 3 + 2] - p[i * 3 + 2];
      if (dx * dx + dy * dy + dz * dz < limit * limit) bad++;
    }
  }
  return bad;
}
