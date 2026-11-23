// Phase 18 stage 2 — layer emitter hierarchy (parent indices).
//
// Each layer's emitters gain an optional parent: sourceParents[i]
// is the index of another emitter in the SAME layer whose
// effective position is added to emitter i's own effective
// position (recursively). -1, a missing entry, a self reference,
// an out-of-range / non-integer value, or an edge that would
// close a cycle all fall back to "root" (no parent), so the
// default (empty array) reproduces the historical layout
// bit-for-bit: when no valid parent exists the addition is
// skipped entirely and the base effective position (manual
// offset + ring, lib/sourceEditor.ts) is returned untouched.
import { effectivePosition, type Vec3Like } from './sourceEditor';

/** Normalise one parent entry: a valid parent index or -1 (root). */
export function normalizeSourceParent(
  parents: readonly number[] | undefined,
  index: number,
  count: number,
): number {
  const raw = parents?.[index];
  if (typeof raw !== 'number' || !Number.isInteger(raw)) return -1;
  if (raw < 0 || raw >= count || raw === index) return -1;
  return raw;
}

/** The full normalised parent list for a layer (-1 = root). */
export function resolveSourceParents(
  parents: readonly number[] | undefined,
  count: number,
): number[] {
  return Array.from({ length: count }, (_, index) => normalizeSourceParent(parents, index, count));
}

/** True when at least one emitter has a valid parent. */
export function hasSourceParents(parents: readonly number[] | undefined, count: number): boolean {
  if (!parents || parents.length === 0) return false;
  return resolveSourceParents(parents, count).some((parent) => parent >= 0);
}

function basePositions(
  positions: readonly Vec3Like[] | undefined,
  count: number,
  spread: number,
): Vec3Like[] {
  return Array.from({ length: count }, (_, index) => {
    const offset = positions?.[index] ?? { x: 0, y: 0, z: 0 };
    return effectivePosition(offset, index, count, spread);
  });
}

/**
 * Effective positions for every emitter with parents applied.
 * Cycle safety: resolution carries the current ancestor chain;
 * an edge pointing back into the chain is treated as root, so
 * a cycle contributes each member's base position exactly once
 * along any resolution path and always terminates.
 */
export function resolveEffectivePositionsWithParents(
  positions: readonly Vec3Like[] | undefined,
  count: number,
  spread: number,
  parents?: readonly number[],
): Vec3Like[] {
  const base = basePositions(positions, count, spread);
  if (!hasSourceParents(parents, count)) return base;
  const normalised = resolveSourceParents(parents, count);
  const solve = (index: number, chain: ReadonlySet<number>): Vec3Like => {
    const parent = normalised[index];
    if (parent < 0 || chain.has(parent)) return base[index];
    const nextChain = new Set(chain);
    nextChain.add(index);
    const parentEffective = solve(parent, nextChain);
    const own = base[index];
    return { x: own.x + parentEffective.x, y: own.y + parentEffective.y, z: own.z + parentEffective.z };
  };
  return base.map((_, index) => solve(index, new Set<number>()));
}

/** One emitter's effective position with parents applied. */
export function effectivePositionWithParents(
  positions: readonly Vec3Like[] | undefined,
  parents: readonly number[] | undefined,
  index: number,
  count: number,
  spread: number,
): Vec3Like {
  return resolveEffectivePositionsWithParents(positions, count, spread, parents)[index];
}
