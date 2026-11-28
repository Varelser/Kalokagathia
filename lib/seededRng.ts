// Deterministic seeded RNG (mulberry-style). Extracted from
// lib/gpgpuInitialData.ts in the 2026-11-14 perf stage-2 split: generic
// consumers (lib/dataSource.ts) imported it from the GPGPU data module,
// which made the whole scene-gpgpu chunk a static startup dependency.
//
// Stage 2 B5: the implementation itself now lives in the
// shared random channel (lib/gpgpuRandom.ts) — bit-identical
// to the copy that stood here. This module stays as the
// stable import surface for existing consumers.
export { mulberry32 as createSeededRng } from './gpgpuRandom';
