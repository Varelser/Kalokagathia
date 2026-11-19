// Particle points vertex GLSL (Phase CD): the third GLSL
// injection point, registered on the shared foundation in
// lib/glslInjection.ts. The user writes a GLSL snippet that runs
// inside the particle points vertex shader
// (components/sceneShaderParticlePointVertex.ts), at the seam
// where `pos` has been fully determined — after every built-in
// motion, morph, spin, warp, life and audio term — immediately
// before the model-view transform. Because the seam sits before
// the transform, the displacement applies to both downstream
// paths: the billboard quad path (via mvPosition) and the
// instanced 3D branch (which consumes `pos` directly).
//
// The snippet may read:
//   pos (vec3, the determined position), lifeProgress (float),
//   aVariant (float, per-particle variant), uTime (float, seconds)
// and write back the single variable:
//   disp (vec3, displacement, starts at vec3(0.0))
// e.g.:
//   disp = vec3(0.0, sin(uTime * 2.0 + aVariant * 6.2831) * 0.05, 0.0);
//
// Safety model matches the other points (the user's own code in
// their own browser — the goal is protecting the output
// contract, not sandboxing): forbidden tokens first, then the
// snippet must compile inside the harness below — a vertex
// harness whose attribute declarations are the real shader's own
// (aPosition / aOffset / aData1..3 / aFeedbackIndex), paired with
// a minimal fragment — before it is swapped in; on any failure
// the previously working shader stays active and the error is
// reported through the status store. While the point is disabled
// or the code is empty, the stock shader string is used as-is,
// so the defaults leave the rendering bit-identical.
//
// prevPos note (Phase CD decision, from the crosscheck remark by
// #11): the built shader adds the same `disp` to `prevPos` (the
// previous-instant position used for trails / streaks). disp is
// a per-particle positional offset, and prevPos is the same
// particle — adding the offset to both keeps the trail delta
// (and vVelocity) measuring the particle's own motion instead of
// fabricating a streak out of a constant displacement.

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

export const PARTICLE_POINTS_VERTEX_GLSL_MAX_LENGTH = GLSL_SNIPPET_MAX_LENGTH;

const FORBIDDEN_TOKENS: readonly GlslForbiddenToken[] = [
  { token: '#', reason: 'プリプロセッサ指令（#）は使えません' },
  { token: 'gl_Position', reason: 'gl_Position への書き込みはできません（disp に変位を入れてください）' },
  { token: 'gl_PointSize', reason: 'gl_PointSize は書けません（disp に変位を入れてください）' },
  { token: 'void main', reason: 'main 関数は定義できません（断片だけを書いてください）' },
  { token: 'uniform', reason: 'uniform は宣言できません（pos / lifeProgress / aVariant / uTime が使えます）' },
  { token: 'attribute', reason: 'attribute は宣言できません' },
  { token: 'varying', reason: 'varying は宣言できません' },
  { token: 'precision', reason: 'precision は宣言できません' },
  { token: 'texture2D', reason: 'テクスチャのサンプリングはできません' },
  { token: 'texture(', reason: 'テクスチャのサンプリングはできません' },
];

export type ParticlePointsVertexGlslValidation = GlslSnippetValidation;

export function validateParticlePointsVertexGlslCode(code: string): ParticlePointsVertexGlslValidation {
  return validateGlslSnippet(code, FORBIDDEN_TOKENS, PARTICLE_POINTS_VERTEX_GLSL_MAX_LENGTH);
}

// The example is the brief's known fragment: a per-particle
// phase-shifted vertical sway. Keep the comments free of the
// forbidden tokens above — the scan covers the whole snippet,
// comments included.
export const PARTICLE_POINTS_VERTEX_GLSL_EXAMPLE = `// 例: 粒子ごとに位相をずらした上下の揺れ。
// pos（vec3）/ lifeProgress / aVariant / uTime が読めます。
// 変位は disp（vec3）へ入れてください。
disp = vec3(0.0, sin(uTime * 2.0 + aVariant * 6.2831) * 0.05, 0.0);`;

// ---------------------------------------------------------------------------
// Compile status, shared between the particle system component
// (which compiles and swaps shaders) and the panel UI (which
// reports the outcome).

export type ParticlePointsVertexGlslStatus = GlslInjectionStatus;

const statusStore = createGlslInjectionStatusStore();

export const setParticlePointsVertexGlslStatus = statusStore.set;
export const getParticlePointsVertexGlslStatus = statusStore.get;
export const useParticlePointsVertexGlslStatus = statusStore.useStatus;

// ---------------------------------------------------------------------------
// Harness generation

// Builds the harness VERTEX shader used for the compile check:
// the attribute declarations are the real vertex shader's own,
// the documented interface sits as locals in main, and the
// snippet occupies the same block scope (disp declared inside
// the block) it will occupy at the seam. The write-back line
// mirrors the production block so a snippet that misuses disp
// fails here, not on stage.
export function buildParticlePointsVertexHarness(customCode: string): string {
  return `
  attribute vec3 aPosition;
  attribute vec3 aOffset;
  attribute vec4 aData1;
  attribute vec4 aData2;
  attribute vec4 aData3;
  attribute float aFeedbackIndex;
  uniform float uTime;
  void main() {
    vec3 pos = aPosition + aOffset;
    float lifeProgress = 0.0;
    float aVariant = aData3.z;
    { // particle points vertex (user GLSL)
    vec3 disp = vec3(0.0);
${customCode}
    pos += disp;
    }
    gl_Position = vec4(pos, 1.0);
  }
`;
}

// The minimal fragment source paired with the harness for the
// compile check (the check compiles a pair; compilation only —
// the app's own program performs the link at render time, and
// snippets cannot declare varyings, so no link-level mismatch
// is reachable from them).
export const PARTICLE_POINTS_VERTEX_CHECK_FRAGMENT = `
void main() {
  gl_FragColor = vec4(1.0);
}
`;

// ---------------------------------------------------------------------------
// The contract, registered on the shared foundation. Backends:
// the snippet is spliced into the WebGL particle points vertex
// shader; user GLSL cannot be compiled to WGSL, and the CPU
// fallback renderer has no such shader — both declare
// 'unsupported' rather than dropping the effect without a word
// (the capability-registry rule, same as the other two points).

export const PARTICLE_POINTS_VERTEX_GLSL_CONTRACT: GlslInjectionContract = {
  id: 'particle-points-vertex',
  stage: 'particle-vertex',
  variables: [
    { name: 'pos', type: 'vec3', access: 'read' },
    { name: 'lifeProgress', type: 'float', access: 'read' },
    { name: 'aVariant', type: 'float', access: 'read' },
    { name: 'uTime', type: 'float', access: 'read' },
    { name: 'disp', type: 'vec3', access: 'readwrite' },
  ],
  backends: { webgl: 'supported', webgpu: 'unsupported', cpu: 'unsupported' },
  maxLength: PARTICLE_POINTS_VERTEX_GLSL_MAX_LENGTH,
  buildHarness: buildParticlePointsVertexHarness,
};

registerGlslInjection(PARTICLE_POINTS_VERTEX_GLSL_CONTRACT);
