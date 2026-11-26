/**
 * Mesh SDF collider (Phase BY): an imported OBJ mesh baked into a
 * signed distance grid on the CPU and sampled by the GPGPU sim
 * passes as a 3D texture, so particles collide with an arbitrary
 * closed mesh — not only the analytic SDF primitives
 * (`abSdfDistance` / `abSdfNormal` in the velocity helpers).
 *
 * Design (foundation prep by #3, two rounds; this module is the
 * implementation):
 *
 * - Source: the SAME `gpgpuMorphObjSource` text the morph target
 *   and the OBJ mesh display read — one shared data source, never
 *   a second copy, and no new import UI. The bake uses the full
 *   triangle set (not the 8,192-point morph sampler, which would
 *   lose thin features).
 * - Normalisation mirrors the morph sampler exactly (bounding-box
 *   centre, bounding-sphere radius 1 — `objNormalization` in
 *   lib/objMorph.ts), and the world placement is the morph world
 *   placement: world = normalised × W with
 *   W = gpgpuMorphScale × gpgpuBounceRadius × 0.48 (the same
 *   convention lib/cpuParticleSim.ts documents). The grid stores
 *   NORMALISED distances; the shader multiplies by W, so changing
 *   the morph scale or the bounce radius never re-bakes.
 * - Bake: exact point–triangle distances via a BVH over the welded
 *   triangle set; the sign comes from a flood fill from the grid
 *   border that treats the near-surface band as a wall (inside =
 *   negative, matching the analytic contract). The domain is the
 *   cube of side N·h centred on the origin with
 *   h = 2 / (N − 2m), m = 3 margin voxels, so the mesh (radius 1)
 *   sits in the inner (N − 2m) voxels. Queries outside the domain
 *   are "no collision" (+∞ on the CPU twin, a large positive in
 *   the shader) — never a clamped underestimate.
 * - Watertight gate: vertices are welded by exact coordinates
 *   first (OBJ exports commonly duplicate a vertex per face,
 *   which the index-based `isObjClosedMesh` would reject), then
 *   the closed test runs. An open mesh refuses the bake and the
 *   collider simply never activates — the legacy colliders keep
 *   working, the same fallback shape as the terrain height field
 *   (no bake → null → flat). Unsigned two-sided collision is NOT
 *   silently substituted: it would change the meaning of
 *   "inside" and is left as a future opt-in.
 * - GPU format: R16F by default (`Data3DTexture` + `RedFormat` +
 *   `HalfFloatType`). The half quantisation error (≤ 1 ulp ≈
 *   0.0005 normalised units) is two orders of magnitude below the
 *   trilinear interpolation error, and the sign never flips
 *   (#3's measurements, reproduced in phaseby_test.mjs). A
 *   Float32 texture is the fallback if the half path throws.
 * - Async: the bake runs in z-slabs across macrotasks with
 *   progress; until it completes the collider is inactive and the
 *   scene runs on the legacy colliders. While the key is OFF (or
 *   there is no usable source) nothing is baked and no texture
 *   exists — the identity guarantee is structural, exactly like
 *   the terrain collider's `getTerrainColliderTexture` gate.
 *
 * The CPU twin `queryMeshSdf` implements the same trilinear query
 * the shaders perform, for tests and tooling.
 */

import * as THREE from 'three';

import { parseObjGeometry, isObjClosedMesh, type ObjGeometry } from './objMorph';
import type { ParticleConfig } from '../types';

/** Margin band around the mesh, in voxels (the mesh occupies the
 *  inner N − 2m voxels of the domain cube). */
export const MESH_SDF_MARGIN_VOXELS = 3;

/** Selectable bake resolutions (the UI offers exactly these). */
export const MESH_SDF_RESOLUTIONS: readonly number[] = [32, 48, 64, 96, 128];

export const MESH_SDF_DEFAULT_RESOLUTION = 64;

/** Sanitise a config value into a supported bake resolution. */
export function meshSdfResolution(config: ParticleConfig): number {
  const n = Math.round(config.gpgpuMeshSdfResolution ?? MESH_SDF_DEFAULT_RESOLUTION);
  return (MESH_SDF_RESOLUTIONS as number[]).includes(n) ? n : MESH_SDF_DEFAULT_RESOLUTION;
}

/**
 * World-units multiplier of the morph placement (normalised
 * position × this = world position). The terrain collider follows
 * the same convention via `terrainMeshWorldScale`.
 */
export function meshSdfWorldScale(config: ParticleConfig): number {
  return Math.max((config.gpgpuMorphScale || 1) * (config.gpgpuBounceRadius || 0) * 0.48, 0);
}

/** The collider can only exist while the key is on and a source
 *  text is present; the bake itself may still be pending. */
export function isMeshSdfRequested(config: ParticleConfig): boolean {
  return !!config.gpgpuMeshSdfEnabled && !!(config.gpgpuMorphObjSource || '').trim();
}

// ---------------------------------------------------------------------------
// Source handling: hash, welding, normalisation

/** FNV-1a, the same signature hash lib/cpuParticleSim.ts uses. */
function meshSdfSourceHash(text: string | undefined): string {
  const s = text || '';
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `${s.length}:${(h >>> 0).toString(36)}`;
}

/**
 * Weld vertices by exact coordinates (deterministic: first
 * occurrence wins) and drop triangles that degenerate under the
 * weld. OBJ exports commonly duplicate vertices per face; the
 * index-based closed test would call such a mesh open even though
 * it is geometrically watertight.
 */
export function weldObjGeometry(geometry: ObjGeometry): ObjGeometry {
  const { vertices, triangles } = geometry;
  const indexByKey = new Map<string, number>();
  const welded: number[] = [];
  const remap = new Uint32Array(vertices.length / 3);
  for (let i = 0; i < remap.length; i += 1) {
    const x = vertices[i * 3];
    const y = vertices[i * 3 + 1];
    const z = vertices[i * 3 + 2];
    const key = `${x},${y},${z}`;
    let target = indexByKey.get(key);
    if (target === undefined) {
      target = welded.length / 3;
      indexByKey.set(key, target);
      welded.push(x, y, z);
    }
    remap[i] = target;
  }
  const out: number[] = [];
  for (let t = 0; t < triangles.length; t += 3) {
    const a = remap[triangles[t]];
    const b = remap[triangles[t + 1]];
    const c = remap[triangles[t + 2]];
    if (a === b || b === c || a === c) continue;
    out.push(a, b, c);
  }
  const vertexCount = welded.length / 3;
  return {
    ...geometry,
    vertices: new Float32Array(welded),
    triangles: new Uint32Array(out),
    vertexNormals: new Float32Array(vertexCount * 3),
    vertexCount,
    triangleCount: out.length / 3,
  };
}

interface MeshNormalization {
  cx: number;
  cy: number;
  cz: number;
  invRadius: number;
}

/** The morph sampler's normalisation (AABB centre, bounding-sphere
 *  radius 1), mirrored from `objNormalization` in lib/objMorph.ts. */
function meshNormalization(vertices: Float32Array): MeshNormalization | null {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < vertices.length; i += 3) {
    const x = vertices[i];
    const y = vertices[i + 1];
    const z = vertices[i + 2];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const cz = (minZ + maxZ) / 2;
  let radius = 0;
  for (let i = 0; i < vertices.length; i += 3) {
    const d = Math.hypot(vertices[i] - cx, vertices[i + 1] - cy, vertices[i + 2] - cz);
    if (d > radius) radius = d;
  }
  if (!(radius > 0)) return null;
  return { cx, cy, cz, invRadius: 1 / radius };
}

// ---------------------------------------------------------------------------
// BVH over triangles + exact point–triangle distance

interface BvhNode {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
  left: number; // node index, -1 for a leaf
  right: number;
  start: number; // leaf: range into `order`
  count: number;
}

const BVH_LEAF_SIZE = 8;

class TriangleBvh {
  private nodes: BvhNode[] = [];
  private order: Uint32Array;
  private centroids: Float32Array;
  private verts: Float32Array;
  private triangles: Uint32Array;

  constructor(verts: Float32Array, triangles: Uint32Array) {
    this.verts = verts;
    this.triangles = triangles;
    const count = triangles.length / 3;
    this.order = new Uint32Array(count);
    this.centroids = new Float32Array(count * 3);
    for (let t = 0; t < count; t += 1) {
      this.order[t] = t;
      const a = triangles[t * 3] * 3;
      const b = triangles[t * 3 + 1] * 3;
      const c = triangles[t * 3 + 2] * 3;
      this.centroids[t * 3] = (verts[a] + verts[b] + verts[c]) / 3;
      this.centroids[t * 3 + 1] = (verts[a + 1] + verts[b + 1] + verts[c + 1]) / 3;
      this.centroids[t * 3 + 2] = (verts[a + 2] + verts[b + 2] + verts[c + 2]) / 3;
    }
    if (count > 0) this.build(0, count);
  }

  private build(start: number, count: number): number {
    const nodeIndex = this.nodes.length;
    const node: BvhNode = {
      minX: Infinity, minY: Infinity, minZ: Infinity,
      maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity,
      left: -1, right: -1, start, count,
    };
    this.nodes.push(node);
    for (let i = start; i < start + count; i += 1) {
      const t = this.order[i];
      for (let k = 0; k < 3; k += 1) {
        const vi = this.triangles[t * 3 + k] * 3;
        const x = this.verts[vi];
        const y = this.verts[vi + 1];
        const z = this.verts[vi + 2];
        if (x < node.minX) node.minX = x;
        if (y < node.minY) node.minY = y;
        if (z < node.minZ) node.minZ = z;
        if (x > node.maxX) node.maxX = x;
        if (y > node.maxY) node.maxY = y;
        if (z > node.maxZ) node.maxZ = z;
      }
    }
    if (count <= BVH_LEAF_SIZE) return nodeIndex;
    // Split at the median centroid along the largest-extent axis
    // (stable: ties broken by triangle index, so the build is
    // deterministic for a given source).
    const ex = node.maxX - node.minX;
    const ey = node.maxY - node.minY;
    const ez = node.maxZ - node.minZ;
    const axis = ex >= ey && ex >= ez ? 0 : ey >= ez ? 1 : 2;
    const slice = Array.from(this.order.subarray(start, start + count));
    slice.sort((p, q) => (this.centroids[p * 3 + axis] - this.centroids[q * 3 + axis]) || (p - q));
    this.order.set(slice, start);
    const mid = start + Math.floor(count / 2);
    node.left = this.build(start, mid - start);
    node.right = this.build(mid, start + count - mid);
    node.count = 0;
    return nodeIndex;
  }

  nearestDistance(px: number, py: number, pz: number): number {
    return Math.sqrt(this.nearestDistanceSq(px, py, pz));
  }

  nearestDistanceSq(px: number, py: number, pz: number): number {
    let best = Infinity;
    const stack: number[] = [0];
    while (stack.length > 0) {
      const ni = stack.pop() as number;
      const node = this.nodes[ni];
      // AABB distance prune.
      const dx = Math.max(node.minX - px, 0, px - node.maxX);
      const dy = Math.max(node.minY - py, 0, py - node.maxY);
      const dz = Math.max(node.minZ - pz, 0, pz - node.maxZ);
      if (dx * dx + dy * dy + dz * dz >= best) continue;
      if (node.left < 0) {
        for (let i = node.start; i < node.start + node.count; i += 1) {
          const d2 = this.pointTriangleDistanceSq(px, py, pz, this.order[i]);
          if (d2 < best) best = d2;
        }
      } else {
        stack.push(node.left, node.right);
      }
    }
    return best;
  }

  private pointTriangleDistanceSq(
    px: number, py: number, pz: number, t: number,
  ): number {
    const tris = this.triangles;
    const a = tris[t * 3] * 3;
    const b = tris[t * 3 + 1] * 3;
    const c = tris[t * 3 + 2] * 3;
    const ax = this.verts[a];
    const ay = this.verts[a + 1];
    const az = this.verts[a + 2];
    const bx = this.verts[b];
    const by = this.verts[b + 1];
    const bz = this.verts[b + 2];
    const cx = this.verts[c];
    const cy = this.verts[c + 1];
    const cz = this.verts[c + 2];
    // Closest point on triangle (Ericson, RTCD 5.1.5) — the flat
    // region sequence: vertex A / vertex B / edge AB / vertex C /
    // edge AC / edge BC / face.
    const abx = bx - ax; const aby = by - ay; const abz = bz - az;
    const acx = cx - ax; const acy = cy - ay; const acz = cz - az;
    const apx = px - ax; const apy = py - ay; const apz = pz - az;
    const d1 = abx * apx + aby * apy + abz * apz;
    const d2 = acx * apx + acy * apy + acz * apz;
    let qx = ax; let qy = ay; let qz = az;
    if (d1 > 0 || d2 > 0) {
      const bpx = px - bx; const bpy = py - by; const bpz = pz - bz;
      const d3 = abx * bpx + aby * bpy + abz * bpz;
      const d4 = acx * bpx + acy * bpy + acz * bpz;
      if (d3 >= 0 && d4 <= d3) {
        qx = bx; qy = by; qz = bz;
      } else {
        const vc = d1 * d4 - d3 * d2;
        if (vc <= 0 && d1 >= 0 && d3 <= 0) {
          const v = d1 / (d1 - d3);
          qx = ax + v * abx; qy = ay + v * aby; qz = az + v * abz;
        } else {
          const cpx = px - cx; const cpy = py - cy; const cpz = pz - cz;
          const d5 = abx * cpx + aby * cpy + abz * cpz;
          const d6 = acx * cpx + acy * cpy + acz * cpz;
          if (d6 >= 0 && d5 <= d6) {
            qx = cx; qy = cy; qz = cz;
          } else {
            const vb = d5 * d2 - d1 * d6;
            if (vb <= 0 && d2 >= 0 && d6 <= 0) {
              const w = d2 / (d2 - d6);
              qx = ax + w * acx; qy = ay + w * acy; qz = az + w * acz;
            } else {
              const va = d3 * d6 - d5 * d4;
              if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) {
                const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
                qx = bx + w * (cx - bx); qy = by + w * (cy - by); qz = bz + w * (cz - bz);
              } else {
                const denom = 1 / (va + vb + vc);
                const v = vb * denom;
                const w = vc * denom;
                qx = ax + abx * v + acx * w;
                qy = ay + aby * v + acy * w;
                qz = az + abz * v + acz * w;
              }
            }
          }
        }
      }
    }
    const dx = px - qx;
    const dy = py - qy;
    const dz = pz - qz;
    return dx * dx + dy * dy + dz * dz;
  }
}

// ---------------------------------------------------------------------------
// The bake

export interface MeshSdfGrid {
  /** Signed distances in NORMALISED units, x-major
   *  (index = x + N·(y + N·z)), cell-centre samples. */
  grid: Float32Array;
  resolution: number;
  /** Domain cube side in normalised units (N·h). */
  sideNorm: number;
  /** Voxel size in normalised units (h = 2 / (N − 2m)). */
  voxelNorm: number;
  triangleCount: number;
  /** Thinnest feature estimate: the smallest per-axis extent of
   *  the normalised AABB, in voxels — a resolution hint for the
   *  UI, not a guarantee. */
  minFeatureVoxels: number;
}

export type MeshSdfBakeFailure = 'no-geometry' | 'not-closed' | 'degenerate';

export interface MeshSdfBakeSession {
  /** Advance one z-slab (or the final sign pass). Returns true
   *  when the bake is complete. */
  step(): boolean;
  /** 0..1 across slabs + the sign pass. */
  readonly progress: number;
  readonly result: MeshSdfGrid | null;
  readonly failure: MeshSdfBakeFailure | null;
  readonly triangleCount: number;
}

/**
 * Prepare a bake of the given geometry at the given resolution.
 * Parsing / welding / the closed test run up front; a refusal is
 * reported via the session's `failure` and no grid is produced.
 */
export function createMeshSdfBake(
  geometry: ObjGeometry,
  resolution: number,
): MeshSdfBakeSession {
  const n = (MESH_SDF_RESOLUTIONS as number[]).includes(resolution)
    ? resolution
    : MESH_SDF_DEFAULT_RESOLUTION;
  const welded = weldObjGeometry(geometry);
  const norm = meshNormalization(welded.vertices);
  if (!norm || welded.triangleCount === 0) {
    return failedSession('no-geometry', 0);
  }
  if (!isObjClosedMesh(welded)) {
    return failedSession('not-closed', welded.triangleCount);
  }
  // Normalised vertices.
  const verts = new Float32Array(welded.vertices.length);
  for (let i = 0; i < verts.length; i += 3) {
    verts[i] = (welded.vertices[i] - norm.cx) * norm.invRadius;
    verts[i + 1] = (welded.vertices[i + 1] - norm.cy) * norm.invRadius;
    verts[i + 2] = (welded.vertices[i + 2] - norm.cz) * norm.invRadius;
  }
  const bvh = new TriangleBvh(verts, welded.triangles);

  const m = MESH_SDF_MARGIN_VOXELS;
  const h = 2 / (n - 2 * m);
  const side = n * h;
  const origin = -side / 2;
  const grid = new Float32Array(n * n * n);
  const totalSteps = n + 1;
  let zDone = 0;
  let result: MeshSdfGrid | null = null;

  // Normalised AABB extents → thinnest-feature hint (voxels).
  let mnx = Infinity; let mny = Infinity; let mnz = Infinity;
  let mxx = -Infinity; let mxy = -Infinity; let mxz = -Infinity;
  for (let i = 0; i < verts.length; i += 3) {
    if (verts[i] < mnx) mnx = verts[i];
    if (verts[i + 1] < mny) mny = verts[i + 1];
    if (verts[i + 2] < mnz) mnz = verts[i + 2];
    if (verts[i] > mxx) mxx = verts[i];
    if (verts[i + 1] > mxy) mxy = verts[i + 1];
    if (verts[i + 2] > mxz) mxz = verts[i + 2];
  }
  const minFeatureVoxels = Math.min(mxx - mnx, mxy - mny, mxz - mnz) / h;

  const session: MeshSdfBakeSession = {
    get progress() {
      return result ? 1 : zDone / totalSteps;
    },
    get result() { return result; },
    get failure() { return null; },
    triangleCount: welded.triangleCount,
    step() {
      if (result) return true;
      if (zDone < n) {
        const z = zDone;
        const cz = origin + (z + 0.5) * h;
        for (let y = 0; y < n; y += 1) {
          const cy = origin + (y + 0.5) * h;
          const rowBase = n * (y + n * z);
          for (let x = 0; x < n; x += 1) {
            const cx = origin + (x + 0.5) * h;
            grid[rowBase + x] = bvh.nearestDistance(cx, cy, cz);
          }
        }
        zDone += 1;
        return false;
      }
      // Sign pass: flood fill from the border; cells whose centre
      // is within 0.6 voxels of the surface are walls the fill
      // cannot cross. Unreached non-wall cells are inside. The
      // wall band itself is then signed by propagation from the
      // classified cells on both sides (a band cell just outside
      // the surface must not inherit "inside" merely because the
      // fill could not cross the band to reach it).
      const wall = 0.6 * h;
      const total = n * n * n;
      const sign = new Int8Array(total); // 0 unknown, 1 outside, 2 inside
      const queue = new Int32Array(total);
      let head = 0;
      let tail = 0;
      const seedOutside = (idx: number) => {
        if (sign[idx] === 0 && grid[idx] >= wall) {
          sign[idx] = 1;
          queue[tail] = idx;
          tail += 1;
        }
      };
      for (let y = 0; y < n; y += 1) {
        for (let x = 0; x < n; x += 1) {
          seedOutside(x + n * y);
          seedOutside(x + n * (y + n * (n - 1)));
        }
      }
      for (let z = 0; z < n; z += 1) {
        for (let y = 0; y < n; y += 1) {
          seedOutside(n * (y + n * z));
          seedOutside((n - 1) + n * (y + n * z));
        }
      }
      for (let z = 0; z < n; z += 1) {
        for (let x = 0; x < n; x += 1) {
          seedOutside(x + n * n * z);
          seedOutside(x + n * (n - 1 + n * z));
        }
      }
      while (head < tail) {
        const idx = queue[head];
        head += 1;
        const x = idx % n;
        const y = Math.floor(idx / n) % n;
        const z = Math.floor(idx / (n * n));
        if (x > 0) seedOutside(idx - 1);
        if (x < n - 1) seedOutside(idx + 1);
        if (y > 0) seedOutside(idx - n);
        if (y < n - 1) seedOutside(idx + n);
        if (z > 0) seedOutside(idx - n * n);
        if (z < n - 1) seedOutside(idx + n * n);
      }
      // Unreached non-wall cells are inside; enqueue both classes
      // and propagate their signs into the wall band.
      head = 0;
      tail = 0;
      for (let i = 0; i < total; i += 1) {
        if (sign[i] === 0 && grid[i] >= wall) sign[i] = 2;
        if (sign[i] !== 0) {
          queue[tail] = i;
          tail += 1;
        }
      }
      while (head < tail) {
        const idx = queue[head];
        head += 1;
        const s = sign[idx];
        const x = idx % n;
        const y = Math.floor(idx / n) % n;
        const z = Math.floor(idx / (n * n));
        const visit = (j: number) => {
          if (sign[j] === 0) {
            sign[j] = s;
            queue[tail] = j;
            tail += 1;
          }
        };
        if (x > 0) visit(idx - 1);
        if (x < n - 1) visit(idx + 1);
        if (y > 0) visit(idx - n);
        if (y < n - 1) visit(idx + n);
        if (z > 0) visit(idx - n * n);
        if (z < n - 1) visit(idx + n * n);
      }
      for (let i = 0; i < total; i += 1) {
        if (sign[i] === 2) grid[i] = -grid[i];
      }
      zDone += 1;
      result = {
        grid,
        resolution: n,
        sideNorm: side,
        voxelNorm: h,
        triangleCount: welded.triangleCount,
        minFeatureVoxels,
      };
      return true;
    },
  };
  return session;
}

function failedSession(failure: MeshSdfBakeFailure, triangleCount: number): MeshSdfBakeSession {
  return {
    progress: 1,
    result: null,
    failure,
    triangleCount,
    step: () => true,
  };
}

/** Synchronous convenience (tests, tooling): run a bake to
 *  completion. Returns null on refusal. */
export function bakeMeshSdfGrid(
  geometry: ObjGeometry | null,
  resolution: number,
): MeshSdfGrid | null {
  if (!geometry) return null;
  const session = createMeshSdfBake(geometry, resolution);
  while (!session.step()) { /* slabs */ }
  return session.result;
}

/**
 * CPU twin of the shader query: trilinear sample of the grid at a
 * NORMALISED position. Outside the domain returns +Infinity (no
 * collision), never a clamped underestimate.
 */
export function queryMeshSdf(grid: MeshSdfGrid, px: number, py: number, pz: number): number {
  const n = grid.resolution;
  const h = grid.voxelNorm;
  const origin = -grid.sideNorm / 2;
  const fx = (px - origin) / h - 0.5;
  const fy = (py - origin) / h - 0.5;
  const fz = (pz - origin) / h - 0.5;
  if (fx < -0.5 || fy < -0.5 || fz < -0.5 || fx > n - 0.5 || fy > n - 0.5 || fz > n - 0.5) {
    return Infinity;
  }
  const cx = Math.min(Math.max(fx, 0), n - 1);
  const cy = Math.min(Math.max(fy, 0), n - 1);
  const cz = Math.min(Math.max(fz, 0), n - 1);
  const x0 = Math.floor(cx);
  const y0 = Math.floor(cy);
  const z0 = Math.floor(cz);
  const x1 = Math.min(x0 + 1, n - 1);
  const y1 = Math.min(y0 + 1, n - 1);
  const z1 = Math.min(z0 + 1, n - 1);
  const tx = cx - x0;
  const ty = cy - y0;
  const tz = cz - z0;
  const g = grid.grid;
  const at = (x: number, y: number, z: number) => g[x + n * (y + n * z)];
  const c00 = at(x0, y0, z0) * (1 - tx) + at(x1, y0, z0) * tx;
  const c10 = at(x0, y1, z0) * (1 - tx) + at(x1, y1, z0) * tx;
  const c01 = at(x0, y0, z1) * (1 - tx) + at(x1, y0, z1) * tx;
  const c11 = at(x0, y1, z1) * (1 - tx) + at(x1, y1, z1) * tx;
  const c0 = c00 * (1 - ty) + c10 * ty;
  const c1 = c01 * (1 - ty) + c11 * ty;
  return c0 * (1 - tz) + c1 * tz;
}

// ---------------------------------------------------------------------------
// Multi-body atlas (up to 4 bodies in one texture)
//
// Bodies are packed as a 2×2 tile atlas: atlas dimensions are
// (2R, 2R, R) for the shared bake resolution R, body i (0-based)
// occupies the cell whose voxel offset is ((i%2)·R, floor(i/2)·R, 0).
// Sampling a body clamps the in-cell fractional coordinates to the
// cell's own texel centres, so trilinear feet never reach into a
// neighbouring cell (the CPU twin of the shader's cell clamp).

export interface MeshSdfAtlasGrid {
  /** Signed distances in NORMALISED units, x-major over the atlas
   *  (index = x + W·(y + H·z)). Cells whose body is absent are
   *  filled with a large positive distance. */
  data: Float32Array;
  resolution: number;
  atlasWidth: number;
  atlasHeight: number;
  atlasDepth: number;
  grids: (MeshSdfGrid | null)[];
}

/** Voxel offset of body `bodyIndex`'s cell inside the atlas. */
export function meshSdfAtlasCellOffset(
  resolution: number,
  bodyIndex: number,
): [number, number, number] {
  return [(bodyIndex % 2) * resolution, Math.floor(bodyIndex / 2) * resolution, 0];
}

/** Pack up to 4 baked grids into the 2×2 atlas. Pure (no THREE). */
export function buildMeshSdfAtlas(grids: (MeshSdfGrid | null)[]): MeshSdfAtlasGrid {
  const list = grids.slice(0, 4);
  const ref = list.find((g) => g !== null) ?? null;
  if (!ref) {
    return {
      data: new Float32Array(0),
      resolution: 0,
      atlasWidth: 0,
      atlasHeight: 0,
      atlasDepth: 0,
      grids: list,
    };
  }
  const r = ref.resolution;
  const w = 2 * r;
  const h = 2 * r;
  const d = r;
  const data = new Float32Array(w * h * d);
  data.fill(ref.sideNorm);
  for (let i = 0; i < list.length; i += 1) {
    const grid = list[i];
    if (!grid || grid.resolution !== r) continue;
    const [ox, oy] = meshSdfAtlasCellOffset(r, i);
    const g = grid.grid;
    for (let z = 0; z < r; z += 1) {
      for (let y = 0; y < r; y += 1) {
        const srcRow = r * (y + r * z);
        const dstRow = (ox) + w * ((oy + y) + h * z);
        for (let x = 0; x < r; x += 1) {
          data[dstRow + x] = g[srcRow + x];
        }
      }
    }
  }
  return { data, resolution: r, atlasWidth: w, atlasHeight: h, atlasDepth: d, grids: list };
}

/**
 * CPU twin of the shader's per-body atlas query: trilinear sample
 * of body `bodyIndex` at a NORMALISED position in that body's
 * domain. Outside the domain returns +Infinity. The fractional
 * coordinates are clamped to the body's own texel centres, which
 * is the cell-clamp guard (no bleed from neighbouring cells). For
 * a 1-body atlas this matches `queryMeshSdf` exactly.
 */
export function queryMeshSdfAtlas(
  atlas: MeshSdfAtlasGrid,
  bodyIndex: number,
  px: number,
  py: number,
  pz: number,
): number {
  const grid = atlas.grids[bodyIndex];
  if (!grid || atlas.resolution <= 0) return Infinity;
  const n = grid.resolution;
  const hv = grid.voxelNorm;
  const origin = -grid.sideNorm / 2;
  const fx = (px - origin) / hv - 0.5;
  const fy = (py - origin) / hv - 0.5;
  const fz = (pz - origin) / hv - 0.5;
  if (fx < -0.5 || fy < -0.5 || fz < -0.5 || fx > n - 0.5 || fy > n - 0.5 || fz > n - 0.5) {
    return Infinity;
  }
  const cx = Math.min(Math.max(fx, 0), n - 1);
  const cy = Math.min(Math.max(fy, 0), n - 1);
  const cz = Math.min(Math.max(fz, 0), n - 1);
  const x0 = Math.floor(cx);
  const y0 = Math.floor(cy);
  const z0 = Math.floor(cz);
  const x1 = Math.min(x0 + 1, n - 1);
  const y1 = Math.min(y0 + 1, n - 1);
  const z1 = Math.min(z0 + 1, n - 1);
  const tx = cx - x0;
  const ty = cy - y0;
  const tz = cz - z0;
  const [ox, oy] = meshSdfAtlasCellOffset(n, bodyIndex);
  const w = atlas.atlasWidth;
  const hh = atlas.atlasHeight;
  const data = atlas.data;
  const at = (x: number, y: number, z: number) => data[(ox + x) + w * ((oy + y) + hh * z)];
  const c00 = at(x0, y0, z0) * (1 - tx) + at(x1, y0, z0) * tx;
  const c10 = at(x0, y1, z0) * (1 - tx) + at(x1, y1, z0) * tx;
  const c01 = at(x0, y0, z1) * (1 - tx) + at(x1, y0, z1) * tx;
  const c11 = at(x0, y1, z1) * (1 - tx) + at(x1, y1, z1) * tx;
  const c0 = c00 * (1 - ty) + c10 * ty;
  const c1 = c01 * (1 - ty) + c11 * ty;
  return c0 * (1 - tz) + c1 * tz;
}

/**
 * CPU model of the shader's min synthesis: the index of the
 * smallest (deepest) distance, or -1 when every distance is
 * non-finite (outside every domain = no collision).
 */
export function meshSdfMinBodyIndex(distances: readonly number[]): number {
  let best = Infinity;
  let bestIndex = -1;
  for (let i = 0; i < distances.length; i += 1) {
    const d = distances[i];
    if (Number.isFinite(d) && d < best) {
      best = d;
      bestIndex = i;
    }
  }
  return bestIndex;
}

// ---------------------------------------------------------------------------
// Texture + async bake management

export type MeshSdfFormat = 'r16f' | 'float32';

export interface MeshSdfColliderData {
  texture: THREE.Data3DTexture;
  grid: MeshSdfGrid;
  format: MeshSdfFormat;
}

export type MeshSdfBakeStatus =
  | { state: 'off' }
  | { state: 'no-source' }
  | { state: 'baking'; progress: number; resolution: number }
  | { state: 'ready'; resolution: number; format: MeshSdfFormat; triangleCount: number; minFeatureVoxels: number }
  | { state: 'refused'; reason: MeshSdfBakeFailure; resolution: number };

interface MeshSdfEntry {
  status: 'baking' | 'ready' | 'refused';
  progress: number;
  session: MeshSdfBakeSession | null;
  data: MeshSdfColliderData | null;
  reason: MeshSdfBakeFailure | null;
  timer: ReturnType<typeof setTimeout> | null;
}

const entries = new Map<string, MeshSdfEntry>();
const MAX_ENTRIES = 4;

function entryKey(config: ParticleConfig): string {
  return `${meshSdfSourceHash(config.gpgpuMorphObjSource)}|${meshSdfResolution(config)}`;
}

function makeMeshSdfTexture(grid: MeshSdfGrid): MeshSdfColliderData {
  const n = grid.resolution;
  const count = n * n * n;
  // R16F first (the brief's default): half data via three's own
  // converter so the decode matches the GPU's exactly.
  try {
    const half = new Uint16Array(count);
    for (let i = 0; i < count; i += 1) {
      half[i] = THREE.DataUtils.toHalfFloat(grid.grid[i]);
    }
    const texture = new THREE.Data3DTexture(half, n, n, n);
    texture.format = THREE.RedFormat;
    texture.type = THREE.HalfFloatType;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.wrapR = THREE.ClampToEdgeWrapping;
    texture.generateMipmaps = false;
    texture.unpackAlignment = 1;
    texture.needsUpdate = true;
    return { texture, grid, format: 'r16f' };
  } catch {
    const texture = new THREE.Data3DTexture(grid.grid, n, n, n);
    texture.format = THREE.RedFormat;
    texture.type = THREE.FloatType;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.wrapR = THREE.ClampToEdgeWrapping;
    texture.generateMipmaps = false;
    texture.unpackAlignment = 1;
    texture.needsUpdate = true;
    return { texture, grid, format: 'float32' };
  }
}

function startEntry(config: ParticleConfig, key: string): MeshSdfEntry {
  const entry: MeshSdfEntry = {
    status: 'baking',
    progress: 0,
    session: null,
    data: null,
    reason: null,
    timer: null,
  };
  entries.set(key, entry);
  // Evict the oldest finished entries beyond the cap.
  if (entries.size > MAX_ENTRIES) {
    for (const [k, e] of entries) {
      if (entries.size <= MAX_ENTRIES) break;
      if (k !== key && e.status !== 'baking') {
        if (e.timer) clearTimeout(e.timer);
        e.data?.texture.dispose();
        entries.delete(k);
      }
    }
  }
  const geometry = parseObjGeometry(config.gpgpuMorphObjSource || '');
  if (!geometry) {
    entry.status = 'refused';
    entry.reason = 'no-geometry';
    entry.progress = 1;
    return entry;
  }
  const session = createMeshSdfBake(geometry, meshSdfResolution(config));
  if (session.failure) {
    entry.status = 'refused';
    entry.reason = session.failure;
    entry.progress = 1;
    return entry;
  }
  entry.session = session;
  const pump = () => {
    entry.timer = null;
    if (entries.get(key) !== entry) return; // superseded
    // A few slabs per macrotask keeps the UI responsive at 128³.
    for (let s = 0; s < 3; s += 1) {
      if (session.step()) break;
    }
    entry.progress = session.progress;
    if (session.result) {
      entry.data = makeMeshSdfTexture(session.result);
      entry.status = 'ready';
      entry.progress = 1;
    } else {
      entry.timer = setTimeout(pump, 0);
    }
  };
  entry.timer = setTimeout(pump, 0);
  return entry;
}

/**
 * The collider for the sim passes, or null while the bake is
 * pending / refused / not requested. Calling this starts the bake
 * (once per source+resolution) — the terrain collider's
 * `getTerrainColliderTexture` contract, extended with the async
 * bake the mesh grid needs.
 */
export function getMeshSdfCollider(config: ParticleConfig): MeshSdfColliderData | null {
  if (!isMeshSdfRequested(config)) return null;
  const key = entryKey(config);
  let entry = entries.get(key);
  if (!entry) entry = startEntry(config, key);
  return entry.status === 'ready' ? entry.data : null;
}

/** Bake status for the UI (never starts a bake on its own beyond
 *  what `getMeshSdfCollider` already runs while the sim is live;
 *  when the panel asks first, starting here is equivalent). */
export function getMeshSdfBakeStatus(config: ParticleConfig): MeshSdfBakeStatus {
  if (!config.gpgpuMeshSdfEnabled) return { state: 'off' };
  if (!(config.gpgpuMorphObjSource || '').trim()) return { state: 'no-source' };
  const resolution = meshSdfResolution(config);
  const key = entryKey(config);
  let entry = entries.get(key);
  if (!entry) entry = startEntry(config, key);
  if (entry.status === 'baking') {
    return { state: 'baking', progress: entry.progress, resolution };
  }
  if (entry.status === 'refused') {
    return { state: 'refused', reason: entry.reason ?? 'no-geometry', resolution };
  }
  const data = entry.data as MeshSdfColliderData;
  return {
    state: 'ready',
    resolution,
    format: data.format,
    triangleCount: data.grid.triangleCount,
    minFeatureVoxels: data.grid.minFeatureVoxels,
  };
}

// ---------------------------------------------------------------------------
// Multi-body async bake + atlas texture management
//
// Body 1 is the single-body collider (morph source / placement /
// Bounce / Friction). Bodies 2-4 carry their own OBJ source; their
// world centre is the configured offset, and their world scale is
// meshSdfWorldScale(config) × their Scale key. A body whose bake
// is refused (open mesh etc.) is dropped on its own — the rest
// still form an atlas. While multi is enabled but the atlas is
// not ready the passes use NO mesh collider at all (the single
// body is not substituted), so a half-baked state can never show
// a partial collider set.

export interface MeshSdfMultiBodyData {
  /** Original body number (0 = body 1 … 3 = body 4). */
  bodyIndex: number;
  origin: [number, number, number];
  domainWorld: number;
  scale: number;
  voxelWorld: number;
  bounce: number;
  friction: number;
  /** Cell origin in atlas UV space. */
  cellUv: [number, number];
}

export interface MeshSdfMultiColliderData {
  texture: THREE.Data3DTexture;
  atlas: MeshSdfAtlasGrid;
  format: MeshSdfFormat;
  bodies: MeshSdfMultiBodyData[];
}

interface MultiBodySpec {
  source: string;
  center: [number, number, number];
  scaleFactor: number;
  bounce: number;
  friction: number;
}

function multiBodySpecs(config: ParticleConfig): MultiBodySpec[] {
  return [
    {
      source: config.gpgpuMorphObjSource || '',
      center: [0, 0, 0],
      scaleFactor: 1,
      bounce: config.gpgpuMeshSdfBounce ?? 0.5,
      friction: config.gpgpuMeshSdfFriction ?? 0.25,
    },
    {
      source: config.gpgpuMeshSdfBody2ObjSource || '',
      center: [
        config.gpgpuMeshSdfBody2OffsetX ?? 0,
        config.gpgpuMeshSdfBody2OffsetY ?? 0,
        config.gpgpuMeshSdfBody2OffsetZ ?? 0,
      ],
      scaleFactor: config.gpgpuMeshSdfBody2Scale ?? 1,
      bounce: config.gpgpuMeshSdfBody2Bounce ?? 0.5,
      friction: config.gpgpuMeshSdfBody2Friction ?? 0.25,
    },
    {
      source: config.gpgpuMeshSdfBody3ObjSource || '',
      center: [
        config.gpgpuMeshSdfBody3OffsetX ?? 0,
        config.gpgpuMeshSdfBody3OffsetY ?? 0,
        config.gpgpuMeshSdfBody3OffsetZ ?? 0,
      ],
      scaleFactor: config.gpgpuMeshSdfBody3Scale ?? 1,
      bounce: config.gpgpuMeshSdfBody3Bounce ?? 0.5,
      friction: config.gpgpuMeshSdfBody3Friction ?? 0.25,
    },
    {
      source: config.gpgpuMeshSdfBody4ObjSource || '',
      center: [
        config.gpgpuMeshSdfBody4OffsetX ?? 0,
        config.gpgpuMeshSdfBody4OffsetY ?? 0,
        config.gpgpuMeshSdfBody4OffsetZ ?? 0,
      ],
      scaleFactor: config.gpgpuMeshSdfBody4Scale ?? 1,
      bounce: config.gpgpuMeshSdfBody4Bounce ?? 0.5,
      friction: config.gpgpuMeshSdfBody4Friction ?? 0.25,
    },
  ];
}

/** The multi collider can only exist while the parent mesh SDF
 *  key AND the multi master key are on and at least one body has
 *  a source text. (Defect fix 2026-11-27: the parent check was
 *  missing, so turning the parent off in the UI — which hides
 *  the multi controls — left the multi collider live.) */
export function isMeshSdfMultiRequested(config: ParticleConfig): boolean {
  if (!config.gpgpuMeshSdfEnabled) return false;
  if (!config.gpgpuMeshSdfMultiEnabled) return false;
  return multiBodySpecs(config).some((s) => s.source.trim().length > 0);
}

interface MeshSdfMultiEntry {
  status: 'baking' | 'ready' | 'refused';
  progress: number;
  sessions: (MeshSdfBakeSession | null)[];
  data: { texture: THREE.Data3DTexture; atlas: MeshSdfAtlasGrid; format: MeshSdfFormat } | null;
  body1Failure: MeshSdfBakeFailure | null;
  failures: (MeshSdfBakeFailure | null)[];
  timer: ReturnType<typeof setTimeout> | null;
}

const multiEntries = new Map<string, MeshSdfMultiEntry>();
const MAX_MULTI_ENTRIES = 4;

function multiEntryKey(config: ParticleConfig): string {
  const hashes = multiBodySpecs(config).map((s) => meshSdfSourceHash(s.source));
  return `multi|${hashes.join('|')}|${meshSdfResolution(config)}`;
}

function makeMeshSdfAtlasTexture(
  atlas: MeshSdfAtlasGrid,
): { texture: THREE.Data3DTexture; atlas: MeshSdfAtlasGrid; format: MeshSdfFormat } {
  const { atlasWidth: w, atlasHeight: h, atlasDepth: d } = atlas;
  const count = w * h * d;
  try {
    const half = new Uint16Array(count);
    for (let i = 0; i < count; i += 1) {
      half[i] = THREE.DataUtils.toHalfFloat(atlas.data[i]);
    }
    const texture = new THREE.Data3DTexture(half, w, h, d);
    texture.format = THREE.RedFormat;
    texture.type = THREE.HalfFloatType;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.wrapR = THREE.ClampToEdgeWrapping;
    texture.generateMipmaps = false;
    texture.unpackAlignment = 1;
    texture.needsUpdate = true;
    return { texture, atlas, format: 'r16f' };
  } catch {
    const texture = new THREE.Data3DTexture(atlas.data, w, h, d);
    texture.format = THREE.RedFormat;
    texture.type = THREE.FloatType;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.wrapR = THREE.ClampToEdgeWrapping;
    texture.generateMipmaps = false;
    texture.unpackAlignment = 1;
    texture.needsUpdate = true;
    return { texture, atlas, format: 'float32' };
  }
}

function startMultiEntry(config: ParticleConfig, key: string): MeshSdfMultiEntry {
  const specs = multiBodySpecs(config);
  const resolution = meshSdfResolution(config);
  const entry: MeshSdfMultiEntry = {
    status: 'baking',
    progress: 0,
    sessions: [null, null, null, null],
    data: null,
    body1Failure: null,
    failures: [null, null, null, null],
    timer: null,
  };
  multiEntries.set(key, entry);
  if (multiEntries.size > MAX_MULTI_ENTRIES) {
    for (const [k, e] of multiEntries) {
      if (multiEntries.size <= MAX_MULTI_ENTRIES) break;
      if (k !== key && e.status !== 'baking') {
        if (e.timer) clearTimeout(e.timer);
        e.data?.texture.dispose();
        multiEntries.delete(k);
      }
    }
  }
  let anySession = false;
  for (let i = 0; i < 4; i += 1) {
    const source = specs[i].source;
    if (!source.trim()) continue;
    const geometry = parseObjGeometry(source);
    if (!geometry) {
      entry.failures[i] = 'no-geometry';
      if (i === 0) entry.body1Failure = 'no-geometry';
      continue;
    }
    const session = createMeshSdfBake(geometry, resolution);
    if (session.failure) {
      entry.failures[i] = session.failure;
      if (i === 0) entry.body1Failure = session.failure;
      continue;
    }
    entry.sessions[i] = session;
    anySession = true;
  }
  if (!anySession) {
    entry.status = 'refused';
    entry.progress = 1;
    return entry;
  }
  const pump = () => {
    entry.timer = null;
    if (multiEntries.get(key) !== entry) return; // superseded
    let done = true;
    let progressSum = 0;
    let progressCount = 0;
    for (const session of entry.sessions) {
      if (!session) continue;
      if (!session.result) {
        for (let s = 0; s < 3; s += 1) {
          if (session.step()) break;
        }
      }
      progressSum += session.progress;
      progressCount += 1;
      if (!session.result) done = false;
    }
    entry.progress = progressCount > 0 ? progressSum / progressCount : 1;
    if (done) {
      const grids = entry.sessions.map((s) => (s ? s.result : null));
      if (grids.every((g) => g === null)) {
        entry.status = 'refused';
        entry.progress = 1;
        return;
      }
      const atlas = buildMeshSdfAtlas(grids);
      entry.data = makeMeshSdfAtlasTexture(atlas);
      entry.status = 'ready';
      entry.progress = 1;
    } else {
      entry.timer = setTimeout(pump, 0);
    }
  };
  entry.timer = setTimeout(pump, 0);
  return entry;
}

function computeMultiBodies(config: ParticleConfig, atlas: MeshSdfAtlasGrid): MeshSdfMultiBodyData[] {
  const specs = multiBodySpecs(config);
  const worldScale = meshSdfWorldScale(config);
  const bodies: MeshSdfMultiBodyData[] = [];
  for (let i = 0; i < 4; i += 1) {
    const grid = atlas.grids[i];
    if (!grid) continue;
    const spec = specs[i];
    if (i > 0 && !(spec.scaleFactor > 0)) continue;
    const scale = worldScale * spec.scaleFactor;
    const domainWorld = grid.sideNorm * scale;
    bodies.push({
      bodyIndex: i,
      origin: [
        spec.center[0] - domainWorld / 2,
        spec.center[1] - domainWorld / 2,
        spec.center[2] - domainWorld / 2,
      ],
      domainWorld,
      scale,
      voxelWorld: grid.voxelNorm * scale,
      bounce: spec.bounce,
      friction: spec.friction,
      cellUv: [
        ((i % 2) * atlas.resolution) / atlas.atlasWidth,
        (Math.floor(i / 2) * atlas.resolution) / atlas.atlasHeight,
      ],
    });
  }
  return bodies;
}

/**
 * The multi-body collider for the sim passes, or null while the
 * atlas bake is pending / refused / not requested. Calling this
 * starts the bakes (once per source set + resolution).
 */
export function getMeshSdfMultiCollider(config: ParticleConfig): MeshSdfMultiColliderData | null {
  if (!isMeshSdfMultiRequested(config)) return null;
  const key = multiEntryKey(config);
  let entry = multiEntries.get(key);
  if (!entry) entry = startMultiEntry(config, key);
  if (entry.status !== 'ready' || !entry.data) return null;
  const bodies = computeMultiBodies(config, entry.data.atlas);
  if (bodies.length === 0) return null;
  return {
    texture: entry.data.texture,
    atlas: entry.data.atlas,
    format: entry.data.format,
    bodies,
  };
}

/** Bake status for the UI — same shape as the single status.
 *  Defect fix 2026-11-27: the status used to be body 1's state
 *  alone, so with body 1 empty or refused it stuck at
 *  'no-source' / 'refused' even while bodies 2–4 baked and the
 *  collider was live. The status now follows the whole set:
 *  'no-source' only when no body has a source, 'refused' only
 *  when every attempted body failed, and the representative
 *  grid is the first body that actually baked. */
export function getMeshSdfMultiBakeStatus(config: ParticleConfig): MeshSdfBakeStatus {
  if (!config.gpgpuMeshSdfEnabled || !config.gpgpuMeshSdfMultiEnabled) return { state: 'off' };
  const specs = multiBodySpecs(config);
  if (!specs.some((s) => s.source.trim().length > 0)) return { state: 'no-source' };
  const resolution = meshSdfResolution(config);
  const key = multiEntryKey(config);
  let entry = multiEntries.get(key);
  if (!entry) entry = startMultiEntry(config, key);
  if (entry.status === 'baking') {
    return { state: 'baking', progress: entry.progress, resolution };
  }
  const firstFailure = entry.failures.find((f) => f) ?? entry.body1Failure ?? 'no-geometry';
  if (entry.status === 'refused') {
    return { state: 'refused', reason: firstFailure, resolution };
  }
  const data = entry.data as { texture: THREE.Data3DTexture; atlas: MeshSdfAtlasGrid; format: MeshSdfFormat };
  const repGrid = data.atlas.grids.find((g) => g);
  if (!repGrid) {
    return { state: 'refused', reason: firstFailure, resolution };
  }
  return {
    state: 'ready',
    resolution,
    format: data.format,
    triangleCount: repGrid.triangleCount,
    minFeatureVoxels: repGrid.minFeatureVoxels,
  };
}
