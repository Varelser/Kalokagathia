// Volume fog fragment GLSL (Phase CE): the fifth GLSL
// injection point, registered on the shared foundation in
// lib/glslInjection.ts. The user writes a GLSL snippet that runs
// inside the volume fog (fog slice) fragment shader
// (components/sceneVolumeFogSystemShaders.ts) at the single seam
// where the density application is complete — after the base
// density scaling and the Pyro grid density feed — and before
// the edge fade and slice fade. Every slice material is built
// from the same shader string, so the same snippet applies to
// all slices identically; per-slice variation is only reachable
// through the read-only `vSlice` value itself.
//
// The snippet may read:
//   vUv (vec2, slice-local coordinates), vSlice (float, the
//   slice plane's position.z written by the vertex shader),
//   uTime (float, seconds)
// and read/write the single variable:
//   alpha (float, the slice opacity before the body's fades,
//   material-style branches and the final uOpacity multiply)
// e.g.:
//   alpha *= 0.5 + 0.5 * sin(vSlice * 0.05 + uTime);
//
// Deliberately NOT in the contract: the per-slice uniforms
// (uSliceIndex / uSliceCount — reading them would contradict
// the "same code on every slice" rule), the colour (computed by
// the body after the seam), and `discard` (the body's own
// alpha <= 0.003 cull sits after the seam and still applies, so
// alpha = 0.0 removes the slice). Texture sampling is rejected
// for the same reason as at the other points.
//
// vSlice note: the fog vertex shader declares and writes
// `varying float vSlice`, but the stock fragment shader never
// declared it (it had no reader). The built fragment used while
// this point is active adds the fragment-side declaration; the
// stock string used while disabled does not carry it, so the
// defaults stay byte-identical.
//
// Cost note: the fog is drawn once per slice, so a snippet's
// cost multiplies by the slice count. This is a heavy path;
// the panel says so next to the toggle.
//
// Safety model matches the other points (the user's own code in
// their own browser — the goal is protecting the output
// contract, not sandboxing): forbidden tokens first, then the
// snippet must compile inside the harness below before it is
// swapped in; on any failure the previously working shader
// stays active and the error is reported through the status
// store. While the point is disabled or the code is empty, the
// stock shader string is used as-is, so the defaults leave the
// rendering bit-identical.

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

export const VOLUME_FOG_GLSL_MAX_LENGTH = GLSL_SNIPPET_MAX_LENGTH;

const FORBIDDEN_TOKENS: readonly GlslForbiddenToken[] = [
  { token: '#', reason: 'プリプロセッサ指令（#）は使えません' },
  { token: 'gl_FragColor', reason: 'gl_FragColor への書き込みはできません（alpha を書き換えてください）' },
  { token: 'discard', reason: 'discard は使えません（消したい場合は alpha を 0 にしてください）' },
  { token: 'void main', reason: 'main 関数は定義できません（断片だけを書いてください）' },
  { token: 'uniform', reason: 'uniform は宣言できません（vUv / vSlice / uTime が使え、alpha が読み書きできます）' },
  { token: 'attribute', reason: 'attribute は宣言できません' },
  { token: 'varying', reason: 'varying は宣言できません' },
  { token: 'precision', reason: 'precision は宣言できません' },
  { token: 'texture2D', reason: 'テクスチャのサンプリングはできません' },
  { token: 'texture(', reason: 'テクスチャのサンプリングはできません' },
];

export type VolumeFogGlslValidation = GlslSnippetValidation;

export function validateVolumeFogGlslCode(code: string): VolumeFogGlslValidation {
  return validateGlslSnippet(code, FORBIDDEN_TOKENS, VOLUME_FOG_GLSL_MAX_LENGTH);
}

/**
 * Resolve the stored snippet against the shared definition
 * set (Layer 1 WP11 phase C wiring): `// @use` directives
 * expand under this point's own forbidden-token list and
 * length cap. A snippet without directives resolves to the
 * identical string.
 */
export function resolveVolumeFogSnippet(
  code: string,
  defs: GlslSharedSnippetSet,
): GlslSnippetResolution {
  return resolveGlslSnippet(code, defs, FORBIDDEN_TOKENS, VOLUME_FOG_GLSL_MAX_LENGTH);
}

// The example is the brief's known fragment: a per-slice phase-
// shifted shimmer through vSlice. Keep the comments free of the
// forbidden tokens above — the scan covers the whole snippet,
// comments included.
export const VOLUME_FOG_GLSL_EXAMPLE = `// 例: スライスごとに位相のずれた明滅。
// alpha（float）が読み書きでき、vUv / vSlice / uTime が読めます。
alpha *= 0.5 + 0.5 * sin(vSlice * 0.05 + uTime);`;

// ---------------------------------------------------------------------------
// Compile status, shared between the volume fog runtime (which
// compiles and swaps shaders) and the panel UI (which reports
// the outcome).

export type VolumeFogGlslStatus = GlslInjectionStatus;

const statusStore = createGlslInjectionStatusStore();

export const setVolumeFogGlslStatus = statusStore.set;
export const getVolumeFogGlslStatus = statusStore.get;
export const useVolumeFogGlslStatus = statusStore.useStatus;

// ---------------------------------------------------------------------------
// Harness generation

// Builds the harness FRAGMENT shader used for the compile check:
// the documented interface sits as locals in main (vSlice is a
// local here — in production it arrives as a varying, which the
// snippet cannot distinguish), and the snippet occupies the same
// bare block scope it will occupy at the production seam.
export function buildVolumeFogHarness(customCode: string): string {
  return `
  precision highp float;
  uniform float uTime;
  void main() {
    vec2 vUv = vec2(0.5);
    float vSlice = 0.0;
    float alpha = 0.5;
    { // volume fog fragment (user GLSL)
${customCode}
    }
    gl_FragColor = vec4(vec3(0.0), alpha);
  }
`;
}

// The minimal vertex source paired with the harness for the
// compile check (the check compiles a pair; compilation only —
// the app's own program performs the link at render time, and
// snippets cannot declare varyings, so no link-level mismatch
// is reachable from them).
export const VOLUME_FOG_CHECK_VERTEX = `
void main() {
  gl_Position = vec4(position, 1.0);
}
`;

// ---------------------------------------------------------------------------
// The contract, registered on the shared foundation. Backends:
// the snippet is spliced into the WebGL volume fog fragment
// shader; user GLSL cannot be compiled to WGSL, and the CPU
// fallback renderer has no such shader — both declare
// 'unsupported' rather than dropping the effect without a word
// (the capability-registry rule, same as the other points).

export const VOLUME_FOG_GLSL_CONTRACT: GlslInjectionContract = {
  id: 'volume-fog-fragment',
  stage: 'volume-fragment',
  variables: [
    { name: 'vUv', type: 'vec2', access: 'read' },
    { name: 'vSlice', type: 'float', access: 'read' },
    { name: 'uTime', type: 'float', access: 'read' },
    { name: 'alpha', type: 'float', access: 'readwrite' },
  ],
  backends: { webgl: 'supported', webgpu: 'unsupported', cpu: 'unsupported' },
  maxLength: VOLUME_FOG_GLSL_MAX_LENGTH,
  buildHarness: buildVolumeFogHarness,
};

registerGlslInjection(VOLUME_FOG_GLSL_CONTRACT);
