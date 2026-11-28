// Particle points fragment GLSL (Phase CE): the fourth GLSL
// injection point, registered on the shared foundation in
// lib/glslInjection.ts. The user writes a GLSL snippet that runs
// inside the particle points fragment shader
// (components/sceneShaderParticlePointFragment.ts) at two seams,
// both placed after every built-in discard and after the colour
// has been fully determined (base colour -> layer gradient ->
// hue shift -> ink inversion -> SDF lighting):
//
//   seam A — inside the Kinetix mask branch (uSdfShape >= 4),
//            just before its early gl_FragColor write + return;
//   seam B — after the SDF block, just before the final write.
//
// At each seam the current finalColor (vec3) and alpha (float)
// are composed into the contract's single write-back variable
// `color` (vec4), the snippet runs, and the result is split
// back into finalColor / alpha before the write.
//
// The snippet may read:
//   vUv (vec2, sprite-local coordinates), vLife (float, life
//   progress), vVelocity (float), vAlpha (float), uTime (float)
// and read/write the single variable:
//   color (vec4, the composed finalColor + alpha)
// e.g.:
//   color = vec4(vec3(1.0) - color.rgb, color.a);
//
// Deliberately NOT in the contract: the body's internal sprite
// switches and flicker inputs (vSpriteMode / vVariant / vBurst),
// the SDF uniforms and the layer-gradient sampler, and
// `discard` — particles are culled by the body's own shape
// judgements, which all sit before the seams; a snippet fades a
// particle out through color.a instead. Texture sampling is
// rejected for the same reason as at the other points.
//
// Safety model matches the other points (the user's own code in
// their own browser — the goal is protecting the output
// contract, not sandboxing): forbidden tokens first, then the
// snippet must compile inside the harness below — a fragment
// harness whose block mirrors the production seam exactly —
// before it is swapped in; on any failure the previously
// working shader stays active and the error is reported through
// the status store. While the point is disabled or the code is
// empty, the stock shader string is used as-is, so the defaults
// leave the rendering bit-identical.

import {
  createGlslInjectionStatusStore,
  registerGlslInjection,
  resolveGlslSnippet,
  validateGlslSnippet,
  GLSL_SNIPPET_MAX_LENGTH,
  type GlslForbiddenToken,
  type GlslInjectionContract,
  type GlslInjectionStatus,
  type GlslSnippetResolution,
  type GlslSnippetValidation,
} from './glslInjection';
import type { GlslSharedSnippetSet } from './glslSharedSnippets';

export const PARTICLE_POINTS_FRAGMENT_GLSL_MAX_LENGTH = GLSL_SNIPPET_MAX_LENGTH;

const FORBIDDEN_TOKENS: readonly GlslForbiddenToken[] = [
  { token: '#', reason: 'プリプロセッサ指令（#）は使えません' },
  { token: 'gl_FragColor', reason: 'gl_FragColor への書き込みはできません（color を書き換えてください）' },
  { token: 'discard', reason: 'discard は使えません（透明にしたい場合は color.a を下げてください）' },
  { token: 'void main', reason: 'main 関数は定義できません（断片だけを書いてください）' },
  { token: 'uniform', reason: 'uniform は宣言できません（color / vUv / vLife / vVelocity / vAlpha / uTime が使えます）' },
  { token: 'attribute', reason: 'attribute は宣言できません' },
  { token: 'varying', reason: 'varying は宣言できません' },
  { token: 'precision', reason: 'precision は宣言できません' },
  { token: 'texture2D', reason: 'テクスチャのサンプリングはできません' },
  { token: 'texture(', reason: 'テクスチャのサンプリングはできません' },
];

export type ParticlePointsFragmentGlslValidation = GlslSnippetValidation;

export function validateParticlePointsFragmentGlslCode(code: string): ParticlePointsFragmentGlslValidation {
  return validateGlslSnippet(code, FORBIDDEN_TOKENS, PARTICLE_POINTS_FRAGMENT_GLSL_MAX_LENGTH);
}

/**
 * Resolve the stored snippet against the shared definition
 * set (Layer 1 WP11 phase C wiring): `// @use` directives
 * expand under this point's own forbidden-token list and
 * length cap. A snippet without directives resolves to the
 * identical string.
 */
export function resolveParticlePointsFragmentSnippet(
  code: string,
  defs: GlslSharedSnippetSet,
): GlslSnippetResolution {
  return resolveGlslSnippet(code, defs, FORBIDDEN_TOKENS, PARTICLE_POINTS_FRAGMENT_GLSL_MAX_LENGTH);
}

// The example is the brief's known fragment (colour inversion),
// extended with a life-end fade. Keep the comments free of the
// forbidden tokens above — the scan covers the whole snippet,
// comments included.
export const PARTICLE_POINTS_FRAGMENT_GLSL_EXAMPLE = `// 例: 色を反転し、寿命の終わりに向けて少し薄くする。
// color（vec4）が読み書きでき、vUv / vLife / vVelocity / vAlpha / uTime が読めます。
color = vec4(vec3(1.0) - color.rgb, color.a * (1.0 - vLife * 0.35));`;

// ---------------------------------------------------------------------------
// Compile status, shared between the particle system component
// (which compiles and swaps shaders) and the panel UI (which
// reports the outcome).

export type ParticlePointsFragmentGlslStatus = GlslInjectionStatus;

const statusStore = createGlslInjectionStatusStore();

export const setParticlePointsFragmentGlslStatus = statusStore.set;
export const getParticlePointsFragmentGlslStatus = statusStore.get;
export const useParticlePointsFragmentGlslStatus = statusStore.useStatus;

// ---------------------------------------------------------------------------
// Harness generation

// Builds the harness FRAGMENT shader used for the compile check:
// the documented interface sits as locals in main, and the
// snippet occupies the same block (compose -> snippet -> split)
// it will occupy at both production seams, so a snippet that
// misuses `color` fails here, not on stage.
export function buildParticlePointsFragmentHarness(customCode: string): string {
  return `
  precision highp float;
  uniform float uTime;
  void main() {
    vec2 vUv = vec2(0.5);
    float vLife = 0.0;
    float vVelocity = 0.0;
    float vAlpha = 1.0;
    vec3 finalColor = vec3(0.0);
    float alpha = 1.0;
    { // particle points fragment (user GLSL)
    vec4 color = vec4(finalColor, alpha);
${customCode}
    finalColor = color.rgb;
    alpha = color.a;
    }
    gl_FragColor = vec4(finalColor, alpha);
  }
`;
}

// The minimal vertex source paired with the harness for the
// compile check (the check compiles a pair; compilation only —
// the app's own program performs the link at render time, and
// snippets cannot declare varyings, so no link-level mismatch
// is reachable from them).
export const PARTICLE_POINTS_FRAGMENT_CHECK_VERTEX = `
void main() {
  gl_Position = vec4(position, 1.0);
}
`;

// ---------------------------------------------------------------------------
// The contract, registered on the shared foundation. Backends:
// the snippet is spliced into the WebGL particle points fragment
// shader; user GLSL cannot be compiled to WGSL, and the CPU
// fallback renderer has no such shader — both declare
// 'unsupported' rather than dropping the effect without a word
// (the capability-registry rule, same as the other points).

export const PARTICLE_POINTS_FRAGMENT_GLSL_CONTRACT: GlslInjectionContract = {
  id: 'particle-points-fragment',
  stage: 'particle-fragment',
  variables: [
    { name: 'vUv', type: 'vec2', access: 'read' },
    { name: 'vLife', type: 'float', access: 'read' },
    { name: 'vVelocity', type: 'float', access: 'read' },
    { name: 'vAlpha', type: 'float', access: 'read' },
    { name: 'uTime', type: 'float', access: 'read' },
    { name: 'color', type: 'vec4', access: 'readwrite' },
  ],
  backends: { webgl: 'supported', webgpu: 'unsupported', cpu: 'unsupported' },
  maxLength: PARTICLE_POINTS_FRAGMENT_GLSL_MAX_LENGTH,
  buildHarness: buildParticlePointsFragmentHarness,
};

registerGlslInjection(PARTICLE_POINTS_FRAGMENT_GLSL_CONTRACT);
