// Phase CC: CSG construction core — builds Manifold operands
// from specs / mesh data and runs the boolean, against any
// loaded manifold-3d module. The worker (workers/csgWorker.ts)
// is a thin shell around this; the plain-node tests drive the
// same code with the Node-loaded module, so the numbers in the
// test suite are the production construction's numbers.
//
// Primitive parameterisation (final CSG brief §フェーズ1,
// values verified against the library):
//   cube     Manifold.cube([s, s, s], center)
//   sphere   Manifold.sphere(s / 2, segments)     (diameter = s)
//   cylinder Manifold.cylinder(s, s/2, s/2, segments, center)
//   cone     Manifold.cylinder(s, s/4, s/2, segments, center)
//   torus    revolve of a 16-point circle (main radius s/2,
//            tube 0.15 s) with `segments` around the axis

import type { Manifold, ManifoldToplevel } from 'manifold-3d';
import { checkWatertightGate, weldMeshVertices, CSG_WELD_TOLERANCE } from './csgGate';
import { buildCsgExtrude } from './csgExtrude';
import type {
  CsgFinishKind,
  CsgOperand,
  CsgOperationKind,
  CsgPrimitiveSpec,
  CsgResultData,
} from './csgCore';
import { clampCsgRefineDivisions } from './csgCore';

export function buildCsgPrimitive(wasm: ManifoldToplevel, spec: CsgPrimitiveSpec): Manifold {
  const { Manifold } = wasm;
  const s = Math.max(0.01, spec.size);
  const seg = Math.max(4, Math.floor(spec.segments) || 32);
  let m: Manifold;
  switch (spec.kind) {
    case 'cube':
      m = Manifold.cube([s, s, s], true);
      break;
    case 'sphere':
      m = Manifold.sphere(s / 2, seg);
      break;
    case 'cylinder':
      m = Manifold.cylinder(s, s / 2, s / 2, seg, true);
      break;
    case 'cone':
      m = Manifold.cylinder(s, s / 4, s / 2, seg, true);
      break;
    case 'torus': {
      const R = s / 2;
      const tube = s * 0.15;
      const cross: [number, number][] = [];
      const n = 16;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        cross.push([R + tube * Math.cos(a), tube * Math.sin(a)]);
      }
      m = Manifold.revolve(cross, seg);
      break;
    }
  }
  const [ox, oy, oz] = spec.offset;
  if (ox !== 0 || oy !== 0 || oz !== 0) m = m.translate([ox, oy, oz]);
  return m;
}

export function buildCsgOperand(wasm: ManifoldToplevel, operand: CsgOperand): Manifold {
  if (operand.type === 'primitive') return buildCsgPrimitive(wasm, operand.spec);
  if (operand.type === 'extrude') return buildCsgExtrude(wasm, operand.spec);
  const { Manifold, Mesh } = wasm;
  const triVerts =
    operand.indices ??
    new Uint32Array(Math.floor(operand.positions.length / 3)).map((_, i) => i);
  // Gate (b): the single construction site. No merge() here —
  // merge welds, which would silently repair unwelded input
  // this gate exists to reject. Throws ManifoldError on
  // non-manifold input; the caller classifies.
  const mesh = new Mesh({
    numProp: 3,
    vertProperties: operand.positions,
    triVerts,
  });
  return Manifold.ofMesh(mesh);
}

export function runCsgBoolean(a: Manifold, b: Manifold, op: CsgOperationKind): Manifold {
  return op === 'union' ? a.add(b) : op === 'difference' ? a.subtract(b) : a.intersect(b);
}

/** Apply a finish (Phase CG, brief unit U3). 'hull'
 *  replaces the result with its convex hull — Manifold's
 *  own hull() over every component at once, so disjoint
 *  parts are bridged into one genus-0 solid. A hull can
 *  never be smaller than its input; callers assert that
 *  property in tests rather than re-checking it here. */
export function applyCsgFinish(result: Manifold, finish: CsgFinishKind, refineDivisions: number = 2): Manifold {
  if (finish === 'hull') return result.hull();
  if (finish === 'refine') return result.refine(clampCsgRefineDivisions(refineDivisions));
  return result;
}

/** Extract one Manifold's mesh with the weld materialised
 *  (see manifoldToResultData). Returns the welded arrays plus
 *  their gate (c) report. */
function extractWeldedMesh(m: Manifold): {
  positions: Float32Array;
  indices: Uint32Array;
  gate: ReturnType<typeof checkWatertightGate>;
} {
  const mesh = m.getMesh();
  const numProp = mesh.numProp || 3;
  const vertCount = Math.floor(mesh.vertProperties.length / numProp);
  const positions = new Float32Array(vertCount * 3);
  for (let i = 0; i < vertCount; i++) {
    positions[i * 3] = mesh.vertProperties[i * numProp];
    positions[i * 3 + 1] = mesh.vertProperties[i * numProp + 1];
    positions[i * 3 + 2] = mesh.vertProperties[i * numProp + 2];
  }
  const welded = weldMeshVertices(positions, new Uint32Array(mesh.triVerts));
  return {
    positions: welded.positions,
    indices: welded.indices,
    gate: checkWatertightGate(welded.positions, welded.indices),
  };
}

export function manifoldToResultData(m: Manifold): CsgResultData {
  // Phase 17 E1b fix, part 1: materialise the gate's 1e-6
  // vertex weld on the extracted mesh. Chained booleans (a
  // previous result fed back as a mesh operand) otherwise come
  // out of getMesh() with the same geometric point split across
  // vertex indices (by one float32 ulp, or exactly duplicated)
  // and with sliver triangles that collapse under the weld —
  // the solid is intact (NoError, exact volume) but the raw
  // triangulation fails gate (c)'s edge census and cannot be
  // chained further. weldMeshVertices is a no-op (same arrays
  // back) for meshes with nothing to merge, so every result
  // that passes today is extracted byte-identically.
  const first = extractWeldedMesh(m);
  if (first.gate.ok || first.gate.skipped) {
    return {
      positions: first.positions,
      indices: first.indices,
      volume: m.volume(),
      triangles: Math.floor(first.indices.length / 3),
      // Gate (c): structural re-check of the output, same code as (a).
      gate: first.gate,
    };
  }
  // Phase 17 E1b fix, part 2: a boolean against a coincident
  // surface (chaining a union with the very sphere that carved
  // the operand, so a whole patch coincides) leaves ghost
  // shells inside Manifold's own result — decompose()
  // separates them out. Measured anatomy (see the fix record):
  // next to the one real solid there are parts of |volume|
  // ~1e-10 (flat doubled patches) and a 392-triangle sliver
  // shell of volume 3.2e-8 — a "solid" whose characteristic
  // thickness (volume / surface area ~1.6e-8) is at the
  // float32 ulp scale, far below the pipeline's own 1e-6 weld
  // resolution, and whose triangulation is not a manifold at
  // all (own welded Euler 139). A part counts as a ghost when
  // its volume is negligible in absolute terms OR its
  // characteristic thickness is at most the weld tolerance —
  // no representable solid is that thin (the gate census
  // itself would weld such a part's two walls together).
  // Dropping the ghosts and re-running the *unchanged* gate
  // (c) on what remains is the only retry: if no part is
  // dropped, or the cleaned mesh still fails the gate, the
  // original failing verdict stands — this never rescues a
  // genuinely broken result.
  const parts = m.decompose();
  if (parts.length > 1) {
    const totalAbsVolume = parts.reduce((sum, p) => sum + Math.abs(p.volume()), 0);
    const ghostEps = 1e-9 * Math.max(1, totalAbsVolume);
    const kept: ReturnType<typeof extractWeldedMesh>[] = [];
    for (const part of parts) {
      const extracted = extractWeldedMesh(part);
      const volume = Math.abs(part.volume());
      let area = 0;
      for (let base = 0; base + 2 < extracted.indices.length; base += 3) {
        const a = extracted.indices[base] * 3;
        const b = extracted.indices[base + 1] * 3;
        const c = extracted.indices[base + 2] * 3;
        const abx = extracted.positions[b] - extracted.positions[a];
        const aby = extracted.positions[b + 1] - extracted.positions[a + 1];
        const abz = extracted.positions[b + 2] - extracted.positions[a + 2];
        const acx = extracted.positions[c] - extracted.positions[a];
        const acy = extracted.positions[c + 1] - extracted.positions[a + 1];
        const acz = extracted.positions[c + 2] - extracted.positions[a + 2];
        const cx = aby * acz - abz * acy;
        const cy = abz * acx - abx * acz;
        const cz = abx * acy - aby * acx;
        area += 0.5 * Math.sqrt(cx * cx + cy * cy + cz * cz);
      }
      const thickness = area > 0 ? volume / area : 0;
      if (volume > ghostEps && thickness > CSG_WELD_TOLERANCE) kept.push(extracted);
    }
    if (kept.length > 0 && kept.length < parts.length) {
      const positions: number[] = [];
      const indices: number[] = [];
      for (const partMesh of kept) {
        const offset = positions.length / 3;
        for (let i = 0; i < partMesh.positions.length; i++) positions.push(partMesh.positions[i]);
        for (let i = 0; i < partMesh.indices.length; i++) indices.push(partMesh.indices[i] + offset);
      }
      const cleanedPositions = new Float32Array(positions);
      const cleanedIndices = new Uint32Array(indices);
      const cleanedGate = checkWatertightGate(cleanedPositions, cleanedIndices);
      if (cleanedGate.ok || cleanedGate.skipped) {
        return {
          positions: cleanedPositions,
          indices: cleanedIndices,
          volume: m.volume(),
          triangles: Math.floor(cleanedIndices.length / 3),
          gate: cleanedGate,
        };
      }
    }
  }
  return {
    positions: first.positions,
    indices: first.indices,
    volume: m.volume(),
    triangles: Math.floor(first.indices.length / 3),
    gate: first.gate,
  };
}
