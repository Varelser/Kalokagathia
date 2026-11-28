/**
 * Emitter list (Layer 1 WP4 phase D1 — design:
 * kalokagathia-pro/LAYER1_WP4_IMPL_RECORD.md and the phase D
 * design memo).
 *
 * Until this module the emitter definition was a SINGLETON:
 * one shape / transform / initial-velocity law for the whole
 * pool (lib/gpgpuEmitter.ts). This module turns it into a
 * LIST — up to EMITTER_LIST_MAX placed emitters, each with
 * its own shape, respawn shape, transform and initial
 * velocity — authored through one JSON string key, the
 * gpgpuFieldInstances / gpgpuGroupsData precedent:
 *
 *   gpgpuEmitters: JSON array of
 *     { shape, respawnShape ('auto' = the legacy placement),
 *       pos: [x, y, z], rot: [x, y, z] (Euler degrees),
 *       scale,
 *       velMode ('cube' | 'directed'), velDir: [x, y, z],
 *       velSpeed, velSpread,
 *       weight (>= 0, default 1), lightUnit (1..4,
 *       default 1), weightFromLight (bool, default false) }
 *
 * Replacement discipline: while the list names at least one
 * valid element it REPLACES the single-emitter keys as the
 * placement law (there can only be one placement law);
 * while it is empty / malformed / all-invalid, resolution
 * falls back to resolveEmitterDef(config) verbatim, the
 * variant predicate is false, and every output of every
 * consumer stays bit-identical to the legacy single-emitter
 * behaviour. The single exception a list can never break:
 * an authored list holding exactly the element the legacy
 * keys describe (emitterDefToListElement) resolves to that
 * same emitter, so routing it through the list reproduces
 * the legacy bake bit for bit (pinned by the D1 test).
 *
 * Assignment: particle i belongs to emitter k for its whole
 * life (re-births included). The assignment is a pure hash
 * of the texel index — emitterHashForIndex, a dedicated
 * dmHash11 offset (17.17, 9.43), NOT the spawn hash
 * (7.77, 3.13), the event hash (5.39, 8.17) or the lifetime
 * hash (11.31, 4.77) — walked against the weight bands the
 * resolution bakes into cumWeightEnd. Being a pure function
 * of the index it consumes NO draws from the seeded RNG
 * stream, which is exactly what keeps the equivalent-single
 * bake bit-identical. The spawn gate (lib/gpgpuLifecycle.ts)
 * stays the pool's clock and is untouched: the gate decides
 * WHEN a particle is born, the band decides WHICH emitter's
 * law places it. The emitter's "rate" is therefore a birth
 * SHARE (its weight over the pool total); while an absolute
 * rate key is also authored, emitter k's expected absolute
 * rate is share_k x the pool rate. weightFromLight makes the
 * effective weight weight x the named light unit's intensity
 * (resolved on the CPU through lib/gpgpuLightUnits.ts — the
 * shader never reads a light key for this).
 *
 * Column supply (D2's groundwork, packed here): the records
 * append ONE section after the path sections of the shared
 * column texture (EMITTER_COLUMN_REQUESTS extends
 * PATH_COLUMN_REQUESTS, append-only — the fields / layers /
 * path offsets never move, and the emitters section starts
 * at texel 1280). One record is EMITTER_RECORD_TEXELS = 7
 * texels:
 *   T0 = (pos.x, pos.y, pos.z, cumWeightEnd)
 *   T1 = (m00, m10, m20, shapeId)        rot*scale column 0
 *   T2 = (m01, m11, m21, velMode)        column 1; 0 cube / 1 directed
 *   T3 = (m02, m12, m22, lightUnit)      column 2
 *   T4 = (velDir.x, velDir.y, velDir.z, velSpeed)  (normalised dir)
 *   T5 = (velSpread, weight, respawnShapeId, 0)   'auto' = -1
 *   T6 = (lightPos.x, lightPos.y, lightPos.z, 0)  (resolved unit pos)
 * No new sampler: the column texture is the one the passes
 * already upload (phase C's texture-budget discipline).
 *
 * GLSL twin (D2): the assignment hash transcribes as
 *   float emitterAssignHash(vec2 uv) {
 *     float n = (uv.x + 17.17) * 127.1 + (uv.y + 9.43) * 311.7;
 *     return dmHash11(n);   // the shared dmHash11 twin
 *   }
 * — keep the offset constants in sync with emitterHashForUv.
 *
 * This module is D1: definitions, resolution, assignment,
 * the column pack and the bake's per-particle law (through
 * lib/gpgpuInitialData.ts GpgpuEmitOptions.emitterList).
 * The respawn / velocity-pass wiring is D2 / D3.
 */

import type { ParticleConfig } from '../types';
import { dmHash11 } from './gpgpuRandom';
import {
  clampEmitterVelSpeed,
  clampEmitterVelSpread,
  emitterRotScaleElements,
  resolveEmitterDef,
  type GpgpuEmitterDef,
  type GpgpuRespawnShape,
} from './gpgpuEmitter';
import { EMIT_SHAPE_IDS, type GpgpuEmitShape } from './gpgpuEmitShapes';
import {
  clampLightUnitIndex,
  resolveEmitLightUnit,
  resolveEmitLightPos,
  resolveLightUnit,
  type LightUnitPos,
} from './gpgpuLightUnits';
import {
  buildColumnLayout,
  columnSectionOffset,
  type ColumnLayout,
  type ColumnSectionRequest,
} from './gpgpuFieldInstances';
import { PATH_COLUMN_REQUESTS } from './gpgpuColumnLayout';

export const EMITTER_LIST_MAX = 8;
/** Texels per emitter record in the column texture (T0..T6). */
export const EMITTER_RECORD_TEXELS = 7;

/** One authored emitter: the single-emitter definition's
 *  fields in list form, plus the list-only fields. */
export interface GpgpuEmitterListElement {
  shape: GpgpuEmitShape;
  respawnShape: GpgpuRespawnShape;
  /** Transform translation (the single key's PosX/Y/Z). */
  pos: [number, number, number];
  /** Transform rotation, Euler XYZ in degrees. */
  rot: [number, number, number];
  /** Transform uniform scale. */
  scale: number;
  velMode: 'cube' | 'directed';
  velDir: [number, number, number];
  velSpeed: number;
  velSpread: number;
  /** Birth share weight (>= 0). 0 = never assigned. */
  weight: number;
  /** Light unit (1..4) the 'light' shape / 'auto' light
   *  ball of THIS emitter reads. */
  lightUnit: number;
  /** True: the effective weight is weight x the light
   *  unit's intensity. */
  weightFromLight: boolean;
}

/** A resolved emitter: the placement law plus the band and
 *  supply values every consumer shares. */
export interface ResolvedEmitter {
  def: GpgpuEmitterDef;
  /** Effective weight (weightFromLight applied, >= 0). */
  weight: number;
  /** Normalised birth share, weight / total (equal shares
   *  when every effective weight is 0). */
  share: number;
  /** Cumulative share at this element's band end, in (0, 1];
   *  the last element's is exactly 1. */
  cumWeightEnd: number;
  /** The light unit this emitter reads (1..4). */
  lightUnit: number;
  /** The resolved position of that unit. */
  lightPos: LightUnitPos;
  /** Directed-velocity bake spec (the base direction
   *  normalised by the resolveEmitterBaseDirection rule),
   *  or null while the element's velocity mode is 'cube'.
   *  Derived from def.initialVelocity at resolve time so
   *  the bake consumes one shape on both routes. */
  velocity: { dir: LightUnitPos; speed: number; spread: number } | null;
}

export interface EmitterListResolution {
  emitters: ResolvedEmitter[];
  /** True while the gpgpuEmitters key authored the list;
   *  false on the legacy single-emitter fallback. */
  listAuthored: boolean;
}

export type EmitterListConfigSlice = Pick<ParticleConfig,
  | 'gpgpuEmitters'
  | 'gpgpuEmitShape' | 'gpgpuRespawnShape'
  | 'gpgpuEmitterPosX' | 'gpgpuEmitterPosY' | 'gpgpuEmitterPosZ'
  | 'gpgpuEmitterRotX' | 'gpgpuEmitterRotY' | 'gpgpuEmitterRotZ'
  | 'gpgpuEmitterScale'
  | 'gpgpuEmitterVelMode' | 'gpgpuEmitterVelDirX' | 'gpgpuEmitterVelDirY' | 'gpgpuEmitterVelDirZ'
  | 'gpgpuEmitterVelSpeed' | 'gpgpuEmitterVelSpread'
  | 'gpgpuLightEnabled' | 'gpgpuLightPosX' | 'gpgpuLightPosY' | 'gpgpuLightPosZ'
  | 'gpgpuLightIntensity' | 'gpgpuLightRadius'
  | 'gpgpuLight2Enabled' | 'gpgpuLight2PosX' | 'gpgpuLight2PosY' | 'gpgpuLight2PosZ'
  | 'gpgpuLight2Intensity' | 'gpgpuLight2Radius'
  | 'gpgpuLight3Enabled' | 'gpgpuLight3PosX' | 'gpgpuLight3PosY' | 'gpgpuLight3PosZ'
  | 'gpgpuLight3Intensity' | 'gpgpuLight3Radius'
  | 'gpgpuLight4Enabled' | 'gpgpuLight4PosX' | 'gpgpuLight4PosY' | 'gpgpuLight4PosZ'
  | 'gpgpuLight4Intensity' | 'gpgpuLight4Radius'
  | 'gpgpuEmitLightUnit'>;

const EMIT_SHAPES: readonly GpgpuEmitShape[] = ['sphere', 'disc', 'ring', 'box', 'shell', 'cone', 'light'];

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

function isEmitShape(value: unknown): value is GpgpuEmitShape {
  return typeof value === 'string' && (EMIT_SHAPES as readonly string[]).includes(value);
}

/**
 * Tolerant parse of the list key (the field-instances
 * discipline: non-objects and unknown shapes are skipped,
 * bad numbers fall back per field, the list is capped).
 * The result is fully normalised — clamps applied — so a
 * serialise round-trip is stable.
 */
export function parseEmitterList(data: string | undefined): GpgpuEmitterListElement[] {
  const out: GpgpuEmitterListElement[] = [];
  for (const item of parseJsonArray(data)) {
    if (out.length >= EMITTER_LIST_MAX) break;
    if (!item || typeof item !== 'object') continue;
    const d = item as Record<string, unknown>;
    if (!isEmitShape(d.shape)) continue;
    out.push({
      shape: d.shape,
      respawnShape: d.respawnShape === 'auto' || isEmitShape(d.respawnShape) ? d.respawnShape : 'auto',
      pos: vec3Or(d.pos, [0, 0, 0]),
      rot: vec3Or(d.rot, [0, 0, 0]),
      scale: finiteOr(d.scale, 1),
      velMode: d.velMode === 'directed' ? 'directed' : 'cube',
      velDir: vec3Or(d.velDir, [0, 1, 0]),
      velSpeed: clampEmitterVelSpeed(finiteOr(d.velSpeed, 2)),
      velSpread: clampEmitterVelSpread(finiteOr(d.velSpread, 0.5)),
      weight: Math.max(0, finiteOr(d.weight, 1)),
      lightUnit: clampLightUnitIndex(typeof d.lightUnit === 'number' ? d.lightUnit : undefined),
      weightFromLight: d.weightFromLight === true,
    });
  }
  return out;
}

/** Serialise elements back into the config key ('' when
 *  empty — the serializeFieldInstances precedent). */
export function serializeEmitterList(elements: ReadonlyArray<GpgpuEmitterListElement>): string {
  if (elements.length === 0) return '';
  return JSON.stringify(elements);
}

/** One element's placement law (the GpgpuEmitterDef form
 *  both placement routes consume). */
export function emitterElementToDef(el: GpgpuEmitterListElement): GpgpuEmitterDef {
  return {
    shape: el.shape,
    respawnShape: el.respawnShape,
    transform: {
      posX: el.pos[0], posY: el.pos[1], posZ: el.pos[2],
      rotX: el.rot[0], rotY: el.rot[1], rotZ: el.rot[2],
      scale: el.scale,
    },
    initialVelocity: el.velMode === 'directed'
      ? { mode: 'directed', dirX: el.velDir[0], dirY: el.velDir[1], dirZ: el.velDir[2], speed: el.velSpeed, spread: el.velSpread }
      : { mode: 'cube', speed: 2 },
  };
}

/**
 * The legacy single-emitter definition as a list element —
 * the migration helper: authoring a list that holds exactly
 * this element reproduces the legacy placement law (the
 * bake bit-identically; see the header).
 */
export function emitterDefToListElement(config: EmitterListConfigSlice): GpgpuEmitterListElement {
  const def = resolveEmitterDef(config);
  const t = def.transform;
  const base: GpgpuEmitterListElement = {
    shape: def.shape,
    respawnShape: def.respawnShape,
    pos: [t.posX, t.posY, t.posZ],
    rot: [t.rotX, t.rotY, t.rotZ],
    scale: t.scale,
    velMode: 'cube',
    velDir: [0, 1, 0],
    velSpeed: 2,
    velSpread: 0.5,
    weight: 1,
    lightUnit: resolveEmitLightUnit(config),
    weightFromLight: false,
  };
  if (def.initialVelocity.mode === 'directed') {
    base.velMode = 'directed';
    base.velDir = [def.initialVelocity.dirX, def.initialVelocity.dirY, def.initialVelocity.dirZ];
    base.velSpeed = def.initialVelocity.speed;
    base.velSpread = def.initialVelocity.spread;
  }
  return base;
}

/** The directed base direction of one def, normalised by
 *  the resolveEmitterBaseDirection rule (the authored axis
 *  normalised, +Y for a zero / near-zero axis). */
function defBaseDirection(def: GpgpuEmitterDef): LightUnitPos {
  if (def.initialVelocity.mode !== 'directed') return { x: 0, y: 1, z: 0 };
  const { dirX: x, dirY: y, dirZ: z } = def.initialVelocity;
  const len = Math.hypot(x, y, z);
  if (!(len > 0.0001)) return { x: 0, y: 1, z: 0 };
  return { x: x / len, y: y / len, z: z / len };
}

function resolveOne(
  def: GpgpuEmitterDef,
  effectiveWeight: number,
  lightUnit: number,
  lightPos: LightUnitPos,
): ResolvedEmitter {
  return {
    def,
    weight: effectiveWeight,
    share: 0,
    cumWeightEnd: 0,
    lightUnit,
    lightPos,
    velocity: def.initialVelocity.mode === 'directed'
      ? { dir: defBaseDirection(def), speed: def.initialVelocity.speed, spread: def.initialVelocity.spread }
      : null,
  };
}

/**
 * The single resolution every consumer shares. An authored
 * list (at least one valid element) replaces the single
 * emitter; anything else falls back to the legacy def with
 * share 1. Bands: shares are the effective weights over
 * their total — or equal shares when every effective
 * weight is 0 (a zero total must never silently drop the
 * whole pool onto element 0).
 */
export function resolveEmitterList(config: EmitterListConfigSlice): EmitterListResolution {
  const elements = parseEmitterList(config.gpgpuEmitters ?? '');
  if (elements.length === 0) {
    const single = resolveOne(
      resolveEmitterDef(config),
      1,
      resolveEmitLightUnit(config),
      resolveEmitLightPos(config),
    );
    single.share = 1;
    single.cumWeightEnd = 1;
    return { emitters: [single], listAuthored: false };
  }
  const resolved = elements.map((el) => {
    const unit = resolveLightUnit(config, el.lightUnit);
    const effective = Math.max(0, el.weight * (el.weightFromLight ? unit.intensity : 1));
    return resolveOne(emitterElementToDef(el), effective, el.lightUnit, unit.pos);
  });
  const total = resolved.reduce((sum, e) => sum + e.weight, 0);
  let acc = 0;
  resolved.forEach((e, i) => {
    e.share = total > 0 ? e.weight / total : 1 / resolved.length;
    acc += e.share;
    e.cumWeightEnd = i === resolved.length - 1 ? 1 : acc;
  });
  return { emitters: resolved, listAuthored: true };
}

/** The variant predicate: at least one valid element is
 *  authored. While false, no consumer builds a list variant
 *  and every output is the legacy single-emitter one. */
export function emitterListActive(config: Pick<ParticleConfig, 'gpgpuEmitters'>): boolean {
  return parseEmitterList(config.gpgpuEmitters ?? '').length > 0;
}

// ── Assignment (dedicated hash, weight bands) ───────────────
//
// The GLSL transcription lives in the module header; keep
// the offset constants (17.17, 9.43) in sync.

/** Assignment hash in [0, 1): dmHash11 of the texel UV
 *  with the dedicated emitter offset (17.17, 9.43). */
export function emitterHashForUv(u: number, v: number): number {
  return dmHash11((u + 17.17) * 127.1 + (v + 9.43) * 311.7);
}

export function emitterHashForIndex(index: number, texSize: number): number {
  const size = Math.max(1, Math.floor(texSize));
  const idx = Math.max(0, Math.floor(index));
  const u = ((idx % size) + 0.5) / size;
  const v = (Math.floor(idx / size) + 0.5) / size;
  return emitterHashForUv(u, v);
}

/** The band walk: the first element whose cumWeightEnd
 *  exceeds the hash. A weight-0 element's band is empty, so
 *  it is never selected; a hash at or past the last end
 *  (float dust) lands on the last element. */
export function emitterIndexForHash(
  emitters: ReadonlyArray<Pick<ResolvedEmitter, 'cumWeightEnd'>>,
  hash: number,
): number {
  for (let i = 0; i < emitters.length; i++) {
    if (emitters[i].cumWeightEnd > hash) return i;
  }
  return Math.max(0, emitters.length - 1);
}

export function emitterIndexForIndex(
  emitters: ReadonlyArray<Pick<ResolvedEmitter, 'cumWeightEnd'>>,
  index: number,
  texSize: number,
): number {
  return emitterIndexForHash(emitters, emitterHashForIndex(index, texSize));
}

// ── Column-data pack (D2's supply groundwork) ───────────────
//
// The emitters section appends after B2's path sections
// (append-only): fields 0, layers 256, pathHeaders 512,
// pathPoints 768, emitters 1280.

export const EMITTER_COLUMN_REQUESTS: readonly ColumnSectionRequest[] = [
  ...PATH_COLUMN_REQUESTS,
  { id: 'emitters', texels: EMITTER_LIST_MAX * EMITTER_RECORD_TEXELS },
];

export const EMITTER_COLUMN_LAYOUT: ColumnLayout = buildColumnLayout(EMITTER_COLUMN_REQUESTS);

export interface EmitterColumnPack {
  emittersBase: number;
  emitterCount: number;
}

/**
 * Pack a resolution's records into an existing column data
 * array laid out by EMITTER_COLUMN_LAYOUT (the
 * packPathColumnData form). Record layout: see the module
 * header (T0..T6). Pure and deterministic — the same
 * resolution always packs to the same bytes.
 */
export function packEmitterColumnData(
  data: Float32Array,
  layout: ColumnLayout,
  resolution: EmitterListResolution,
): EmitterColumnPack {
  const emittersBase = columnSectionOffset(layout, 'emitters');
  resolution.emitters.forEach((e, i) => {
    const a = (emittersBase + i * EMITTER_RECORD_TEXELS) * 4;
    const t = e.def.transform;
    const m = emitterRotScaleElements(t);
    const iv = e.def.initialVelocity;
    const dir = e.velocity ? e.velocity.dir : { x: 0, y: 1, z: 0 };
    // T0: position + the assignment band's end.
    data[a] = t.posX; data[a + 1] = t.posY; data[a + 2] = t.posZ; data[a + 3] = e.cumWeightEnd;
    // T1..T3: rot*scale columns (emitterRotScaleElements is
    // column-major: [m00, m10, m20, m01, ...]) + per-column
    // tags.
    data[a + 4] = m[0]; data[a + 5] = m[1]; data[a + 6] = m[2]; data[a + 7] = EMIT_SHAPE_IDS[e.def.shape];
    data[a + 8] = m[3]; data[a + 9] = m[4]; data[a + 10] = m[5]; data[a + 11] = iv.mode === 'directed' ? 1 : 0;
    data[a + 12] = m[6]; data[a + 13] = m[7]; data[a + 14] = m[8]; data[a + 15] = e.lightUnit;
    // T4: the normalised directed axis + speed (inert
    // defaults while the mode is 'cube').
    data[a + 16] = dir.x; data[a + 17] = dir.y; data[a + 18] = dir.z;
    data[a + 19] = iv.mode === 'directed' ? iv.speed : 2;
    // T5: spread / effective weight / respawn shape id.
    data[a + 20] = iv.mode === 'directed' ? iv.spread : 0;
    data[a + 21] = e.weight;
    data[a + 22] = e.def.respawnShape === 'auto' ? -1 : EMIT_SHAPE_IDS[e.def.respawnShape];
    data[a + 23] = 0;
    // T6: the resolved light position.
    data[a + 24] = e.lightPos.x; data[a + 25] = e.lightPos.y; data[a + 26] = e.lightPos.z; data[a + 27] = 0;
  });
  return { emittersBase, emitterCount: resolution.emitters.length };
}
