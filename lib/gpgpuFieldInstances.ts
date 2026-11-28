/**
 * Field instances + flow-field layers (Grammar 2.0 stage 2,
 * slice B1 — design: kalokagathia-pro/STAGE2_DESIGN.md §1
 * decisions 1-2 and §3 B1).
 *
 * The legacy fields are singletons: the vortex sits on the
 * origin with infinite range, the gravity wells are auto-placed
 * on a ring, and exactly one wind volume can be placed. This
 * module turns the three field kinds into INSTANCES — a placed
 * vortex / well / wind volume with its own position, radius and
 * strength — supplied to the velocity pass through the shared
 * COLUMN-DATA texture (design decision 2), and groups them into
 * LAYERS: a layer is a named set of instances with a weight,
 * whose per-particle modulation rides an attribute slot (design
 * decision 1 — continuous values travel through attribute
 * slots, never through the REP outputs).
 *
 * Authoring surface: two serialised keys (the gpgpuGroupsData
 * precedent — one JSON string per list, parsed tolerantly;
 * malformed data resolves to "no instances", never a throw):
 *
 *   gpgpuFieldInstances: JSON array of
 *     { kind: 'vortex' | 'well' | 'wind' | 'drag' | 'crown',
 *       pos: [x, y, z], radius, strength,
 *       tilt (vortex), dir: [x, y, z] (wind),
 *       softening, orbit (well),
 *       target: [x, y, z] (drag), height, width (crown),
 *       falloff? (WP5 phase A: a FalloffShape id from
 *         lib/gpgpuWindVolume.ts; omitted = the default shape),
 *       group? (WP5 phase A: a group ref — the id of a named
 *         group in gpgpuGroupsData, the gpgpuGroupRef
 *         convention; omitted = no group gate) }
 *   gpgpuFieldLayers: JSON array of
 *     { name?, weight, slot (-1 = none, else 0..3),
 *       members: [1-based instance indices],
 *       group? (same group ref as above, for the whole layer) }
 *
 * The WP5 phase A additions started as lib-only foundations:
 * the falloff shape is honoured by the CPU twins below, and a
 * group ref resolves through resolveFieldGroupGate (the
 * resolveGroupGate form — predicate or baked — plus an explicit
 * 'unresolved' outcome for a dangling ref). WP5 phase D wires
 * both into the shader: two daemon kinds join the instance
 * grammar ('drag' and 'crown', from lib/gpgpuDaemonFields.ts),
 * and an APPEND-ONLY extension pack (the 'fieldExt' /
 * 'layerExt' column sections) carries the falloff shape ids,
 * the normalised group gates and the daemon parameters, so the
 * legacy records above never change shape. A list authored
 * before WP5 — legacy kinds, default falloff, no gates —
 * resolves exactly as before and never stands the extension
 * up (fieldInstancesExtended stays false), which keeps the
 * pre-Phase-D shader string byte-identical for such configs.
 * One residency limit rides with the baked gate form: a baked
 * field gate reads attribute slot 3, which the runtime bake
 * fills with the ONE global gpgpuGroupRef group's membership —
 * a baked field gate is therefore honoured exactly when its
 * group is that baked group; several distinct baked groups
 * cannot be resident at once (the same ruling resolveGroupGate
 * itself documents for the global gate).
 *
 * An instance belongs to at most one layer: the FIRST layer
 * (in list order) that names it wins. Instances in no layer
 * apply at weight 1. A layer's weight multiplies its member
 * instances; when the layer names an attribute slot, the
 * weight is further multiplied per particle by that slot's
 * value (the attribute expression / dyn path writes the slot —
 * the same supply the force drive reads).
 *
 * The instance force laws are the legacy laws localised by the
 * wind volume's falloff ((1-(d/R)^2)^2, zero at and beyond the
 * radius): the vortex gains a centre and a finite range (the
 * design's stated purpose), the well keeps its pull + orbit
 * terms inside its radius, the wind volume gains its own
 * direction instead of inheriting the global one. The legacy
 * singletons are untouched — instances ADD to them. The pure
 * functions here are the reference implementation; the velocity
 * shader carries the GLSL twin (kaloFieldForce in
 * components/gpgpuShaderSimulationVelocityHelpers.ts), and the
 * unit tests pin both.
 *
 * Everything here is inert while the instance list is empty:
 * the shader variant is not built, no texture is created, and
 * the velocity pass is byte-identical to the legacy string.
 */
import * as THREE from 'three';
import type { ParticleConfig } from '../types';
import {
  falloffShapeValue,
  resolveFalloffShape,
  windVolumeFalloff,
  type FalloffShape,
} from './gpgpuWindVolume';
import {
  evaluateGpgpuGroup,
  findGpgpuGroup,
  parseGpgpuGroups,
  resolveGroupGate,
  GPGPU_GROUP_BAKED_SLOT,
  type GpgpuGroupDef,
  type GpgpuGroupPredicate,
} from './gpgpuGroups';
import {
  clampDaemonDragRate,
  daemonCrownRingProfile,
  DAEMON_CROWN_GAIN,
  DAEMON_CROWN_UP_BIAS,
} from './gpgpuDaemonFields';

export type FieldInstanceKind = 'vortex' | 'well' | 'wind' | 'drag' | 'crown';

/** GLSL kind ids (texel C.x of an instance record). The WP5
 *  phase D daemon kinds append after the B1 three — the ids of
 *  the legacy kinds never move. */
export const FIELD_INSTANCE_KIND_IDS: Record<FieldInstanceKind, number> = {
  vortex: 0,
  well: 1,
  wind: 2,
  drag: 3,
  crown: 4,
};

export const FIELD_INSTANCE_MAX = 16;
export const FIELD_LAYER_MAX = 8;
/** Texels per instance record: A pos+radius / B vec+strength / C kind+params+layer. */
export const FIELD_INSTANCE_TEXELS = 3;
/** Texels per layer record: weight / slot+1 / reserved / reserved. */
export const FIELD_LAYER_TEXELS = 1;

export interface FieldInstanceDef {
  kind: FieldInstanceKind;
  pos: [number, number, number];
  radius: number;
  strength: number;
  /** Vortex only: axis tilt, read exactly like gpgpuVortexTilt. */
  tilt: number;
  /** Wind only: direction (normalised at resolve). */
  dir: [number, number, number];
  /** Well only: softening (legacy default 10 when omitted). */
  softening: number;
  /** Well only: orbit gain (legacy default 0.5 when omitted). */
  orbit: number;
  /** WP5 phase A: the falloff curve this instance localises
   *  with (a FalloffShape id). Absent = the default shape, so
   *  pre-WP5 data keeps the legacy curve bit for bit. An
   *  unrecognised authored value is dropped at parse time. */
  falloff?: FalloffShape;
  /** WP5 phase A: group ref — the id of a named group in
   *  gpgpuGroupsData (the gpgpuGroupRef convention; a group's
   *  `name` is a display label, refs carry the id). Absent =
   *  no group gate. Resolution: resolveFieldGroupGate. */
  group?: string;
  /** WP5 phase D, drag only: the velocity the placed drag
   *  daemon relaxes toward (the DaemonDragDef target). Absent
   *  = the zero vector (a stilling volume). */
  target?: [number, number, number];
  /** WP5 phase D, crown only: the column height the crown's
   *  vertical envelope decays over. Absent = the radius. */
  height?: number;
  /** WP5 phase D, crown only: the Gaussian ring width around
   *  the radius. Absent = radius / 2 (the daemonCrownRingProfile
   *  fallback). */
  width?: number;
}

export interface ResolvedFieldInstance extends FieldInstanceDef {
  kindId: number;
  /** Unit vector the shader reads: the vortex axis (from tilt,
   *  the legacy formula) or the normalised wind direction.
   *  Unused for wells and the daemon kinds (0, 1, 0
   *  placeholder — their parameters ride the extension pack,
   *  never this record). */
  vec: [number, number, number];
  /** Index into the resolved layer list, or -1 for no layer. */
  layerIndex: number;
  /** Drag target with the default applied (zero vector). */
  target: [number, number, number];
  /** Crown column height with the default applied (radius). */
  height: number;
  /** Crown ring width with the default applied (radius / 2). */
  width: number;
}

export interface FieldLayerDef {
  name: string;
  weight: number;
  /** Attribute slot for the per-particle weight modulation,
   *  -1 = no modulation (the layer weight applies as-is). */
  slot: number;
  /** 1-based instance indices (the authoring order). */
  members: number[];
  /** WP5 phase A: group ref for the whole layer (same form
   *  as FieldInstanceDef.group). Absent = no group gate. */
  group?: string;
}

export interface FieldInstancesResolution {
  instances: ResolvedFieldInstance[];
  layers: FieldLayerDef[];
  active: boolean;
}

type FieldConfigSlice = Pick<ParticleConfig, 'gpgpuFieldInstances' | 'gpgpuFieldLayers'>;

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function vec3Or(value: unknown, fallback: [number, number, number]): [number, number, number] {
  if (!Array.isArray(value)) return [...fallback];
  return [
    finiteOr(value[0], fallback[0]),
    finiteOr(value[1], fallback[1]),
    finiteOr(value[2], fallback[2]),
  ];
}

function parseJsonArray(data: string | undefined): unknown[] {
  if (!data) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(data);
  } catch {
    return [];
  }
  return Array.isArray(raw) ? raw : [];
}

/** The authored falloff field: a recognised shape id, or
 *  undefined (field absent — the default shape applies). An
 *  unrecognised value is dropped, never resolved silently
 *  here, so a serialised def only ever carries a valid id. */
function parseFalloffField(value: unknown): FalloffShape | undefined {
  return value === 'smooth' || value === 'linear' || value === 'smoothstep'
    ? value
    : undefined;
}

/** The authored group ref: a non-empty string (group ids cap
 *  at 64 chars in lib/gpgpuGroups.ts), or undefined (field
 *  absent — no gate). Whether the ref names an existing group
 *  is a resolution question (resolveFieldGroupGate), not a
 *  parse question, so any non-empty string is kept. */
function parseGroupField(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value.slice(0, 64) : undefined;
}

/** Tolerant parse of the instance key (groups discipline:
 *  unknown kinds and non-objects are skipped, bad numbers fall
 *  back per field, the list is capped). */
export function parseFieldInstances(data: string | undefined): FieldInstanceDef[] {
  const out: FieldInstanceDef[] = [];
  for (const item of parseJsonArray(data)) {
    if (out.length >= FIELD_INSTANCE_MAX) break;
    if (!item || typeof item !== 'object') continue;
    const d = item as Record<string, unknown>;
    if (d.kind !== 'vortex' && d.kind !== 'well' && d.kind !== 'wind'
      && d.kind !== 'drag' && d.kind !== 'crown') continue;
    const def: FieldInstanceDef = {
      kind: d.kind,
      pos: vec3Or(d.pos, [0, 0, 0]),
      radius: Math.max(0, finiteOr(d.radius, 60)),
      strength: finiteOr(d.strength, 1),
      tilt: finiteOr(d.tilt, 0),
      dir: vec3Or(d.dir, [1, 0, 0]),
      softening: Math.max(0, finiteOr(d.softening, 10)),
      orbit: finiteOr(d.orbit, 0.5),
    };
    const falloff = parseFalloffField(d.falloff);
    if (falloff !== undefined) def.falloff = falloff;
    const group = parseGroupField(d.group);
    if (group !== undefined) def.group = group;
    // WP5 phase D daemon parameters (drag target / crown
    // height + ring width), parsed tolerantly like the rest:
    // they ride the def only when authored, the resolve step
    // applies the defaults.
    if (d.kind === 'drag' && Array.isArray(d.target)) def.target = vec3Or(d.target, [0, 0, 0]);
    if (d.kind === 'crown') {
      if (typeof d.height === 'number' && Number.isFinite(d.height)) def.height = Math.max(0, d.height);
      if (typeof d.width === 'number' && Number.isFinite(d.width)) def.width = Math.max(0, d.width);
    }
    out.push(def);
  }
  return out;
}

/** Tolerant parse of the layer key. Members are 1-based
 *  instance indices; duplicates inside one layer collapse. */
export function parseFieldLayers(data: string | undefined): FieldLayerDef[] {
  const out: FieldLayerDef[] = [];
  for (const item of parseJsonArray(data)) {
    if (out.length >= FIELD_LAYER_MAX) break;
    if (!item || typeof item !== 'object') continue;
    const d = item as Record<string, unknown>;
    const slotRaw = Math.round(finiteOr(d.slot, -1));
    const members: number[] = [];
    if (Array.isArray(d.members)) {
      for (const m of d.members) {
        const idx = typeof m === 'number' && Number.isFinite(m) ? Math.round(m) : NaN;
        if (idx >= 1 && idx <= FIELD_INSTANCE_MAX && !members.includes(idx)) members.push(idx);
      }
    }
    const layer: FieldLayerDef = {
      name: typeof d.name === 'string' && d.name.length > 0 ? d.name.slice(0, 80) : '',
      weight: finiteOr(d.weight, 1),
      slot: slotRaw >= 0 && slotRaw <= 3 ? slotRaw : -1,
      members,
    };
    const group = parseGroupField(d.group);
    if (group !== undefined) layer.group = group;
    out.push(layer);
  }
  return out;
}

/** Serialise instance definitions back into the config key
 *  ('' when empty — the serializeGpgpuGroups precedent). The
 *  optional WP5 fields ride along only when present on a def,
 *  so a list authored before WP5 serialises without them. */
export function serializeFieldInstances(defs: ReadonlyArray<FieldInstanceDef>): string {
  if (defs.length === 0) return '';
  return JSON.stringify(defs);
}

/** Serialise layer definitions back into the config key
 *  ('' when empty). Same discipline as serializeFieldInstances. */
export function serializeFieldLayers(defs: ReadonlyArray<FieldLayerDef>): string {
  if (defs.length === 0) return '';
  return JSON.stringify(defs);
}

// ── Group gates (WP5 phase A) ────────────────────────────────
//
// A field instance or layer may name a group (its `group`
// field — a group id, the gpgpuGroupRef convention). The gate
// resolves in the resolveGroupGate form, because the shader
// side inherits that function's texture-budget ruling: a
// predicate group compiles down to a predicate the shader
// evaluates itself, and a snapshot / composite group is read
// from the attribute bake's spare slot. Two outcomes are added
// on top of that form:
//   'none'       — no ref authored: no gate, the field
//                  applies to every particle (today's behaviour);
//   'unresolved' — a ref was authored but names no group in
//                  the library. The field is treated as having
//                  NO gate (a dangling ref must never silently
//                  gate everything off), and the reason is
//                  surfaced on the result instead of being
//                  swallowed — the WP2 rejection-code discipline.

export type FieldGroupGateRejectionReason = 'group-not-found';

export type FieldGroupGateResolution =
  | { kind: 'none' }
  | { kind: 'predicate'; groupId: string; predicate: GpgpuGroupPredicate }
  | { kind: 'baked'; groupId: string; slot: number }
  | { kind: 'unresolved'; ref: string; reason: FieldGroupGateRejectionReason };

/**
 * Resolve one authored group ref against the group library.
 * `defs` is the parsed gpgpuGroupsData library (parseGpgpuGroups).
 */
export function resolveFieldGroupGate(
  defs: ReadonlyArray<GpgpuGroupDef>,
  ref: string | undefined,
): FieldGroupGateResolution {
  if (!ref) return { kind: 'none' };
  const def = findGpgpuGroup(defs, ref);
  if (!def) return { kind: 'unresolved', ref, reason: 'group-not-found' };
  const gate = resolveGroupGate(defs, ref);
  if (gate.kind === 'predicate') return { kind: 'predicate', groupId: def.id, predicate: gate.predicate };
  if (gate.kind === 'baked') return { kind: 'baked', groupId: def.id, slot: gate.slot };
  // Unreachable: a found def never resolves to the legacy path.
  return { kind: 'none' };
}

/** The group gate of one field instance definition. */
export function resolveFieldInstanceGroupGate(
  defs: ReadonlyArray<GpgpuGroupDef>,
  inst: Pick<FieldInstanceDef, 'group'>,
): FieldGroupGateResolution {
  return resolveFieldGroupGate(defs, inst.group);
}

/** The group gate of one field layer definition. */
export function resolveFieldLayerGroupGate(
  defs: ReadonlyArray<GpgpuGroupDef>,
  layer: Pick<FieldLayerDef, 'group'>,
): FieldGroupGateResolution {
  return resolveFieldGroupGate(defs, layer.group);
}

/**
 * Evaluate the membership a group ref gates on, over the
 * attribute bake (the evaluateGpgpuGroup contract: interleaved
 * RGBA, channel = slot, `count` particle slots). Returns null
 * when there is nothing to gate on — no ref, an unresolved
 * ref, or a group that itself fails to evaluate (unknown /
 * cyclic composite) — so callers treat null as "no gate".
 */
export function evaluateFieldGroupMembership(
  defs: ReadonlyArray<GpgpuGroupDef>,
  ref: string | undefined,
  attrData: Float32Array,
  count: number,
): Uint8Array | null {
  const gate = resolveFieldGroupGate(defs, ref);
  if (gate.kind !== 'predicate' && gate.kind !== 'baked') return null;
  return evaluateGpgpuGroup(defs, gate.groupId, attrData, count);
}

/** The vortex axis from a tilt value — the legacy chunk's
 *  formula (normalize(vec3(sin(tilt), cos(tilt), 0))), kept
 *  term for term so an instance with tilt = gpgpuVortexTilt
 *  swirls around the same axis as the singleton. */
export function vortexAxisFromTilt(tilt: number): [number, number, number] {
  const x = Math.sin(tilt);
  const y = Math.cos(tilt);
  const len = Math.hypot(x, y) || 1;
  return [x / len, y / len, 0];
}

function normaliseDir(dir: [number, number, number]): [number, number, number] {
  const len = Math.hypot(dir[0], dir[1], dir[2]);
  if (!(len > 1e-9)) return [1, 0, 0];
  return [dir[0] / len, dir[1] / len, dir[2] / len];
}

/**
 * The single resolution every consumer shares: parse both
 * keys, derive the per-kind shader vector, and assign each
 * instance to the first layer that names it.
 */
export function resolveFieldInstances(config: FieldConfigSlice): FieldInstancesResolution {
  const defs = parseFieldInstances(config.gpgpuFieldInstances ?? '');
  const layers = parseFieldLayers(config.gpgpuFieldLayers ?? '');
  const instances: ResolvedFieldInstance[] = defs.map((def, defIndex) => {
    let layerIndex = -1;
    const authoringIndex = defIndex + 1;
    for (let li = 0; li < layers.length; li++) {
      if (layers[li].members.includes(authoringIndex)) { layerIndex = li; break; }
    }
    return {
      ...def,
      kindId: FIELD_INSTANCE_KIND_IDS[def.kind],
      vec: def.kind === 'vortex'
        ? vortexAxisFromTilt(def.tilt)
        : def.kind === 'wind'
          ? normaliseDir(def.dir)
          : [0, 1, 0] as [number, number, number],
      layerIndex,
      target: def.target ? [...def.target] as [number, number, number] : [0, 0, 0],
      height: def.height !== undefined ? def.height : def.radius,
      width: def.width !== undefined ? def.width : def.radius / 2,
    };
  });
  return { instances, layers, active: instances.length > 0 };
}

/** The variant predicate: at least one valid instance. The
 *  velocity shader's field variant exists only while this
 *  holds, so the default config keeps the stock string. */
export function fieldInstancesActive(config: FieldConfigSlice): boolean {
  return parseFieldInstances(config.gpgpuFieldInstances ?? '').length > 0;
}

/**
 * Whether the attribute texture is a field consumer: some
 * layer names a valid slot AND at least one of its member
 * instances is actually assigned to it. Resolved through this
 * shared predicate on both the bake side (runtime) and the
 * consumption side (passes), so the two cannot drift.
 */
export function fieldLayerSlotAttrActive(config: FieldConfigSlice): boolean {
  const res = resolveFieldInstances(config);
  if (!res.active) return false;
  return res.layers.some((layer, li) => layer.slot >= 0
    && res.instances.some((inst) => inst.layerIndex === li));
}

// ── Column-data supply (design decision 2) ───────────────────
//
// ONE RGBA float texture carries every column-shaped supply
// the velocity pass needs: sections are laid out by the single
// allocator below, each starting on a fresh row, addressed in
// texel units through base offsets the passes hand to the
// shader as uniforms. Sections are APPEND-ONLY: a later slice
// (B2's path point lists) registers its section after the
// existing ones, so the fields / layers offsets never move.

export const COLUMN_TEX_WIDTH = 256;

export interface ColumnSectionRequest {
  id: string;
  texels: number;
}

export interface ColumnSectionLayout {
  id: string;
  /** Section start, in texels from the texture origin. */
  offsetTexel: number;
  texels: number;
}

export interface ColumnLayout {
  width: number;
  height: number;
  sections: ColumnSectionLayout[];
}

export function buildColumnLayout(requests: readonly ColumnSectionRequest[]): ColumnLayout {
  const sections: ColumnSectionLayout[] = [];
  let row = 0;
  for (const req of requests) {
    const texels = Math.max(0, Math.round(req.texels));
    sections.push({ id: req.id, offsetTexel: row * COLUMN_TEX_WIDTH, texels });
    row += Math.max(1, Math.ceil(texels / COLUMN_TEX_WIDTH));
  }
  return { width: COLUMN_TEX_WIDTH, height: Math.max(1, row), sections };
}

export function columnSectionOffset(layout: ColumnLayout, id: string): number {
  const section = layout.sections.find((s) => s.id === id);
  return section ? section.offsetTexel : 0;
}

/** The B1 registration: field instances, then layer records.
 *  B2 appends its path section after these (append-only). */
export const FIELD_COLUMN_REQUESTS: readonly ColumnSectionRequest[] = [
  { id: 'fields', texels: FIELD_INSTANCE_MAX * FIELD_INSTANCE_TEXELS },
  { id: 'layers', texels: FIELD_LAYER_MAX * FIELD_LAYER_TEXELS },
];

export const FIELD_COLUMN_LAYOUT: ColumnLayout = buildColumnLayout(FIELD_COLUMN_REQUESTS);

export interface FieldColumnPack {
  data: Float32Array;
  width: number;
  height: number;
  fieldsBase: number;
  layersBase: number;
  instanceCount: number;
  layerCount: number;
}

/**
 * Pack a resolution into the column texture's data array.
 * Instance record (3 texels):
 *   A = (pos.x, pos.y, pos.z, radius)
 *   B = (vec.x, vec.y, vec.z, strength)   vec = axis / dir
 *   C = (kindId, softening, orbit, layerIndex + 1)
 * Layer record (1 texel):
 *   (weight, slot + 1, 0, 0)              slot + 1: 0 = none
 * Pure and deterministic — the same resolution always packs
 * to the same bytes.
 */
export function packFieldColumnData(
  resolution: FieldInstancesResolution,
  layout: ColumnLayout = FIELD_COLUMN_LAYOUT,
): FieldColumnPack {
  const data = new Float32Array(layout.width * layout.height * 4);
  const fieldsBase = columnSectionOffset(layout, 'fields');
  const layersBase = columnSectionOffset(layout, 'layers');
  resolution.instances.forEach((inst, i) => {
    const a = (fieldsBase + i * FIELD_INSTANCE_TEXELS) * 4;
    data[a] = inst.pos[0]; data[a + 1] = inst.pos[1]; data[a + 2] = inst.pos[2]; data[a + 3] = inst.radius;
    data[a + 4] = inst.vec[0]; data[a + 5] = inst.vec[1]; data[a + 6] = inst.vec[2]; data[a + 7] = inst.strength;
    data[a + 8] = inst.kindId; data[a + 9] = inst.softening; data[a + 10] = inst.orbit; data[a + 11] = inst.layerIndex + 1;
  });
  resolution.layers.forEach((layer, j) => {
    const a = (layersBase + j * FIELD_LAYER_TEXELS) * 4;
    data[a] = layer.weight; data[a + 1] = layer.slot + 1; data[a + 2] = 0; data[a + 3] = 0;
  });
  return {
    data,
    width: layout.width,
    height: layout.height,
    fieldsBase,
    layersBase,
    instanceCount: resolution.instances.length,
    layerCount: resolution.layers.length,
  };
}

// ── Extension pack (WP5 phase D) ─────────────────────────────
//
// The B1 records above are frozen: they carry no falloff
// shape, no group gate and no daemon parameters. Phase D
// appends two sections AFTER every existing one (the
// append-only discipline — the allocator in
// lib/gpgpuPathAssets.ts registers them last):
//
//   fieldExt (FIELD_INSTANCE_MAX × 3 texels, per instance):
//     E0 = (falloffShapeId, gateKind, gateSlot, gateMode)
//     E1 = (gateLow, gateHigh, gateInvert, 0)
//     E2 = drag:  (target.x, target.y, target.z, 0)
//          crown: (height, width, 0, 0)
//          else:  (0, 0, 0, 0)
//   layerExt (FIELD_LAYER_MAX × 2 texels, per layer):
//     L0 = (gateKind, gateSlot, gateMode, gateLow)
//     L1 = (gateHigh, gateInvert, 0, 0)
//
// A gate is normalised into the form the shader evaluates:
// kind 0 = no gate (authored none, or an UNRESOLVED ref — a
// dangling ref never gates, the phase A ruling); kind 1 = a
// predicate (slot, mode, low, high, invert). A baked gate
// normalises to the predicate the passes themselves use for
// the global baked gate — slot GPGPU_GROUP_BAKED_SLOT, mode
// 'above', low 0.5, high 1, no invert — because the shader
// reads the baked membership from that slot either way (see
// the residency note in the header).

/** Texels per instance in the fieldExt section. */
export const FIELD_EXT_TEXELS_PER_INSTANCE = 3;
/** Texels per layer in the layerExt section. */
export const FIELD_LAYER_EXT_TEXELS = 2;

/** Falloff shape ids for the extension pack (E0.x). */
export const FALLOFF_SHAPE_IDS: Record<FalloffShape, number> = {
  smooth: 0,
  linear: 1,
  smoothstep: 2,
};

const GROUP_MODE_IDS: Record<GpgpuGroupPredicate['mode'], number> = {
  below: 0,
  above: 1,
  band: 2,
};

/** A group gate in the packed, shader-evaluable form. */
export interface PackedFieldGate {
  kind: 0 | 1;
  slot: number;
  mode: number;
  low: number;
  high: number;
  invert: number;
}

const NO_FIELD_GATE: PackedFieldGate = { kind: 0, slot: 0, mode: 0, low: 0, high: 0, invert: 0 };

/** Normalise one resolved gate for the extension pack. */
export function packFieldGate(resolution: FieldGroupGateResolution): PackedFieldGate {
  if (resolution.kind === 'predicate') {
    const p = resolution.predicate;
    return {
      kind: 1,
      slot: p.slot,
      mode: GROUP_MODE_IDS[p.mode] ?? 1,
      low: p.low,
      high: p.high,
      invert: p.invert ? 1 : 0,
    };
  }
  if (resolution.kind === 'baked') {
    return { kind: 1, slot: GPGPU_GROUP_BAKED_SLOT, mode: 1, low: 0.5, high: 1, invert: 0 };
  }
  return { ...NO_FIELD_GATE };
}

export interface FieldExtConfigSlice extends FieldConfigSlice {
  gpgpuGroupsData?: string;
}

function fieldGatesForConfig(config: FieldExtConfigSlice): {
  instanceGates: PackedFieldGate[];
  layerGates: PackedFieldGate[];
  anyGate: boolean;
} {
  const defs = parseGpgpuGroups(config.gpgpuGroupsData ?? '');
  const res = resolveFieldInstances(config);
  const instanceGates = res.instances.map((inst) => packFieldGate(resolveFieldInstanceGroupGate(defs, inst)));
  const layerGates = res.layers.map((layer) => packFieldGate(resolveFieldLayerGroupGate(defs, layer)));
  return {
    instanceGates,
    layerGates,
    anyGate: instanceGates.some((g) => g.kind === 1) || layerGates.some((g) => g.kind === 1),
  };
}

/**
 * Whether the extension pack must stand for this config: any
 * daemon-kind instance, any non-default falloff shape, or any
 * instance / layer group gate that resolves to a real gate.
 * False for every pre-Phase-D config, which is what keeps
 * their shader strings byte-identical.
 */
export function fieldInstancesExtended(config: FieldExtConfigSlice): boolean {
  const res = resolveFieldInstances(config);
  if (!res.active) return false;
  if (res.instances.some((inst) => inst.kind === 'drag' || inst.kind === 'crown')) return true;
  if (res.instances.some((inst) => inst.falloff !== undefined && inst.falloff !== 'smooth')) return true;
  return fieldGatesForConfig(config).anyGate;
}

/** Whether any field group gate resolves to a real gate —
 *  the passes read this to keep the attribute texture bound
 *  (the gate evaluation reads attribute slots). */
export function fieldGroupGateActive(config: FieldExtConfigSlice): boolean {
  return fieldGatesForConfig(config).anyGate;
}

/**
 * Write the extension sections into an already-allocated
 * column data array (the packFieldColumnData composition
 * pattern: the caller owns the array, sized by `layout`).
 * Returns the section bases (0 when the layout carries no
 * such section).
 */
export function packFieldExtColumnData(
  data: Float32Array,
  layout: ColumnLayout,
  config: FieldExtConfigSlice,
): { fieldExtBase: number; layerExtBase: number } {
  if (!layout.sections.some((s) => s.id === 'fieldExt')) return { fieldExtBase: 0, layerExtBase: 0 };
  const fieldExtBase = columnSectionOffset(layout, 'fieldExt');
  const layerExtBase = columnSectionOffset(layout, 'layerExt');
  const res = resolveFieldInstances(config);
  const { instanceGates, layerGates } = fieldGatesForConfig(config);
  res.instances.forEach((inst, i) => {
    const gate = instanceGates[i] ?? NO_FIELD_GATE;
    const a = (fieldExtBase + i * FIELD_EXT_TEXELS_PER_INSTANCE) * 4;
    data[a] = FALLOFF_SHAPE_IDS[inst.falloff ?? 'smooth'] ?? 0;
    data[a + 1] = gate.kind; data[a + 2] = gate.slot; data[a + 3] = gate.mode;
    data[a + 4] = gate.low; data[a + 5] = gate.high; data[a + 6] = gate.invert; data[a + 7] = 0;
    if (inst.kind === 'drag') {
      data[a + 8] = inst.target[0]; data[a + 9] = inst.target[1]; data[a + 10] = inst.target[2]; data[a + 11] = 0;
    } else if (inst.kind === 'crown') {
      data[a + 8] = inst.height; data[a + 9] = inst.width; data[a + 10] = 0; data[a + 11] = 0;
    }
  });
  res.layers.forEach((_layer, j) => {
    const gate = layerGates[j] ?? NO_FIELD_GATE;
    const a = (layerExtBase + j * FIELD_LAYER_EXT_TEXELS) * 4;
    data[a] = gate.kind; data[a + 1] = gate.slot; data[a + 2] = gate.mode; data[a + 3] = gate.low;
    data[a + 4] = gate.high; data[a + 5] = gate.invert; data[a + 6] = 0; data[a + 7] = 0;
  });
  return { fieldExtBase, layerExtBase };
}

// ── CPU twins of the instance force laws ─────────────────────
//
// The GLSL twin is kaloFieldForce in the velocity helpers.
// `gust` is the already-scaled gust vector (the shader's
// vnoise expression times uWindGust); pass [0, 0, 0] for the
// gust-free form. Gates (grpWind / grpVortex / grpWell) are
// NOT applied here — the shader multiplies them per kind, the
// caller here does the same.

/** The localising falloff: the wind volume's (1-(d/R)^2)^2
 *  under the default shape. A shape argument (an instance's
 *  authored `falloff` field) selects another curve from
 *  lib/gpgpuWindVolume.ts; omitting it — or passing an
 *  unrecognised value — keeps the legacy values bit for bit. */
export function fieldInstanceFalloff(distance: number, radius: number, shape?: FalloffShape): number {
  return shape === undefined
    ? windVolumeFalloff(distance, radius)
    : falloffShapeValue(resolveFalloffShape(shape), distance, radius);
}

/**
 * One instance's Δv for one particle (before the per-kind
 * force-gate multiplier). `layerWeight` is the resolved layer
 * weight INCLUDING any per-particle slot modulation (1 for an
 * unlayered instance). Outside the radius the contribution is
 * exactly zero. `vel` is the particle's current velocity —
 * only the drag daemon reads it (its law is a relaxation
 * toward a target velocity); every other kind ignores it, so
 * existing callers keep their meaning.
 */
export function fieldInstanceForce(
  inst: ResolvedFieldInstance,
  layerWeight: number,
  pos: [number, number, number],
  delta: number,
  gust: [number, number, number] = [0, 0, 0],
  vel: [number, number, number] = [0, 0, 0],
): [number, number, number] {
  const rel: [number, number, number] = [pos[0] - inst.pos[0], pos[1] - inst.pos[1], pos[2] - inst.pos[2]];
  if (inst.kind === 'crown') {
    // The crown's envelope is CYLINDRICAL (a ring in the XZ
    // plane, decaying with height), not the spherical falloff
    // below — it is daemonCrownForce with the height decay
    // read through the instance's falloff shape and the layer
    // weight folded in. Below the base or at / above the
    // column height the contribution is exactly zero.
    const cy = rel[1];
    if (!(inst.radius > 0) || !(inst.height > 0) || cy < 0 || cy >= inst.height) return [0, 0, 0];
    const rho = Math.hypot(rel[0], rel[2]);
    const ring = daemonCrownRingProfile(rho, inst.radius, inst.width);
    const env = fieldInstanceFalloff(cy, inst.height, inst.falloff);
    const wgt = ring * env * layerWeight;
    if (wgt <= 0) return [0, 0, 0];
    let dx = 0;
    let dz = 0;
    if (rho > 1e-9) { dx = rel[0] / rho; dz = rel[2] / rho; }
    const len = Math.hypot(dx, DAEMON_CROWN_UP_BIAS, dz) || 1;
    const s = (inst.strength * wgt * Math.max(delta, 0) * DAEMON_CROWN_GAIN) / len;
    return [dx * s, DAEMON_CROWN_UP_BIAS * s, dz * s];
  }
  const dist = Math.hypot(rel[0], rel[1], rel[2]);
  const fall = fieldInstanceFalloff(dist, inst.radius, inst.falloff);
  if (fall <= 0) return [0, 0, 0];
  const w = fall * layerWeight;
  if (inst.kind === 'drag') {
    // The placed drag daemon (daemonDragDeltaV): an
    // exponential relaxation toward the target velocity,
    // localised by the same falloff — at the default shape
    // and layer weight 1 this IS daemonDragDeltaV term for
    // term (its weight is daemonDragWeight = the volume
    // falloff).
    const rate = clampDaemonDragRate(inst.strength);
    const k = 1 - Math.exp(-rate * fall * Math.max(delta, 0));
    const s = k * layerWeight;
    return [
      (inst.target[0] - vel[0]) * s,
      (inst.target[1] - vel[1]) * s,
      (inst.target[2] - vel[2]) * s,
    ];
  }
  if (inst.kind === 'vortex') {
    // tangent = axis × rel, normalised, at the legacy gain 80.
    const t: [number, number, number] = [
      inst.vec[1] * rel[2] - inst.vec[2] * rel[1],
      inst.vec[2] * rel[0] - inst.vec[0] * rel[2],
      inst.vec[0] * rel[1] - inst.vec[1] * rel[0],
    ];
    const tl = Math.hypot(t[0], t[1], t[2]);
    if (!(tl > 0.001)) return [0, 0, 0];
    const s = (inst.strength * w * delta * 80) / tl;
    return [t[0] * s, t[1] * s, t[2] * s];
  }
  if (inst.kind === 'well') {
    // Pull (legacy gain 2000) + orbit tangent (legacy gain 50).
    const d = Math.max(dist + inst.softening, 0.001);
    const pull = (inst.strength * w * delta * 2000) / (d * d);
    const toC: [number, number, number] = [-rel[0], -rel[1], -rel[2]];
    const nLen = Math.hypot(toC[0] + 0.001, toC[1], toC[2]) || 1;
    const n: [number, number, number] = [(toC[0] + 0.001) / nLen, toC[1] / nLen, toC[2] / nLen];
    // orbit tangent = cross(n, (0, 1, 0)) = (-n.z, 0, n.x)
    const orbitTan: [number, number, number] = [-n[2], 0, n[0]];
    const os = inst.orbit * w * delta * 50;
    return [
      toC[0] * pull + orbitTan[0] * os,
      toC[1] * pull + orbitTan[1] * os,
      toC[2] * pull + orbitTan[2] * os,
    ];
  }
  // Wind: (dir * strength + gust) at the legacy wind gain 30.
  const s = w * delta * 30;
  return [
    (inst.vec[0] * inst.strength + gust[0]) * s,
    (inst.vec[1] * inst.strength + gust[1]) * s,
    (inst.vec[2] * inst.strength + gust[2]) * s,
  ];
}

// ── THREE supply (the terrain-derived-maps pattern) ──────────
//
// The passes resolve the texture per frame through this
// cached getter: the pack is a pure function of the two keys,
// so a module-level cache keyed by their exact strings is the
// whole contract. Null while no instance exists — the passes
// then leave every field uniform at its inert entry and the
// variant is never built.

export interface FieldColumnSupply extends Omit<FieldColumnPack, 'data'> {
  texture: THREE.DataTexture;
}

let fieldColumnCache: { signature: string; supply: FieldColumnSupply } | null = null;

export function getFieldColumnSupply(config: FieldConfigSlice): FieldColumnSupply | null {
  const resolution = resolveFieldInstances(config);
  if (!resolution.active) return null;
  const signature = `${config.gpgpuFieldInstances ?? ''}\n${config.gpgpuFieldLayers ?? ''}`;
  if (fieldColumnCache && fieldColumnCache.signature === signature) return fieldColumnCache.supply;
  const pack = packFieldColumnData(resolution);
  const texture = new THREE.DataTexture(pack.data, pack.width, pack.height, THREE.RGBAFormat, THREE.FloatType);
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  if (fieldColumnCache) fieldColumnCache.supply.texture.dispose();
  const { data: _data, ...rest } = pack;
  const supply: FieldColumnSupply = { ...rest, texture };
  fieldColumnCache = { signature, supply };
  return supply;
}
