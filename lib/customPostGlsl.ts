// Custom GLSL post stage (Phase BX): the second GLSL injection
// point, registered on the shared foundation in
// lib/glslInjection.ts. The user writes a GLSL fragment that runs
// in a fullscreen post pass placed immediately before the
// 'output-grade' stage, so output-grade stays the final word on
// exposure / tone / brand duotone.
//
// The snippet may read:
//   vUv (vec2, screen position), uTime (float, seconds),
//   uResolution (vec2, pixels)
// and read/write:
//   color (vec3, the frame colour entering this stage)
// e.g.:
//   color = vec3(1.0) - color;
//
// The input texture is deliberately NOT exposed: the frame is
// handed over as `color` only, and texture sampling tokens are
// rejected (sampling neighbouring pixels is a different contract
// and stays out of this point, as in the Phase BX spike).
//
// Safety model matches the custom force (the user's own code in
// their own browser — the goal is protecting the output
// contract, not sandboxing): forbidden tokens first, then the
// snippet must compile inside the harness below before it is
// swapped in; on any failure the previously working fragment
// stays active and the error is reported through the status
// store. The stage itself only exists while an enabled,
// statically valid snippet is set (lib/postFxStack.ts), so the
// defaults leave the composer output bit-identical.
//
// Luminance lock: the stage's fragment can re-project its result
// onto luminance (Rec. 709 weights, the same weights the brand
// duotone uses) after the snippet runs. That keeps the app's
// monochrome policy from silently dissolving just because a
// snippet can now produce colour: the lock is an option on the
// contract, default OFF (Phase BX brief, following the spike's
// recommendation).

import {
  createGlslInjectionStatusStore,
  registerGlslInjection,
  validateGlslSnippet,
  GLSL_SNIPPET_MAX_LENGTH,
  type GlslForbiddenToken,
  type GlslInjectionContract,
  type GlslInjectionStatus,
  type GlslSnippetValidation,
} from './glslInjection';

export const CUSTOM_POST_GLSL_MAX_LENGTH = GLSL_SNIPPET_MAX_LENGTH;

const FORBIDDEN_TOKENS: readonly GlslForbiddenToken[] = [
  { token: '#', reason: 'プリプロセッサ指令（#）は使えません' },
  { token: 'gl_FragColor', reason: 'gl_FragColor への書き込みはできません（color を書き換えてください）' },
  { token: 'void main', reason: 'main 関数は定義できません（断片だけを書いてください）' },
  { token: 'uniform', reason: 'uniform は宣言できません（color / vUv / uTime / uResolution が使えます）' },
  { token: 'attribute', reason: 'attribute は宣言できません' },
  { token: 'varying', reason: 'varying は宣言できません' },
  { token: 'precision', reason: 'precision は宣言できません' },
  { token: 'texture2D', reason: 'テクスチャのサンプリングはできません（入力は color として渡ります）' },
  { token: 'texture(', reason: 'テクスチャのサンプリングはできません（入力は color として渡ります）' },
];

export type CustomPostGlslValidation = GlslSnippetValidation;

export function validateCustomPostGlslCode(code: string): CustomPostGlslValidation {
  return validateGlslSnippet(code, FORBIDDEN_TOKENS, CUSTOM_POST_GLSL_MAX_LENGTH);
}

// The example doubles as the BX starter's snippet: a warm tint
// graded across the frame, written to be paired with the
// luminance lock (the tint folds back to a luminance lift, so
// the demo shows colour code landing as monochrome). Keep the
// comments free of the forbidden tokens above — the scan covers
// the whole snippet, comments included.
export const CUSTOM_POST_GLSL_EXAMPLE = `// 例: 暖色ティントを画面の左右で変えながら重ねる断片。
// color はこの段への入力色（読み書き）、vUv は画面座標です。
// 輝度ロックと併用すると、色は輝度の持ち上げとして残ります。
float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
float lift = mix(0.92, 1.08, vUv.x);
color = color * lift + vec3(0.10, 0.03, 0.0) * (1.0 - luma) * 0.35;`;

// ---------------------------------------------------------------------------
// Compile status, shared between the composer component (which
// compiles and swaps fragments) and the panel UI (which reports
// the outcome).

export type CustomPostGlslStatus = GlslInjectionStatus;

const statusStore = createGlslInjectionStatusStore();

export const setCustomPostGlslStatus = statusStore.set;
export const getCustomPostGlslStatus = statusStore.get;
export const useCustomPostGlslStatus = statusStore.useStatus;

// ---------------------------------------------------------------------------
// Harness + fragment generation

// Builds the harness fragment shader used for the compile check:
// the snippet sits in the same block scope it will occupy in the
// post pass, with the documented interface as locals/uniforms.
export function buildCustomPostGlslHarness(customCode: string): string {
  return `
  precision highp float;
  uniform float uTime;
  uniform vec2 uResolution;
  void main() {
    vec2 vUv = vec2(0.5);
    vec3 color = vec3(0.0);
    {
${customCode}
    }
    gl_FragColor = vec4(color, 1.0);
  }
`;
}

// The vertex source paired with the harness for the compile
// check (the check compiles a pair; the pass's own vertex shader
// only derives vUv from clip-space position).
export const CUSTOM_POST_GLSL_CHECK_VERTEX = `
void main() {
  gl_Position = vec4(position, 1.0);
}
`;

// Builds the full fragment shader of the post pass for a
// validated snippet: the input frame is sampled into `color`
// BEFORE the snippet runs, and the luminance lock (uLumaLock,
// a uniform so toggling it needs no recompile) re-projects the
// result afterwards.
export function buildCustomPostGlslFragment(customCode: string): string {
  return /* glsl */ `
uniform sampler2D tDiffuse;
uniform float uTime;
uniform vec2 uResolution;
uniform float uLumaLock;
varying vec2 vUv;

void main() {
  vec3 color = texture2D(tDiffuse, vUv).rgb;
  {
${customCode}
  }
  if (uLumaLock > 0.5) {
    color = vec3(dot(color, vec3(0.2126, 0.7152, 0.0722)));
  }
  gl_FragColor = vec4(color, 1.0);
}
`;
}

// ---------------------------------------------------------------------------
// The contract, registered on the shared foundation. Backends:
// the post chain is a WebGL composer — there is no WGSL post
// pipeline and the CPU fallback canvas has no post chain — so
// both declare 'unsupported' rather than dropping the effect
// without a word.

export const CUSTOM_POST_GLSL_CONTRACT: GlslInjectionContract = {
  id: 'custom-glsl-post',
  stage: 'post-fragment',
  variables: [
    { name: 'color', type: 'vec3', access: 'readwrite' },
    { name: 'vUv', type: 'vec2', access: 'read' },
    { name: 'uTime', type: 'float', access: 'read' },
    { name: 'uResolution', type: 'vec2', access: 'read' },
  ],
  backends: { webgl: 'supported', webgpu: 'unsupported', cpu: 'unsupported' },
  maxLength: CUSTOM_POST_GLSL_MAX_LENGTH,
  buildHarness: buildCustomPostGlslHarness,
};

registerGlslInjection(CUSTOM_POST_GLSL_CONTRACT);
