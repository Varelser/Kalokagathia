// Species allocation (Phase 16 stage 5, UE5 #41 foliage split).
//
// When the terrain scatter bake assigns species zones, the draw
// splits the instanced-solids pool into one InstancedBufferGeometry
// + Mesh per species. The legacy instance cap ("the first
// activeCount texels") cannot be applied per species — the species
// subsets are interleaved in texel order, so cutting each subset's
// head would skew the species ratio. allocateSpeciesCounts is the
// proportional replacement fixed in PHASE16_STAGE5_DESIGN.md:
//
//   totals n_k, pool N = Σ n_k, target active A
//   ideal a_k = A * n_k / N; start from min(n_k, floor(a_k)), then
//   hand out the remainder by largest fractional part (ties to the
//   lower species index), never exceeding n_k; overflow that no
//   species can absorb is dropped, so Σ result = min(A, N)
//   whenever every species can absorb its share, and in all cases
//   Σ result <= min(A, N) with result_k <= n_k.
//   A >= N returns the totals verbatim (the full pool, as legacy).
//
// Pure and deterministic; unit-tested in
// scripts/phase16-depth-geom-foliage.test.mjs.

export function allocateSpeciesCounts(totals: readonly number[], active: number): number[] {
  const n = totals.map((v) => (Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0));
  const total = n.reduce((a, b) => a + b, 0);
  const target = Number.isFinite(active) ? Math.max(0, Math.floor(active)) : 0;
  if (total === 0 || target === 0) return n.map(() => 0);
  if (target >= total) return [...n];
  const out = new Array<number>(n.length).fill(0);
  const fracs: Array<{ idx: number; frac: number }> = [];
  let assigned = 0;
  for (let k = 0; k < n.length; k++) {
    const ideal = (target * n[k]) / total;
    const base = Math.min(n[k], Math.floor(ideal));
    out[k] = base;
    assigned += base;
    fracs.push({ idx: k, frac: ideal - Math.floor(ideal) });
  }
  // Largest remainder first; stable tie-break by species index so
  // the allocation is a pure function of (totals, active).
  fracs.sort((a, b) => (b.frac - a.frac) || (a.idx - b.idx));
  let remaining = target - assigned;
  // Repeat passes: a species capped at n_k may leave units it
  // cannot absorb, which later passes offer to the rest.
  while (remaining > 0) {
    let progressed = false;
    for (const { idx } of fracs) {
      if (remaining <= 0) break;
      if (out[idx] < n[idx]) {
        out[idx] += 1;
        remaining -= 1;
        progressed = true;
      }
    }
    if (!progressed) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Baked species channel — the one shared slot the bake publishes
// into and the mesh-assets hook reads (the lib/attrPointCloud.ts
// store precedent; kept minimal: a single current bake, keyed by
// texSize + species count so a stale bake from another pool size
// or species setting is never consumed).

import React from 'react';

export interface BakedSpeciesData {
  /** texel index -> species zone 0..species-1 (all 0 when the
   *  scatter grammar is off or species is 1). */
  data: Uint8Array;
  texSize: number;
  species: number;
  version: number;
}

let currentBaked: BakedSpeciesData | null = null;
let bakedVersion = 0;
const bakedListeners = new Set<() => void>();

export function setBakedSpeciesData(data: Uint8Array, texSize: number, species: number): void {
  bakedVersion += 1;
  currentBaked = { data, texSize, species, version: bakedVersion };
  for (const listener of bakedListeners) listener();
}

export function getBakedSpeciesData(): BakedSpeciesData | null {
  return currentBaked;
}

function subscribeBakedSpecies(listener: () => void): () => void {
  bakedListeners.add(listener);
  return () => {
    bakedListeners.delete(listener);
  };
}

export function useBakedSpeciesData(): BakedSpeciesData | null {
  return React.useSyncExternalStore(subscribeBakedSpecies, getBakedSpeciesData, getBakedSpeciesData);
}
