/**
 * Named particle groups (Phase CV — generic group retention).
 *
 * Until Phase AK the app had exactly one group: an unnamed live
 * predicate over one attribute slot, feeding only the velocity
 * force gate. Phase CV generalises that into a small library of
 * NAMED groups, following the three rulings made when the phase
 * was approved:
 *
 *  1. Definitions live in ONE serialised config key
 *     (`gpgpuGroupsData`, a JSON string; empty = no groups, which
 *     keeps the default configuration bit-identical). The force
 *     gate selects a group through the flat `gpgpuGroupRef` key;
 *     an empty ref keeps the legacy Phase AK predicate path
 *     exactly as before.
 *  2. Share links carry predicate definitions only. Frozen
 *     snapshots (and composites that depend on them) are dropped
 *     by `filterGpgpuGroupsForLink` at link-encode time; they
 *     persist in local saves and user presets.
 *  3. The first consumer is the existing force gate: when a ref
 *     is set, the gate samples a per-particle membership texture
 *     baked on the CPU from the same attribute data the legacy
 *     predicate reads, so predicate groups agree with
 *     `groupMembership` bit for bit.
 *
 * A group source is one of:
 *  - predicate: a live range test over one attribute slot
 *    (slot / mode / low / high / invert — the Phase AK shape);
 *  - snapshot: a frozen member list ("retention" — the members
 *    stay even when attribute values move afterwards), stored as
 *    base64 little-endian Uint32 indices into the attribute
 *    texture's particle order;
 *  - composite: the union or intersection of two other groups
 *    (which may themselves be composites of predicates).
 */

import { groupMembership, type AttrGroupMode } from './gpgpuAttributes';

export interface GpgpuGroupPredicate {
  slot: number;
  mode: AttrGroupMode;
  low: number;
  high: number;
  invert: boolean;
}

export type GpgpuGroupSource =
  | { kind: 'predicate'; predicate: GpgpuGroupPredicate }
  | { kind: 'snapshot'; indicesB64: string }
  | { kind: 'composite'; a: string; b: string; op: 'union' | 'intersection' };

export interface GpgpuGroupDef {
  id: string;
  name: string;
  source: GpgpuGroupSource;
}

/** Hard caps so a pasted or corrupted payload cannot grow the
 *  config without bound. A snapshot of every particle in the
 *  largest texture (512² indices ≈ 1 MB raw ≈ 1.4 MB base64)
 *  fits under the char cap; typical groups are far smaller. */
export const GPGPU_GROUPS_MAX_DEFS = 16;
export const GPGPU_GROUPS_MAX_CHARS = 2_000_000;

const GROUP_ID_RE = /^[A-Za-z0-9._-]{1,64}$/;
const GROUP_MODES: ReadonlyArray<AttrGroupMode> = ['below', 'above', 'band'];

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function parsePredicate(raw: unknown): GpgpuGroupPredicate | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Record<string, unknown>;
  if (!isFiniteNumber(p.slot) || Math.round(p.slot) !== p.slot || p.slot < 0 || p.slot > 3) return null;
  if (!GROUP_MODES.includes(p.mode as AttrGroupMode)) return null;
  if (!isFiniteNumber(p.low) || !isFiniteNumber(p.high)) return null;
  return {
    slot: p.slot,
    mode: p.mode as AttrGroupMode,
    low: Math.max(0, Math.min(1, p.low)),
    high: Math.max(0, Math.min(1, p.high)),
    invert: p.invert === true,
  };
}

function parseSource(raw: unknown): GpgpuGroupSource | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  if (s.kind === 'predicate') {
    const predicate = parsePredicate(s.predicate);
    return predicate ? { kind: 'predicate', predicate } : null;
  }
  if (s.kind === 'snapshot') {
    if (typeof s.indicesB64 !== 'string' || s.indicesB64.length === 0) return null;
    if (!/^[A-Za-z0-9+/=]+$/.test(s.indicesB64)) return null;
    return { kind: 'snapshot', indicesB64: s.indicesB64 };
  }
  if (s.kind === 'composite') {
    if (typeof s.a !== 'string' || typeof s.b !== 'string') return null;
    if (!GROUP_ID_RE.test(s.a) || !GROUP_ID_RE.test(s.b)) return null;
    if (s.op !== 'union' && s.op !== 'intersection') return null;
    return { kind: 'composite', a: s.a, b: s.b, op: s.op };
  }
  return null;
}

/**
 * Parse the serialised key into validated definitions. Anything
 * malformed is dropped quietly (the config must never crash the
 * app); duplicate ids keep the first definition.
 */
export function parseGpgpuGroups(data: string): GpgpuGroupDef[] {
  if (!data) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(data);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const out: GpgpuGroupDef[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (out.length >= GPGPU_GROUPS_MAX_DEFS) break;
    if (!item || typeof item !== 'object') continue;
    const d = item as Record<string, unknown>;
    if (typeof d.id !== 'string' || !GROUP_ID_RE.test(d.id) || seen.has(d.id)) continue;
    const source = parseSource(d.source);
    if (!source) continue;
    seen.add(d.id);
    out.push({
      id: d.id,
      name: typeof d.name === 'string' && d.name.length > 0 ? d.name.slice(0, 80) : d.id,
      source,
    });
  }
  return out;
}

/** Serialise definitions back into the config key ('' when empty).
 *  Returns null when the payload would exceed the char cap. */
export function serializeGpgpuGroups(defs: ReadonlyArray<GpgpuGroupDef>): string | null {
  if (defs.length === 0) return '';
  const text = JSON.stringify(defs);
  return text.length <= GPGPU_GROUPS_MAX_CHARS ? text : null;
}

export function findGpgpuGroup(defs: ReadonlyArray<GpgpuGroupDef>, id: string): GpgpuGroupDef | null {
  return defs.find((d) => d.id === id) ?? null;
}

/** A fresh, collision-free group id (timestamp + counter-free
 *  random suffix; ids are labels only, never render inputs). */
export function makeGpgpuGroupId(defs: ReadonlyArray<GpgpuGroupDef>): string {
  const taken = new Set(defs.map((d) => d.id));
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const id = `g${Date.now().toString(36)}${Math.floor(Math.random() * 0xffffff).toString(36)}`;
    if (!taken.has(id)) return id;
  }
  return `g${Date.now().toString(36)}x${defs.length}`;
}

/** Snapshot index codec: base64 of little-endian Uint32 bytes. */
export function encodeSnapshotIndices(indices: Uint32Array): string {
  const bytes = new Uint8Array(indices.buffer, indices.byteOffset, indices.byteLength);
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

export function decodeSnapshotIndices(b64: string): Uint32Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  const usable = bytes.length - (bytes.length % 4);
  return new Uint32Array(bytes.buffer, 0, usable / 4);
}

/**
 * Evaluate one group's membership over the attribute bake.
 * `attrData` is the bake's interleaved RGBA float array (channel
 * = slot), `count` the particle slots it covers (texSize²).
 * Returns null for an unknown id or a cyclic composite.
 */
export function evaluateGpgpuGroup(
  defs: ReadonlyArray<GpgpuGroupDef>,
  id: string,
  attrData: Float32Array,
  count: number,
): Uint8Array | null {
  const byId = new Map(defs.map((d) => [d.id, d]));
  const visiting = new Set<string>();
  const evalDef = (def: GpgpuGroupDef): Uint8Array | null => {
    if (visiting.has(def.id)) return null;
    visiting.add(def.id);
    const out = new Uint8Array(count);
    const src = def.source;
    if (src.kind === 'snapshot') {
      const indices = decodeSnapshotIndices(src.indicesB64);
      for (const i of indices) if (i < count) out[i] = 1;
    } else if (src.kind === 'predicate') {
      const p = src.predicate;
      const stride = 4;
      for (let i = 0; i < count; i += 1) {
        out[i] = groupMembership(attrData[i * stride + p.slot], p.mode, p.low, p.high, p.invert);
      }
    } else {
      const a = byId.get(src.a);
      const b = byId.get(src.b);
      if (!a || !b) return null;
      const ma = evalDef(a);
      const mb = evalDef(b);
      if (!ma || !mb) return null;
      for (let i = 0; i < count; i += 1) {
        out[i] = src.op === 'union' ? (ma[i] | mb[i]) : (ma[i] & mb[i]);
      }
    }
    visiting.delete(def.id);
    return out;
  };
  const def = byId.get(id);
  return def ? evalDef(def) : null;
}

/**
 * Freeze a group: replace its source with a snapshot of its
 * CURRENT membership (evaluated against the given bake), keeping
 * id and name. Returns the new definition list, or null when the
 * group cannot be evaluated or is already a snapshot.
 */
export function freezeGpgpuGroup(
  defs: ReadonlyArray<GpgpuGroupDef>,
  id: string,
  attrData: Float32Array,
  count: number,
): GpgpuGroupDef[] | null {
  const def = findGpgpuGroup(defs, id);
  if (!def || def.source.kind === 'snapshot') return null;
  const membership = evaluateGpgpuGroup(defs, id, attrData, count);
  if (!membership) return null;
  const indices: number[] = [];
  for (let i = 0; i < count; i += 1) if (membership[i] === 1) indices.push(i);
  const frozen: GpgpuGroupDef = {
    id: def.id,
    name: def.name,
    source: { kind: 'snapshot', indicesB64: encodeSnapshotIndices(Uint32Array.from(indices)) },
  };
  return defs.map((d) => (d.id === id ? frozen : d));
}

/**
 * The slot whose bake channel carries a baked group's membership
 * (see resolveGroupGate). The last slot: predicate groups keep
 * their own slot, and slot 4 is the least likely to be a drive
 * target — but while a snapshot/composite group gates, drives
 * reading slot 4 see membership (0/1) instead of values. That
 * trade-off is documented in the panel.
 */
export const GPGPU_GROUP_BAKED_SLOT = 3;

export type GroupGateResolution =
  | { kind: 'legacy' }
  | { kind: 'predicate'; predicate: GpgpuGroupPredicate }
  | { kind: 'baked'; slot: number };

/**
 * How the force gate resolves the group reference. The velocity
 * fragment shader already links every texture unit the platform
 * guarantees (16/16), so a named group can NEVER get its own
 * membership texture there — instead:
 *  - a predicate group compiles down to the legacy gate itself
 *    (the GLSL twin evaluates the same predicate; only the
 *    uniform values come from the definition);
 *  - a snapshot/composite group is baked into the attribute
 *    texture's spare slot channel as exact 0/1 membership, and
 *    the gate reads it as "above 0.5" on that slot.
 * An empty or dangling ref resolves to the legacy path.
 */
export function resolveGroupGate(
  defs: ReadonlyArray<GpgpuGroupDef>,
  ref: string,
): GroupGateResolution {
  if (!ref) return { kind: 'legacy' };
  const def = findGpgpuGroup(defs, ref);
  if (!def) return { kind: 'legacy' };
  if (def.source.kind === 'predicate') return { kind: 'predicate', predicate: def.source.predicate };
  return { kind: 'baked', slot: GPGPU_GROUP_BAKED_SLOT };
}

/**
 * The share-link view of the group library (ruling 2): predicate
 * groups survive; snapshots are dropped, and composites are kept
 * only when everything they transitively reference survives.
 */
export function filterGpgpuGroupsForLink(
  defs: ReadonlyArray<GpgpuGroupDef>,
): { defs: GpgpuGroupDef[]; droppedIds: string[] } {
  const byId = new Map(defs.map((d) => [d.id, d]));
  const keeps = new Map<string, boolean>();
  const keep = (def: GpgpuGroupDef, visiting: Set<string>): boolean => {
    const cached = keeps.get(def.id);
    if (cached !== undefined) return cached;
    if (visiting.has(def.id)) return false;
    visiting.add(def.id);
    let result: boolean;
    if (def.source.kind === 'predicate') result = true;
    else if (def.source.kind === 'snapshot') result = false;
    else {
      const a = byId.get(def.source.a);
      const b = byId.get(def.source.b);
      result = !!a && !!b && keep(a, visiting) && keep(b, visiting);
    }
    visiting.delete(def.id);
    keeps.set(def.id, result);
    return result;
  };
  const kept: GpgpuGroupDef[] = [];
  const droppedIds: string[] = [];
  for (const def of defs) {
    if (keep(def, new Set())) kept.push(def);
    else droppedIds.push(def.id);
  }
  return { defs: kept, droppedIds };
}
