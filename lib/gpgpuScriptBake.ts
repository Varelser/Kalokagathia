/**
 * Script bake (C1, Layer 1 WP11 phase B) — the contracts of
 * the Pyodide script-bake receptacle, ported into the tree's
 * lib layer. The design is
 * kalokagathia-pro/expanded-ruler/pyodide-integration-design.md
 * and the connection shapes follow §1 of the bake channel's
 * prototype record (kalokagathia-pro/PYODIDE_PROTO_IMPL_RECORD.md,
 * prototype at kalokagathia-pro/pyodide-integration-proto/,
 * static check / config store / output validation implemented
 * and unit-tested there — 15 tests ALL PASS at intake; this
 * module ports those CONTRACTS to the tree's conventions, it
 * does not copy the prototype code).
 *
 * Scope of this phase — contracts and connection points only:
 *   - the six authoring keys (below) and their validation,
 *     including the static check of the Python source and the
 *     "on failure the last working version stands" store;
 *   - the output validation (type / length / NaN-Inf / total
 *     element cap) an execution result must pass before it
 *     may be adopted as a bake;
 *   - the two lib-level connection points the prototype
 *     record fixed: the attribute bake (same inputs as
 *     buildAttributeData, one Float32Array(count) column per
 *     declared channel name out) and initial-state generation
 *     (the argument shape of
 *     buildGpgpuInitialDataFromStateFrame).
 * NOT in this phase: running a Worker, bundling Pyodide
 * assets (the execution form is phase D's open judgment), any
 * panel wiring (phase C), and the state-cache merge — the
 * prototype record itself marks the manifest provenance
 * fields as not-yet-implemented, so this module produces the
 * channel columns in the frame-attributes shape but never
 * calls assembleStateCache.
 *
 * The script's role is bake-stage computation only (design
 * §1): attribute bake, initial-state generation, validation
 * support. It never enters a real-time shader path — the
 * output is consumed as baked arrays, and reproducibility is
 * carried by the baked output and its hash
 * (gpgpuScriptOutputHash), not by re-execution (design §4).
 *
 * OFF discipline: gpgpuScriptEnabled defaults to false and no
 * consumer outside this module reads the script keys in this
 * phase, so a configuration that never touches them behaves
 * exactly as before — the custom-force precedent
 * (lib/gpgpuCustomForce.ts: length cap + validation + last
 * working version) carried over to Python, per design §5.
 */

import {
  buildGpgpuInitialDataFromStateFrame,
  type GpgpuInitialData,
} from './gpgpuInitialData';

// ---------------------------------------------------------------------------
// SHA-256 (synchronous, dependency-free)
// ---------------------------------------------------------------------------
//
// The prototype hashed with node:crypto; the tree has no
// hashing helper and the browser's crypto.subtle is async,
// which would bend the store's synchronous contract. This is
// a compact textbook SHA-256 over bytes; the test pins the
// published vectors and cross-checks the output-hash
// composition against node:crypto.

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function sha256Hex(data: Uint8Array): string {
  const H = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const bitLenHi = Math.floor((data.length * 8) / 0x100000000);
  const bitLenLo = (data.length * 8) >>> 0;
  const paddedLen = (((data.length + 8) >> 6) + 1) << 6;
  const msg = new Uint8Array(paddedLen);
  msg.set(data);
  msg[data.length] = 0x80;
  const view = new DataView(msg.buffer);
  view.setUint32(paddedLen - 4, bitLenLo);
  view.setUint32(paddedLen - 8, bitLenHi);
  const W = new Uint32Array(64);
  const rotr = (x: number, n: number) => ((x >>> n) | (x << (32 - n))) >>> 0;
  for (let block = 0; block < paddedLen; block += 64) {
    for (let t = 0; t < 16; t++) W[t] = view.getUint32(block + t * 4);
    for (let t = 16; t < 64; t++) {
      const s0 = (rotr(W[t - 15], 7) ^ rotr(W[t - 15], 18) ^ (W[t - 15] >>> 3)) >>> 0;
      const s1 = (rotr(W[t - 2], 17) ^ rotr(W[t - 2], 19) ^ (W[t - 2] >>> 10)) >>> 0;
      W[t] = (W[t - 16] + s0 + W[t - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let t = 0; t < 64; t++) {
      const S1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0;
      const ch = ((e & f) ^ (~e & g)) >>> 0;
      const temp1 = (h + S1 + ch + SHA256_K[t] + W[t]) >>> 0;
      const S0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0;
      const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
      const temp2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + temp1) >>> 0;
      d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
  }
  let hex = '';
  for (const word of H) hex += word.toString(16).padStart(8, '0');
  return hex;
}

const textEncoder = new TextEncoder();

/** SHA-256 (hex) of a script source text (design §7 provenance). */
export function hashScriptSource(source: string): string {
  return sha256Hex(textEncoder.encode(String(source)));
}

/**
 * SHA-256 (hex) of a bake output set: for each output name in
 * sorted order, the name's UTF-8 bytes followed by the array's
 * raw bytes (design §3, gpgpuScriptOutputHash). Deterministic
 * in the outputs alone — the same outputs hash identically
 * regardless of the record's key order.
 */
export function hashScriptOutputs(outputs: Record<string, Float32Array>): string {
  const names = Object.keys(outputs).sort();
  let total = 0;
  const parts: Uint8Array[] = [];
  for (const name of names) {
    const nameBytes = textEncoder.encode(name);
    const a = outputs[name];
    const bytes = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
    parts.push(nameBytes, bytes);
    total += nameBytes.length + bytes.length;
  }
  const all = new Uint8Array(total);
  let off = 0;
  for (const part of parts) { all.set(part, off); off += part.length; }
  return sha256Hex(all);
}

// ---------------------------------------------------------------------------
// Static check (design §5): import whitelist + forbidden patterns
// ---------------------------------------------------------------------------

/** Source length cap (design §3): wider than GLSL's 4,000, not unbounded. */
export const SCRIPT_SOURCE_MAX_LENGTH = 32000;

/** Imports a script may use: computation only (design §5). */
export const SCRIPT_ALLOWED_IMPORTS: ReadonlySet<string> = new Set([
  'math', 'random', 'numpy', 'statistics', 'fractions', 'decimal',
  'itertools', 'functools', 'array', 'struct', 'hashlib',
]);

const SCRIPT_FORBIDDEN_PATTERNS: readonly (readonly [RegExp, string])[] = [
  [/\bimport\s+os\b/, 'import os は禁止です'],
  [/\bimport\s+sys\b/, 'import sys は禁止です'],
  [/\bimport\s+subprocess\b/, 'import subprocess は禁止です'],
  [/\bimport\s+socket\b/, 'import socket は禁止です'],
  [/\bimport\s+urllib\b/, 'import urllib は禁止です'],
  [/\bimport\s+js\b/, 'import js (ホスト橋渡し) は禁止です'],
  [/\bimport\s+importlib\b/, 'import importlib は禁止です'],
  [/\bfrom\s+os\b/, 'from os は禁止です'],
  [/\bfrom\s+sys\b/, 'from sys は禁止です'],
  [/\bfrom\s+subprocess\b/, 'from subprocess は禁止です'],
  [/\bfrom\s+socket\b/, 'from socket は禁止です'],
  [/\bfrom\s+urllib\b/, 'from urllib は禁止です'],
  [/\bfrom\s+js\b/, 'from js は禁止です'],
  [/\bfrom\s+importlib\b/, 'from importlib は禁止です'],
  [/\beval\s*\(/, 'eval() は禁止です'],
  [/\bexec\s*\(/, 'exec() は禁止です'],
  [/\bopen\s*\(/, 'open() によるファイルアクセスは禁止です'],
  [/\b__import__\s*\(/, '__import__() は禁止です'],
  [/\bcompile\s*\(/, 'compile() は禁止です'],
  [/\bglobals\s*\(/, 'globals() は禁止です'],
  [/\blocals\s*\(/, 'locals() は禁止です'],
  [/\bgetattr\s*\(/, 'getattr() は禁止です'],
  [/\bsetattr\s*\(/, 'setattr() は禁止です'],
  [/\b__\w+__/, 'ダンダー属性へのアクセスは禁止です'],
  [/\binput\s*\(/, 'input() は禁止です'],
  [/\bbreakpoint\s*\(/, 'breakpoint() は禁止です'],
];

export type ScriptCheckResult = { ok: true } | { ok: false; error: string };

/**
 * Static check of a Python source (design §5). One layer of a
 * two-layer defence: the runtime guard inside the Worker is
 * the other (prototype record §2), and it is not part of this
 * phase. Never throws.
 */
export function staticCheckScript(source: unknown): ScriptCheckResult {
  if (typeof source !== 'string') return { ok: false, error: 'ソースは文字列が必要です。' };
  if (source.length > SCRIPT_SOURCE_MAX_LENGTH) {
    return { ok: false, error: `ソースが上限 ${SCRIPT_SOURCE_MAX_LENGTH} 文字を超えています (${source.length} 文字)。` };
  }
  for (const [re, reason] of SCRIPT_FORBIDDEN_PATTERNS) {
    if (re.test(source)) return { ok: false, error: `静的検査で拒否: ${reason}` };
  }
  const importRe = /^\s*(?:import|from)\s+([A-Za-z_][A-Za-z0-9_.]*)/gm;
  let m: RegExpExecArray | null;
  while ((m = importRe.exec(source)) !== null) {
    const top = m[1].split('.')[0];
    if (!SCRIPT_ALLOWED_IMPORTS.has(top)) {
      return { ok: false, error: `静的検査で拒否: import "${m[1]}" は許可リストにありません (許可: ${[...SCRIPT_ALLOWED_IMPORTS].join(', ')})` };
    }
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// The six authoring keys (design §3) and their validation
// ---------------------------------------------------------------------------

export const SCRIPT_TARGETS = ['attrBake', 'initialState', 'fieldBake'] as const;
export type GpgpuScriptTarget = (typeof SCRIPT_TARGETS)[number];

/** Save-format version. A different version is refused, not migrated (yet). */
export const SCRIPT_FORMAT_VERSION = 1;

/** The script-bake slice of ParticleConfig (design §3). */
export interface GpgpuScriptConfigSlice {
  gpgpuScriptEnabled: boolean;
  gpgpuScriptTarget: GpgpuScriptTarget;
  gpgpuScriptSource: string;
  gpgpuScriptSeed: number;
  gpgpuScriptFormatVersion: number;
  gpgpuScriptOutputHash: string;
}

export const SCRIPT_CONFIG_DEFAULTS: Readonly<GpgpuScriptConfigSlice> = Object.freeze({
  gpgpuScriptEnabled: false,
  gpgpuScriptTarget: 'attrBake',
  gpgpuScriptSource: '',
  gpgpuScriptSeed: 0,
  gpgpuScriptFormatVersion: SCRIPT_FORMAT_VERSION,
  gpgpuScriptOutputHash: '',
});

export type ScriptConfigValidation =
  | { ok: true; config: GpgpuScriptConfigSlice }
  | { ok: false; error: string };

/**
 * Validate a candidate script-bake slice (pure). Missing keys
 * fall back to the defaults; a present-but-wrong value is
 * refused with the reason. The static check runs only when
 * the script is enabled — OFF with an empty (or any) source
 * stays valid, so the default configuration is untouched.
 * Never throws.
 */
export function validateScriptConfig(input: unknown): ScriptConfigValidation {
  if (!input || typeof input !== 'object') return { ok: false, error: 'config がオブジェクトではありません。' };
  const raw = input as Partial<GpgpuScriptConfigSlice>;
  const c: GpgpuScriptConfigSlice = {
    gpgpuScriptEnabled: raw.gpgpuScriptEnabled ?? SCRIPT_CONFIG_DEFAULTS.gpgpuScriptEnabled,
    gpgpuScriptTarget: raw.gpgpuScriptTarget ?? SCRIPT_CONFIG_DEFAULTS.gpgpuScriptTarget,
    gpgpuScriptSource: raw.gpgpuScriptSource ?? SCRIPT_CONFIG_DEFAULTS.gpgpuScriptSource,
    gpgpuScriptSeed: raw.gpgpuScriptSeed ?? SCRIPT_CONFIG_DEFAULTS.gpgpuScriptSeed,
    gpgpuScriptFormatVersion: raw.gpgpuScriptFormatVersion ?? SCRIPT_CONFIG_DEFAULTS.gpgpuScriptFormatVersion,
    gpgpuScriptOutputHash: raw.gpgpuScriptOutputHash ?? SCRIPT_CONFIG_DEFAULTS.gpgpuScriptOutputHash,
  };
  if (typeof c.gpgpuScriptEnabled !== 'boolean') return { ok: false, error: 'gpgpuScriptEnabled は真偽値が必要です。' };
  if (!(SCRIPT_TARGETS as readonly string[]).includes(c.gpgpuScriptTarget)) {
    return { ok: false, error: `gpgpuScriptTarget は ${SCRIPT_TARGETS.join(' / ')} のいずれかが必要です ("${String(c.gpgpuScriptTarget)}")。` };
  }
  if (typeof c.gpgpuScriptSource !== 'string') return { ok: false, error: 'gpgpuScriptSource は文字列が必要です。' };
  if (c.gpgpuScriptSource.length > SCRIPT_SOURCE_MAX_LENGTH) {
    return { ok: false, error: `gpgpuScriptSource が上限 ${SCRIPT_SOURCE_MAX_LENGTH} 文字を超えています (${c.gpgpuScriptSource.length} 文字)。` };
  }
  if (!Number.isInteger(c.gpgpuScriptSeed) || c.gpgpuScriptSeed < 0 || c.gpgpuScriptSeed > 0xffffffff) {
    return { ok: false, error: 'gpgpuScriptSeed は 0..4294967295 の整数が必要です。' };
  }
  if (c.gpgpuScriptFormatVersion !== SCRIPT_FORMAT_VERSION) {
    return { ok: false, error: `gpgpuScriptFormatVersion は ${SCRIPT_FORMAT_VERSION} が必要です ("${String(c.gpgpuScriptFormatVersion)}")。旧版の移行は未実装のため拒否します。` };
  }
  if (typeof c.gpgpuScriptOutputHash !== 'string' || (c.gpgpuScriptOutputHash !== '' && !/^[0-9a-f]{64}$/.test(c.gpgpuScriptOutputHash))) {
    return { ok: false, error: 'gpgpuScriptOutputHash は空文字か SHA-256 (16進64文字) が必要です。' };
  }
  if (c.gpgpuScriptEnabled) {
    if (c.gpgpuScriptSource.trim().length === 0) return { ok: false, error: '有効化する場合は gpgpuScriptSource が空ではいけません。' };
    const chk = staticCheckScript(c.gpgpuScriptSource);
    if (!chk.ok) return chk;
  }
  return { ok: true, config: c };
}

// ---------------------------------------------------------------------------
// The validated store: on failure the last working version stands
// ---------------------------------------------------------------------------

export interface ScriptGoodBake {
  outputs: Record<string, Float32Array>;
  hash: string;
  sourceHash: string;
  target: GpgpuScriptTarget;
}

export type ScriptSharePayload = Omit<GpgpuScriptConfigSlice, 'gpgpuScriptSource'> & {
  /** Present only when the payload explicitly includes the script. */
  gpgpuScriptSource?: string;
  gpgpuScriptIncluded: boolean;
  requiresRunConfirmation?: boolean;
};

/**
 * The validated store (the custom-force discipline, design
 * §5): applyConfig validates first and a failed candidate
 * leaves `current` — and any recorded good bake — exactly as
 * it was. recordGoodBake is the only way lastGoodBake and the
 * gpgpuScriptOutputHash key move, and only an execution whose
 * outputs passed validateScriptOutputs may call it.
 */
export class GpgpuScriptBakeStore {
  current: GpgpuScriptConfigSlice;
  lastGoodBake: ScriptGoodBake | null;

  constructor(initial: Partial<GpgpuScriptConfigSlice> = {}) {
    const v = validateScriptConfig({ ...SCRIPT_CONFIG_DEFAULTS, ...initial });
    if (!v.ok) throw new Error(`初期 config が不正です: ${v.error}`);
    this.current = v.config;
    this.lastGoodBake = null;
  }

  applyConfig(candidate: Partial<GpgpuScriptConfigSlice>): ScriptConfigValidation & { retained?: GpgpuScriptConfigSlice } {
    const v = validateScriptConfig(candidate);
    if (!v.ok) return { ok: false, error: v.error, retained: this.current };
    this.current = v.config;
    return { ok: true, config: this.current };
  }

  recordGoodBake(outputs: Record<string, Float32Array>, hash: string): ScriptGoodBake {
    this.lastGoodBake = {
      outputs,
      hash,
      sourceHash: hashScriptSource(this.current.gpgpuScriptSource),
      target: this.current.gpgpuScriptTarget,
    };
    this.current = { ...this.current, gpgpuScriptOutputHash: hash };
    return this.lastGoodBake;
  }

  /**
   * Share payloads exclude the source by default (design §3:
   * a script is a program, not a setting — the receiving side
   * must never run one unknowingly). Including it requires
   * the explicit flag and marks the payload as needing a
   * run confirmation on the receiving side.
   */
  toSharePayload(includeScript = false): ScriptSharePayload {
    if (!includeScript) {
      const { gpgpuScriptSource: _omitted, ...rest } = this.current;
      return { ...rest, gpgpuScriptIncluded: false };
    }
    return { ...this.current, gpgpuScriptIncluded: true, requiresRunConfirmation: true };
  }
}

// ---------------------------------------------------------------------------
// Output validation (design §5): only a passing output is adopted
// ---------------------------------------------------------------------------

/** Total-element cap per particle (pos/vel/age + channels headroom). */
export const SCRIPT_OUTPUT_MAX_ELEMENTS_PER_PARTICLE = 64;

export type ScriptOutputsValidation = { ok: true } | { ok: false; error: string };

/**
 * Validate an execution result before it may be adopted as a
 * bake: every entry a Float32Array, expected lengths honoured,
 * no NaN / Inf anywhere, and the total element count within
 * the per-particle cap. Never throws.
 */
export function validateScriptOutputs(
  outputs: unknown,
  opts: { count?: number; expected?: Record<string, number> } = {},
): ScriptOutputsValidation {
  if (!outputs || typeof outputs !== 'object') return { ok: false, error: '出力がオブジェクトではありません。' };
  const expected = opts.expected ?? {};
  let total = 0;
  for (const [name, arr] of Object.entries(outputs as Record<string, unknown>)) {
    if (!(arr instanceof Float32Array)) return { ok: false, error: `出力 "${name}" が Float32Array ではありません。` };
    if (name in expected && arr.length !== expected[name]) {
      return { ok: false, error: `出力 "${name}" の長さが一致しません (${arr.length}、期待 ${expected[name]})。` };
    }
    for (let i = 0; i < arr.length; i++) {
      if (!Number.isFinite(arr[i])) return { ok: false, error: `出力 "${name}" の要素 ${i} が NaN/Inf です。ベイクとして採用しません。` };
    }
    total += arr.length;
  }
  const count = opts.count;
  if (Number.isInteger(count) && (count as number) > 0 && total > (count as number) * SCRIPT_OUTPUT_MAX_ELEMENTS_PER_PARTICLE) {
    return { ok: false, error: `出力の総要素数 ${total} が上限 (粒子数 x ${SCRIPT_OUTPUT_MAX_ELEMENTS_PER_PARTICLE}) を超えています。` };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Resolution: OFF means the legacy path, verbatim
// ---------------------------------------------------------------------------

export interface ScriptBakePlan {
  target: GpgpuScriptTarget;
  source: string;
  seed: number;
  formatVersion: number;
}

export type ScriptBakeResolution =
  | { ok: true; plan: ScriptBakePlan | null }
  | { ok: false; error: string };

/**
 * Resolve a config slice to a bake plan. A disabled script
 * resolves to a null plan — the caller keeps the legacy path
 * and nothing about the bake changes. An enabled-but-invalid
 * slice is an error, never a silent disable.
 */
export function resolveScriptBake(config: Partial<GpgpuScriptConfigSlice>): ScriptBakeResolution {
  const v = validateScriptConfig(config);
  if (!v.ok) return v;
  if (!v.config.gpgpuScriptEnabled) return { ok: true, plan: null };
  return {
    ok: true,
    plan: {
      target: v.config.gpgpuScriptTarget,
      source: v.config.gpgpuScriptSource,
      seed: v.config.gpgpuScriptSeed,
      formatVersion: v.config.gpgpuScriptFormatVersion,
    },
  };
}

// ---------------------------------------------------------------------------
// Connection point 1 — the attribute bake (prototype record §1-1)
// ---------------------------------------------------------------------------

export interface ScriptBakeInputs {
  count: number;
  /** Positions, count x 3 (the worker's `pos` input). */
  pos: Float32Array;
  /** Velocities, count x 3 (the worker's `vel` input). */
  vel: Float32Array;
  /** Per-particle age, count wide (the worker's `age` input). */
  age: Float32Array;
}

/**
 * Derive the execution inputs from the SAME initial data the
 * attribute bake consumes (lib/gpgpuAttributes.ts
 * buildAttributeData's posData / velData: count x 4 lanes of
 * xyz + age / xyz + phase). The worker contract takes
 * triplets, so the w lanes split out here: posData's w is the
 * age input, velData's w (the Kuramoto phase) is not part of
 * the script contract and is dropped. Returns null when a
 * lane is mis-sized (nothing is padded or decimated).
 */
export function scriptBakeInputsFromInitialData(
  posData: Float32Array,
  velData?: Float32Array | null,
): ScriptBakeInputs | null {
  if (posData.length % 4 !== 0) return null;
  const count = posData.length / 4;
  if (velData != null && velData.length !== posData.length) return null;
  const pos = new Float32Array(count * 3);
  const vel = new Float32Array(count * 3);
  const age = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = posData[i * 4];
    pos[i * 3 + 1] = posData[i * 4 + 1];
    pos[i * 3 + 2] = posData[i * 4 + 2];
    age[i] = posData[i * 4 + 3];
    if (velData != null) {
      vel[i * 3] = velData[i * 4];
      vel[i * 3 + 1] = velData[i * 4 + 1];
      vel[i * 3 + 2] = velData[i * 4 + 2];
    }
  }
  return { count, pos, vel, age };
}

export type ScriptAttrBakeColumns =
  | { ok: true; channels: Record<string, Float32Array> }
  | { ok: false; error: string };

/**
 * The attribute-bake connection: from an execution's outputs,
 * take the declared channels (`channel:<name>` entries) as
 * one Float32Array(count) column per name — the shape the
 * state-cache frame's `attributes` record carries (prototype
 * record §1-1). A declared channel the script did not write
 * is simply absent (the prototype's worker contract); a
 * written channel of the wrong length, a non-Float32Array, or
 * a NaN / Inf anywhere in the outputs refuses the whole set.
 * This produces the columns only — merging them into a state
 * cache is NOT done here (the manifest provenance fields the
 * merge needs are unimplemented, prototype record §1-3).
 */
export function scriptAttrBakeColumns(
  outputs: Record<string, Float32Array>,
  count: number,
  declaredChannels: readonly string[],
): ScriptAttrBakeColumns {
  const expected: Record<string, number> = {};
  for (const name of declaredChannels) expected[`channel:${name}`] = count;
  if (outputs && typeof outputs === 'object') {
    if (outputs.pos instanceof Float32Array) expected.pos = count * 3;
    if (outputs.vel instanceof Float32Array) expected.vel = count * 3;
    if (outputs.age instanceof Float32Array) expected.age = count;
  }
  const v = validateScriptOutputs(outputs, { count, expected });
  if (!v.ok) return v;
  const channels: Record<string, Float32Array> = {};
  for (const name of declaredChannels) {
    const col = outputs[`channel:${name}`];
    if (col !== undefined) channels[name] = col;
  }
  return { ok: true, channels };
}

// ---------------------------------------------------------------------------
// Connection point 2 — initial-state generation (prototype record §1-2)
// ---------------------------------------------------------------------------

export type ScriptInitialState =
  | { ok: true; data: GpgpuInitialData }
  | { ok: false; error: string };

/**
 * The initial-state connection: an execution's pos / vel /
 * age outputs ARE the argument shape of
 * buildGpgpuInitialDataFromStateFrame (prototype record
 * §1-2), so adoption is validation plus that canonical
 * conversion — posData gains the age as its w lane, velData's
 * w stays 0 (the bake's phase seed value), exactly as a
 * restored state-cache frame converts. Missing or mis-sized
 * lanes refuse with the reason; nothing is padded.
 */
export function scriptInitialStateFromOutputs(
  outputs: Record<string, Float32Array>,
  count: number,
): ScriptInitialState {
  if (!outputs || typeof outputs !== 'object') return { ok: false, error: '出力がオブジェクトではありません。' };
  for (const lane of ['pos', 'vel', 'age'] as const) {
    if (!(outputs[lane] instanceof Float32Array)) {
      return { ok: false, error: `初期状態の生成には出力 "${lane}" (Float32Array) が必要です。` };
    }
  }
  const v = validateScriptOutputs(outputs, {
    count,
    expected: { pos: count * 3, vel: count * 3, age: count },
  });
  if (!v.ok) return v;
  const data = buildGpgpuInitialDataFromStateFrame({
    count,
    positions: outputs.pos,
    velocities: outputs.vel,
    ages: outputs.age,
  });
  if (!data) return { ok: false, error: '初期状態への変換が長さ不一致で拒否されました。' };
  return { ok: true, data };
}
