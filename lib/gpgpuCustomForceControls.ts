// Control declarations for the GPGPU custom force (KCB1, Casberry
// addControl equivalent).
//
// SPEC (fixed here — this module is the specification):
//
//   A snippet declares a slider by calling
//
//     ctrl("id", min, max, default)
//
//   anywhere a float expression is allowed, typically:
//
//     float speed = ctrl("speed", 0.0, 5.0, 1.0);
//     vel.y += sin(pos.x * 0.05 + uTime) * speed * uDelta;
//
//   - The call is extracted STATICALLY (textual scan, the same
//     spirit as the forbidden-token scan in lib/glslInjection.ts:
//     a call inside a comment also counts as a declaration).
//   - id must match /^[A-Za-z_][A-Za-z0-9_]*$/ and be at most 32
//     characters; the reserved names pos / vel / uTime / uDelta /
//     ctrl / main are rejected. Duplicate ids are rejected.
//   - min, max, default are numeric literals (sign, decimals and
//     exponent allowed). min must be strictly less than max and
//     default must lie inside [min, max]. Anything else — a
//     malformed ctrl( call, a non-literal argument, more than
//     CTRL_MAX_CONTROLS declarations — is a validation error, so
//     the snippet is rejected before the compile check, with the
//     reason shown in the panel (the stock fallback rule of the
//     injection foundation applies unchanged).
//   - At shader-build time each call is rewritten to the uniform
//     reference uCtrl_<id> and one `uniform float uCtrl_<id>;`
//     line per declaration is injected into the velocity shader
//     preamble. Slider values live in the config key
//     gpgpuCustomForceCtrlValues (id -> number); a stored value
//     outside [min, max] is clamped, a missing / non-finite one
//     falls back to the declared default.
//
// IDENTITY: a snippet with no ctrl() declaration produces no
// uniform lines and no rewriting — buildVelocityFragment returns
// the byte-identical stock shader (pinned by scripts/kcb1_test.mjs).
//
// This module is pure (no React / three imports): the uniforms
// record is typed structurally so the material-side sync helper
// can be unit-tested in plain Node.

export const CTRL_MAX_CONTROLS = 16;
export const CTRL_ID_MAX_LENGTH = 32;
export const CTRL_UNIFORM_PREFIX = 'uCtrl_';

export interface CustomForceControlDecl {
  id: string;
  min: number;
  max: number;
  defaultValue: number;
}

export interface CustomForceControlExtraction {
  ok: boolean;
  error?: string;
  decls: CustomForceControlDecl[];
}

const RESERVED_IDS = new Set(['pos', 'vel', 'uTime', 'uDelta', 'ctrl', 'main']);
const ID_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const NUMBER_PATTERN = '[-+]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][-+]?\\d+)?';
const CALL_PATTERN = new RegExp(
  `\\bctrl\\s*\\(\\s*"([^"]*)"\\s*,\\s*(${NUMBER_PATTERN})\\s*,\\s*(${NUMBER_PATTERN})\\s*,\\s*(${NUMBER_PATTERN})\\s*\\)`,
  'g',
);
const ANY_CALL_PATTERN = /\bctrl\s*\(/g;

// Extracts and validates every ctrl() declaration in a snippet.
// Pure and total: malformed input yields { ok: false } with a
// Japanese reason, never a throw.
export function extractCustomForceControls(code: string): CustomForceControlExtraction {
  const decls: CustomForceControlDecl[] = [];
  const seen = new Set<string>();
  let match: RegExpExecArray | null;
  CALL_PATTERN.lastIndex = 0;
  while ((match = CALL_PATTERN.exec(code)) !== null) {
    const [, id, minRaw, maxRaw, defaultRaw] = match;
    if (!ID_PATTERN.test(id) || id.length > CTRL_ID_MAX_LENGTH) {
      return { ok: false, decls: [], error: `ctrl の id が不正です: "${id}"（英字/アンダースコア始まりの英数字、${CTRL_ID_MAX_LENGTH}文字以内）` };
    }
    if (RESERVED_IDS.has(id)) {
      return { ok: false, decls: [], error: `ctrl の id "${id}" は予約名のため使えません` };
    }
    if (seen.has(id)) {
      return { ok: false, decls: [], error: `ctrl の id "${id}" が重複しています` };
    }
    const min = Number(minRaw);
    const max = Number(maxRaw);
    const defaultValue = Number(defaultRaw);
    if (!Number.isFinite(min) || !Number.isFinite(max) || !Number.isFinite(defaultValue)) {
      return { ok: false, decls: [], error: `ctrl "${id}" の数値が不正です` };
    }
    if (!(min < max)) {
      return { ok: false, decls: [], error: `ctrl "${id}" の範囲が不正です（min < max が必要）: ${minRaw}, ${maxRaw}` };
    }
    if (defaultValue < min || defaultValue > max) {
      return { ok: false, decls: [], error: `ctrl "${id}" の既定値 ${defaultRaw} が範囲 [${minRaw}, ${maxRaw}] の外です` };
    }
    seen.add(id);
    decls.push({ id, min, max, defaultValue });
    if (decls.length > CTRL_MAX_CONTROLS) {
      return { ok: false, decls: [], error: `ctrl 宣言が多すぎます（最大 ${CTRL_MAX_CONTROLS} 件）` };
    }
  }
  // Any ctrl( occurrence the strict pattern did not consume is a
  // malformed declaration — reject it here with a clear reason
  // instead of letting GLSL fail on an undefined function.
  const wellFormedCount = decls.length;
  const anyCount = (code.match(ANY_CALL_PATTERN) ?? []).length;
  if (anyCount !== wellFormedCount) {
    return { ok: false, decls: [], error: 'ctrl(...) の書式が不正です: ctrl("id", min, max, default) の形で書いてください（引数は数値リテラルのみ）' };
  }
  return { ok: true, decls };
}

export function ctrlUniformName(id: string): string {
  return `${CTRL_UNIFORM_PREFIX}${id}`;
}

// The uniform declaration block injected into the velocity shader
// preamble ('' when there are no declarations — the identity path).
export function buildCtrlUniformDeclarations(decls: readonly CustomForceControlDecl[]): string {
  if (decls.length === 0) return '';
  return decls.map((d) => `  uniform float ${ctrlUniformName(d.id)};`).join('\n') + '\n';
}

// Rewrites every ctrl(...) call in the snippet to its uniform
// reference. Only call with a successful extraction; a snippet
// without declarations is returned unchanged (identity).
export function applyCtrlDeclarations(code: string, decls: readonly CustomForceControlDecl[]): string {
  if (decls.length === 0) return code;
  CALL_PATTERN.lastIndex = 0;
  return code.replace(CALL_PATTERN, (_m, id: string) => ctrlUniformName(id));
}

// Resolves the effective value of every declared control from the
// stored config record: stored value clamped to [min, max],
// missing / non-finite stored value -> the declared default.
export function resolveCtrlValues(
  decls: readonly CustomForceControlDecl[],
  stored: Record<string, number> | undefined,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const d of decls) {
    const raw = stored?.[d.id];
    out[d.id] = typeof raw === 'number' && Number.isFinite(raw)
      ? Math.min(d.max, Math.max(d.min, raw))
      : d.defaultValue;
  }
  return out;
}

// Builds fresh uniform entries ({ uCtrl_<id>: { value } }) for a
// THREE.ShaderMaterial uniforms record.
export function buildCtrlUniformEntries(
  decls: readonly CustomForceControlDecl[],
  stored: Record<string, number> | undefined,
): Record<string, { value: number }> {
  const values = resolveCtrlValues(decls, stored);
  const entries: Record<string, { value: number }> = {};
  for (const d of decls) entries[ctrlUniformName(d.id)] = { value: values[d.id] };
  return entries;
}

// Syncs a live uniforms record with the declarations + stored
// values: creates missing entries, updates existing ones in place
// (so no shader rebuild is needed for a slider move), and drops
// stale uCtrl_* entries whose declaration no longer exists.
export function syncCtrlUniforms(
  uniforms: Record<string, { value: unknown }>,
  decls: readonly CustomForceControlDecl[],
  stored: Record<string, number> | undefined,
): void {
  const entries = buildCtrlUniformEntries(decls, stored);
  for (const key of Object.keys(uniforms)) {
    if (key.startsWith(CTRL_UNIFORM_PREFIX) && !(key in entries)) delete uniforms[key];
  }
  for (const [key, entry] of Object.entries(entries)) {
    const existing = uniforms[key] as { value: number } | undefined;
    if (existing) existing.value = entry.value;
    else uniforms[key] = entry;
  }
}
