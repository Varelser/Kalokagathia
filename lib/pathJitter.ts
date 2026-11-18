// Path jitter (Phase AW): the Phase AH hand-drawn line jitter
// (lib/lineJitter.ts) extended to path DRAWING. The line jitter
// hashes each segment endpoint's index, which keeps shared
// endpoints glued; path geometry has no shared index space, so
// this variant hashes the endpoint's POSITION instead — two
// path vertices at the same position (a polyline's shared joint,
// duplicated across subpaths) receive the identical displacement
// and the line never tears. Deterministic and static, like the
// line jitter: no time term, no RNG state.
//
// The amount semantics match the line jitter: the offset scale
// is amount * 0.02 in the caller's unit space (the line system
// multiplies by the sphere radius; path callers pass their own
// scale). Amount <= 0 is the identity, and
// applyPathJitterToPositions returns the input reference
// untouched in that case, so default configurations stay
// bit-identical by construction.

function hash1(n: number): number {
  const x = Math.sin(n) * 43758.5453123;
  return x - Math.floor(x);
}

const QUANTUM = 4096;

function positionSeed(x: number, y: number, z: number, axis: number): number {
  // Quantised position hash: vertices that agree to ~1/4096 of a
  // unit hash identically, so authored duplicates (which are
  // bit-equal) always agree, while distinct vertices decorrelate.
  const qx = Math.round(x * QUANTUM);
  const qy = Math.round(y * QUANTUM);
  const qz = Math.round(z * QUANTUM);
  return qx * 0.371 + qy * 0.717 + qz * 1.113 + axis * 2.399;
}

/**
 * The path-jitter displacement of one point. `scale` converts
 * the normalised amount into the caller's units (the offset is
 * hash * amount * 0.02 * scale per axis, centred on zero).
 */
export function pathJitterOffset(
  x: number,
  y: number,
  z: number,
  amount: number,
  scale = 1,
): { x: number; y: number; z: number } {
  if (!(amount > 0)) return { x: 0, y: 0, z: 0 };
  const k = amount * 0.02 * scale;
  return {
    x: (hash1(positionSeed(x, y, z, 0)) - 0.5) * 2 * k,
    y: (hash1(positionSeed(x, y, z, 1)) - 0.5) * 2 * k,
    z: (hash1(positionSeed(x, y, z, 2)) - 0.5) * 2 * k,
  };
}

/**
 * Displace a flat xyz position array in place into a NEW
 * Float32Array. With amount <= 0 the input is returned as-is
 * (same reference), which callers use as the bit-identical path.
 */
export function applyPathJitterToPositions(
  positions: ArrayLike<number>,
  amount: number,
  scale = 1,
): ArrayLike<number> {
  if (!(amount > 0)) return positions;
  const out = new Float32Array(positions.length);
  for (let i = 0; i + 2 < positions.length; i += 3) {
    const x = positions[i];
    const y = positions[i + 1];
    const z = positions[i + 2];
    const o = pathJitterOffset(x, y, z, amount, scale);
    out[i] = x + o.x;
    out[i + 1] = y + o.y;
    out[i + 2] = z + o.z;
  }
  return out;
}
