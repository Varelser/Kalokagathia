// ── Column-data layout constants (leaf module) ─────────────
//
// The path-asset column layout, extracted from
// lib/gpgpuPathAssets.ts (Layer 1 WP4, phase D2) so both the
// path assets module and the emitter list module
// (lib/gpgpuEmitterList.ts, which APPENDS its emitters
// section to these requests) can build on the constants
// without an import cycle: the combined supply in
// gpgpuPathAssets.ts also consumes the emitter list, so
// neither may sit above the other. This module depends only
// on lib/gpgpuFieldInstances.ts. gpgpuPathAssets.ts
// re-exports the constants, so existing import paths keep
// working.

import {
  buildColumnLayout,
  COLUMN_TEX_WIDTH,
  FIELD_COLUMN_REQUESTS,
  type ColumnLayout,
  type ColumnSectionRequest,
} from './gpgpuFieldInstances';

export const PATH_ASSET_MAX_PATHS = 8;
export const PATH_ASSET_MAX_POINTS = 64;

// ── Column-data supply (design decision 2, shared with B1) ──
//
// The extended layout appends the two path sections after
// B1's fields / layers (append-only: their offsets never
// move). Header record (1 texel per path):
//   (pointCount, closed ? 1 : 0, pointsOffset, 0)
// Point record (1 texel per point):
//   (x, y, z, cum)   cum = the open polyline's cumulative
//                    arc length at this point (the emission
//                    walk reads it; the follow walk recomputes
//                    segment lengths like the legacy chunk).

export const PATH_COLUMN_REQUESTS: readonly ColumnSectionRequest[] = [
  ...FIELD_COLUMN_REQUESTS,
  // Row-padded like B1's sections (only PATH_ASSET_MAX_PATHS
  // texels are written; the rest of the row stays zero), so
  // every section starts on a row boundary: fields 0, layers
  // 256, pathHeaders 512, pathPoints 768.
  { id: 'pathHeaders', texels: COLUMN_TEX_WIDTH },
  { id: 'pathPoints', texels: PATH_ASSET_MAX_PATHS * PATH_ASSET_MAX_POINTS },
];

export const PATH_ASSET_COLUMN_LAYOUT: ColumnLayout = buildColumnLayout(PATH_COLUMN_REQUESTS);
