// Parameter references for modulation expressions (Phase 15,
// Houdini §2 — the ch() equivalent). An expression source in a
// modulation route may read OTHER parameters by name:
//
//   p_<catalog key, lowercased>     e.g. p_gpgpuboidsalignment
//
// Semantics, fixed deliberately:
// - Values come from the BASE config (the config before this
//   frame's modulation overlay) — never from modulated results,
//   so references cannot form cycles and the deterministic
//   render reproduces them exactly.
// - Values are normalised to [0, 1] by the catalog range
//   (min..max), like every other modulation source's value01.
// - Only catalog parameters with a numeric value and a real
//   range (max > min) are referenceable. A reference to a
//   non-numeric parameter compiles but evaluates to NaN, and
//   the modulation fallback (pass the wrapped source through)
//   applies — the Phase AJ discipline.
// - Three GPGPU keys are not in PARAMETER_CATALOG
//   (gpgpuParticleLifeAvoid, gpgpuSphSurfaceTension,
//   gpgpuSphEnabled) and therefore cannot be referenced; they
//   live in the AI control catalog instead.

import { PARAMETER_CATALOG, type ParameterCatalogEntry } from './parameterCatalog';
import type { ParticleConfig } from '../types';

const REFS = new Map<string, ParameterCatalogEntry>();

for (const entry of PARAMETER_CATALOG) {
  if (!(entry.max > entry.min)) continue;
  const name = `p_${String(entry.key).toLowerCase()}`;
  // Keys are unique; a name collision could only arise from two
  // keys differing by case alone — keep the first, deterministically.
  if (!REFS.has(name)) REFS.set(name, entry);
}

/** Every referenceable name (the compile-time extra-var set). */
export const EXPRESSION_PARAM_REF_NAMES: ReadonlySet<string> = new Set(REFS.keys());

/** Build the evaluation environment from the base config. */
export function buildExpressionParamVars(config: ParticleConfig): Record<string, number> {
  const vars: Record<string, number> = {};
  REFS.forEach((entry, name) => {
    const raw = config[entry.key];
    if (typeof raw !== 'number' || !Number.isFinite(raw)) return;
    vars[name] = Math.min(1, Math.max(0, (raw - entry.min) / (entry.max - entry.min)));
  });
  return vars;
}

/** Referenceable parameters, for help text in the route editor. */
export function listExpressionParamRefs(): { name: string; key: string; label: string }[] {
  const out: { name: string; key: string; label: string }[] = [];
  REFS.forEach((entry, name) => {
    out.push({ name, key: String(entry.key), label: entry.label });
  });
  return out;
}
