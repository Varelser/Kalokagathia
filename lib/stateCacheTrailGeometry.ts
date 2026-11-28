import {
  stateCacheExportAllowed,
  STATE_CACHE_FORMAT,
  STATE_CACHE_VERSION,
  type StateCacheData,
} from './gpgpuStateCache';

/**
 * Trail geometry (Grammar 2.0 stage 3, slice S7): turn a
 * state cache (lib/gpgpuStateCache.ts, the canonical frame
 * sequence) into TRAIL TUBE geometry — one OBJ / STL
 * document per particle, holding the tube swept along
 * that particle's whole trajectory, delivered as one ZIP.
 * Design: kalokagathia-pro/STAGE3_DESIGN.md §2 S7.
 *
 * WHERE THE TRAJECTORIES COME FROM (inventory finding —
 * the design premise needs one correction): the design
 * says "from the trail history (the drawing side's Trail
 * / Ribbon history)", but in the actual code NONE of the
 * drawing-side histories exists as obtainable data:
 *   - The GPU Trail / Ribbon / Tube modes keep their
 *     history in a ring of WebGL render targets (trailRTs
 *     in the GPGPU runtime, blitted from the position
 *     texture every frame) that shader materials sample
 *     directly. There is no CPU readback of that ring —
 *     the only readbacks in the codebase are of the
 *     CURRENT position texture — and stage 3 does not
 *     build new readback routes (design judgment 2).
 *   - The Smooth Tube mode keeps a CPU ring buffer, but
 *     it is a React ref local to
 *     components/sceneGpgpuSmoothTube.tsx (at most 256
 *     particles x 32 frames), rebuilt in place into
 *     display geometry every frame and never exposed.
 *   - The light trail (lib/lightTrail.ts) is one light
 *     object's path, not particle data.
 * So — exactly as S6 rebuilt the density field from the
 * cache — the trajectories are RECONSTRUCTED from the
 * canonical cache: particle index i is a texel identity,
 * stable across the whole frame sequence, so particle
 * i's trajectory is positions[f][i] over all frames f.
 * The drawing trails are not touched, not read, and not
 * changed (the design's "the drawing mode's behaviour
 * does not change" holds trivially: this module only
 * reads the cache).
 *
 * GEOMETRY CHOICE: a tube (circular cross-section swept
 * along the trajectory), not a ribbon. Exported data has
 * no camera, and a ribbon needs a reference direction to
 * face — with a fixed reference the ribbon's plane twists
 * arbitrarily on a general 3D path, while a tube is
 * view-independent and is the shape the codebase's own
 * tube trails draw. The sweep uses PARALLEL-TRANSPORT
 * frames: the initial normal is the coordinate axis least
 * aligned with the first tangent, and each next normal is
 * the previous one rotated by the rotation that takes the
 * previous tangent to the next (Rodrigues) and
 * re-orthogonalised afterwards. Parallel transport has no
 * twist of its
 * own and no preferred up direction, so a vertical tangent
 * needs no special case (the display Smooth Tube's fixed
 * -up frame flips there; this data path does not inherit
 * that). A near-exact fold-back (consecutive tangents
 * pointing opposite ways, where the rotation axis is
 * undefined) keeps the previous normal, re-orthogonalised
 * against the new tangent. The tube is open at both ends
 * (no caps), like the drawing tubes.
 *
 * DEGENERATE INPUT, stated rather than hidden: points
 * closer than TRAIL_MIN_SEGMENT to the last kept point
 * are collapsed (a resting particle contributes one
 * station, not a stack of zero-length segments); a
 * non-finite sample BREAKS the trajectory — the tube is
 * built per maximal finite run and the break is counted,
 * never interpolated over. A run with fewer than two kept
 * points yields no tube. Every count (input / collapsed /
 * non-finite / runs / stations) is reported in the build
 * stats and in the series result.
 *
 * PARAMETERS (the design holds the geometry parameters
 * in keys): the four stateCacheTrail* config keys
 * (radius / radial segments / particle limit / frame
 * limit), bridged by resolveStateCacheTrailFromConfig.
 * Unlike S6, nothing is bridged from display keys: the
 * drawing tubes' radii (gpgpuTubeRadius /
 * gpgpuSmoothTubeRadius) are draw parameters of the GPU /
 * component paths, not a definition this data path
 * shares, so the export owns its radius key and stays
 * independent of display state. All four keys only feed
 * this export action; nothing else reads them, so an
 * untouched configuration is bit-identical.
 *
 * LIMITS: a cache with more particles than the key's
 * limit is REFUSED with the reason (the cache discipline:
 * never silently pick a subset of particles). The frame
 * limit is different by nature — a trail IS a recent
 * history — so when the cache is longer than the limit,
 * the MOST RECENT frames (the trailing window) are used
 * and the window is stated in the result (framesTotal /
 * framesUsed / windowStartIndex) and in the panel text;
 * nothing is dropped silently. A workload cap on the
 * estimated ring-vertex count refuses combinations whose
 * output would be unreasonable to build in memory.
 *
 * Edition gate: export is a full-edition feature (杉
 * decision, STAGE3_DESIGN §4.5-3), enforced in the ZIP
 * entry point with the same predicate as the other
 * state-cache exports.
 */

export type TrailGeometryFormat = 'obj' | 'stl';

export const TRAIL_GEOMETRY_ZIP_FILE_NAME = 'monosphere-trail-geometry.zip';
export const TRAIL_MIN_RADIAL_SEGMENTS = 3;
export const TRAIL_MAX_RADIAL_SEGMENTS = 32;
/** Consecutive trajectory points closer than this (world
 *  units) collapse into one station. */
export const TRAIL_MIN_SEGMENT = 1e-6;
/** Safety cap on the estimated total ring vertices
 *  (particles x window frames x radial segments). */
export const TRAIL_MAX_RING_VERTICES = 4_000_000;

export interface TrailGeometryParams {
  /** Tube radius, in world units. */
  radius: number;
  /** Vertices per cross-section ring (integer, 3..32). */
  radialSegments: number;
  /** Refuse a cache with more particles than this. */
  maxParticles: number;
  /** Use at most this many of the most recent frames. */
  maxFrames: number;
}

export interface TrailMesh {
  /** Vertex positions, 3 per vertex, world units. */
  vertices: Float32Array;
  /** Triangle corner indices into `vertices`, 3 per face,
   *  wound counter-clockwise seen from outside. */
  faces: Uint32Array;
}

export interface TubeBuildStats {
  /** Points in the input trajectory. */
  inputPoints: number;
  /** Non-finite points (each one breaks the trajectory). */
  nonFinitePoints: number;
  /** Finite points collapsed as near-duplicates. */
  collapsedPoints: number;
  /** Tube runs built (maximal finite runs with >= 2 kept
   *  points). */
  runs: number;
  /** Ring stations emitted, summed over runs. */
  stations: number;
}

export interface TrailGeometryConfigLike {
  stateCacheTrailRadius: number;
  stateCacheTrailRadialSegments: number;
  stateCacheTrailMaxParticles: number;
  stateCacheTrailMaxFrames: number;
}

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

/**
 * Validate a parameter set on its own (no cache involved).
 * Shared by the config bridge and the series builder so a
 * parameter set is judged the same way at both points.
 */
export function validateTrailParams(
  params: TrailGeometryParams,
): { ok: true } | { ok: false; error: string } {
  const { radius, radialSegments, maxParticles, maxFrames } = params;
  if (!Number.isFinite(radius) || radius <= 0) {
    return fail(`チューブ半径（${String(radius)}）が正の有限値ではないため、トレイルジオメトリを生成できません。`);
  }
  if (
    !Number.isInteger(radialSegments)
    || radialSegments < TRAIL_MIN_RADIAL_SEGMENTS
    || radialSegments > TRAIL_MAX_RADIAL_SEGMENTS
  ) {
    return fail(
      `断面の分割数（${String(radialSegments)}）が対応範囲（${TRAIL_MIN_RADIAL_SEGMENTS}〜${TRAIL_MAX_RADIAL_SEGMENTS} の整数）外のため、トレイルジオメトリを生成できません。`,
    );
  }
  if (!Number.isInteger(maxParticles) || maxParticles < 1) {
    return fail(`粒子数上限（${String(maxParticles)}）が 1 以上の整数ではないため、トレイルジオメトリを生成できません。`);
  }
  if (!Number.isInteger(maxFrames) || maxFrames < 2) {
    return fail(`履歴フレーム上限（${String(maxFrames)}）が 2 以上の整数ではないため、トレイルジオメトリを生成できません（軌跡には最低2フレームが必要です）。`);
  }
  return { ok: true };
}

/** Ring vertices the series build would emit at most, at
 *  the given cache shape — the workload the safety cap in
 *  validateCacheForTrailGeometry judges. */
export function estimateTrailRingVertices(
  count: number,
  frameCount: number,
  params: TrailGeometryParams,
): number {
  return count * Math.min(frameCount, params.maxFrames) * params.radialSegments;
}

/**
 * Bridge the config keys into a parameter set: the four
 * stateCacheTrail* keys, nothing else (see the header for
 * why no display key is bridged). An invalid set resolves
 * to a refusal with the reason; the export then does not
 * run.
 */
export function resolveStateCacheTrailFromConfig(
  config: TrailGeometryConfigLike,
): { ok: true; params: TrailGeometryParams } | { ok: false; error: string } {
  const params: TrailGeometryParams = {
    radius: config.stateCacheTrailRadius,
    radialSegments: config.stateCacheTrailRadialSegments,
    maxParticles: config.stateCacheTrailMaxParticles,
    maxFrames: config.stateCacheTrailMaxFrames,
  };
  const valid = validateTrailParams(params);
  if (!valid.ok) return valid;
  return { ok: true, params };
}

/* ---------------- trajectory ---------------- */

/**
 * Extract one particle's trajectory from a cache over
 * the frame range [frameStart, frameEnd): the particle's
 * position in each frame, in frame order, as xyz
 * triplets. Raw — non-finite samples are carried through
 * and judged by the tube builder, not repaired here.
 */
export function extractTrajectory(
  cache: StateCacheData,
  particleIndex: number,
  frameStart = 0,
  frameEnd = cache.manifest.frameCount,
): Float32Array {
  const out = new Float32Array(Math.max(0, frameEnd - frameStart) * 3);
  for (let f = frameStart; f < frameEnd; f++) {
    const pos = cache.positions[f];
    const o = (f - frameStart) * 3;
    out[o] = pos[particleIndex * 3];
    out[o + 1] = pos[particleIndex * 3 + 1];
    out[o + 2] = pos[particleIndex * 3 + 2];
  }
  return out;
}

/* ---------------- tube builder (pure geometry) ---------------- */

type Vec3 = [number, number, number];

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
const normalize = (a: Vec3): Vec3 | null => {
  const n = norm(a);
  if (!Number.isFinite(n) || n === 0) return null;
  return [a[0] / n, a[1] / n, a[2] / n];
};

/** The coordinate axis least aligned with `t` (ties break
 *  in x, y, z order — deterministic). */
function leastAlignedAxis(t: Vec3): Vec3 {
  const axes: Vec3[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  let best = axes[0];
  let bestDot = Math.abs(dot(t, best));
  for (let i = 1; i < 3; i++) {
    const d = Math.abs(dot(t, axes[i]));
    if (d < bestDot) {
      best = axes[i];
      bestDot = d;
    }
  }
  return best;
}

/** A unit vector perpendicular to unit vector `t`: the
 *  least-aligned axis with its `t` component removed. */
function anyPerpendicular(t: Vec3): Vec3 {
  const axis = leastAlignedAxis(t);
  const d = dot(axis, t);
  return normalize([axis[0] - d * t[0], axis[1] - d * t[1], axis[2] - d * t[2]]) ?? [0, 0, 0];
}

/**
 * Rotate `v` by the rotation that takes unit vector
 * `from` to unit vector `to` (Rodrigues' formula). For a
 * near-exact fold-back the rotation axis is undefined;
 * the caller handles that case before calling this.
 */
function rotateFromTo(v: Vec3, from: Vec3, to: Vec3): Vec3 {
  const axis = cross(from, to);
  const s = norm(axis);
  const c = Math.min(1, Math.max(-1, dot(from, to)));
  if (s < 1e-12) return v; // parallel: no rotation
  const k: Vec3 = [axis[0] / s, axis[1] / s, axis[2] / s];
  const kv = cross(k, v);
  const kkv = cross(k, kv);
  // Rodrigues: v_rot = v + (k x v) * sin + (k x (k x v)) * (1 - cos),
  // with sin = |from x to| = s and cos = from . to = c here.
  const oneMinusC = 1 - c;
  return [
    v[0] + kv[0] * s + kkv[0] * oneMinusC,
    v[1] + kv[1] * s + kkv[1] * oneMinusC,
    v[2] + kv[2] * s + kkv[2] * oneMinusC,
  ];
}

/**
 * Build the tube swept along one trajectory. Pure: the
 * same points and parameters always produce the same
 * mesh. See the header for the frame construction and
 * the degenerate-input rules.
 */
export function buildTubeFromTrajectory(
  points: ArrayLike<number>,
  pointCount: number,
  radius: number,
  radialSegments: number,
): { mesh: TrailMesh; stats: TubeBuildStats } {
  const stats: TubeBuildStats = {
    inputPoints: pointCount,
    nonFinitePoints: 0,
    collapsedPoints: 0,
    runs: 0,
    stations: 0,
  };
  const vertexList: number[] = [];
  const faceList: number[] = [];

  const emitRun = (run: Vec3[]) => {
    // Collapse near-duplicate consecutive points.
    const kept: Vec3[] = [];
    for (const p of run) {
      const last = kept[kept.length - 1];
      if (last && norm(sub(p, last)) < TRAIL_MIN_SEGMENT) {
        stats.collapsedPoints++;
        continue;
      }
      kept.push(p);
    }
    if (kept.length < 2) return;
    stats.runs++;
    const m = kept.length;

    // Tangents: central differences, one-sided at the
    // ends. An interior tangent can still vanish on an
    // exact fold-back (p[i+1] == p[i-1]); fall back to
    // the outgoing, then the incoming, segment direction.
    const tangents: Vec3[] = [];
    for (let i = 0; i < m; i++) {
      let t: Vec3 | null = null;
      if (i === 0) t = normalize(sub(kept[1], kept[0]));
      else if (i === m - 1) t = normalize(sub(kept[m - 1], kept[m - 2]));
      else {
        t = normalize(sub(kept[i + 1], kept[i - 1]))
          ?? normalize(sub(kept[i + 1], kept[i]))
          ?? normalize(sub(kept[i], kept[i - 1]));
      }
      // kept points are pairwise distinct along the run,
      // so at least one difference above is non-zero.
      tangents.push(t ?? [1, 0, 0]);
    }

    // Parallel-transport frames.
    const baseVertex = vertexList.length / 3;
    let normal = anyPerpendicular(tangents[0]);
    for (let i = 0; i < m; i++) {
      const t = tangents[i];
      if (i > 0) {
        const prev = tangents[i - 1];
        const d = dot(prev, t);
        if (d < -1 + 1e-9) {
          // Near-exact fold-back: the rotation axis is
          // undefined, so keep the previous normal and
          // re-orthogonalise it against the new tangent.
          const nd = dot(normal, t);
          normal = normalize([normal[0] - nd * t[0], normal[1] - nd * t[1], normal[2] - nd * t[2]])
            ?? anyPerpendicular(t);
        } else {
          const rotated = rotateFromTo(normal, prev, t);
          const rd = dot(rotated, t);
          normal = normalize([rotated[0] - rd * t[0], rotated[1] - rd * t[1], rotated[2] - rd * t[2]])
            ?? anyPerpendicular(t);
        }
      }
      const binormal = cross(t, normal);
      const c = kept[i];
      for (let s = 0; s < radialSegments; s++) {
        const theta = (2 * Math.PI * s) / radialSegments;
        const co = Math.cos(theta) * radius;
        const si = Math.sin(theta) * radius;
        vertexList.push(
          c[0] + co * normal[0] + si * binormal[0],
          c[1] + co * normal[1] + si * binormal[1],
          c[2] + co * normal[2] + si * binormal[2],
        );
      }
      stats.stations++;
      if (i > 0) {
        const a0 = baseVertex + (i - 1) * radialSegments;
        const b0 = baseVertex + i * radialSegments;
        for (let s = 0; s < radialSegments; s++) {
          const s1 = (s + 1) % radialSegments;
          const a = a0 + s;
          const b = a0 + s1;
          const cc = b0 + s;
          const dd = b0 + s1;
          // Wound so the face normal points away from the
          // centreline (verified against a straight tube
          // by the S7 test).
          faceList.push(a, b, cc, b, dd, cc);
        }
      }
    }
  };

  // Split into maximal finite runs; a non-finite sample
  // breaks the trajectory (counted, never bridged).
  let run: Vec3[] = [];
  const flush = () => {
    if (run.length > 0) emitRun(run);
    run = [];
  };
  for (let i = 0; i < pointCount; i++) {
    const x = points[i * 3] ?? Number.NaN;
    const y = points[i * 3 + 1] ?? Number.NaN;
    const z = points[i * 3 + 2] ?? Number.NaN;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      stats.nonFinitePoints++;
      flush();
      continue;
    }
    run.push([x, y, z]);
  }
  flush();

  return {
    mesh: {
      vertices: new Float32Array(vertexList),
      faces: new Uint32Array(faceList),
    },
    stats,
  };
}

/* ---------------- mesh documents (S5/S6's shape) ---------------- */

/**
 * Build a Wavefront OBJ document from an indexed triangle
 * mesh — the same document shape as lib/meshExport.ts and
 * lib/stateCacheSkinning.ts produce (comment header, `v`
 * lines, 1-based `f` lines), for trail tube topology.
 */
export function buildObjFromTrailMesh(mesh: TrailMesh): string {
  const vertexCount = mesh.vertices.length / 3;
  const faceCount = mesh.faces.length / 3;
  const lines: string[] = [
    '# Monosphere GPGPU particle trail (tube geometry)',
    `# ${vertexCount} vertices, ${faceCount} faces`,
  ];
  for (let i = 0; i < vertexCount; i++) {
    lines.push(`v ${mesh.vertices[i * 3]} ${mesh.vertices[i * 3 + 1]} ${mesh.vertices[i * 3 + 2]}`);
  }
  for (let f = 0; f < faceCount; f++) {
    lines.push(`f ${mesh.faces[f * 3] + 1} ${mesh.faces[f * 3 + 1] + 1} ${mesh.faces[f * 3 + 2] + 1}`);
  }
  lines.push('');
  return lines.join('\n');
}

/**
 * Build an ASCII STL document from an indexed triangle
 * mesh, with a computed (normalised) normal per facet —
 * the same facet format as lib/meshExport.ts's STL.
 * Zero-area facets are skipped, as there.
 */
export function buildStlFromTrailMesh(
  mesh: TrailMesh,
  solidName = 'monosphere-particle-trail',
): string {
  const lines: string[] = [`solid ${solidName}`];
  const v = mesh.vertices;
  for (let f = 0; f < mesh.faces.length / 3; f++) {
    const [a, b, c] = [mesh.faces[f * 3], mesh.faces[f * 3 + 1], mesh.faces[f * 3 + 2]];
    const ux = v[b * 3] - v[a * 3];
    const uy = v[b * 3 + 1] - v[a * 3 + 1];
    const uz = v[b * 3 + 2] - v[a * 3 + 2];
    const wx = v[c * 3] - v[a * 3];
    const wy = v[c * 3 + 1] - v[a * 3 + 1];
    const wz = v[c * 3 + 2] - v[a * 3 + 2];
    let nx = uy * wz - uz * wy;
    let ny = uz * wx - ux * wz;
    let nz = ux * wy - uy * wx;
    const length = Math.hypot(nx, ny, nz);
    if (!Number.isFinite(length) || length === 0) continue;
    nx /= length;
    ny /= length;
    nz /= length;
    lines.push(`  facet normal ${nx} ${ny} ${nz}`);
    lines.push('    outer loop');
    for (const idx of [a, b, c]) {
      lines.push(`      vertex ${v[idx * 3]} ${v[idx * 3 + 1]} ${v[idx * 3 + 2]}`);
    }
    lines.push('    endloop');
    lines.push('  endfacet');
  }
  lines.push(`endsolid ${solidName}`);
  return lines.join('\n') + '\n';
}

/* ---------------- cache-level series ---------------- */

export interface StateCacheTrailFrameWindow {
  /** Frames in the cache. */
  framesTotal: number;
  /** Frames actually used (the trailing window). */
  framesUsed: number;
  /** First frame index of the window. */
  windowStartIndex: number;
  /** Absolute frame number of the window's first frame. */
  windowStartFrame: number;
}

export interface StateCacheTrailFile {
  particleIndex: number;
  fileName: string;
  contents: string;
  vertices: number;
  faces: number;
  stats: TubeBuildStats;
}

export type StateCacheTrailSeriesResult =
  | {
      ok: true;
      format: TrailGeometryFormat;
      files: StateCacheTrailFile[];
      window: StateCacheTrailFrameWindow;
    }
  | { ok: false; error: string };

export type StateCacheTrailZipResult =
  | {
      ok: true;
      fileName: string;
      buffer: ArrayBuffer;
      format: TrailGeometryFormat;
      fileCount: number;
      totalVertices: number;
      totalFaces: number;
      window: StateCacheTrailFrameWindow;
    }
  | { ok: false; error: string };

/** File name for one particle's trail document — the
 *  particle index, zero-padded (the mesh series'
 *  per-unit naming convention, applied to particles). */
export function trailFileNameForParticle(particleIndex: number, format: TrailGeometryFormat): string {
  return `monosphere-trail-${String(particleIndex).padStart(4, '0')}.${format}`;
}

/** The trailing window the frame limit selects. */
export function trailFrameWindow(cache: StateCacheData, params: TrailGeometryParams): StateCacheTrailFrameWindow {
  const framesTotal = cache.manifest.frameCount;
  const framesUsed = Math.min(framesTotal, params.maxFrames);
  const windowStartIndex = framesTotal - framesUsed;
  return {
    framesTotal,
    framesUsed,
    windowStartIndex,
    windowStartFrame: cache.manifest.startFrame + windowStartIndex,
  };
}

/**
 * Check that a cache and a parameter set can produce a
 * trail geometry series at all. Stated at the point of
 * use (the held cache is a live object), in the cache
 * discipline: refuse with the reason, never rearrange.
 */
export function validateCacheForTrailGeometry(
  cache: StateCacheData,
  params: TrailGeometryParams,
): { ok: true } | { ok: false; error: string } {
  const valid = validateTrailParams(params);
  if (!valid.ok) return valid;
  const { manifest } = cache;
  if (!manifest || typeof manifest !== 'object') return fail('マニフェストがありません。');
  if (manifest.format !== STATE_CACHE_FORMAT || manifest.version !== STATE_CACHE_VERSION) {
    return fail(
      `正本形式（${STATE_CACHE_FORMAT} v${STATE_CACHE_VERSION}）ではないため、トレイルジオメトリへ変換できません（format="${String(manifest.format)}"、version=${String(manifest.version)}）。`,
    );
  }
  if (!Number.isInteger(manifest.frameCount) || manifest.frameCount < 2) {
    return fail(
      `キャッシュのフレーム数（${String(manifest.frameCount)}）が 2 未満のため、軌跡を取り出せません（トレイルには最低2フレームの履歴が必要です）。`,
    );
  }
  if (cache.positions.length !== manifest.frameCount) {
    return fail(
      `フレーム列の長さ（${cache.positions.length}）がマニフェストの frameCount（${manifest.frameCount}）と一致しないため、トレイルジオメトリへ変換できません。`,
    );
  }
  if (!Number.isInteger(manifest.count) || manifest.count < 1) {
    return fail('キャッシュに粒子がありません。');
  }
  if (manifest.count > params.maxParticles) {
    return fail(
      `キャッシュの粒子数（${manifest.count.toLocaleString()} 点）がトレイル書き出しの上限（${params.maxParticles.toLocaleString()} 点）を超えるため、変換できません。粒子の一部だけを選んで書き出すことはしません。上限は設定キー stateCacheTrailMaxParticles で指定します。`,
    );
  }
  for (let f = 0; f < manifest.frameCount; f++) {
    const pos = cache.positions[f];
    if (!pos || pos.length !== manifest.count * 3) {
      return fail(
        `フレーム ${f} の位置バッファ長（${pos ? pos.length : 0}）が粒子数×3（${manifest.count * 3}）と一致しないため、トレイルジオメトリへ変換できません。`,
      );
    }
  }
  const estimate = estimateTrailRingVertices(manifest.count, manifest.frameCount, params);
  if (estimate > TRAIL_MAX_RING_VERTICES) {
    return fail(
      `トレイルジオメトリの推定頂点数（約 ${estimate.toLocaleString()} 頂点＝粒子数×使用フレーム数×断面分割数）が安全上限（${TRAIL_MAX_RING_VERTICES.toLocaleString()}）を超えるため、変換できません。粒子数上限・履歴フレーム上限・断面分割数のいずれかを下げてください。`,
    );
  }
  return { ok: true };
}

/** The trail tube of one particle of a cache, over the
 *  trailing window the parameters select. Assumes the
 *  cache and params passed validateCacheForTrailGeometry. */
export function buildTrailGeometryForParticle(
  cache: StateCacheData,
  particleIndex: number,
  params: TrailGeometryParams,
): { mesh: TrailMesh; stats: TubeBuildStats } {
  const window = trailFrameWindow(cache, params);
  const trajectory = extractTrajectory(
    cache,
    particleIndex,
    window.windowStartIndex,
    window.windowStartIndex + window.framesUsed,
  );
  return buildTubeFromTrajectory(trajectory, window.framesUsed, params.radius, params.radialSegments);
}

/**
 * Build one trail document per particle for a whole
 * cache. A particle whose trajectory never forms a tube
 * (resting, or broken into single points) still gets a
 * document — an empty mesh with its stats recorded — so
 * the series stays particle-aligned and nothing is
 * dropped silently.
 */
export function buildStateCacheTrailGeometrySeries(
  cache: StateCacheData,
  params: TrailGeometryParams,
  format: TrailGeometryFormat = 'obj',
): StateCacheTrailSeriesResult {
  const valid = validateCacheForTrailGeometry(cache, params);
  if (!valid.ok) return valid;
  const window = trailFrameWindow(cache, params);
  const files: StateCacheTrailFile[] = [];
  for (let p = 0; p < cache.manifest.count; p++) {
    const { mesh, stats } = buildTrailGeometryForParticle(cache, p, params);
    files.push({
      particleIndex: p,
      fileName: trailFileNameForParticle(p, format),
      contents: format === 'stl' ? buildStlFromTrailMesh(mesh) : buildObjFromTrailMesh(mesh),
      vertices: mesh.vertices.length / 3,
      faces: mesh.faces.length / 3,
      stats,
    });
  }
  return { ok: true, format, files, window };
}

/**
 * The panel's export entry point: the edition gate (see
 * header) plus the series build, packed into ONE ZIP
 * archive — the mesh series' delivery shape, for the same
 * reason (browsers throttle bursts of downloads).
 */
export async function buildStateCacheTrailGeometryZip(
  cache: StateCacheData,
  params: TrailGeometryParams,
  options?: { format?: TrailGeometryFormat; edition?: string },
): Promise<StateCacheTrailZipResult> {
  const format = options?.format ?? 'obj';
  if (!stateCacheExportAllowed(options?.edition)) {
    return fail('公開版ではトレイルジオメトリの書き出しはできません（完全版の機能です）。');
  }
  const series = buildStateCacheTrailGeometrySeries(cache, params, format);
  if (!series.ok) return series;
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  let totalVertices = 0;
  let totalFaces = 0;
  for (const file of series.files) {
    zip.file(file.fileName, file.contents);
    totalVertices += file.vertices;
    totalFaces += file.faces;
  }
  const buffer = await zip.generateAsync({ type: 'arraybuffer' });
  return {
    ok: true,
    fileName: TRAIL_GEOMETRY_ZIP_FILE_NAME,
    buffer,
    format,
    fileCount: series.files.length,
    totalVertices,
    totalFaces,
    window: series.window,
  };
}
