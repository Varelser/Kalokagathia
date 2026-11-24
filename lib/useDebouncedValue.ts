/**
 * Debounced value (Phase 20 stage 3): returns the latest value
 * only after it has stayed unchanged for `delayMs`. The first
 * value is returned immediately (mount is never delayed), and
 * any change resets the wait, so a slider drag settles into a
 * single update instead of a rebake per tick. Equality is by
 * the `keyOf` projection (default String()), which lets object
 * values debounce by their field identity.
 *
 * Used by the terrain consumers whose rebake runs the erosion
 * sim synchronously (terrain mesh geometry, the morph bake):
 * ONLY the erosion parameters go through this hook there —
 * every other input keeps its immediate path.
 */
import * as React from 'react';

export function useDebouncedValue<T>(
  value: T,
  delayMs: number,
  keyOf: (v: T) => string = (v) => String(v),
): T {
  const [settled, setSettled] = React.useState<T>(value);
  const key = keyOf(value);
  const settledKey = keyOf(settled);
  const latestRef = React.useRef(value);
  latestRef.current = value;
  React.useEffect(() => {
    if (key === settledKey) return undefined;
    const timer = window.setTimeout(() => {
      setSettled(latestRef.current);
    }, delayMs);
    return () => {
      window.clearTimeout(timer);
    };
  }, [key, settledKey, delayMs]);
  return settled;
}

/** Quiet period for erosion-driven rebakes (Phase 20 stage 3). */
export const TERRAIN_EROSION_DEBOUNCE_MS = 200;
