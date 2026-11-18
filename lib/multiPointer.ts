/**
 * Multi-pointer tracking for the GPGPU mouse force (Phase AO).
 *
 * The legacy input layer tracked exactly one pointer: a single
 * `mousemove` listener feeding one NDC vector. This module keeps
 * up to MAX_MULTI_POINTERS simultaneous pointers in insertion
 * order (a Map), so the FIRST tracked pointer is always the one
 * that drives the legacy single-pointer path verbatim, and the
 * remaining pointers feed the multi-touch shader block only while
 * the gpgpuMouseMultiTouch key is on.
 *
 * The functions are pure operations over the Map (no DOM, no
 * clock), so the ordering / cap / removal rules are unit-testable
 * without a browser. Coordinates are canvas NDC in the app's
 * convention (x: -1..1 left-to-right, y: -1..1 bottom-to-top).
 */

export interface PointerNdc {
  x: number;
  y: number;
}

export type PointerTrackMap = Map<number, PointerNdc>;

/** Simultaneous pointers kept at most (matches uMousePosMulti[4]). */
export const MAX_MULTI_POINTERS = 4;

export function createPointerTrackMap(): PointerTrackMap {
  return new Map();
}

/**
 * Add a pointer, or update it in place if already tracked (an
 * update never changes its insertion position, so the primary
 * pointer is stable while it stays down). New pointers beyond
 * the cap are ignored — the cap keeps the oldest pointers, which
 * are the ones the user is already interacting with.
 */
export function trackPointer(map: PointerTrackMap, pointerId: number, x: number, y: number): void {
  const existing = map.get(pointerId);
  if (existing) {
    existing.x = x;
    existing.y = y;
    return;
  }
  if (map.size >= MAX_MULTI_POINTERS) return;
  map.set(pointerId, { x, y });
}

/**
 * Update a tracked pointer's position. Untracked pointers are NOT
 * added (a move without a preceding down must not resurrect a
 * released touch); returns whether the pointer was tracked.
 */
export function movePointer(map: PointerTrackMap, pointerId: number, x: number, y: number): boolean {
  const existing = map.get(pointerId);
  if (!existing) return false;
  existing.x = x;
  existing.y = y;
  return true;
}

/** Release a pointer (up / cancel). Unknown ids are a no-op. */
export function releasePointer(map: PointerTrackMap, pointerId: number): void {
  map.delete(pointerId);
}

/** The first tracked pointer (insertion order), or null. */
export function primaryPointer(map: PointerTrackMap): { pointerId: number; x: number; y: number } | null {
  for (const [pointerId, ndc] of map) return { pointerId, x: ndc.x, y: ndc.y };
  return null;
}

/** All tracked pointers in insertion order (primary first). */
export function pointerList(map: PointerTrackMap): { pointerId: number; x: number; y: number }[] {
  const out: { pointerId: number; x: number; y: number }[] = [];
  for (const [pointerId, ndc] of map) out.push({ pointerId, x: ndc.x, y: ndc.y });
  return out;
}
