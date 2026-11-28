// GLSL injection points — the shared foundation (Phase BX).
//
// A "GLSL injection point" is a place where the user can splice
// their own GLSL snippet into a shader the app builds. Before
// Phase BX there was exactly one: the GPGPU custom force
// (lib/gpgpuCustomForce.ts), which grew its own validation,
// compile harness and status plumbing. BX generalises that shape
// into a registry so every injection point shares one contract
// type, one validation core and one fallback rule:
//
//   forbidden-token scan -> harness compile check against a live
//   GL context -> swap in only on success; on any failure the
//   previously working shader stays active and the error is
//   reported through the point's status store.
//
// Identity is structural at every point: a disabled / empty /
// statically invalid snippet means the stage itself is never
// added to its pipeline (no always-on pass with a uniform
// branch). The registry also records, per point, which backends
// can run the snippet — user GLSL cannot be compiled to WGSL,
// so WebGPU / CPU paths declare 'unsupported' here instead of
// silently dropping the effect (the capability-registry rule).

import React from 'react';
import {
  expandGlslSharedSnippets,
  validateGlslSharedSnippetDefs,
  type GlslSharedSnippetSet,
} from './glslSharedSnippets';

// ---------------------------------------------------------------------------
// Shared snippet validation

export const GLSL_SNIPPET_MAX_LENGTH = 4000;

export interface GlslForbiddenToken {
  token: string;
  reason: string;
}

export interface GlslSnippetValidation {
  ok: boolean;
  error?: string;
}

// The one validation core every injection point uses. Each point
// supplies its own forbidden-token list because the guidance in
// the reasons is contract-specific (which variable to write,
// which variables can be read), but the scan itself — length cap
// first, then a substring scan in list order — is shared, so the
// points can never drift apart in behaviour.
export function validateGlslSnippet(
  code: string,
  forbiddenTokens: readonly GlslForbiddenToken[],
  maxLength: number = GLSL_SNIPPET_MAX_LENGTH,
): GlslSnippetValidation {
  if (code.length > maxLength) {
    return { ok: false, error: `コードが長すぎます（最大 ${maxLength} 文字）` };
  }
  for (const { token, reason } of forbiddenTokens) {
    if (code.includes(token)) {
      return { ok: false, error: reason };
    }
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Compile check (shared)
//
// Compile-checks a vertex+fragment pair against a live GL context. three
// r187 is WebGL2-only and compiles GLSL1-style ShaderMaterial sources by
// prepending '#version 300 es' plus compatibility defines (attribute →
// in, varying → in/out, gl_FragColor → pc_fragColor, texture2D →
// texture). The prefixes below mirror that transform, so this check
// compiles the same language level the renderer will — including its
// reserved words. Only compilation is verified (the app's own program
// performs the link at render time); injected snippets cannot declare
// varyings or uniforms, so link-level mismatch is out of reach for them.
// (Moved here verbatim from lib/gpgpuCustomForce.ts in Phase BX; the
// custom force re-exports it so existing imports are unchanged.)

const CHECK_VERTEX_PREFIX = `#version 300 es
#define attribute in
#define varying out
#define texture2D texture
precision highp float;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform vec3 cameraPosition;
attribute vec3 position;
attribute vec3 normal;
attribute vec2 uv;
`;

const CHECK_FRAGMENT_PREFIX = `#version 300 es
#define varying in
out highp vec4 pc_fragColor;
#define gl_FragColor pc_fragColor
#define texture2D texture
precision highp float;
uniform mat4 viewMatrix;
uniform vec3 cameraPosition;
`;

export function compileCheckShader(
  gl: WebGL2RenderingContext | WebGLRenderingContext,
  vertexSource: string,
  fragmentSource: string,
): GlslSnippetValidation {
  const compile = (type: number, source: string): { shader: WebGLShader | null; log: string } => {
    const shader = gl.createShader(type);
    if (!shader) return { shader: null, log: 'shader allocation failed' };
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    const ok = gl.getShaderParameter(shader, gl.COMPILE_STATUS) as boolean;
    const log = gl.getShaderInfoLog(shader) ?? '';
    if (!ok) {
      gl.deleteShader(shader);
      return { shader: null, log };
    }
    return { shader, log };
  };
  const vertex = compile(gl.VERTEX_SHADER, CHECK_VERTEX_PREFIX + vertexSource);
  if (!vertex.shader) return { ok: false, error: `頂点シェーダ: ${vertex.log}` };
  const fragment = compile(gl.FRAGMENT_SHADER, CHECK_FRAGMENT_PREFIX + fragmentSource);
  if (vertex.shader) gl.deleteShader(vertex.shader);
  if (!fragment.shader) return { ok: false, error: fragment.log || 'コンパイルに失敗しました' };
  gl.deleteShader(fragment.shader);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Status store (shared)
//
// The compile status of one injection point, shared between the
// code that compiles/swaps shaders and the panel UI that reports
// the outcome. One store per point; the shape and the
// notify-only-on-change rule are shared.

export type GlslInjectionStatus =
  | { state: 'inactive' }
  | { state: 'active' }
  | { state: 'error'; message: string };

export interface GlslInjectionStatusStore {
  set: (next: GlslInjectionStatus) => void;
  get: () => GlslInjectionStatus;
  useStatus: () => GlslInjectionStatus;
}

export function createGlslInjectionStatusStore(): GlslInjectionStatusStore {
  let status: GlslInjectionStatus = { state: 'inactive' };
  const listeners = new Set<() => void>();
  const set = (next: GlslInjectionStatus): void => {
    if (status.state === next.state && (next.state !== 'error' || (status as { message?: string }).message === next.message)) {
      return;
    }
    status = next;
    for (const listener of listeners) listener();
  };
  const get = (): GlslInjectionStatus => status;
  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };
  const useStatus = (): GlslInjectionStatus =>
    React.useSyncExternalStore(subscribe, get, get);
  return { set, get, useStatus };
}

// ---------------------------------------------------------------------------
// The contract type and the registry

export type GlslInjectionStage =
  | 'simulation-fragment'
  | 'post-fragment'
  | 'particle-vertex'
  | 'particle-fragment'
  | 'volume-fragment'
  | 'geom-vertex'
  | 'geom-fragment';

export type GlslInjectionBackend = 'webgl' | 'webgpu' | 'cpu';

export type GlslInjectionBackendSupport = 'supported' | 'unsupported';

export interface GlslInjectionVariable {
  name: string;
  // 'vec4' joined in Phase CE: the particle fragment point's
  // write-back `color` is a vec4 (rgb + alpha in one variable).
  // 'sampler2D' joined in Layer 1 WP11 phase D2: the post
  // replacement slot documents its declared texture input
  // (tDiffuse) in the same interface shape.
  type: 'float' | 'vec2' | 'vec3' | 'vec4' | 'sampler2D';
  access: 'read' | 'readwrite';
}

export interface GlslInjectionContract {
  /** Stable id, e.g. 'gpgpu-custom-force' / 'custom-glsl-post'. */
  id: string;
  /** Which pipeline stage the snippet is spliced into. */
  stage: GlslInjectionStage;
  /** The documented interface: what the snippet may read, and
   *  the single variable it writes back. */
  variables: readonly GlslInjectionVariable[];
  /** Per-backend support, declared — never silently dropped. */
  backends: Record<GlslInjectionBackend, GlslInjectionBackendSupport>;
  /** Snippet length cap (characters). */
  maxLength: number;
  /** Builds the harness shader used for the compile check: the
   *  snippet in the same block scope it will occupy, with the
   *  documented interface as locals/uniforms. The harness is a
   *  shader of the point's own stage (fragment points build a
   *  fragment harness, the vertex point a vertex harness); the
   *  compile check pairs it with a minimal counterpart. */
  buildHarness: (code: string) => string;
}

const REGISTRY = new Map<string, GlslInjectionContract>();

export function registerGlslInjection(contract: GlslInjectionContract): void {
  // Re-registering an id keeps the historical last-wins behaviour
  // (the registry is a plain Map), but it is almost certainly a
  // wiring mistake — two modules claiming one point — so it now
  // warns in development instead of passing silently (Phase CD,
  // from the GLSL extension plan's phase-1 decisions).
  if (REGISTRY.has(contract.id) && typeof console !== 'undefined') {
    console.warn(`[glslInjection] duplicate registration for '${contract.id}' — the later contract wins`);
  }
  REGISTRY.set(contract.id, contract);
}

export function getGlslInjection(id: string): GlslInjectionContract | undefined {
  return REGISTRY.get(id);
}

export function listGlslInjections(): GlslInjectionContract[] {
  return Array.from(REGISTRY.values());
}

// ---------------------------------------------------------------------------
// Shared snippet definitions at the injection points (Layer 1
// WP11, phase A — the Scratch Pad foundation)
//
// The grammar itself (definition set, `// @use` directives,
// deterministic expansion, cycle rejection) lives in
// lib/glslSharedSnippets.ts as pure functions. This section is
// the one place it plugs into the points' resolution: a point
// resolves its snippet through resolveGlslSnippet, which layers
// this module's shared validation core over the grammar — every
// definition body and the expanded result are held to the
// consuming point's own forbidden-token list and length cap, so
// a shared definition can never smuggle in what the point
// itself forbids. A configuration that uses no shared
// definitions resolves to the identical string it always
// produced (expansion is an identity there), so existing
// shaders stay byte-identical.

export type { GlslSharedSnippetDef, GlslSharedSnippetSet } from './glslSharedSnippets';
export {
  expandGlslSharedSnippets,
  findGlslSharedSnippetRefs,
  parseGlslSharedSnippetDefs,
  serializeGlslSharedSnippetDefs,
  validateGlslSharedSnippetDefs,
} from './glslSharedSnippets';

/** Structural validation plus this module's validation core
 *  applied to every definition body, under the consuming
 *  point's forbidden-token list and length cap. */
export function validateGlslSharedSnippetDefsForInjection(
  defs: GlslSharedSnippetSet,
  forbiddenTokens: readonly GlslForbiddenToken[],
  maxLength: number = GLSL_SNIPPET_MAX_LENGTH,
): GlslSnippetValidation {
  const structural = validateGlslSharedSnippetDefs(defs);
  if (!structural.ok) return structural;
  for (const def of defs) {
    const body = validateGlslSnippet(def.code, forbiddenTokens, maxLength);
    if (!body.ok) {
      return { ok: false, error: `共有スニペット '${def.name}': ${body.error}` };
    }
  }
  return { ok: true };
}

export interface GlslSnippetResolution {
  ok: boolean;
  /** Present when ok: the resolved snippet text. */
  code?: string;
  error?: string;
}

/**
 * Resolve one point's snippet against a shared definition set:
 * validate the set under the point's contract, expand the
 * `// @use` directives, then validate the expanded text under
 * the same contract. With an empty set and no directives the
 * input is returned unchanged — the identical string.
 */
export function resolveGlslSnippet(
  code: string,
  defs: GlslSharedSnippetSet,
  forbiddenTokens: readonly GlslForbiddenToken[],
  maxLength: number = GLSL_SNIPPET_MAX_LENGTH,
): GlslSnippetResolution {
  const expanded = expandGlslSharedSnippets(code, defs);
  if (!expanded.ok) return { ok: false, error: expanded.error };
  const resolved = expanded.code as string;
  if (resolved === code) return { ok: true, code };
  const defsCheck = validateGlslSharedSnippetDefsForInjection(defs, forbiddenTokens, maxLength);
  if (!defsCheck.ok) return { ok: false, error: defsCheck.error };
  const bodyCheck = validateGlslSnippet(resolved, forbiddenTokens, maxLength);
  if (!bodyCheck.ok) return bodyCheck;
  return { ok: true, code: resolved };
}

// ---------------------------------------------------------------------------
// Full-fragment replacement slots (Layer 1 WP11, phase D2)
//
// The snippet points above splice user code into a host-owned
// shader at a seam. At the three terminal points whose inputs
// close over declared uniforms / sampling and whose output is a
// single colour — the post fragment, the particle points
// fragment and the volume fog fragment — the WP11 phase-D
// material (branch 2, option (b)) opens a second form next to
// the snippet: a replacement slot, where the user code IS the
// whole fragment shader. The host owns only the declarations
// (the uniforms / varyings it supplies) and the validation;
// everything from `void main` on is user code, and the output
// form the code must satisfy is: define main, and write the
// final colour to gl_FragColor.
//
// The protection machinery is the snippet points' own: the
// length cap and the forbidden-token scan run first (the shared
// core above), then the code must pass a harness compile check
// before it is swapped in, and on any failure the previously
// working fragment stays active (the per-point status stores
// report the outcome, as at the snippet points). The harness
// differs in shape only: it is not a snippet embedded in a
// block, it is the code itself assembled behind the host
// declarations — the same assembly the production fragment
// uses, so the check compiles what will actually run.
//
// Not opened, by the same decision: the GEOM points (the vertex
// point carries placement invariants, the fragment point would
// include replacing the lighting sum) and the particle points
// vertex point. They keep snippet insertion only, and no
// replacement contract is registered for them. The custom force
// is a simulation pass, outside the drawing-side scope entirely.
//
// A configuration that uses no replacement resolves exactly as
// before: the snippet contracts and their builders are
// untouched, so existing shaders stay byte-identical.

export interface GlslReplacementContract {
  /** The injection point this slot belongs to: the same id as
   *  the point's snippet contract. */
  pointId: string;
  /** The pipeline stage the replaced fragment occupies (the
   *  point's own stage). */
  stage: GlslInjectionStage;
  /** Host-supplied declarations, prepended verbatim before the
   *  user code in both the harness and the built fragment. The
   *  user code must not redeclare these names — the validation
   *  forbids declaration tokens outright. */
  declarations: string;
  /** The documented interface: the host-supplied names the user
   *  code may read. The output is not listed here: the user code
   *  writes gl_FragColor itself, inside its own main. */
  variables: readonly GlslInjectionVariable[];
  /** Per-backend support, declared — mirrors the point's own. */
  backends: Record<GlslInjectionBackend, GlslInjectionBackendSupport>;
  /** Replacement code length cap (characters). */
  maxLength: number;
  /** Point-specific forbidden tokens, scanned after the shared
   *  replacement base list below. */
  forbiddenTokens: readonly GlslForbiddenToken[];
  /** Assembles the fragment the compile check sees: the host
   *  declarations followed by the user code, whole. */
  buildHarness: (code: string) => string;
  /** Assembles the production fragment: the same assembly the
   *  harness checks (host declarations + user code, whole). */
  buildFragment: (code: string) => string;
}

// The forbidden tokens every replacement slot shares. The host
// supplies all declarations, so declaration tokens are rejected
// outright (a redeclaration of a supplied name would not
// compile anyway; the scan turns it into a guided error). The
// scan covers the whole text, comments included — the same
// discipline as the snippet lists.
export const GLSL_REPLACEMENT_BASE_FORBIDDEN_TOKENS: readonly GlslForbiddenToken[] = [
  { token: '#', reason: 'プリプロセッサ指令（#）は使えません' },
  { token: 'precision', reason: 'precision は宣言できません（ホスト側が供給します）' },
  { token: 'uniform', reason: 'uniform は宣言できません（宣言はホスト側が供給します）' },
  { token: 'varying', reason: 'varying は宣言できません（宣言はホスト側が供給します）' },
  { token: 'attribute', reason: 'attribute は宣言できません' },
];

/** Assembles a replacement fragment: host declarations, then
 *  the user code as the whole rest of the shader. */
export function assembleGlslReplacementFragment(declarations: string, code: string): string {
  return `${declarations}\n\n${code}\n`;
}

/**
 * Validate replacement code against its slot's contract: the
 * shared scan (length cap first, then the base list and the
 * point's own list, in order), then the output form — the code
 * must define main and write gl_FragColor. The compile check
 * (compileCheckShader over the contract's harness, paired with
 * the point's check vertex) runs after this, at swap time, as
 * at the snippet points.
 */
export function validateGlslReplacementCode(
  code: string,
  contract: GlslReplacementContract,
): GlslSnippetValidation {
  const scanned = validateGlslSnippet(
    code,
    [...GLSL_REPLACEMENT_BASE_FORBIDDEN_TOKENS, ...contract.forbiddenTokens],
    contract.maxLength,
  );
  if (!scanned.ok) return scanned;
  if (!code.includes('void main')) {
    return { ok: false, error: 'main 関数が定義されていません（フラグメント全体を書いてください）' };
  }
  if (!code.includes('gl_FragColor')) {
    return { ok: false, error: 'gl_FragColor への書き込みがありません（出力は gl_FragColor に書いてください）' };
  }
  return { ok: true };
}

const REPLACEMENT_REGISTRY = new Map<string, GlslReplacementContract>();

export function registerGlslReplacement(contract: GlslReplacementContract): void {
  // Same duplicate discipline as registerGlslInjection: last
  // wins, but warn — two modules claiming one slot is a wiring
  // mistake.
  if (REPLACEMENT_REGISTRY.has(contract.pointId) && typeof console !== 'undefined') {
    console.warn(`[glslInjection] duplicate replacement registration for '${contract.pointId}' — the later contract wins`);
  }
  REPLACEMENT_REGISTRY.set(contract.pointId, contract);
}

export function getGlslReplacement(pointId: string): GlslReplacementContract | undefined {
  return REPLACEMENT_REGISTRY.get(pointId);
}

export function listGlslReplacements(): GlslReplacementContract[] {
  return Array.from(REPLACEMENT_REGISTRY.values());
}
