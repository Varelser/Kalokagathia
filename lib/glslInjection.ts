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
  | 'volume-fragment';

export type GlslInjectionBackend = 'webgl' | 'webgpu' | 'cpu';

export type GlslInjectionBackendSupport = 'supported' | 'unsupported';

export interface GlslInjectionVariable {
  name: string;
  // 'vec4' joined in Phase CE: the particle fragment point's
  // write-back `color` is a vec4 (rgb + alpha in one variable).
  type: 'float' | 'vec2' | 'vec3' | 'vec4';
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
