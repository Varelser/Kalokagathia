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
//
// Phase BX: this point is registered on the shared GLSL injection
// foundation (lib/glslInjection.ts) as its first entry. The
// validation core, the compile check and the status store are the
// shared implementations; this module keeps its own forbidden
// token list (the reasons are contract-specific) and its harness
// builder, and re-exports compileCheckShader so existing imports
// are unchanged. The config keys and the UI are untouched.

import {
  createGlslInjectionStatusStore,
  registerGlslInjection,
  validateGlslSnippet,
  type GlslInjectionContract,
  type GlslInjectionStatus,
} from './glslInjection';

export { compileCheckShader } from './glslInjection';

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
  return validateGlslSnippet(code, FORBIDDEN_TOKENS, CUSTOM_FORCE_MAX_LENGTH);
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

export type CustomForceStatus = GlslInjectionStatus;

const statusStore = createGlslInjectionStatusStore();

export const setCustomForceStatus = statusStore.set;

export const getCustomForceStatus = statusStore.get;

export const useCustomForceStatus = statusStore.useStatus;

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

// The compile check itself is the shared implementation in
// lib/glslInjection.ts (Phase BX), re-exported at the top of
// this module so existing imports keep working unchanged.

// ---------------------------------------------------------------------------
// The contract, registered on the shared foundation (Phase BX) as
// its first entry. Backends: the snippet is spliced into the
// WebGL velocity shader; user GLSL cannot be compiled to WGSL,
// and the CPU fallback runs no velocity shader — both declare
// 'unsupported' (the capability registry routes such configs to
// WebGL instead of dropping the effect).

export const CUSTOM_FORCE_CONTRACT: GlslInjectionContract = {
  id: 'gpgpu-custom-force',
  stage: 'simulation-fragment',
  variables: [
    { name: 'pos', type: 'vec3', access: 'read' },
    { name: 'vel', type: 'vec3', access: 'readwrite' },
    { name: 'uTime', type: 'float', access: 'read' },
    { name: 'uDelta', type: 'float', access: 'read' },
  ],
  backends: { webgl: 'supported', webgpu: 'unsupported', cpu: 'unsupported' },
  maxLength: CUSTOM_FORCE_MAX_LENGTH,
  buildHarness: buildCustomForceHarness,
};

registerGlslInjection(CUSTOM_FORCE_CONTRACT);
