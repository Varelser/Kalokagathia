/**
 * Source-position editor math (roadmap Phase 8C).
 *
 * A layer's emitters sit at an *effective* position:
 *
 *   effective = manual offset (SourcePositions[i])
 *             + ring arrangement (when SourceSpread > 0 and count > 1,
 *               emitter i sits on a circle of radius = spread)
 *
 * This mirrors getConfiguredSourceOffset in lib/appStateCollision.ts,
 * which is what the renderer/colliders use. The Play tab editor
 * shows effective positions on a top-view (X/Z) pad and converts
 * drags back into manual offsets, so what you see is where the
 * emitter actually is.
 */

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

/** World range covered by the editor pad on each axis (matches the panel sliders). */
export const SOURCE_EDITOR_RANGE = 5000;

export function ringComponent(index: number, count: number, spread: number): { x: number; z: number } {
  if (spread <= 0 || count <= 1) return { x: 0, z: 0 };
  const angle = (index / count) * Math.PI * 2;
  return { x: Math.cos(angle) * spread, z: Math.sin(angle) * spread };
}

export function effectivePosition(
  offset: Vec3Like,
  index: number,
  count: number,
  spread: number,
): Vec3Like {
  const ring = ringComponent(index, count, spread);
  return { x: offset.x + ring.x, y: offset.y, z: offset.z + ring.z };
}

/** Inverse of effectivePosition for the X/Z plane (Y is untouched by the ring). */
export function offsetFromEffective(
  effective: Vec3Like,
  index: number,
  count: number,
  spread: number,
): Vec3Like {
  const ring = ringComponent(index, count, spread);
  return { x: effective.x - ring.x, y: effective.y, z: effective.z - ring.z };
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** World X/Z -> pad ratios (0..1). Pad X is world X; pad Y (down) is world Z. */
export function worldToPad(pos: Vec3Like, range = SOURCE_EDITOR_RANGE): { rx: number; ry: number } {
  return {
    rx: clamp((pos.x + range) / (range * 2), 0, 1),
    ry: clamp((pos.z + range) / (range * 2), 0, 1),
  };
}

/** Pad ratios -> world X/Z, snapped to the panel's step of 10. */
export function padToWorld(rx: number, ry: number, range = SOURCE_EDITOR_RANGE): { x: number; z: number } {
  const snap = (value: number) => Math.round(value / 10) * 10;
  return {
    x: snap(clamp(rx, 0, 1) * range * 2 - range),
    z: snap(clamp(ry, 0, 1) * range * 2 - range),
  };
}

/**
 * Return a new positions array with `index` replaced by `offset`,
 * padded with zero offsets up to `count` entries when the stored
 * array is shorter (defaults in the app are sparse).
 */
export function withPosition(
  positions: Vec3Like[] | undefined,
  count: number,
  index: number,
  offset: Vec3Like,
): Vec3Like[] {
  const length = Math.max(count, (positions?.length ?? 0), index + 1);
  const next: Vec3Like[] = [];
  for (let i = 0; i < length; i++) {
    const existing = positions?.[i];
    next.push(existing ? { x: existing.x, y: existing.y, z: existing.z } : { x: 0, y: 0, z: 0 });
  }
  next[index] = { x: offset.x, y: offset.y, z: offset.z };
  return next;
}
