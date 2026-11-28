/**
 * Attribute channel mappings (Layer 1 WP2, phase B2).
 *
 * The attribute system already had three ways to WRITE the four
 * writable slots, and every one of them buries the channel-to-
 * channel relationship inside a per-slot expression: the bake
 * expressions, the dynamic / feedback re-evaluation and the
 * chain stage all say "slot N becomes f(own value, names, …)".
 * None of them states the data-flow fact "channel P feeds
 * channel Q" as data. This module adds that missing piece: a
 * mapping TABLE, stored in one serialised config key
 * (`gpgpuAttrMappings`, a JSON string; empty = no mappings, so
 * the default configuration is bit-identical and no mapping
 * stage ever exists).
 *
 * An entry is `{ from, to, expr? }` with channel NAMES on both
 * sides (resolved through lib/gpgpuAttributes.ts
 * `resolveAttrNameSlot`, the same name resolution the bake and
 * the Phase A graph channel-writes use, so a channel the graph
 * claimed is addressable here verbatim):
 *
 *  - `from` may name any slot 0..7 (the extended slots are
 *    read-only everywhere in the system, and reading is all a
 *    source does);
 *  - `to` must name a WRITABLE slot 0..3 — writing an extended
 *    slot is rejected (`ext-slot-read-only`, the
 *    assignPipelineExpressionSlots discipline);
 *  - `expr` omitted means the identity copy; when present it
 *    is a transform expression with the SOURCE channel's value
 *    bound to `x` (the dyn stage's "x = own value" precedent,
 *    generalised to "x = the input value"). No other variable
 *    is bound except the expression language's own built-ins
 *    and `t` (the sim clock, as in the dyn stage).
 *
 * Evaluation is sequential in entry order, against the current
 * values: a later entry whose source was an earlier entry's
 * target reads the NEW value (the dyn stage's ordered-locals
 * semantics). Each mapped result passes the same guard as the
 * dyn stage — a finite result with |r| < 1e30 is clamped to
 * [0, 1]; anything else keeps the target's current value.
 *
 * This module is the foundation only: the CPU twin
 * (`applyAttrMappings`) and the fragment builder
 * (`buildAttrMappingFragment`, modelled on
 * lib/expressionGlsl.ts `buildAttrDynFragment`) are here; the
 * scene wiring that runs the fragment as a stage (after the
 * chain stage, before the REP) belongs to phase B3.
 */

import {
  ATTR_EXT_SLOT_OFFSET,
  ATTR_SLOT_COUNT,
  resolveAttrNameSlot,
} from './gpgpuAttributes';
import {
  compileExpression,
  evaluateCompiledExpression,
} from './expression';
import {
  astToGlsl,
  ATTR_EXT_MAIN_LINES,
  ATTR_EXT_UNIFORM_LINES,
  type GlslVarResolver,
} from './expressionGlsl';

export interface AttrMappingEntry {
  from: string;
  to: string;
  expr?: string;
}

export interface ResolvedAttrMapping {
  fromSlot: number;
  toSlot: number;
  expr?: string;
}

export type AttrMappingRejectionReason =
  | 'unknown-source-channel'
  | 'unknown-target-channel'
  | 'ext-slot-read-only'
  | 'duplicate-target';

export interface AttrMappingRejection {
  index: number;
  reason: AttrMappingRejectionReason;
}

export interface AttrMappingResolution {
  resolved: ResolvedAttrMapping[];
  rejections: AttrMappingRejection[];
}

/** Hard caps so a pasted or corrupted payload cannot grow the
 *  config without bound (the gpgpuGroups discipline). Only four
 *  entries can ever resolve — targets are slots 0..3 and
 *  duplicates are rejected — so 64 parsed entries is generous. */
export const ATTR_MAPPINGS_MAX_ENTRIES = 64;
export const ATTR_MAPPINGS_MAX_CHARS = 100_000;

const CHANNELS = ['r', 'g', 'b', 'a'] as const;

/**
 * Parse the serialised key into validated entries. Anything
 * malformed is dropped quietly (the config must never crash
 * the app — the parseGpgpuGroups discipline): a non-object
 * item, a missing / empty / non-string `from` or `to`, or a
 * non-string `expr`. An `expr` that is empty after trimming is
 * treated as omitted (the identity copy).
 */
export function parseAttrMappings(data: string): AttrMappingEntry[] {
  if (!data) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(data);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const out: AttrMappingEntry[] = [];
  for (const item of raw) {
    if (out.length >= ATTR_MAPPINGS_MAX_ENTRIES) break;
    if (!item || typeof item !== 'object') continue;
    const e = item as Record<string, unknown>;
    if (typeof e.from !== 'string' || typeof e.to !== 'string') continue;
    const from = e.from.trim();
    const to = e.to.trim();
    if (!from || !to) continue;
    if (e.expr !== undefined && typeof e.expr !== 'string') continue;
    const expr = typeof e.expr === 'string' ? e.expr.trim() : '';
    out.push(expr ? { from, to, expr } : { from, to });
  }
  return out;
}

/** Serialise entries back into the config key ('' when empty).
 *  Returns null when the payload would exceed the char cap. */
export function serializeAttrMappings(
  entries: ReadonlyArray<AttrMappingEntry>,
): string | null {
  if (entries.length === 0) return '';
  const text = JSON.stringify(
    entries.map((e) => (e.expr ? { from: e.from, to: e.to, expr: e.expr } : { from: e.from, to: e.to })),
  );
  return text.length <= ATTR_MAPPINGS_MAX_CHARS ? text : null;
}

/**
 * Resolve entry names to slots against the two name sets.
 * Every entry either resolves or is rejected with a reason —
 * nothing is dropped silently at this layer (the Phase A
 * discipline: rejections stay surfaced with reason codes).
 * Checks run source → target → writability → duplication, so
 * an entry rejected for an earlier reason never claims its
 * target slot.
 */
export function resolveAttrMappings(
  entries: ReadonlyArray<AttrMappingEntry>,
  names: readonly string[],
  names2: readonly string[],
): AttrMappingResolution {
  const resolved: ResolvedAttrMapping[] = [];
  const rejections: AttrMappingRejection[] = [];
  const claimedTargets = new Set<number>();
  entries.forEach((entry, index) => {
    const fromSlot = resolveAttrNameSlot(entry.from, names, names2);
    if (fromSlot < 0) {
      rejections.push({ index, reason: 'unknown-source-channel' });
      return;
    }
    const toSlot = resolveAttrNameSlot(entry.to, names, names2);
    if (toSlot < 0) {
      rejections.push({ index, reason: 'unknown-target-channel' });
      return;
    }
    if (toSlot >= ATTR_EXT_SLOT_OFFSET) {
      rejections.push({ index, reason: 'ext-slot-read-only' });
      return;
    }
    if (claimedTargets.has(toSlot)) {
      rejections.push({ index, reason: 'duplicate-target' });
      return;
    }
    claimedTargets.add(toSlot);
    resolved.push(entry.expr ? { fromSlot, toSlot, expr: entry.expr } : { fromSlot, toSlot });
  });
  return { resolved, rejections };
}

/** The dyn stage's guard, as a CPU predicate: finite and
 *  |r| < 1e30 (`r == r` excludes NaN, exactly as in GLSL). */
function mappingGuardPasses(r: number): boolean {
  return r === r && Math.abs(r) < 1.0e30;
}

/**
 * The CPU twin: apply the resolved mappings to one particle's
 * slot values (length 4 or 8 — sources may read slots 4..7,
 * targets only ever write 0..3) and return the new array.
 * Sequential in entry order against the working copy, so a
 * chained mapping reads the remapped value. An expression
 * that fails to compile, or a result the guard rejects, keeps
 * the target's current value (the bake's "a slot whose
 * expression fails keeps its value" precedent).
 */
export function applyAttrMappings(
  values: readonly number[],
  resolved: ReadonlyArray<ResolvedAttrMapping>,
): number[] {
  const out = [...values];
  for (const m of resolved) {
    const input = m.fromSlot < out.length ? out[m.fromSlot] : NaN;
    let r: number;
    if (m.expr === undefined) {
      r = input;
    } else {
      const compiled = compileExpression(m.expr);
      if (!compiled.ok) continue;
      r = evaluateCompiledExpression(compiled.ast, input, 0);
    }
    if (mappingGuardPasses(r)) {
      out[m.toSlot] = Math.min(1, Math.max(0, r));
    }
  }
  return out;
}

/**
 * Build the mapping stage's fragment shader, or null when the
 * stage must not exist: no entry resolves, every resolved
 * entry's expression fails to compile, or an expression uses
 * a construct with no faithful GLSL form (the
 * buildAttrDynFragment discipline — a compile failure skips
 * that entry, a GLSL-form failure voids the whole fragment).
 *
 * The fragment mirrors buildAttrDynFragment's shape: locals
 * v0..v3 hold slots 0..3 of uSrc, w0..w3 (emitted only when a
 * source reads an extended slot) hold slots 4..7 of uSrc2,
 * entries emit in order against the locals, and each mapped
 * result passes the dyn guard with the target's own bake
 * channel as the fallback.
 */
export function buildAttrMappingFragment(
  entries: ReadonlyArray<AttrMappingEntry>,
  names: readonly string[],
  names2: readonly string[],
): string | null {
  const { resolved } = resolveAttrMappings(entries, names, names2);
  if (resolved.length === 0) return null;

  const blocks: string[] = [];
  let active = 0;
  let usesExt = false;
  for (const m of resolved) {
    const srcLocal = m.fromSlot < ATTR_SLOT_COUNT
      ? `v${m.fromSlot}`
      : `w${m.fromSlot - ATTR_EXT_SLOT_OFFSET}`;
    let valueGlsl: string;
    if (m.expr === undefined) {
      valueGlsl = srcLocal;
    } else {
      const compiled = compileExpression(m.expr);
      if (!compiled.ok) continue;
      const resolveVar: GlslVarResolver = (name) => {
        if (name === 'x') return srcLocal;
        if (name === 't') return 'uTime';
        return null;
      };
      const glsl = astToGlsl(compiled.ast, resolveVar);
      if (glsl === null) return null;
      valueGlsl = glsl;
    }
    active += 1;
    if (m.fromSlot >= ATTR_EXT_SLOT_OFFSET) usesExt = true;
    blocks.push(
      `  {\n`
      + `    float r = ${valueGlsl};\n`
      + `    v${m.toSlot} = ((r == r) && abs(r) < 1.0e30) ? clamp(r, 0.0, 1.0) : src.${CHANNELS[m.toSlot]};\n`
      + `  }`,
    );
  }
  if (active === 0) return null;

  return [
    'precision highp float;',
    'varying vec2 vUv;',
    'uniform sampler2D uSrc;',
    ...(usesExt ? ATTR_EXT_UNIFORM_LINES : []),
    'uniform float uTime;',
    'void main() {',
    '  vec4 src = texture2D(uSrc, vUv);',
    ...(usesExt ? ATTR_EXT_MAIN_LINES : []),
    '  float v0 = src.r;',
    '  float v1 = src.g;',
    '  float v2 = src.b;',
    '  float v3 = src.a;',
    ...blocks,
    '  gl_FragColor = vec4(v0, v1, v2, v3);',
    '}',
    '',
  ].join('\n');
}
