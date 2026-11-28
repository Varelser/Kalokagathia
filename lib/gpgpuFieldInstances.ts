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
 *     { kind: 'vortex' | 'well' | 'wind',
 *       pos: [x, y, z], radius, strength,
 *       tilt (vortex), dir: [x, y, z] (wind),
 *       softening, orbit (well) }
 *   gpgpuFieldLayers: JSON array of
 *     { name?, weight, slot (-1 = none, else 0..3),
 *       members: [1-based instance indices] }
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
import { windVolumeFalloff } from './gpgpuWindVolume';

export type FieldInstanceKind = 'vortex' | 'well' | 'wind';

/** GLSL kind ids (texel C.x of an instance record). */
export const FIELD_INSTANCE_KIND_IDS: Record<FieldInstanceKind, number> = {
  vortex: 0,
  well: 1,
  wind: 2,
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
}

export interface ResolvedFieldInstance extends FieldInstanceDef {
  kindId: number;
  /** Unit vector the shader reads: the vortex axis (from tilt,
   *  the legacy formula) or the normalised wind direction.
   *  Unused for wells (0, 1, 0 placeholder). */
  vec: [number, number, number];
  /** Index into the resolved layer list, or -1 for no layer. */
  layerIndex: number;
}

export interface FieldLayerDef {
  name: string;
  weight: number;
  /** Attribute slot for the per-particle weight modulation,
   *  -1 = no modulation (the layer weight applies as-is). */
  slot: number;
  /** 1-based instance indices (the authoring order). */
  members: number[];
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

/** Tolerant parse of the instance key (groups discipline:
 *  unknown kinds and non-objects are skipped, bad numbers fall
 *  back per field, the list is capped). */
export function parseFieldInstances(data: string | undefined): FieldInstanceDef[] {
  const out: FieldInstanceDef[] = [];
  for (const item of parseJsonArray(data)) {
    if (out.length >= FIELD_INSTANCE_MAX) break;
    if (!item || typeof item !== 'object') continue;
    const d = item as Record<string, unknown>;
    if (d.kind !== 'vortex' && d.kind !== 'well' && d.kind !== 'wind') continue;
    out.push({
      kind: d.kind,
      pos: vec3Or(d.pos, [0, 0, 0]),
      radius: Math.max(0, finiteOr(d.radius, 60)),
      strength: finiteOr(d.strength, 1),
      tilt: finiteOr(d.tilt, 0),
      dir: vec3Or(d.dir, [1, 0, 0]),
      softening: Math.max(0, finiteOr(d.softening, 10)),
      orbit: finiteOr(d.orbit, 0.5),
    });
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
    out.push({
      name: typeof d.name === 'string' && d.name.length > 0 ? d.name.slice(0, 80) : '',
      weight: finiteOr(d.weight, 1),
      slot: slotRaw >= 0 && slotRaw <= 3 ? slotRaw : -1,
      members,
    });
  }
  return out;
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

// ── CPU twins of the instance force laws ─────────────────────
//
// The GLSL twin is kaloFieldForce in the velocity helpers.
// `gust` is the already-scaled gust vector (the shader's
// vnoise expression times uWindGust); pass [0, 0, 0] for the
// gust-free form. Gates (grpWind / grpVortex / grpWell) are
// NOT applied here — the shader multiplies them per kind, the
// caller here does the same.

/** The localising falloff: the wind volume's (1-(d/R)^2)^2. */
export function fieldInstanceFalloff(distance: number, radius: number): number {
  return windVolumeFalloff(distance, radius);
}

/**
 * One instance's Δv for one particle (before the per-kind
 * force-gate multiplier). `layerWeight` is the resolved layer
 * weight INCLUDING any per-particle slot modulation (1 for an
 * unlayered instance). Outside the radius the contribution is
 * exactly zero.
 */
export function fieldInstanceForce(
  inst: ResolvedFieldInstance,
  layerWeight: number,
  pos: [number, number, number],
  delta: number,
  gust: [number, number, number] = [0, 0, 0],
): [number, number, number] {
  const rel: [number, number, number] = [pos[0] - inst.pos[0], pos[1] - inst.pos[1], pos[2] - inst.pos[2]];
  const dist = Math.hypot(rel[0], rel[1], rel[2]);
  const fall = fieldInstanceFalloff(dist, inst.radius);
  if (fall <= 0) return [0, 0, 0];
  const w = fall * layerWeight;
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
