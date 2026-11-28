/**
 * Local time per group (Layer 1 WP9, phase D).
 *
 * Until this phase the simulation had exactly one clock: the
 * global timeScale (lib/playbackTime.ts) scaling the frame
 * delta for every particle alike. The age advance in the
 * position pass is a single `age += uDelta` and the velocity
 * pass integrates its forces over the same uDelta, so there
 * was no way to say "this group runs slower" — the tyFlow
 * §4-21 Speed / §4-23 Slow rows of the WP9 survey
 * (kalokagathia-pro/LAYER1_WP9_INVESTIGATION.md §3 (d)).
 *
 * This module is the grammar + resolution for a per-group
 * time factor, and the two shader passes carry the variant
 * that applies it:
 *
 *   Authoring: ONE serialised config key, `gpgpuLocalTimeGroups`
 *   (a JSON string; '' = no local time, which keeps the
 *   default configuration bit-identical — the gpgpuGroupsData /
 *   gpgpuEmitDeform discipline):
 *
 *     [ { "group": "<group id>", "factor": 0.25 }, ... ]
 *
 *   `group` is a group id in the gpgpuGroupsData library (the
 *   gpgpuGroupRef convention — the same expression the force
 *   gate, the group kill and the field gates use).
 *
 *   Note on the group reference (gate item 16 follow-up,
 *   2026-11-28): a baked entry can only reside when its group
 *   is the one named by gpgpuGroupRef, and setting that key
 *   also activates the force gate with its default target
 *   ('all') — the reference key IS the gate's group selector
 *   (Phase CV ruling, restated in Phase DF). Gate-scoped
 *   forces then apply to the referenced group only.
 *   Predicate entries do not need the reference and do not
 *   raise the gate. This coupling is by design; it is
 *   recorded here because this module's authoring surface
 *   is where the reference gets set.
 *
 *   `factor`
 *   is the group's local clock rate against the global delta:
 *   0 freezes the group, 0.25 is Slow, 2 is Speed. Factors
 *   clamp to [0, 4]. At most LOCAL_TIME_MAX_ENTRIES entries
 *   are honoured (the shader table's size).
 *
 *   Combination rule: a particle can belong to several listed
 *   groups; the FIRST entry in list order whose group the
 *   particle belongs to wins (the field-layer precedent in
 *   lib/gpgpuFieldInstances.ts: the first layer that names an
 *   instance wins). A particle in no listed group keeps the
 *   factor 1 — the legacy clock. An entry whose factor is
 *   exactly 1 is the identity and is dropped at resolution
 *   (the all-ones suppression discipline the age curves use):
 *   it never stands the variant up and never shields later
 *   entries.
 *
 *   Gate resolution follows resolveGroupGate's texture-budget
 *   ruling verbatim (lib/gpgpuGroups.ts): a predicate group
 *   compiles down to a predicate the shader evaluates itself
 *   over the attribute bake; a snapshot / composite group is
 *   read from the attribute bake's slot 3 as "above 0.5" —
 *   which is honoured exactly when the entry's group is the
 *   ONE group the runtime bake filled into slot 3 (the
 *   gpgpuGroupRef group, while it resolves baked and the
 *   particle rules do not own slot 3). A baked entry naming
 *   any other group cannot be resident and is dropped at
 *   resolution with the reason surfaced ('baked-not-resident'),
 *   the same residency limit the field gates document. A
 *   dangling group id is dropped with 'group-not-found' (the
 *   WP2 rejection-code discipline: never silently gate, and
 *   never throw on malformed config).
 *
 *   Application (the shader variants; both are spliced only
 *   while the resolution stands, so every other configuration
 *   keeps the shipped strings byte for byte):
 *   - Position pass: the age advances — the plain advance and
 *     the Phase 15 collision life cost alike — multiply the
 *     global delta by the particle's factor. Nothing else in
 *     the pass changes: the respawn restart age, the spawn
 *     clocks and the position transport keep the global clock
 *     (documented boundary below).
 *   - Velocity pass: the built-in force accumulation's net
 *     delta — the Phase AC capture (velAfterForces −
 *     velForceBase) — is multiplied by the factor at the
 *     capture boundary in the tail, the Phase AK attribute
 *     drive's discipline, so a factor of exactly 1
 *     reconstructs the velocity bit-for-bit. Everything after
 *     the capture (colliders, mouse, custom force, the global
 *     drag, the clamps) is added back unscaled, exactly as
 *     the Phase AC force curve treats it. The SPH / Grains
 *     solver block (components/
 *     gpgpuShaderSimulationVelocityMainSphGrains.ts) is NOT
 *     edited by this phase; its accumulated contribution
 *     rides inside the captured delta like it does for the
 *     force curve, but its internal substeps keep the global
 *     delta.
 *
 *   Supply follows the distribution / deform discipline: the
 *   resolved entries ride a uniform vec4 array
 *   (uLocalTimeEntries, two vec4s per entry, packLocalTimeEntries)
 *   plus a count — no sampler is spent in either pass (the
 *   velocity fragment already links every texture unit the
 *   platform guarantees). The passes fill the count per frame
 *   and hold it at 0 while the attribute texture is missing
 *   (and, in the position pass, in replica stacks, where the
 *   texel layout is stack-local while the bake is global —
 *   the group kill's suppression), so the variant then
 *   evaluates to exactly 1 everywhere.
 *
 *   Boundaries (deliberate, recorded for the WP9 record):
 *   - The position pass's own position transport
 *     (pos += vel * uDelta * ...) is not scaled: the velocity
 *     the particle carries already reflects its local clock
 *     through the velocity capture above, and the transport
 *     step is the shared inter-pass step (the WP9 phase D
 *     scope is the age advance + the velocity integration).
 *   - Speed (tyFlow §4-21) and Slow (§4-23) are both this one
 *     mechanism (factor > 1 / < 1); there is no separate
 *     Speed surface.
 */

import {
  groupMembership,
  type AttrGroupMode,
} from './gpgpuAttributes';
import {
  findGpgpuGroup,
  parseGpgpuGroups,
  resolveGroupGate,
  GPGPU_GROUP_BAKED_SLOT,
  type GpgpuGroupPredicate,
} from './gpgpuGroups';
import { hasEffectiveParticleRules } from './gpgpuParticleRules';

/** Entries the shader table carries (uniform array size). */
export const LOCAL_TIME_MAX_ENTRIES = 4;

/** vec4 uniforms per entry in uLocalTimeEntries. */
export const LOCAL_TIME_VEC4_PER_ENTRY = 2;

/** Total vec4s of the uLocalTimeEntries uniform array. */
export const LOCAL_TIME_UNIFORM_VEC4S = LOCAL_TIME_MAX_ENTRIES * LOCAL_TIME_VEC4_PER_ENTRY;

/** Factor clamp: 0 freezes a group; 4 is the fastest local
 *  clock (the free-curve value ceiling, lib/freeCurve.ts). */
export const LOCAL_TIME_FACTOR_MIN = 0;
export const LOCAL_TIME_FACTOR_MAX = 4;

/** Mode ids as consumed by the shader (the passes' own
 *  mapping for the global group gate). */
export const LOCAL_TIME_MODE_IDS: Record<AttrGroupMode, number> = {
  below: 0,
  above: 1,
  band: 2,
};

/** One authored entry of the gpgpuLocalTimeGroups key. */
export interface LocalTimeEntry {
  group: string;
  factor: number;
}

/** Config slice the local-time wiring reads. */
export interface LocalTimeConfig {
  gpgpuLocalTimeGroups?: string;
  gpgpuGroupsData?: string;
  gpgpuGroupRef?: string;
  gpgpuParticleRules?: string;
}

function clampFactor(v: number): number {
  return Math.max(LOCAL_TIME_FACTOR_MIN, Math.min(LOCAL_TIME_FACTOR_MAX, v));
}

/**
 * Tolerant parse of the authored key (the groups discipline:
 * malformed data resolves to fewer entries, never a throw).
 * Entries without a string group id or a finite factor are
 * dropped; the factor clamps to [0, 4]; the list caps at
 * LOCAL_TIME_MAX_ENTRIES.
 */
export function parseLocalTimeEntries(data: string): LocalTimeEntry[] {
  if (!data) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(data);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const out: LocalTimeEntry[] = [];
  for (const item of raw) {
    if (out.length >= LOCAL_TIME_MAX_ENTRIES) break;
    if (!item || typeof item !== 'object') continue;
    const d = item as Record<string, unknown>;
    if (typeof d.group !== 'string' || d.group.length === 0) continue;
    if (typeof d.factor !== 'number' || !Number.isFinite(d.factor)) continue;
    out.push({ group: d.group, factor: clampFactor(d.factor) });
  }
  return out;
}

/** Serialise entries back into the config key ('' when empty). */
export function serializeLocalTimeEntries(entries: ReadonlyArray<LocalTimeEntry>): string {
  if (entries.length === 0) return '';
  return JSON.stringify(entries.map((e) => ({ group: e.group, factor: clampFactor(e.factor) })));
}

/**
 * One resolved entry: the normalised gate the shader
 * evaluates (a predicate form in every case — a baked group
 * arrives as the slot-3 "above 0.5" predicate, the passes'
 * own baked-gate form) plus the factor it applies.
 */
export interface ResolvedLocalTimeEntry {
  groupId: string;
  factor: number;
  slot: number;
  mode: AttrGroupMode;
  low: number;
  high: number;
  invert: boolean;
  /** True when the gate reads a baked group's membership
   *  from attribute slot 3 (informational; the shader form
   *  is the predicate above either way). */
  baked: boolean;
}

export type LocalTimeDropReason = 'group-not-found' | 'baked-not-resident' | 'identity-factor';

export interface LocalTimeResolution {
  /** Shader-ready entries, in authored (first-match) order. */
  entries: ResolvedLocalTimeEntry[];
  /** True while at least one entry stands — the passes'
   *  variant predicate. */
  active: boolean;
  /** Authored entries the resolution dropped, with reasons
   *  (the WP2 rejection-code discipline: surfaced, not
   *  swallowed). */
  dropped: Array<{ group: string; reason: LocalTimeDropReason }>;
}

/**
 * The single resolution every consumer shares: parse the
 * key, resolve each entry's group gate against the library,
 * and normalise to the shader's predicate form.
 *
 * The baked residency follows the runtime's own ruling: the
 * attribute bake's slot 3 carries the membership of the ONE
 * group gpgpuGroupRef names while that ref resolves baked —
 * and while the particle rules are effective they own slot
 * 3 instead (design 3.5), so no baked entry is resident
 * then.
 */
export function resolveLocalTime(config: LocalTimeConfig): LocalTimeResolution {
  const authored = parseLocalTimeEntries(config.gpgpuLocalTimeGroups ?? '');
  const dropped: Array<{ group: string; reason: LocalTimeDropReason }> = [];
  if (authored.length === 0) return { entries: [], active: false, dropped };
  const defs = parseGpgpuGroups(config.gpgpuGroupsData ?? '');
  const ref = config.gpgpuGroupRef ?? '';
  let bakedGroupId: string | null = null;
  if (ref && !hasEffectiveParticleRules(config.gpgpuParticleRules ?? '')) {
    const refGate = resolveGroupGate(defs, ref);
    if (refGate.kind === 'baked') {
      const def = findGpgpuGroup(defs, ref);
      bakedGroupId = def ? def.id : null;
    }
  }
  const entries: ResolvedLocalTimeEntry[] = [];
  for (const entry of authored) {
    if (entry.factor === 1) {
      dropped.push({ group: entry.group, reason: 'identity-factor' });
      continue;
    }
    const def = findGpgpuGroup(defs, entry.group);
    if (!def) {
      dropped.push({ group: entry.group, reason: 'group-not-found' });
      continue;
    }
    const gate = resolveGroupGate(defs, entry.group);
    if (gate.kind === 'predicate') {
      const p: GpgpuGroupPredicate = gate.predicate;
      entries.push({
        groupId: def.id, factor: entry.factor,
        slot: p.slot, mode: p.mode, low: p.low, high: p.high, invert: p.invert,
        baked: false,
      });
    } else if (gate.kind === 'baked') {
      if (bakedGroupId !== def.id) {
        dropped.push({ group: entry.group, reason: 'baked-not-resident' });
        continue;
      }
      entries.push({
        groupId: def.id, factor: entry.factor,
        slot: GPGPU_GROUP_BAKED_SLOT, mode: 'above', low: 0.5, high: 1, invert: false,
        baked: true,
      });
    }
  }
  return { entries, active: entries.length > 0, dropped };
}

/** True while a config's local-time table has any effective
 *  entry — the shader variants stand only then. */
export function localTimeVariantActive(config: LocalTimeConfig): boolean {
  return resolveLocalTime(config).active;
}

/**
 * Pack the resolved entries into the uLocalTimeEntries
 * uniform layout: LOCAL_TIME_MAX_ENTRIES × 2 vec4s as flat
 * numbers.
 *   A = (slot, modeId, low, high)
 *   B = (invert ? 1 : 0, factor, baked ? 1 : 0, 0)
 * Unused entries pack as zeros (their factor reads 0 but the
 * shader's loop stops at uLocalTimeCount, so they never
 * evaluate).
 */
export function packLocalTimeEntries(entries: readonly ResolvedLocalTimeEntry[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < LOCAL_TIME_MAX_ENTRIES; i++) {
    const e = entries[i];
    if (!e) {
      out.push(0, 0, 0, 0, 0, 0, 0, 0);
      continue;
    }
    out.push(e.slot, LOCAL_TIME_MODE_IDS[e.mode], e.low, e.high);
    out.push(e.invert ? 1 : 0, e.factor, e.baked ? 1 : 0, 0);
  }
  return out;
}

/**
 * TS twin of kaloLocalTimeFactor (the GLSL below): the first
 * entry whose gate the particle passes wins; no match is
 * exactly 1. `channelValue` reads the particle's attribute
 * channels by slot (the bake's RGBA, channel = slot).
 */
export function localTimeFactor(
  entries: readonly ResolvedLocalTimeEntry[],
  channelValue: (slot: number) => number,
): number {
  for (const e of entries) {
    const member = groupMembership(channelValue(e.slot), e.mode, e.low, e.high, e.invert);
    if (member > 0.5) return e.factor;
  }
  return 1;
}

/** The twin over the attribute bake's interleaved RGBA
 *  array (channel = slot, `index` the particle slot). */
export function localTimeFactorForParticle(
  entries: readonly ResolvedLocalTimeEntry[],
  attrData: ArrayLike<number>,
  index: number,
): number {
  return localTimeFactor(entries, (slot) => attrData[index * 4 + slot] ?? 0);
}

/**
 * TS twin of the velocity tail's local-time block: the
 * built-in force delta (after − base) is scaled by the
 * factor and the post-capture remainder (vel − after) is
 * added back unscaled — the Phase AC capture discipline.
 * A factor of exactly 1 returns `vel` component-for-component.
 */
export function localTimeScaleForceDelta(
  velForceBase: readonly [number, number, number],
  velAfterForces: readonly [number, number, number],
  vel: readonly [number, number, number],
  factor: number,
): [number, number, number] {
  return [
    velForceBase[0] + (velAfterForces[0] - velForceBase[0]) * factor + (vel[0] - velAfterForces[0]),
    velForceBase[1] + (velAfterForces[1] - velForceBase[1]) * factor + (vel[1] - velAfterForces[1]),
    velForceBase[2] + (velAfterForces[2] - velForceBase[2]) * factor + (vel[2] - velAfterForces[2]),
  ];
}

/** The uniform declarations both passes splice in while the
 *  variant stands (the array size follows the constants
 *  above; keep in sync with packLocalTimeEntries). */
export function localTimeUniformsGlsl(): string {
  return /* glsl */ `
uniform vec4 uLocalTimeEntries[${LOCAL_TIME_UNIFORM_VEC4S}];
uniform int uLocalTimeCount;
`;
}

/**
 * GLSL twin of localTimeFactor above. Reads the entry table
 * from the uLocalTimeEntries / uLocalTimeCount uniforms
 * (localTimeUniformsGlsl) and the membership primitives
 * (kaloAttrChannel / kaloGroupMembership) both passes
 * already define before this function is spliced in. The
 * formulas mirror the JS twin term for term.
 */
export function localTimeFactorGlsl(): string {
  return /* glsl */ `
  // Local time (Layer 1 WP9, phase D): the per-group time
  // factor — GLSL twin of localTimeFactor in
  // lib/gpgpuLocalTime.ts (keep the two term for term).
  // First matching entry wins; no match is exactly 1.
  float kaloLocalTimeFactor(vec4 attrData) {
    for (int i = 0; i < ${LOCAL_TIME_MAX_ENTRIES}; i++) {
      if (i >= uLocalTimeCount) break;
      vec4 a = uLocalTimeEntries[i * ${LOCAL_TIME_VEC4_PER_ENTRY}];
      vec4 b = uLocalTimeEntries[i * ${LOCAL_TIME_VEC4_PER_ENTRY} + 1];
      float member = kaloGroupMembership(
        kaloAttrChannel(attrData, int(a.x + 0.5)),
        int(a.y + 0.5), a.z, a.w, b.x > 0.5);
      if (member > 0.5) return b.y;
    }
    return 1.0;
  }
`;
}
