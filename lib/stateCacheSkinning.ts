import {
  stateCacheExportAllowed,
  STATE_CACHE_FORMAT,
  STATE_CACHE_VERSION,
  type StateCacheData,
} from './gpgpuStateCache';

/**
 * Skinning (Grammar 2.0 stage 3, slice S6): turn a state
 * cache (lib/gpgpuStateCache.ts, the canonical frame
 * sequence) into an ISOSURFACE mesh series — one OBJ / STL
 * document per frame, delivered as one ZIP. Design:
 * kalokagathia-pro/STAGE3_DESIGN.md §2 S6.
 *
 * WHERE THE DENSITY FIELD COMES FROM (inventory finding):
 * the design says "from the density field (the density
 * pass is an existing asset)", but in the actual code no
 * 3D density field exists as data:
 *   - The SPH density is a transient value inside the
 *     simulation shader; lib/gpgpuDensity.ts states it is
 *     "never stored anywhere". The `den` supply built on
 *     it is a per-particle scalar texture (one density per
 *     particle), not a 3D field.
 *   - The display metaballs are NOT a raymarch over a
 *     stored field either: components/sceneMetaballSystem
 *     .tsx feeds a three-stdlib MarchingCubes object whose
 *     field lives inside that display object and whose
 *     output is a render BufferGeometry. There is no
 *     density grid / voxel texture asset anywhere.
 * So the honest construction — the one this module takes —
 * is to REBUILD the field on the CPU from the cached
 * particle positions (a kernel splat onto a regular grid).
 * Nothing is read back from the GPU, no display code is
 * reused (design rule 7: the data path exists independently
 * of the drawing path), and the canonical cache is only
 * read, never modified.
 *
 * DENSITY DEFINITION: the splat kernel is the codebase's
 * own density kernel, lib/gpgpuDensity.ts:
 *   w = max(0, 1 - q^2),  q = dist / h,
 * with h bridged from the existing config key
 * gpgpuSphRadius (the scale the user already tunes for
 * SPH), and the field is the plain sum over ALL particles,
 * divided by gpgpuSphRestDensity:
 *   F(x) = (1 / restDensity) * sum_j w(|x - p_j| / h).
 * Deliberate differences from `den` in gpgpuDensity.ts,
 * which is a per-particle SAMPLE of a field rather than
 * the field itself: `den` evaluates over a fixed 256-point
 * subsample, skips the particle's own contribution, and
 * clamps to [0, 1]. A field definition has no subsample
 * and no self to skip (a particle contributes to the field
 * at its own location like any other), and clamping would
 * destroy the isosurface, so none of the three is applied
 * here. The kernel SHAPE and its radius/rest scale are the
 * shared part, and they are shared on purpose.
 *
 * ISOSURFACE ALGORITHM: naive surface nets. Each grid cell
 * whose eight corners straddle the iso level contributes
 * one vertex (the average of the cell's edge crossings);
 * each grid edge whose endpoints straddle the level joins
 * the vertices of the (up to four) cells sharing that edge
 * into a quad. The mesh is watertight by construction
 * wherever the surface does not touch the domain boundary
 * (a surface that reaches the boundary is clipped there —
 * the domain is finite, and that is stated, not hidden).
 * Face orientation is fixed per triangle against the
 * field gradient (outward = decreasing field), so winding
 * never depends on the quad enumeration order.
 * Why not marching cubes: its triangle table is 256 x 16
 * entries of constant data that could not be verified
 * byte-for-byte in this environment, and the only in-repo
 * implementation is the three-stdlib display object,
 * which this data path must not reuse. Surface nets needs
 * no constant tables at all, and its output is verified
 * geometrically by the S6 test (closedness, signed volume
 * and area against analytic values). The choice and this
 * reasoning are recorded in STAGE3_S6_IMPL_RECORD.md.
 *
 * PARAMETERS (design: "resolution and the particle limit
 * are specified by keys"): the three stateCacheSkinning*
 * config keys (resolution / iso level / particle limit),
 * bridged together with the existing SPH / bounds keys by
 * resolveStateCacheSkinningFromConfig below. All three
 * keys only feed this export action; nothing else reads
 * them, so an untouched configuration is bit-identical.
 *
 * REFUSALS (the cache discipline — state the reason,
 * never rearrange): a non-canonical cache, a frame buffer
 * that is not count x 3, a particle count over the key's
 * limit, a resolution outside the supported range, a
 * non-positive iso level, a kernel radius smaller than
 * the grid spacing (the field would be undersampled — a
 * particle could fall between nodes and vanish), and a
 * per-frame splat workload over the safety cap.
 *
 * Edition gate: export is a full-edition feature (杉
 * decision, STAGE3_DESIGN §4.5-3), enforced in the ZIP
 * entry point with the same predicate as the other
 * state-cache exports.
 */

export type SkinningFormat = 'obj' | 'stl';

export const SKINNING_ZIP_FILE_NAME = 'monosphere-skin-series.zip';
export const SKINNING_MIN_RESOLUTION = 8;
export const SKINNING_MAX_RESOLUTION = 96;
/** Per-frame splat safety cap, in node visits (see the
 *  workload refusal in validateSkinningParams). */
export const SKINNING_MAX_NODE_VISITS = 120_000_000;

export interface SkinningParams {
  /** Grid nodes per axis (the field has resolution^3 nodes,
   *  (resolution-1)^3 cells). */
  resolution: number;
  /** Half-size of the cubic domain, in world units: the
   *  field covers [-extent, +extent] on every axis (the
   *  same volume the display metaballs map onto). */
  extent: number;
  /** Iso level, in field units (kernel sum / restDensity). */
  isoLevel: number;
  /** Kernel support radius h, in world units. */
  kernelRadius: number;
  /** Normalisation divisor of the field (rest density). */
  restDensity: number;
  /** Refuse a cache with more particles than this. */
  maxParticles: number;
}

export interface DensityField {
  resolution: number;
  extent: number;
  /** Node spacing (world units). */
  spacing: number;
  /** resolution^3 samples, index = x + res * (y + res * z). */
  values: Float32Array;
  /** Particles that contributed to the field. */
  usedParticles: number;
  /** Particles skipped (non-finite position, or farther
   *  than the kernel radius from every domain node). */
  skippedParticles: number;
}

export interface SkinningMesh {
  /** Vertex positions, 3 per vertex, world units. */
  vertices: Float32Array;
  /** Triangle corner indices into `vertices`, 3 per face,
   *  wound counter-clockwise seen from outside. */
  faces: Uint32Array;
}

export interface SkinningConfigLike {
  stateCacheSkinningResolution: number;
  stateCacheSkinningIsoLevel: number;
  stateCacheSkinningMaxParticles: number;
  gpgpuSphRadius: number;
  gpgpuSphRestDensity: number;
  gpgpuBounceRadius: number;
}

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

/**
 * Validate a parameter set on its own (no cache involved).
 * Shared by the config bridge and the series builder so a
 * parameter set is judged the same way at both points.
 */
export function validateSkinningParams(
  params: SkinningParams,
): { ok: true } | { ok: false; error: string } {
  const { resolution, extent, isoLevel, kernelRadius, restDensity, maxParticles } = params;
  if (!Number.isInteger(resolution) || resolution < SKINNING_MIN_RESOLUTION || resolution > SKINNING_MAX_RESOLUTION) {
    return fail(
      `解像度（${String(resolution)}）が対応範囲（${SKINNING_MIN_RESOLUTION}〜${SKINNING_MAX_RESOLUTION} の整数）外のため、等値面を生成できません。`,
    );
  }
  if (!Number.isFinite(extent) || extent <= 0) {
    return fail(`対象範囲（extent=${String(extent)}）が正の有限値ではないため、等値面を生成できません。`);
  }
  if (!Number.isFinite(isoLevel) || isoLevel <= 0) {
    return fail(`等値（iso=${String(isoLevel)}）が正の有限値ではないため、等値面を生成できません。`);
  }
  if (!Number.isFinite(kernelRadius) || kernelRadius <= 0) {
    return fail(`カーネル半径（${String(kernelRadius)}）が正の有限値ではないため、密度場を組み立てられません。`);
  }
  if (!Number.isFinite(restDensity) || restDensity <= 0) {
    return fail(`rest density（${String(restDensity)}）が正の有限値ではないため、密度場を組み立てられません。`);
  }
  if (!Number.isInteger(maxParticles) || maxParticles < 1) {
    return fail(`粒子数上限（${String(maxParticles)}）が 1 以上の整数ではないため、等値面を生成できません。`);
  }
  const spacing = (2 * extent) / (resolution - 1);
  if (kernelRadius < spacing) {
    return fail(
      `カーネル半径（${kernelRadius}）がグリッド間隔（${spacing.toFixed(3)}）より小さいため、密度場が粗く標本化され粒子が節点の間に落ちて消える恐れがあります。解像度を下げるか、カーネル半径（SPH 半径）を大きくしてください。`,
    );
  }
  return { ok: true };
}

/** Node visits one frame of splatting would need, at the
 *  given particle count — the workload the safety cap in
 *  buildStateCacheSkinningSeries judges. */
export function estimateSkinningNodeVisits(count: number, params: SkinningParams): number {
  const spacing = (2 * params.extent) / (params.resolution - 1);
  const span = 2 * Math.floor(params.kernelRadius / spacing) + 1;
  return count * span * span * span;
}

/**
 * Bridge the config keys into a parameter set: the three
 * stateCacheSkinning* keys plus the existing SPH kernel
 * keys (gpgpuSphRadius / gpgpuSphRestDensity — the density
 * definition's own scale) and the bounds key
 * (gpgpuBounceRadius — the volume the display metaballs
 * already use). An invalid set resolves to a refusal with
 * the reason; the export then does not run.
 */
export function resolveStateCacheSkinningFromConfig(
  config: SkinningConfigLike,
): { ok: true; params: SkinningParams } | { ok: false; error: string } {
  const params: SkinningParams = {
    resolution: config.stateCacheSkinningResolution,
    extent: config.gpgpuBounceRadius,
    isoLevel: config.stateCacheSkinningIsoLevel,
    kernelRadius: config.gpgpuSphRadius,
    restDensity: config.gpgpuSphRestDensity,
    maxParticles: config.stateCacheSkinningMaxParticles,
  };
  const valid = validateSkinningParams(params);
  if (!valid.ok) return valid;
  return { ok: true, params };
}

/**
 * Build the density field of one frame by splatting the
 * SPH kernel (see the header for the definition) onto a
 * regular grid. Pure: positions in (count x 3 triplets),
 * field out. Non-finite positions never contribute.
 */
export function buildDensityField(
  positions: ArrayLike<number>,
  count: number,
  params: SkinningParams,
): DensityField {
  const res = params.resolution;
  const extent = params.extent;
  const spacing = (2 * extent) / (res - 1);
  const values = new Float32Array(res * res * res);
  const h = params.kernelRadius;
  const h2 = h * h;
  const invRest = 1 / params.restDensity;
  const reach = extent + h; // particles this far out can still touch a node
  let usedParticles = 0;
  let skippedParticles = 0;
  for (let p = 0; p < count; p++) {
    const px = positions[p * 3] ?? 0;
    const py = positions[p * 3 + 1] ?? 0;
    const pz = positions[p * 3 + 2] ?? 0;
    if (!Number.isFinite(px) || !Number.isFinite(py) || !Number.isFinite(pz)) {
      skippedParticles++;
      continue;
    }
    if (Math.abs(px) > reach || Math.abs(py) > reach || Math.abs(pz) > reach) {
      skippedParticles++;
      continue;
    }
    // Node index range within the kernel support, per axis.
    const axisRange = (c: number): [number, number] => {
      const lo = Math.max(0, Math.ceil((c - h + extent) / spacing));
      const hi = Math.min(res - 1, Math.floor((c + h + extent) / spacing));
      return [lo, hi];
    };
    const [x0, x1] = axisRange(px);
    const [y0, y1] = axisRange(py);
    const [z0, z1] = axisRange(pz);
    let contributed = false;
    for (let z = z0; z <= z1; z++) {
      const wz = -extent + z * spacing;
      const dz = wz - pz;
      for (let y = y0; y <= y1; y++) {
        const wy = -extent + y * spacing;
        const dy = wy - py;
        let idx = x0 + res * (y + res * z);
        for (let x = x0; x <= x1; x++, idx++) {
          const wx = -extent + x * spacing;
          const dx = wx - px;
          const r2 = dx * dx + dy * dy + dz * dz;
          if (r2 < h2) {
            values[idx] += (1 - r2 / h2) * invRest;
            contributed = true;
          }
        }
      }
    }
    if (contributed) usedParticles++;
    else skippedParticles++;
  }
  return { resolution: res, extent, spacing, values, usedParticles, skippedParticles };
}

/**
 * Extract the isosurface of a density field at `isoLevel`
 * by naive surface nets (see the header). Pure: the same
 * field and level always produce the same mesh.
 */
export function extractIsosurface(field: DensityField, isoLevel: number): SkinningMesh {
  const res = field.resolution;
  const { values, spacing, extent } = field;
  const cells = res - 1;
  const nodeAt = (x: number, y: number, z: number) => values[x + res * (y + res * z)];
  const inside = (v: number) => v >= isoLevel;

  // One vertex per straddling cell, at the average of the
  // cell's edge crossings. cellVertex maps cell index ->
  // vertex index (or -1).
  const cellVertex = new Int32Array(cells * cells * cells).fill(-1);
  const vertexList: number[] = [];
  // Corner offsets of a cell, and its 12 edges as corner pairs.
  const CORNERS: [number, number, number][] = [
    [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
    [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
  ];
  const EDGES: [number, number][] = [
    [0, 1], [1, 2], [2, 3], [3, 0],
    [4, 5], [5, 6], [6, 7], [7, 4],
    [0, 4], [1, 5], [2, 6], [3, 7],
  ];
  for (let z = 0; z < cells; z++) {
    for (let y = 0; y < cells; y++) {
      for (let x = 0; x < cells; x++) {
        let mask = 0;
        const cornerValues = new Array<number>(8);
        for (let c = 0; c < 8; c++) {
          const v = nodeAt(x + CORNERS[c][0], y + CORNERS[c][1], z + CORNERS[c][2]);
          cornerValues[c] = v;
          if (inside(v)) mask |= 1 << c;
        }
        if (mask === 0 || mask === 0xff) continue;
        let sx = 0;
        let sy = 0;
        let sz = 0;
        let n = 0;
        for (const [a, b] of EDGES) {
          const va = cornerValues[a];
          const vb = cornerValues[b];
          if (inside(va) === inside(vb)) continue;
          const t = (isoLevel - va) / (vb - va);
          sx += x + CORNERS[a][0] + (CORNERS[b][0] - CORNERS[a][0]) * t;
          sy += y + CORNERS[a][1] + (CORNERS[b][1] - CORNERS[a][1]) * t;
          sz += z + CORNERS[a][2] + (CORNERS[b][2] - CORNERS[a][2]) * t;
          n++;
        }
        if (n === 0) continue;
        cellVertex[x + cells * (y + cells * z)] = vertexList.length / 3;
        vertexList.push(
          -extent + (sx / n) * spacing,
          -extent + (sy / n) * spacing,
          -extent + (sz / n) * spacing,
        );
      }
    }
  }

  // One quad per sign-changing grid edge, joining the
  // vertices of the cells that share the edge. Cells are
  // listed cyclically around the edge; the per-triangle
  // gradient fix below makes the winding outward
  // regardless of the enumeration order.
  const faceList: number[] = [];
  // Raw cell-array index, or -1 outside the cell lattice
  // (the quad builder treats -1 as "no cell on this side").
  const cellIndexOf = (x: number, y: number, z: number) =>
    x < 0 || y < 0 || z < 0 || x >= cells || y >= cells || z >= cells
      ? -1
      : x + cells * (y + cells * z);
  // Field gradient at a world point (central differences
  // on the node lattice, clamped) — used only to orient
  // faces outward (outward = decreasing field).
  const gradientAt = (wx: number, wy: number, wz: number): [number, number, number] => {
    const gx = Math.min(res - 2, Math.max(0, Math.round((wx + extent) / spacing - 0.5)));
    const gy = Math.min(res - 2, Math.max(0, Math.round((wy + extent) / spacing - 0.5)));
    const gz = Math.min(res - 2, Math.max(0, Math.round((wz + extent) / spacing - 0.5)));
    return [
      nodeAt(gx + 1, gy, gz) - nodeAt(gx, gy, gz),
      nodeAt(gx, gy + 1, gz) - nodeAt(gx, gy, gz),
      nodeAt(gx, gy, gz + 1) - nodeAt(gx, gy, gz),
    ];
  };
  const pushTriangle = (a: number, b: number, c: number) => {
    const ax = vertexList[a * 3];
    const ay = vertexList[a * 3 + 1];
    const az = vertexList[a * 3 + 2];
    const bx = vertexList[b * 3];
    const by = vertexList[b * 3 + 1];
    const bz = vertexList[b * 3 + 2];
    const cx = vertexList[c * 3];
    const cy = vertexList[c * 3 + 1];
    const cz = vertexList[c * 3 + 2];
    const ux = bx - ax;
    const uy = by - ay;
    const uz = bz - az;
    const vx = cx - ax;
    const vy = cy - ay;
    const vz = cz - az;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    // A zero-area triangle (two cell vertices coincide on
    // highly symmetric fields) is kept: it carries no
    // geometry, but dropping it would tear the mesh's
    // combinatorics. The STL builder skips it again at the
    // document level, as lib/meshExport.ts does.
    const [gx, gy, gz] = gradientAt((ax + bx + cx) / 3, (ay + by + cy) / 3, (az + bz + cz) / 3);
    // Outward is the direction of DECREASING field, so a
    // correct outward normal has dot(normal, gradient) < 0.
    if (nx * gx + ny * gy + nz * gz > 0) faceList.push(a, c, b);
    else faceList.push(a, b, c);
  };
  const quad = (cellsAround: number[]) => {
    const vs = cellsAround.map((ci) => (ci < 0 ? -1 : cellVertex[ci]));
    if (vs.some((v) => v < 0)) return;
    pushTriangle(vs[0], vs[1], vs[2]);
    pushTriangle(vs[0], vs[2], vs[3]);
  };
  const cellIdx = cellIndexOf;
  for (let z = 0; z < res; z++) {
    for (let y = 0; y < res; y++) {
      for (let x = 0; x < res; x++) {
        const v0 = nodeAt(x, y, z);
        // Edges along +x / +y / +z from this node. The four
        // sharing cells, cyclically around the edge (their
        // lower corners relative to the edge's start node).
        if (x + 1 < res && inside(v0) !== inside(nodeAt(x + 1, y, z))) {
          quad([
            cellIdx(x, y - 1, z - 1), cellIdx(x, y, z - 1),
            cellIdx(x, y, z), cellIdx(x, y - 1, z),
          ]);
        }
        if (y + 1 < res && inside(v0) !== inside(nodeAt(x, y + 1, z))) {
          quad([
            cellIdx(x - 1, y, z - 1), cellIdx(x - 1, y, z),
            cellIdx(x, y, z), cellIdx(x, y, z - 1),
          ]);
        }
        if (z + 1 < res && inside(v0) !== inside(nodeAt(x, y, z + 1))) {
          quad([
            cellIdx(x - 1, y - 1, z), cellIdx(x, y - 1, z),
            cellIdx(x, y, z), cellIdx(x - 1, y, z),
          ]);
        }
      }
    }
  }

  return {
    vertices: new Float32Array(vertexList),
    faces: new Uint32Array(faceList),
  };
}

/* ---------------- mesh documents (S5's shape) ---------------- */

/**
 * Build a Wavefront OBJ document from an indexed triangle
 * mesh — the same document shape as lib/meshExport.ts
 * produces for the grid meshes (comment header, `v` lines,
 * 1-based `f` lines), for a topology that is not a grid.
 */
export function buildObjFromMesh(mesh: SkinningMesh): string {
  const vertexCount = mesh.vertices.length / 3;
  const faceCount = mesh.faces.length / 3;
  const lines: string[] = [
    '# Monosphere GPGPU particle mesh (skinning isosurface)',
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
export function buildStlFromMesh(
  mesh: SkinningMesh,
  solidName = 'monosphere-particles-skin',
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

export interface StateCacheSkinningFrameFile {
  frameIndex: number;
  frameNumber: number;
  fileName: string;
  contents: string;
  vertices: number;
  faces: number;
  usedParticles: number;
  skippedParticles: number;
}

export type StateCacheSkinningSeriesResult =
  | { ok: true; format: SkinningFormat; files: StateCacheSkinningFrameFile[] }
  | { ok: false; error: string };

export type StateCacheSkinningZipResult =
  | {
      ok: true;
      fileName: string;
      buffer: ArrayBuffer;
      format: SkinningFormat;
      fileCount: number;
      totalVertices: number;
      totalFaces: number;
    }
  | { ok: false; error: string };

/** File name for one frame of the series — the mesh
 *  series' convention (absolute frame number, padded). */
export function skinningFileNameForFrame(
  cache: StateCacheData,
  frameIndex: number,
  format: SkinningFormat,
): string {
  const absolute = cache.manifest.startFrame + frameIndex;
  return `monosphere-skin-${String(absolute).padStart(4, '0')}.${format}`;
}

/**
 * Check that a cache and a parameter set can produce a
 * skinning series at all. Stated at the point of use (the
 * held cache is a live object), in the cache discipline:
 * refuse with the reason, never rearrange or resample.
 */
export function validateCacheForSkinning(
  cache: StateCacheData,
  params: SkinningParams,
): { ok: true } | { ok: false; error: string } {
  const valid = validateSkinningParams(params);
  if (!valid.ok) return valid;
  const { manifest } = cache;
  if (!manifest || typeof manifest !== 'object') return fail('マニフェストがありません。');
  if (manifest.format !== STATE_CACHE_FORMAT || manifest.version !== STATE_CACHE_VERSION) {
    return fail(
      `正本形式（${STATE_CACHE_FORMAT} v${STATE_CACHE_VERSION}）ではないため、等値面へ変換できません（format="${String(manifest.format)}"、version=${String(manifest.version)}）。`,
    );
  }
  if (!Number.isInteger(manifest.frameCount) || manifest.frameCount <= 0) {
    return fail('キャッシュにフレームがありません。');
  }
  if (cache.positions.length !== manifest.frameCount) {
    return fail(
      `フレーム列の長さ（${cache.positions.length}）がマニフェストの frameCount（${manifest.frameCount}）と一致しないため、等値面へ変換できません。`,
    );
  }
  if (manifest.count > params.maxParticles) {
    return fail(
      `キャッシュの粒子数（${manifest.count.toLocaleString()} 点）がスキニングの上限（${params.maxParticles.toLocaleString()} 点）を超えるため、等値面へ変換できません。上限は設定キー stateCacheSkinningMaxParticles で指定します。`,
    );
  }
  for (let f = 0; f < manifest.frameCount; f++) {
    const pos = cache.positions[f];
    if (!pos || pos.length !== manifest.count * 3) {
      return fail(
        `フレーム ${f} の位置バッファ長（${pos ? pos.length : 0}）が粒子数×3（${manifest.count * 3}）と一致しないため、等値面へ変換できません。`,
      );
    }
  }
  const visits = estimateSkinningNodeVisits(manifest.count, params);
  if (visits > SKINNING_MAX_NODE_VISITS) {
    return fail(
      `密度場の組み立て量（1フレームあたり約 ${visits.toLocaleString()} 節点訪問）が安全上限（${SKINNING_MAX_NODE_VISITS.toLocaleString()}）を超えるため、等値面へ変換できません。解像度を下げるか、カーネル半径（SPH 半径）を小さくしてください。`,
    );
  }
  return { ok: true };
}

/** The isosurface mesh of one cache frame. Assumes the
 *  cache and params passed validateCacheForSkinning. */
export function buildSkinningMeshForFrame(
  cache: StateCacheData,
  frameIndex: number,
  params: SkinningParams,
): { mesh: SkinningMesh; usedParticles: number; skippedParticles: number } {
  const field = buildDensityField(cache.positions[frameIndex], cache.manifest.count, params);
  const mesh = extractIsosurface(field, params.isoLevel);
  return { mesh, usedParticles: field.usedParticles, skippedParticles: field.skippedParticles };
}

/**
 * Build the per-frame isosurface documents for a whole
 * cache. A frame whose particles never reach the iso
 * level yields an empty document (0 vertices / 0 faces),
 * not a refusal — the series stays frame-aligned.
 */
export function buildStateCacheSkinningSeries(
  cache: StateCacheData,
  params: SkinningParams,
  format: SkinningFormat = 'obj',
): StateCacheSkinningSeriesResult {
  const valid = validateCacheForSkinning(cache, params);
  if (!valid.ok) return valid;
  const files: StateCacheSkinningFrameFile[] = [];
  for (let f = 0; f < cache.manifest.frameCount; f++) {
    const { mesh, usedParticles, skippedParticles } = buildSkinningMeshForFrame(cache, f, params);
    files.push({
      frameIndex: f,
      frameNumber: cache.manifest.startFrame + f,
      fileName: skinningFileNameForFrame(cache, f, format),
      contents: format === 'stl' ? buildStlFromMesh(mesh) : buildObjFromMesh(mesh),
      vertices: mesh.vertices.length / 3,
      faces: mesh.faces.length / 3,
      usedParticles,
      skippedParticles,
    });
  }
  return { ok: true, format, files };
}

/**
 * The panel's export entry point: the edition gate (see
 * header) plus the series build, packed into ONE ZIP
 * archive — the mesh series' delivery shape, for the same
 * reason (browsers throttle bursts of downloads).
 */
export async function buildStateCacheSkinningSeriesZip(
  cache: StateCacheData,
  params: SkinningParams,
  options?: { format?: SkinningFormat; edition?: string },
): Promise<StateCacheSkinningZipResult> {
  const format = options?.format ?? 'obj';
  if (!stateCacheExportAllowed(options?.edition)) {
    return fail('公開版では等値面メッシュの書き出しはできません（完全版の機能です）。');
  }
  const series = buildStateCacheSkinningSeries(cache, params, format);
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
    fileName: SKINNING_ZIP_FILE_NAME,
    buffer,
    format,
    fileCount: series.files.length,
    totalVertices,
    totalFaces,
  };
}
