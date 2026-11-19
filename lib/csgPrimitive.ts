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
import { checkWatertightGate } from './csgGate';
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

export function manifoldToResultData(m: Manifold): CsgResultData {
  const mesh = m.getMesh();
  const numProp = mesh.numProp || 3;
  const vertCount = Math.floor(mesh.vertProperties.length / numProp);
  const positions = new Float32Array(vertCount * 3);
  for (let i = 0; i < vertCount; i++) {
    positions[i * 3] = mesh.vertProperties[i * numProp];
    positions[i * 3 + 1] = mesh.vertProperties[i * numProp + 1];
    positions[i * 3 + 2] = mesh.vertProperties[i * numProp + 2];
  }
  const indices = new Uint32Array(mesh.triVerts);
  return {
    positions,
    indices,
    volume: m.volume(),
    triangles: Math.floor(indices.length / 3),
    // Gate (c): structural re-check of the output, same code as (a).
    gate: checkWatertightGate(positions, indices),
  };
}
