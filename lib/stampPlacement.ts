/**
 * Path shape stamping (Phase AA3: Tao-style stamp repetition).
 *
 * Phase S turned an imported SVG into an authored path (arc-length
 * tables in lib/pathGeometry.ts) and Phase K chained copies of the
 * whole path, but neither STAMPS a shape along the path: Tao's
 * grammar is "a shape, repeated at equal intervals along a path,
 * aligned to the path's tangent". This module is that generator's
 * pure core, consumed by the morph bake in 'stamp' path mode:
 *
 *  - Stamp centres sit at equal ARC-LENGTH intervals: centre k of
 *    `stampCount` is at s = (k + 0.5) / stampCount of the path
 *    (the bake resolves the centre and its tangent through
 *    lib/pathGeometry.ts, honouring the subpath mode).
 *  - Each stamp is a small flat shape in the path plane, built from
 *    a deterministic per-stamp point pattern (golden-angle spiral
 *    family): 'disc' (filled), 'ring' (outline), 'star' (alternating
 *    radii), 'diamond' (rhombus outline). 'obj' is handled by the
 *    bake itself (it needs the OBJ sample cloud); this module
 *    provides the pattern for the four primitive shapes.
 *  - Alignment: when `align` is on, the shape's local +X axis is
 *    rotated onto the path tangent at the centre; when off, shapes
 *    keep the path plane's axes. Size is in normalised cloud units
 *    (the shape's radius before the bake's world scale).
 *
 * Pure and deterministic: the same (shape, j, perStamp, size,
 * angle) always yields the same local point, so bakes reproduce
 * bit-for-bit and the unit tests can measure spacing / alignment
 * exactly.
 */

export type StampShape = 'disc' | 'ring' | 'star' | 'diamond' | 'obj';

export const STAMP_MAX_COUNT = 64;

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/** Stamp count from the spacing key (a path fraction per stamp). */
export function stampCountForSpacing(spacing: number): number {
  if (!Number.isFinite(spacing) || spacing <= 0) return 8;
  return Math.max(1, Math.min(STAMP_MAX_COUNT, Math.round(1 / spacing)));
}

export function clampStampSize(v: number): number {
  if (!Number.isFinite(v)) return 0.18;
  return Math.max(0.01, Math.min(1, v));
}

export function clampStampSpacing(v: number): number {
  if (!Number.isFinite(v) || v <= 0) return 0.125;
  return Math.max(1 / STAMP_MAX_COUNT, Math.min(0.5, v));
}

/** Centre parameter s in (0, 1) of stamp k out of `stampCount`. */
export function stampCenterS(k: number, stampCount: number): number {
  const n = Math.max(1, Math.floor(stampCount) || 1);
  const kk = Math.max(0, Math.min(n - 1, Math.floor(k) || 0));
  return (kk + 0.5) / n;
}

/**
 * Local (pre-rotation, pre-translation) point j of a stamp holding
 * `perStamp` points, for the primitive shapes. The pattern fills
 * the unit disc and is scaled by `size`.
 */
export function stampLocalPoint(
  shape: StampShape,
  j: number,
  perStamp: number,
  size: number,
): { x: number; y: number } {
  const m = Math.max(1, Math.floor(perStamp) || 1);
  const jj = ((Math.floor(j) % m) + m) % m;
  const s = clampStampSize(size);
  const frac = (jj + 0.5) / m;
  switch (shape) {
    case 'ring': {
      const a = jj * GOLDEN_ANGLE;
      return { x: Math.cos(a) * s, y: Math.sin(a) * s };
    }
    case 'star': {
      const a = jj * GOLDEN_ANGLE;
      const r = s * (jj % 2 === 0 ? 1 : 0.45);
      return { x: Math.cos(a) * r, y: Math.sin(a) * r };
    }
    case 'diamond': {
      // Rhombus outline: walk the perimeter by golden steps.
      const a = jj * GOLDEN_ANGLE;
      const ca = Math.abs(Math.cos(a));
      const sa = Math.abs(Math.sin(a));
      const denom = Math.max(1e-9, ca + sa);
      return { x: (Math.cos(a) / denom) * s, y: (Math.sin(a) / denom) * s };
    }
    case 'disc':
    case 'obj':
    default: {
      const a = jj * GOLDEN_ANGLE;
      const r = s * Math.sqrt(frac);
      return { x: Math.cos(a) * r, y: Math.sin(a) * r };
    }
  }
}

/**
 * Place a local stamp point at a centre with a tangent: rotate by
 * the tangent angle when aligning, then translate. (cx, cy) is the
 * path point at the stamp centre; (tx, ty) its unit tangent.
 */
export function placeStampPoint(
  local: { x: number; y: number },
  center: { x: number; y: number },
  tangent: { x: number; y: number },
  align: boolean,
): { x: number; y: number } {
  if (!align) return { x: center.x + local.x, y: center.y + local.y };
  const angle = Math.atan2(tangent.y, tangent.x);
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return {
    x: center.x + local.x * c - local.y * s,
    y: center.y + local.x * s + local.y * c,
  };
}
