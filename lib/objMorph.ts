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
 *
 * Phase O additions: the parser also resolves per-vertex normals
 * (authored `vn` referenced by the faces wins per-vertex; otherwise
 * the area-weighted average of adjacent face normals), and
 * sampleObjPointCloudWithNormals adds the 'vertices' and 'volume'
 * sampling modes plus a parallel normal cloud for the normal-speed
 * emission kick. The Phase J surface path (sampleObjPointCloud) is
 * untouched, and the new sampler's 'surface' mode reproduces its
 * points bit-for-bit (same seed, same draw order).
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
  /**
   * Per-vertex normals, flat xyz triples (unit length, or zero when
   * undefined). Authored `vn` normals referenced by a face corner win
   * for that vertex; every other vertex gets the area-weighted
   * average of its adjacent face normals (Phase O).
   */
  vertexNormals: Float32Array;
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
  const authoredNormals: number[] = [];
  const triangles: number[] = [];
  // Per-corner authored-normal indices, parallel to `triangles`
  // (-1 = the corner's face token carried no usable vn index).
  const cornerNormalIdx: number[] = [];
  let faceCount = 0;

  const lines = objText.split(/\r\n|\r|\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.length < 2) continue;
    const head = line.charCodeAt(0);
    if (head === 118 && line[1] === 'n' && (line[2] === ' ' || line[2] === '\t')) {
      // 'vn x y z' — authored vertex normal (Phase O).
      const parts = line.split(/\s+/);
      const x = Number(parts[1]);
      const y = Number(parts[2]);
      const z = Number(parts[3]);
      if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
        authoredNormals.push(x, y, z);
      }
      continue;
    }
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
      const faceNormals: number[] = [];
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
        // Authored normal index (the third token component, v/vt/vn
        // or v//vn). A missing or unusable vn never invalidates the
        // face — the vertex just falls back to the computed normal.
        let normalIndex = -1;
        const vnCount = authoredNormals.length / 3;
        if (slash !== -1 && vnCount > 0) {
          const components = token.split('/');
          const rawNormal = components.length >= 3 ? Number(components[2]) : NaN;
          if (Number.isInteger(rawNormal) && rawNormal !== 0) {
            const resolved = rawNormal > 0 ? rawNormal - 1 : vnCount + rawNormal;
            if (resolved >= 0 && resolved < vnCount) normalIndex = resolved;
          }
        }
        faceNormals.push(normalIndex);
      }
      if (!valid || face.length < 3) continue;
      faceCount += 1;
      for (let k = 1; k + 1 < face.length; k++) {
        triangles.push(face[0], face[k], face[k + 1]);
        cornerNormalIdx.push(faceNormals[0], faceNormals[k], faceNormals[k + 1]);
      }
      continue;
    }
    // vn / vt / vp / o / g / s / usemtl / mtllib / comments: ignored.
  }

  const vertexCount = vertices.length / 3;
  const triangleCount = triangles.length / 3;
  if (vertexCount === 0 || triangleCount === 0) return null;
  const vertexArray = new Float32Array(vertices);
  const triangleArray = new Uint32Array(triangles);
  return {
    vertices: vertexArray,
    triangles: triangleArray,
    vertexNormals: computeObjVertexNormals(vertexArray, triangleArray, authoredNormals, cornerNormalIdx),
    vertexCount,
    faceCount,
    triangleCount,
  };
}

/**
 * Per-vertex normals for a parsed mesh: the area-weighted average of
 * adjacent face normals (the unnormalised cross product IS the area
 * weight), overridden per-vertex by an authored `vn` whenever a face
 * corner referenced one for that vertex. Zero-area neighbourhoods
 * yield a zero normal; samplers substitute a fallback direction.
 */
function computeObjVertexNormals(
  vertices: Float32Array,
  triangles: Uint32Array,
  authoredNormals: number[],
  cornerNormalIdx: number[],
): Float32Array {
  const vertexCount = vertices.length / 3;
  const accum = new Float64Array(vertexCount * 3);
  for (let t = 0; t < triangles.length; t += 3) {
    const a = triangles[t] * 3;
    const b = triangles[t + 1] * 3;
    const c = triangles[t + 2] * 3;
    const abx = vertices[b] - vertices[a];
    const aby = vertices[b + 1] - vertices[a + 1];
    const abz = vertices[b + 2] - vertices[a + 2];
    const acx = vertices[c] - vertices[a];
    const acy = vertices[c + 1] - vertices[a + 1];
    const acz = vertices[c + 2] - vertices[a + 2];
    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;
    for (let corner = 0; corner < 3; corner++) {
      const o = triangles[t + corner] * 3;
      accum[o] += nx;
      accum[o + 1] += ny;
      accum[o + 2] += nz;
    }
  }
  const authoredPerVertex = new Int32Array(vertexCount).fill(-1);
  for (let t = 0; t < triangles.length; t++) {
    const nIdx = cornerNormalIdx[t];
    if (nIdx !== undefined && nIdx >= 0) authoredPerVertex[triangles[t]] = nIdx;
  }
  const out = new Float32Array(vertexCount * 3);
  for (let v = 0; v < vertexCount; v++) {
    const o = v * 3;
    let nx = 0;
    let ny = 0;
    let nz = 0;
    const aIdx = authoredPerVertex[v];
    if (aIdx >= 0) {
      nx = authoredNormals[aIdx * 3];
      ny = authoredNormals[aIdx * 3 + 1];
      nz = authoredNormals[aIdx * 3 + 2];
    }
    if (Math.hypot(nx, ny, nz) < 1e-9) {
      nx = accum[o];
      ny = accum[o + 1];
      nz = accum[o + 2];
    }
    const len = Math.hypot(nx, ny, nz);
    if (len > 1e-9) {
      out[o] = nx / len;
      out[o + 1] = ny / len;
      out[o + 2] = nz / len;
    }
  }
  return out;
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

// ---------------------------------------------------------------------------
// Phase O: sampling modes + per-sample normals.
//
// 'surface' is the Phase J distribution (area-weighted, sqrt
// barycentric) reproduced draw-for-draw so its points stay
// bit-identical to sampleObjPointCloud; each sample additionally
// carries the barycentric interpolation of the vertex normals.
// 'vertices' places the samples on the mesh vertices themselves
// (cycled deterministically when more samples than vertices are
// requested). 'volume' fills the interior of a CLOSED mesh by
// rejection sampling inside the bounding box with a ray-parity
// inside test; a mesh that is not closed (some edge is not shared by
// exactly two triangles) cannot define an interior, so the mode
// falls back to 'surface' and says so via the result — the UI
// surfaces the same fact. Normals: surface/vertices use the vertex
// normals; volume uses the nearest triangle's face normal.
// ---------------------------------------------------------------------------

/** OBJ sampling modes (Phase O). 'surface' is the Phase J default. */
export type ObjSampleMode = 'surface' | 'vertices' | 'volume';

export interface ObjSampleResult {
  /** Normalised sample points, flat xyz triples. */
  points: Float32Array;
  /** Per-sample unit normals, flat xyz triples parallel to points. */
  normals: Float32Array;
  requestedMode: ObjSampleMode;
  /** The mode actually used ('surface' when volume fell back). */
  effectiveMode: ObjSampleMode;
  /** True when 'volume' was requested but the mesh is not closed. */
  fellBack: boolean;
  /**
   * True when volume rejection sampling hit its attempt cap before
   * filling the budget and the remainder was topped up with surface
   * samples (thin / pathological closed meshes only).
   */
  toppedUp: boolean;
  /** Closedness verdict when volume was requested, else null. */
  closed: boolean | null;
}

/**
 * Closed-mesh test: every undirected triangle edge is shared by
 * exactly two triangles. This is the condition under which the
 * ray-parity inside test (and the notion of "interior") is sound.
 */
export function isObjClosedMesh(geometry: ObjGeometry): boolean {
  if (geometry.triangleCount === 0) return false;
  const edges = new Map<string, number>();
  const { triangles } = geometry;
  for (let t = 0; t < triangles.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = triangles[t + e];
      const b = triangles[t + ((e + 1) % 3)];
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  }
  for (const count of edges.values()) if (count !== 2) return false;
  return true;
}

interface ObjNormalization {
  cx: number;
  cy: number;
  cz: number;
  invRadius: number;
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

/** Same centre/radius normalisation the Phase J sampler applies. */
function objNormalization(vertices: Float32Array): ObjNormalization | null {
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
  return { cx, cy, cz, invRadius: 1 / radius, minX, minY, minZ, maxX, maxY, maxZ };
}

/** Unit normal of one triangle (zero vector for degenerate faces). */
function objFaceNormal(vertices: Float32Array, triangles: Uint32Array, t: number): [number, number, number] {
  const a = triangles[t * 3] * 3;
  const b = triangles[t * 3 + 1] * 3;
  const c = triangles[t * 3 + 2] * 3;
  const abx = vertices[b] - vertices[a];
  const aby = vertices[b + 1] - vertices[a + 1];
  const abz = vertices[b + 2] - vertices[a + 2];
  const acx = vertices[c] - vertices[a];
  const acy = vertices[c + 1] - vertices[a + 1];
  const acz = vertices[c + 2] - vertices[a + 2];
  const nx = aby * acz - abz * acy;
  const ny = abz * acx - abx * acz;
  const nz = abx * acy - aby * acx;
  const len = Math.hypot(nx, ny, nz);
  if (!(len > 1e-12)) return [0, 0, 0];
  return [nx / len, ny / len, nz / len];
}

/**
 * Sample an OBJ document into a normalised point cloud WITH a
 * parallel normal cloud, in one of the Phase O modes. Pure and
 * deterministic for a given (source, mode). Returns null when the
 * document has no usable geometry. In 'surface' mode the points are
 * bit-identical to sampleObjPointCloud (same seed and draw order);
 * only the normals are new information.
 */
export function sampleObjPointCloudWithNormals(
  objText: string,
  mode: ObjSampleMode = 'surface',
  sampleCount: number = OBJ_MORPH_SAMPLE_COUNT,
): ObjSampleResult | null {
  const geometry = parseObjGeometry(objText);
  if (!geometry) return null;
  const { vertices, triangles, triangleCount, vertexNormals } = geometry;
  const norm = objNormalization(vertices);
  if (!norm) return null;
  const { cx, cy, cz, invRadius } = norm;

  const points = new Float32Array(sampleCount * 3);
  const normals = new Float32Array(sampleCount * 3);
  const writePoint = (s: number, x: number, y: number, z: number) => {
    points[s * 3] = (x - cx) * invRadius;
    points[s * 3 + 1] = (y - cy) * invRadius;
    points[s * 3 + 2] = (z - cz) * invRadius;
  };
  const writeNormal = (s: number, nx: number, ny: number, nz: number) => {
    const len = Math.hypot(nx, ny, nz);
    if (len > 1e-9) {
      normals[s * 3] = nx / len;
      normals[s * 3 + 1] = ny / len;
      normals[s * 3 + 2] = nz / len;
    } else {
      // Undefined normal (degenerate neighbourhood): fall back to the
      // radial direction of the sample itself, which for the convex
      // sample meshes is the outward direction.
      const px = points[s * 3];
      const py = points[s * 3 + 1];
      const pz = points[s * 3 + 2];
      const pl = Math.hypot(px, py, pz);
      if (pl > 1e-9) {
        normals[s * 3] = px / pl;
        normals[s * 3 + 1] = py / pl;
        normals[s * 3 + 2] = pz / pl;
      } else {
        normals[s * 3 + 1] = 1;
      }
    }
  };

  if (mode === 'vertices') {
    const vertexCount = vertices.length / 3;
    for (let s = 0; s < sampleCount; s++) {
      const v = (s % vertexCount) * 3;
      writePoint(s, vertices[v], vertices[v + 1], vertices[v + 2]);
      writeNormal(s, vertexNormals[v], vertexNormals[v + 1], vertexNormals[v + 2]);
    }
    return { points, normals, requestedMode: mode, effectiveMode: 'vertices', fellBack: false, toppedUp: false, closed: null };
  }

  // Surface sampling shared by 'surface' and the volume fallback /
  // top-up. The draw sequence (pick, sqrt, barycentric) mirrors
  // sampleObjPointCloud exactly, so a fresh RNG here reproduces the
  // Phase J cloud bit-for-bit.
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
  const sampleSurfaceInto = (rng: () => number, from: number, to: number) => {
    if (!(totalArea > 0)) {
      // Degenerate mesh: cycle the vertices, as the Phase J sampler.
      const vertexCount = vertices.length / 3;
      for (let s = from; s < to; s++) {
        const v = (s % vertexCount) * 3;
        writePoint(s, vertices[v], vertices[v + 1], vertices[v + 2]);
        writeNormal(s, vertexNormals[v], vertexNormals[v + 1], vertexNormals[v + 2]);
      }
      return;
    }
    for (let s = from; s < to; s++) {
      const pick = rng() * totalArea;
      let lo = 0;
      let hi = triangleCount - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (cumulative[mid] < pick) lo = mid + 1;
        else hi = mid;
      }
      const ia = triangles[lo * 3];
      const ib = triangles[lo * 3 + 1];
      const ic = triangles[lo * 3 + 2];
      const a = ia * 3;
      const b = ib * 3;
      const c = ic * 3;
      const r1 = Math.sqrt(rng());
      const r2 = rng();
      const wa = 1 - r1;
      const wb = r1 * (1 - r2);
      const wc = r1 * r2;
      writePoint(
        s,
        vertices[a] * wa + vertices[b] * wb + vertices[c] * wc,
        vertices[a + 1] * wa + vertices[b + 1] * wb + vertices[c + 1] * wc,
        vertices[a + 2] * wa + vertices[b + 2] * wb + vertices[c + 2] * wc,
      );
      writeNormal(
        s,
        vertexNormals[a] * wa + vertexNormals[b] * wb + vertexNormals[c] * wc,
        vertexNormals[a + 1] * wa + vertexNormals[b + 1] * wb + vertexNormals[c + 1] * wc,
        vertexNormals[a + 2] * wa + vertexNormals[b + 2] * wb + vertexNormals[c + 2] * wc,
      );
    }
  };

  if (mode === 'surface') {
    const rng = createSeededRng(OBJ_SAMPLE_SEED);
    sampleSurfaceInto(rng, 0, sampleCount);
    return { points, normals, requestedMode: mode, effectiveMode: 'surface', fellBack: false, toppedUp: false, closed: null };
  }

  // mode === 'volume'
  const closed = isObjClosedMesh(geometry);
  if (!closed) {
    const rng = createSeededRng(OBJ_SAMPLE_SEED);
    sampleSurfaceInto(rng, 0, sampleCount);
    return { points, normals, requestedMode: mode, effectiveMode: 'surface', fellBack: true, toppedUp: false, closed: false };
  }

  // Face normals + centroids (source space) for the volume normals.
  const faceNormals = new Float32Array(triangleCount * 3);
  const centroids = new Float32Array(triangleCount * 3);
  for (let t = 0; t < triangleCount; t++) {
    const [nx, ny, nz] = objFaceNormal(vertices, triangles, t);
    faceNormals[t * 3] = nx;
    faceNormals[t * 3 + 1] = ny;
    faceNormals[t * 3 + 2] = nz;
    const a = triangles[t * 3] * 3;
    const b = triangles[t * 3 + 1] * 3;
    const c = triangles[t * 3 + 2] * 3;
    centroids[t * 3] = (vertices[a] + vertices[b] + vertices[c]) / 3;
    centroids[t * 3 + 1] = (vertices[a + 1] + vertices[b + 1] + vertices[c + 1]) / 3;
    centroids[t * 3 + 2] = (vertices[a + 2] + vertices[b + 2] + vertices[c + 2]) / 3;
  }
  // Ray-parity inside test (Möller–Trumbore crossings along a fixed,
  // slightly irrational direction so edge/vertex hits stay rare).
  const dirX = 1;
  const dirY = 0.173;
  const dirZ = 0.089;
  const isInside = (px: number, py: number, pz: number): boolean => {
    let crossings = 0;
    for (let t = 0; t < triangleCount; t++) {
      const a = triangles[t * 3] * 3;
      const b = triangles[t * 3 + 1] * 3;
      const c = triangles[t * 3 + 2] * 3;
      const e1x = vertices[b] - vertices[a];
      const e1y = vertices[b + 1] - vertices[a + 1];
      const e1z = vertices[b + 2] - vertices[a + 2];
      const e2x = vertices[c] - vertices[a];
      const e2y = vertices[c + 1] - vertices[a + 1];
      const e2z = vertices[c + 2] - vertices[a + 2];
      const pvx = dirY * e2z - dirZ * e2y;
      const pvy = dirZ * e2x - dirX * e2z;
      const pvz = dirX * e2y - dirY * e2x;
      const det = e1x * pvx + e1y * pvy + e1z * pvz;
      if (Math.abs(det) < 1e-12) continue;
      const invDet = 1 / det;
      const tx = px - vertices[a];
      const ty = py - vertices[a + 1];
      const tz = pz - vertices[a + 2];
      const u = (tx * pvx + ty * pvy + tz * pvz) * invDet;
      if (u < 0 || u > 1) continue;
      const qx = ty * e1z - tz * e1y;
      const qy = tz * e1x - tx * e1z;
      const qz = tx * e1y - ty * e1x;
      const v = (dirX * qx + dirY * qy + dirZ * qz) * invDet;
      if (v < 0 || u + v > 1) continue;
      const hitT = (e2x * qx + e2y * qy + e2z * qz) * invDet;
      if (hitT > 1e-9) crossings++;
    }
    return crossings % 2 === 1;
  };

  const rng = createSeededRng(OBJ_SAMPLE_SEED);
  const spanX = norm.maxX - norm.minX;
  const spanY = norm.maxY - norm.minY;
  const spanZ = norm.maxZ - norm.minZ;
  const maxAttempts = sampleCount * 60;
  let placed = 0;
  let attempts = 0;
  while (placed < sampleCount && attempts < maxAttempts) {
    attempts++;
    const px = norm.minX + rng() * spanX;
    const py = norm.minY + rng() * spanY;
    const pz = norm.minZ + rng() * spanZ;
    if (!isInside(px, py, pz)) continue;
    writePoint(placed, px, py, pz);
    // Normal: the face normal of the nearest triangle centroid.
    let best = Infinity;
    let bestT = 0;
    for (let t = 0; t < triangleCount; t++) {
      const dx = centroids[t * 3] - px;
      const dy = centroids[t * 3 + 1] - py;
      const dz = centroids[t * 3 + 2] - pz;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < best) {
        best = d2;
        bestT = t;
      }
    }
    writeNormal(placed, faceNormals[bestT * 3], faceNormals[bestT * 3 + 1], faceNormals[bestT * 3 + 2]);
    placed++;
  }
  let toppedUp = false;
  if (placed < sampleCount) {
    toppedUp = true;
    sampleSurfaceInto(rng, placed, sampleCount);
  }
  return { points, normals, requestedMode: mode, effectiveMode: 'volume', fellBack: false, toppedUp, closed: true };
}
