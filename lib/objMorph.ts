/**
 * OBJ import for the GPGPU morph system (Phase J: OBJ / mesh emitter).
 *
 * Parses a Wavefront OBJ document (file upload or pasted text) with a
 * small, dependency-free parser and turns its surface into a point
 * cloud the morph bake (lib/gpgpuMorphTargets.ts) can consume as the
 * 'obj' target. The flow mirrors the SVG morph treatment (Pro-2): the
 * OBJ *source text* lives in the config (gpgpuMorphObjSource) so it
 * persists with projects and presets, and the point cloud is
 * re-derived deterministically at bake time — same source, same cloud.
 *
 * Supported input:
 *  - `v` vertex lines (x y z; an optional w is ignored).
 *  - `f` face lines with every common index form: `v`, `v/vt`,
 *    `v//vn`, `v/vt/vn`, and negative (relative) indices. Texture /
 *    normal indices are parsed off and discarded — the cloud needs
 *    positions only.
 *  - Polygon faces (4+ vertices) are fan-triangulated.
 *  - Everything else (vn / vt / o / g / s / materials / comments) is
 *    skipped, and malformed lines are ignored rather than fatal. A
 *    document with no usable vertices or no usable faces yields null,
 *    which the UI surfaces explicitly and the bake answers with the
 *    shell fallback, exactly like a missing SVG / media map.
 *
 * Sampling: triangles are picked with probability proportional to
 * their area and points are placed with the standard sqrt barycentric
 * trick, giving a uniform surface distribution. The RNG is the shared
 * seeded generator with a fixed seed, so the cloud is a pure function
 * of the source text (the deterministic renderer relies on this).
 * The cloud is normalised into morph space the same way the built-in
 * targets are sized: centred on the bounding-box centre and scaled so
 * the bounding-sphere radius is 1.
 */

import { createSeededRng } from './seededRng';

/** Points sampled from an imported OBJ (flat xyz triples, normalised). */
export const OBJ_MORPH_SAMPLE_COUNT = 8192;

/** Fixed sampler seed: the cloud depends on the source text only. */
const OBJ_SAMPLE_SEED = 0x0b1ec7;

export interface ObjGeometry {
  /** Vertex positions, flat xyz triples in source units. */
  vertices: Float32Array;
  /** Triangle vertex indices (0-based), flat triples. */
  triangles: Uint32Array;
  vertexCount: number;
  /** Polygon faces as authored (before fan triangulation). */
  faceCount: number;
  triangleCount: number;
}

/**
 * Parse the vertex/face structure of an OBJ document. Returns null
 * when the document carries no usable geometry (no vertices, or no
 * face that resolves to a triangle).
 */
export function parseObjGeometry(objText: string): ObjGeometry | null {
  if (!objText || objText.indexOf('v') === -1) return null;
  const vertices: number[] = [];
  const triangles: number[] = [];
  let faceCount = 0;

  const lines = objText.split(/\r\n|\r|\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.length < 2) continue;
    const head = line.charCodeAt(0);
    if (head === 118 && (line[1] === ' ' || line[1] === '\t')) {
      // 'v x y z [w]' — vertex position.
      const parts = line.split(/\s+/);
      const x = Number(parts[1]);
      const y = Number(parts[2]);
      const z = Number(parts[3]);
      if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
        vertices.push(x, y, z);
      }
      continue;
    }
    if (head === 102 && (line[1] === ' ' || line[1] === '\t')) {
      // 'f a b c [...]' — polygon face; fan-triangulated below.
      const vertexCount = vertices.length / 3;
      if (vertexCount === 0) continue;
      const tokens = line.slice(1).trim().split(/\s+/);
      const face: number[] = [];
      let valid = tokens.length >= 3;
      for (const token of tokens) {
        const slash = token.indexOf('/');
        const rawIndex = slash === -1 ? token : token.slice(0, slash);
        const parsed = Number(rawIndex);
        if (!Number.isInteger(parsed) || parsed === 0) {
          valid = false;
          break;
        }
        // Positive indices are 1-based; negative are relative to the
        // most recently defined vertex (-1 = last vertex).
        const index = parsed > 0 ? parsed - 1 : vertexCount + parsed;
        if (index < 0 || index >= vertexCount) {
          valid = false;
          break;
        }
        face.push(index);
      }
      if (!valid || face.length < 3) continue;
      faceCount += 1;
      for (let k = 1; k + 1 < face.length; k++) {
        triangles.push(face[0], face[k], face[k + 1]);
      }
      continue;
    }
    // vn / vt / vp / o / g / s / usemtl / mtllib / comments: ignored.
  }

  const vertexCount = vertices.length / 3;
  const triangleCount = triangles.length / 3;
  if (vertexCount === 0 || triangleCount === 0) return null;
  return {
    vertices: new Float32Array(vertices),
    triangles: new Uint32Array(triangles),
    vertexCount,
    faceCount,
    triangleCount,
  };
}

/**
 * Sample an OBJ document into a normalised surface point cloud: flat
 * xyz triples centred on the bounding-box centre with bounding-sphere
 * radius 1. Returns null when the document has no usable geometry.
 * Pure and deterministic — the same source always yields the same
 * cloud, which the deterministic renderer relies on.
 */
export function sampleObjPointCloud(
  objText: string,
  sampleCount: number = OBJ_MORPH_SAMPLE_COUNT,
): Float32Array | null {
  const geometry = parseObjGeometry(objText);
  if (!geometry) return null;
  const { vertices, triangles, triangleCount } = geometry;

  // Bounding box centre + bounding-sphere radius (morph-space sizing).
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
  const invRadius = 1 / radius;

  // Per-triangle areas and their cumulative distribution.
  const cumulative = new Float64Array(triangleCount);
  let totalArea = 0;
  for (let t = 0; t < triangleCount; t++) {
    const a = triangles[t * 3] * 3;
    const b = triangles[t * 3 + 1] * 3;
    const c = triangles[t * 3 + 2] * 3;
    const abx = vertices[b] - vertices[a];
    const aby = vertices[b + 1] - vertices[a + 1];
    const abz = vertices[b + 2] - vertices[a + 2];
    const acx = vertices[c] - vertices[a];
    const acy = vertices[c + 1] - vertices[a + 1];
    const acz = vertices[c + 2] - vertices[a + 2];
    const crossX = aby * acz - abz * acy;
    const crossY = abz * acx - abx * acz;
    const crossZ = abx * acy - aby * acx;
    totalArea += 0.5 * Math.hypot(crossX, crossY, crossZ);
    cumulative[t] = totalArea;
  }

  const out = new Float32Array(sampleCount * 3);
  const rng = createSeededRng(OBJ_SAMPLE_SEED);

  if (!(totalArea > 0)) {
    // Degenerate mesh (all triangles zero-area, e.g. a line of
    // slivers): fall back to cycling the vertices themselves so the
    // morph still gathers somewhere meaningful.
    const vertexCount = vertices.length / 3;
    for (let s = 0; s < sampleCount; s++) {
      const v = (s % vertexCount) * 3;
      out[s * 3] = (vertices[v] - cx) * invRadius;
      out[s * 3 + 1] = (vertices[v + 1] - cy) * invRadius;
      out[s * 3 + 2] = (vertices[v + 2] - cz) * invRadius;
    }
    return out;
  }

  for (let s = 0; s < sampleCount; s++) {
    // Area-weighted triangle pick (binary search over cumulative area).
    const pick = rng() * totalArea;
    let lo = 0;
    let hi = triangleCount - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cumulative[mid] < pick) lo = mid + 1;
      else hi = mid;
    }
    const a = triangles[lo * 3] * 3;
    const b = triangles[lo * 3 + 1] * 3;
    const c = triangles[lo * 3 + 2] * 3;
    // Uniform barycentric placement (sqrt trick).
    const r1 = Math.sqrt(rng());
    const r2 = rng();
    const wa = 1 - r1;
    const wb = r1 * (1 - r2);
    const wc = r1 * r2;
    out[s * 3] = (vertices[a] * wa + vertices[b] * wb + vertices[c] * wc - cx) * invRadius;
    out[s * 3 + 1] = (vertices[a + 1] * wa + vertices[b + 1] * wb + vertices[c + 1] * wc - cy) * invRadius;
    out[s * 3 + 2] = (vertices[a + 2] * wa + vertices[b + 2] * wb + vertices[c + 2] * wc - cz) * invRadius;
  }
  return out;
}

const fmt = (n: number): string => {
  const v = Math.abs(n) < 1e-9 ? 0 : n;
  return v.toFixed(6);
};

/**
 * Procedurally authored sample mesh: an icosphere (icosahedron
 * subdivided once, 42 vertices / 80 triangular faces), normalised to
 * the unit sphere. Original geometry, generated here — no IP.
 */
function buildSampleObjSphere(): string {
  const t = (1 + Math.sqrt(5)) / 2;
  const base: Array<[number, number, number]> = [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
    [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
    [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ];
  const faces: Array<[number, number, number]> = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];
  const verts: Array<[number, number, number]> = base.map(([x, y, z]) => {
    const l = Math.hypot(x, y, z);
    return [x / l, y / l, z / l];
  });
  const midpointCache = new Map<string, number>();
  const midpoint = (a: number, b: number): number => {
    const key = a < b ? `${a}_${b}` : `${b}_${a}`;
    const cached = midpointCache.get(key);
    if (cached !== undefined) return cached;
    const pa = verts[a];
    const pb = verts[b];
    const mx = (pa[0] + pb[0]) / 2;
    const my = (pa[1] + pb[1]) / 2;
    const mz = (pa[2] + pb[2]) / 2;
    const l = Math.hypot(mx, my, mz) || 1;
    verts.push([mx / l, my / l, mz / l]);
    const index = verts.length - 1;
    midpointCache.set(key, index);
    return index;
  };
  const subdivided: Array<[number, number, number]> = [];
  for (const [a, b, c] of faces) {
    const ab = midpoint(a, b);
    const bc = midpoint(b, c);
    const ca = midpoint(c, a);
    subdivided.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
  }
  const lines = ['# Kalokagathia sample OBJ — icosphere (procedural, original)'];
  for (const [x, y, z] of verts) lines.push(`v ${fmt(x)} ${fmt(y)} ${fmt(z)}`);
  for (const [a, b, c] of subdivided) lines.push(`f ${a + 1} ${b + 1} ${c + 1}`);
  return lines.join('\n');
}

/**
 * Procedurally authored sample mesh: a low-poly torus knot (2,3)
 * tube — 60 segments around the curve × 7 around the tube, authored
 * with quad faces so the sample also exercises polygon faces.
 * Original geometry, generated here — no IP.
 */
function buildSampleObjTorusKnot(): string {
  const tubularSegments = 60;
  const radialSegments = 7;
  const tubeRadius = 0.34;
  const curvePoint = (u: number): [number, number, number] => {
    const r = 2 + Math.cos(3 * u);
    return [r * Math.cos(2 * u), r * Math.sin(2 * u), Math.sin(3 * u)];
  };
  const verts: Array<[number, number, number]> = [];
  for (let i = 0; i < tubularSegments; i++) {
    const u = (i / tubularSegments) * Math.PI * 2;
    const p = curvePoint(u);
    const pNext = curvePoint(u + 0.01);
    const tx = pNext[0] - p[0];
    const ty = pNext[1] - p[1];
    const tz = pNext[2] - p[2];
    // Frame: N = normalize(T × Z) (the knot's tangent is never
    // parallel to the Z axis, so this is stable), B = T × N.
    let nx = ty;
    let ny = -tx;
    let nz = 0;
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl; ny /= nl; nz /= nl;
    const bx = ty * nz - tz * ny;
    const by = tz * nx - tx * nz;
    const bz = tx * ny - ty * nx;
    for (let j = 0; j < radialSegments; j++) {
      const v = (j / radialSegments) * Math.PI * 2;
      const cos = Math.cos(v);
      const sin = Math.sin(v);
      verts.push([
        p[0] + tubeRadius * (cos * nx + sin * bx),
        p[1] + tubeRadius * (cos * ny + sin * by),
        p[2] + tubeRadius * (cos * nz + sin * bz),
      ]);
    }
  }
  const lines = ['# Kalokagathia sample OBJ — torus knot (2,3) tube (procedural, original)'];
  for (const [x, y, z] of verts) lines.push(`v ${fmt(x)} ${fmt(y)} ${fmt(z)}`);
  for (let i = 0; i < tubularSegments; i++) {
    const iNext = (i + 1) % tubularSegments;
    for (let j = 0; j < radialSegments; j++) {
      const jNext = (j + 1) % radialSegments;
      const a = i * radialSegments + j + 1;
      const b = iNext * radialSegments + j + 1;
      const c = iNext * radialSegments + jNext + 1;
      const d = i * radialSegments + jNext + 1;
      lines.push(`f ${a} ${b} ${c} ${d}`);
    }
  }
  return lines.join('\n');
}

/** Bundled sample: low-poly icosphere OBJ text. */
export const SAMPLE_OBJ_SPHERE: string = buildSampleObjSphere();

/** Bundled sample: low-poly torus-knot tube OBJ text (quad faces). */
export const SAMPLE_OBJ_TORUS_KNOT: string = buildSampleObjTorusKnot();
