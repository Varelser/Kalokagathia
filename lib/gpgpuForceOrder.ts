// Phase 18 stage 2 — GPGPU force application order.
//
// The velocity shader's built-in force blocks (see
// components/gpgpuShaderSimulationVelocityMainForces.ts) run in
// the order their chunks are concatenated. This module is the
// pure, dependency-free definition of that order: the default
// name list (the historical order) plus the correction rules
// for the user-facing gpgpuForceOrder key (a comma-separated
// list of chunk names). Correction is total and safe: unknown
// names and duplicates are dropped, and any chunk the list
// omits is appended in default order, so the result is always
// a permutation of the full chunk set.

export const GPGPU_FORCE_CHUNK_NAMES = [
  'pyro-buoyancy',
  'turbulence',
  'audio-blast',
  'nbody',
  'curl',
  'pyro-disturbance',
  'boids',
  'kuramoto',
  'particle-life',
  'attractor',
  'levy',
  'vortex',
  'wind',
  'wind-volume',
  'slope',
  'well',
  'elastic',
  'magnetic',
  'steer-avoid',
] as const;

export type GpgpuForceChunkName = (typeof GPGPU_FORCE_CHUNK_NAMES)[number];

const KNOWN = new Set<string>(GPGPU_FORCE_CHUNK_NAMES);

/** Normalise any order input into a full permutation of the chunk names. */
export function normalizeGpgpuForceOrder(order?: string | readonly string[] | null): string[] {
  const raw = typeof order === 'string'
    ? order.split(',')
    : Array.isArray(order)
      ? order
      : [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of raw) {
    const name = String(entry).trim();
    if (!name || !KNOWN.has(name) || seen.has(name)) continue;
    seen.add(name);
    result.push(name);
  }
  for (const name of GPGPU_FORCE_CHUNK_NAMES) {
    if (!seen.has(name)) result.push(name);
  }
  return result;
}

/** True when the input denotes the default order (including '' / unset). */
export function isDefaultGpgpuForceOrder(order?: string | readonly string[] | null): boolean {
  if (order == null) return true;
  if (typeof order === 'string' && order.trim() === '') return true;
  const names = normalizeGpgpuForceOrder(order);
  return names.every((name, index) => name === GPGPU_FORCE_CHUNK_NAMES[index]);
}

/** Serialise a (possibly partial) order back to the canonical key form. */
export function serializeGpgpuForceOrder(order?: string | readonly string[] | null): string {
  if (isDefaultGpgpuForceOrder(order)) return '';
  return normalizeGpgpuForceOrder(order).join(',');
}
