// Species source grammar (Layer 1 WP8, phase E).
//
// Design: the authored form of the geom species split. The
// split itself is old — the terrain scatter bake publishes a
// per-texel species zone (lib/speciesAllocation.ts, phase 16
// stage 5), phase C of this WP added the assignment rules
// (lib/gpgpuPlacement.ts) — but WHAT each zone draws is
// configured by a fixed key set: zone 0 is gpgpuGeomMode /
// gpgpuMorphObjSource, zones 1..3 are the
// gpgpuGeomSpecies{2,3,4}Mode / gpgpuGeomSpecies{2,3,4}ObjSource
// keys, resolved by resolveSpeciesGeomMode /
// resolveSpeciesObjSource in components/useGpgpuMeshAssets.ts.
// The zone count is therefore capped at 4 and the per-zone
// sources cannot be authored as one description. This module
// is that description: a base source plus a LIST of per-zone
// entries of arbitrary length, resolved by rules that
// replicate the existing resolution term for term, so every
// configuration the keys can express resolves identically
// here (the tests pin the agreement over config grids), and
// zones past the authored list fall back to the base —
// exactly what the existing resolvers do for zones >= 4.
//
// Resolution rules (the existing ones, verbatim):
//   zone 0      -> the base mode / base OBJ source, always.
//   zone k >= 1 -> entry k - 1 of the list; a missing entry
//                  resolves to the base.
//   mode        -> an entry mode of 'follow' resolves to the
//                  base mode; any other value is the mode.
//   obj source  -> an entry source whose trim is '' carries
//                  no model and resolves to the base OBJ
//                  source; a non-empty source resolves to
//                  itself, untrimmed (the existing resolver
//                  returns the raw string).
//
// The existing modules are NOT modified: the keys keep their
// meaning, speciesSetFromConfig bridges a live config into
// the authored form, and the draw-side wiring (feeding a
// resolved list longer than 4 zones into the mesh assets,
// whose split loop is built around the baked channel's zone
// count) is a separate step outside this phase — this module
// is the grammar and its resolution only.
//
// Parse discipline, in the operator layers' style: tolerant
// per field (an unknown base mode falls back to the config
// default 'point', an unknown entry mode to the entry default
// 'follow', a non-string OBJ source to ''), the list capped
// at SPECIES_SET_MAX_ENTRIES, and a description that is not
// a JSON object at all resolves to null rather than
// substituting a different set silently. An authored set
// with NO entries is valid and is the legacy behaviour:
// every zone resolves to the base source.

/** The geometry modes a base source may name (the
 *  gpgpuGeomMode union in types/configGpgpu.ts). */
export const SPECIES_BASE_MODES: readonly string[] = [
  'point',
  'cube',
  'tetra',
  'octa',
  'icosa',
  'torus',
  'cone',
  'obj',
];

/** The modes a per-zone entry may name: the base modes plus
 *  'follow' (resolve to the base mode), the entry default. */
export const SPECIES_ENTRY_MODES: readonly string[] = [...SPECIES_BASE_MODES, 'follow'];

/** Authored-list cap (a guard against pathological input,
 *  far above any zone count the bake can publish). */
export const SPECIES_SET_MAX_ENTRIES = 64;

/** One per-zone source: the geometry mode and the OBJ
 *  document that builds it when the mode is 'obj'. */
export interface SpeciesSourceEntry {
  mode: string;
  objSource: string;
}

/**
 * The authored species set: one base source (zone 0, and
 * the fallback of every unfilled zone) plus the per-zone
 * entries — entries[k] authors zone k + 1.
 */
export interface SpeciesSetSpec {
  baseMode: string;
  baseObjSource: string;
  entries: SpeciesSourceEntry[];
}

/**
 * The structural subset of ParticleConfig the bridge reads
 * (the eight species keys). Any full config satisfies it.
 */
export interface SpeciesConfigLike {
  gpgpuGeomMode: string;
  gpgpuMorphObjSource: string;
  gpgpuGeomSpecies2Mode: string;
  gpgpuGeomSpecies3Mode: string;
  gpgpuGeomSpecies4Mode: string;
  gpgpuGeomSpecies2ObjSource: string;
  gpgpuGeomSpecies3ObjSource: string;
  gpgpuGeomSpecies4ObjSource: string;
}

/**
 * Bridge: the authored set a live config expresses — base
 * from gpgpuGeomMode / gpgpuMorphObjSource, entries from
 * the species 2..4 keys in zone order. Resolving this set
 * agrees with resolveSpeciesGeomMode /
 * resolveSpeciesObjSource for every zone (pinned by the
 * tests), so the grammar is a strict generalisation of the
 * keys, not a parallel meaning.
 */
export function speciesSetFromConfig(config: SpeciesConfigLike): SpeciesSetSpec {
  return {
    baseMode: config.gpgpuGeomMode,
    baseObjSource: config.gpgpuMorphObjSource,
    entries: [
      { mode: config.gpgpuGeomSpecies2Mode, objSource: config.gpgpuGeomSpecies2ObjSource },
      { mode: config.gpgpuGeomSpecies3Mode, objSource: config.gpgpuGeomSpecies3ObjSource },
      { mode: config.gpgpuGeomSpecies4Mode, objSource: config.gpgpuGeomSpecies4ObjSource },
    ],
  };
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function modeOr(value: unknown, allowed: readonly string[], fallback: string): string {
  return typeof value === 'string' && allowed.includes(value) ? value : fallback;
}

/**
 * Parse and sanitise an authored species set description:
 * {baseMode, baseObjSource, species: [{mode, objSource},
 * ...]} (the list field is named `species`; `entries` is
 * accepted as an alias). Returns null when the description
 * is not a JSON object. Per-field fallbacks follow the
 * config defaults: base mode 'point', entry mode 'follow',
 * OBJ sources ''. Entries past the cap are dropped.
 */
export function parseSpeciesSet(raw: string | null | undefined): SpeciesSetSpec | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const root = parsed as Record<string, unknown>;
  const listRaw = Array.isArray(root.species)
    ? root.species
    : Array.isArray(root.entries)
      ? root.entries
      : [];
  const entries: SpeciesSourceEntry[] = [];
  for (const item of listRaw) {
    if (entries.length >= SPECIES_SET_MAX_ENTRIES) break;
    if (!item || typeof item !== 'object') {
      entries.push({ mode: 'follow', objSource: '' });
      continue;
    }
    const e = item as Record<string, unknown>;
    entries.push({
      mode: modeOr(e.mode, SPECIES_ENTRY_MODES, 'follow'),
      objSource: stringOr(e.objSource, ''),
    });
  }
  return {
    baseMode: modeOr(root.baseMode, SPECIES_BASE_MODES, 'point'),
    baseObjSource: stringOr(root.baseObjSource, ''),
    entries,
  };
}

function zoneIndex(zone: number): number {
  return Number.isFinite(zone) ? Math.max(0, Math.floor(zone)) : 0;
}

function entryFor(spec: SpeciesSetSpec, zone: number): SpeciesSourceEntry | null {
  const z = zoneIndex(zone);
  if (z === 0) return null;
  return spec.entries[z - 1] ?? null;
}

/**
 * Resolved geometry mode of a zone: zone 0 and unfilled
 * zones resolve to the base mode; a filled entry resolves
 * to its own mode, with 'follow' resolving to the base.
 * Term-for-term the rule of resolveSpeciesGeomMode.
 */
export function resolveSpeciesMode(spec: SpeciesSetSpec, zone: number): string {
  const entry = entryFor(spec, zone);
  if (!entry) return spec.baseMode;
  return entry.mode === 'follow' ? spec.baseMode : entry.mode;
}

/**
 * Resolved OBJ source of a zone: zone 0 and unfilled zones
 * resolve to the base source; a filled entry resolves to
 * its own source while its trim is non-empty, and to the
 * base source while it is '' (a whitespace-only document
 * carries no model). Only consulted when the zone's
 * resolved mode is 'obj'. Term-for-term the rule of
 * resolveSpeciesObjSource.
 */
export function resolveSpeciesObjSource(spec: SpeciesSetSpec, zone: number): string {
  const entry = entryFor(spec, zone);
  if (!entry) return spec.baseObjSource;
  return entry.objSource.trim() !== '' ? entry.objSource : spec.baseObjSource;
}

/** The fully resolved source of one zone. */
export function resolveSpeciesEntry(spec: SpeciesSetSpec, zone: number): SpeciesSourceEntry {
  return { mode: resolveSpeciesMode(spec, zone), objSource: resolveSpeciesObjSource(spec, zone) };
}

/** Resolved sources for zones 0..zoneCount-1, in order. */
export function resolveSpeciesZones(spec: SpeciesSetSpec, zoneCount: number): SpeciesSourceEntry[] {
  const n = Number.isInteger(zoneCount) && zoneCount > 0 ? zoneCount : 0;
  const out: SpeciesSourceEntry[] = [];
  for (let z = 0; z < n; z++) out.push(resolveSpeciesEntry(spec, z));
  return out;
}

/**
 * Resolved sources for a per-point zone assignment (the
 * phase C grammar's output, lib/gpgpuPlacement.ts): one
 * resolved entry per point, parallel to `zones`.
 */
export function speciesSourcesForZones(
  spec: SpeciesSetSpec,
  zones: ArrayLike<number>,
): SpeciesSourceEntry[] {
  const out: SpeciesSourceEntry[] = [];
  for (let i = 0; i < zones.length; i++) out.push(resolveSpeciesEntry(spec, zones[i]));
  return out;
}
