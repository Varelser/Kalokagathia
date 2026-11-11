// Custom GLSL force for the GPGPU velocity simulation (WebGL backend).
//
// The user writes a GLSL fragment that runs inside the velocity shader's
// main(), at the point where all built-in forces have been accumulated
// into `vel` but before the speed clamp, damping and boundary bounce. The
// snippet may read:
//   pos (vec3, current position), vel (vec3, current velocity),
//   uTime (float, seconds), uDelta (float, frame step)
// and add to `vel`, e.g.:
//   vel += vec3(sin(pos.y * 0.05 + uTime), 0.0, cos(pos.x * 0.05)) * 12.0 * uDelta;
//
// Safety model: this is the user's own code in their own browser, so the
// goal is not sandboxing — it is protecting the simulation's output
// contract. Snippets are rejected when they contain preprocessor
// directives, entry-point or declaration keywords, the framebuffer write,
// or texture sampling (sampling the sim's own textures mid-pass is
// undefined behavior). On top of that, the snippet must compile inside a
// harness shader exposing exactly the documented interface (pos / vel /
// uTime / uDelta, same block scope as the injection point) before it is
// swapped in; on any failure the previously working shader stays active
// and the error is reported here. The harness is compiled instead of the
// full velocity shader because a compile verdict must be about the
// snippet alone: it isolates the snippet from any unrelated breakage in
// the stock shader (which historically had one of its own — a vnoise
// mix() missing its third argument, fixed 2026-11-08).

import React from 'react';

export const CUSTOM_FORCE_MAX_LENGTH = 4000;

const FORBIDDEN_TOKENS: Array<{ token: string; reason: string }> = [
  { token: '#', reason: 'プリプロセッサ指令（#）は使えません' },
  { token: 'gl_FragColor', reason: 'gl_FragColor への書き込みはできません（vel に加算してください）' },
  { token: 'void main', reason: 'main 関数は定義できません（断片だけを書いてください）' },
  { token: 'uniform', reason: 'uniform は宣言できません（pos / vel / uTime / uDelta が使えます）' },
  { token: 'attribute', reason: 'attribute は宣言できません' },
  { token: 'varying', reason: 'varying は宣言できません' },
  { token: 'precision', reason: 'precision は宣言できません' },
  { token: 'texture2D', reason: 'テクスチャのサンプリングはできません' },
  { token: 'texture(', reason: 'テクスチャのサンプリングはできません' },
];

export interface CustomForceValidation {
  ok: boolean;
  error?: string;
}

export function validateCustomForceCode(code: string): CustomForceValidation {
  if (code.length > CUSTOM_FORCE_MAX_LENGTH) {
    return { ok: false, error: `コードが長すぎます（最大 ${CUSTOM_FORCE_MAX_LENGTH} 文字）` };
  }
  for (const { token, reason } of FORBIDDEN_TOKENS) {
    if (code.includes(token)) {
      return { ok: false, error: reason };
    }
  }
  return { ok: true };
}

export const CUSTOM_FORCE_EXAMPLE = `// 渦巻き上昇: 中心軸の周りに回転しながら持ち上げる
vec2 toAxis = pos.xz;
float dist = length(toAxis) + 0.001;
vec2 tangent = vec2(-toAxis.y, toAxis.x) / dist;
float pull = clamp(1.0 - dist / 220.0, 0.0, 1.0);
vel.xz += tangent * pull * 60.0 * uDelta;
vel.y += pull * 18.0 * uDelta;`;

// ---------------------------------------------------------------------------
// Compile status, shared between the simulation assets hook (which compiles
// and swaps shaders) and the panel UI (which reports the outcome).

export type CustomForceStatus =
  | { state: 'inactive' }
  | { state: 'active' }
  | { state: 'error'; message: string };

let status: CustomForceStatus = { state: 'inactive' };
const listeners = new Set<() => void>();

export function setCustomForceStatus(next: CustomForceStatus): void {
  if (status.state === next.state && (next.state !== 'error' || (status as { message?: string }).message === next.message)) {
    return;
  }
  status = next;
  for (const listener of listeners) listener();
}

export function getCustomForceStatus(): CustomForceStatus {
  return status;
}

function subscribeCustomForceStatus(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useCustomForceStatus(): CustomForceStatus {
  return React.useSyncExternalStore(subscribeCustomForceStatus, getCustomForceStatus, getCustomForceStatus);
}

// Builds the harness fragment shader used for the compile check: the
// snippet sits in the same block scope it will occupy in the velocity
// shader, with the documented interface as locals/uniforms.
export function buildCustomForceHarness(customCode: string): string {
  return `
  precision highp float;
  uniform float uTime;
  uniform float uDelta;
  void main() {
    vec3 pos = vec3(0.0);
    vec3 vel = vec3(0.0);
    {
${customCode}
    }
    gl_FragColor = vec4(vel, 1.0);
  }
`;
}

// Compile-checks a vertex+fragment pair against a live GL context. three
// r187 is WebGL2-only and compiles GLSL1-style ShaderMaterial sources by
// prepending '#version 300 es' plus compatibility defines (attribute →
// in, varying → in/out, gl_FragColor → pc_fragColor, texture2D →
// texture). The prefixes below mirror that transform, so this check
// compiles the same language level the renderer will — including its
// reserved words. Only compilation is verified (the sim's own program
// performs the link at render time); injected snippets cannot declare
// varyings or uniforms, so link-level mismatch is out of reach for them.
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
): CustomForceValidation {
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
