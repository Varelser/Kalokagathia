/**
 * Mesh export (OBJ / STL) — companion to the PLY point-cloud export.
 *
 * Grid-topology assumption: the GPGPU particle field is a
 * texSize × texSize texture, so the captured positions are NOT an
 * unordered point cloud — they are a regular row-major grid of
 * vertices. Consecutive texels therefore form quads:
 *
 *   (r, c)   (r, c+1)
 *   (r+1, c) (r+1, c+1)
 *
 * and each quad triangulates into two faces. That inherent topology
 * is what makes a mesh export possible without any surface
 * reconstruction: this module simply walks the grid, emits the valid
 * vertices, and connects neighbouring texels, skipping any triangle
 * that touches an invalid vertex.
 *
 * Validity rule mirrors the PLY builder in lib/pointCloudExport.ts:
 * a vertex is exportable iff x, y and z are all finite. (The PLY code
 * uses no other invalid marker — in particular (0,0,0) is a legal
 * position there, so it is legal here too.) Zero-area triangles
 * (collinear / coincident corners) have no usable face normal and are
 * skipped as well; in STL they would be meaningless, and in OBJ they
 * are dropped for consistency so both formats describe the same mesh.
 *
 * The builders here are pure functions over plain arrays: they take
 * xyz-packed positions (3 numbers per vertex, row-major), a grid
 * width and height, and return the document string. No three.js, no
 * GPU access — the capture itself is the same one-shot readback the
 * PLY export already performs (see lib/pointCloudExport.ts).
 */

export interface MeshExportStats {
  /** Vertices in the source grid (width × height). */
  gridVertices: number;
  /** Vertices that passed the finiteness rule and were emitted. */
  vertices: number;
  /** Triangles emitted (after invalid-vertex and zero-area skips). */
  faces: number;
}

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

function readVertex(positions: Float32Array, index: number): Vec3 | null {
  const o = index * 3;
  if (o + 2 >= positions.length) return null;
  const x = positions[o];
  const y = positions[o + 1];
  const z = positions[o + 2];
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
  return { x, y, z };
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function isZeroArea(normal: Vec3): boolean {
  return (
    !Number.isFinite(normal.x) ||
    !Number.isFinite(normal.y) ||
    !Number.isFinite(normal.z) ||
    (normal.x === 0 && normal.y === 0 && normal.z === 0)
  );
}

interface Triangle {
  /** Grid vertex indices (into the source grid), counter-clockwise. */
  indices: [number, number, number];
  corners: [Vec3, Vec3, Vec3];
  /** Unnormalised face normal (cross product); zero-area iff (0,0,0). */
  normal: Vec3;
}

function collectTriangles(positions: Float32Array, width: number, height: number): Triangle[] {
  const triangles: Triangle[] = [];
  if (width < 2 || height < 2) return triangles;
  const at = (row: number, col: number) => readVertex(positions, row * width + col);
  for (let row = 0; row + 1 < height; row++) {
    for (let col = 0; col + 1 < width; col++) {
      const a = at(row, col);
      const b = at(row, col + 1);
      const c = at(row + 1, col);
      const d = at(row + 1, col + 1);
      const ia = row * width + col;
      const ib = ia + 1;
      const ic = ia + width;
      const id = ic + 1;
      // Quad (a, b, c, d) -> triangles (a, b, d) and (a, d, c).
      // Each triangle is judged on its own corners, so a quad with a
      // single bad corner still contributes its one clean triangle.
      const candidates: { indices: [number, number, number]; corners: (Vec3 | null)[] }[] = [
        { indices: [ia, ib, id], corners: [a, b, d] },
        { indices: [ia, id, ic], corners: [a, d, c] },
      ];
      for (const candidate of candidates) {
        const [p, q, r] = candidate.corners;
        if (!p || !q || !r) continue;
        const normal = cross(sub(q, p), sub(r, p));
        if (isZeroArea(normal)) continue;
        triangles.push({
          indices: candidate.indices,
          corners: [p, q, r],
          normal,
        });
      }
    }
  }
  return triangles;
}

/**
 * Count what a mesh export of this grid would emit, without building
 * the document. Used for UI notices ("N faces / M vertices").
 */
export function countMeshExport(
  positions: Float32Array,
  width: number,
  height: number,
): MeshExportStats {
  const gridVertices = Math.max(0, width) * Math.max(0, height);
  let vertices = 0;
  for (let i = 0; i < gridVertices; i++) {
    if (readVertex(positions, i)) vertices++;
  }
  return {
    gridVertices,
    vertices,
    faces: collectTriangles(positions, width, height).length,
  };
}

/**
 * Build a Wavefront OBJ document from a row-major grid of xyz-packed
 * positions. Only vertices referenced by an emitted face are written
 * (numbered from 1, per the OBJ format), followed by `f` lines.
 */
export function buildObjFromGrid(
  positions: Float32Array,
  width: number,
  height: number,
): string {
  const triangles = collectTriangles(positions, width, height);
  // Remap grid indices -> OBJ's 1-based indices, emitting each used
  // vertex once, in first-use order.
  const objIndexByGrid = new Map<number, number>();
  const vertexLines: string[] = [];
  const remap = (gridIndex: number, corner: Vec3): number => {
    let objIndex = objIndexByGrid.get(gridIndex);
    if (objIndex === undefined) {
      vertexLines.push(`v ${corner.x} ${corner.y} ${corner.z}`);
      objIndex = vertexLines.length; // 1-based
      objIndexByGrid.set(gridIndex, objIndex);
    }
    return objIndex;
  };
  const faceLines: string[] = [];
  for (const triangle of triangles) {
    const [i0, i1, i2] = triangle.indices.map((gridIndex, k) =>
      remap(gridIndex, triangle.corners[k]),
    );
    faceLines.push(`f ${i0} ${i1} ${i2}`);
  }
  return [
    '# Monosphere GPGPU particle mesh (grid topology)',
    `# ${vertexLines.length} vertices, ${faceLines.length} faces`,
    ...vertexLines,
    ...faceLines,
    '',
  ].join('\n');
}

/**
 * Build an ASCII STL document from a row-major grid of xyz-packed
 * positions, with a computed (normalised) normal per facet.
 * Zero-area facets are skipped (see the header note).
 */
export function buildStlFromGrid(
  positions: Float32Array,
  width: number,
  height: number,
  solidName = 'monosphere-particles',
): string {
  const triangles = collectTriangles(positions, width, height);
  const lines: string[] = [`solid ${solidName}`];
  for (const triangle of triangles) {
    const length = Math.hypot(triangle.normal.x, triangle.normal.y, triangle.normal.z);
    const nx = triangle.normal.x / length;
    const ny = triangle.normal.y / length;
    const nz = triangle.normal.z / length;
    lines.push(`  facet normal ${nx} ${ny} ${nz}`);
    lines.push('    outer loop');
    for (const corner of triangle.corners) {
      lines.push(`      vertex ${corner.x} ${corner.y} ${corner.z}`);
    }
    lines.push('    endloop');
    lines.push('  endfacet');
  }
  lines.push(`endsolid ${solidName}`);
  return lines.join('\n') + '\n';
}

/**
 * Convert a captured RGBA position buffer (xyz + age per texel, the
 * PointCloudCaptureState buffer shape) into the xyz-packed grid this
 * module works on. `texSize` is the grid edge reported by the capture
 * state; when it is missing/inconsistent, a square grid is inferred
 * from the buffer length if possible. Returns null when no square
 * grid can be determined.
 */
export function extractGridPositions(
  data: Float32Array,
  texSize: number,
): { positions: Float32Array; width: number; height: number } | null {
  let size = Math.floor(texSize);
  if (size <= 0 || size * size * 4 > data.length) {
    const texelCount = Math.floor(data.length / 4);
    const inferred = Math.floor(Math.sqrt(texelCount));
    if (inferred <= 0 || inferred * inferred !== texelCount) return null;
    size = inferred;
  }
  const positions = new Float32Array(size * size * 3);
  for (let i = 0; i < size * size; i++) {
    positions[i * 3] = data[i * 4];
    positions[i * 3 + 1] = data[i * 4 + 1];
    positions[i * 3 + 2] = data[i * 4 + 2];
  }
  return { positions, width: size, height: size };
}
