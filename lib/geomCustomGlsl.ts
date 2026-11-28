// GEOM custom GLSL (Phase 16 stage 4): the sixth and seventh GLSL
// injection points, registered on the shared foundation in
// lib/glslInjection.ts. They splice user snippets into the
// instanced-geometry shaders (components/gpgpuShaderVolumes.ts
// GEOM_VERT / GEOM_FRAG) — the first points on a surface that has
// both shape and lighting. Scope is deliberately GEOM only, and
// deliberately POST-computation seams only: the vertex seam sits
// after the instance position is fully determined, the fragment
// seam after the lighting sum. Replacing the lighting formula
// itself (a pre-computation seam) is NOT part of this stage.
//
// Vertex contract — the snippet may read:
//   worldPos (vec3, the determined world position),
//   normal (vec3, the world-space normal), uTime (float, seconds)
// and write back the single variable:
//   disp (vec3, displacement, starts at vec3(0.0))
// e.g.:
//   disp = vec3(0.0, sin(uTime * 2.0 + worldPos.x * 0.05) * 0.5, 0.0);
//
// Fragment contract — the snippet may read:
//   col (vec3, the colour right after lighting), N (vec3, the
//   view-space normal), V (vec3, the view direction)
// and write back the single variable:
//   col (vec3)
// e.g.:
//   col *= 0.85 + 0.15 * N.y;
//
// Safety model matches the other points: forbidden tokens first,
// then the snippet must compile inside the harness below before
// it is swapped in; on any failure the previously working shader
// stays active and the error is reported through the point's
// status store. While a point is disabled or its code is empty
// (or statically invalid), the builders in gpgpuShaderVolumes.ts
// return the stock shader strings byte-identical.

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

export const GEOM_CUSTOM_VERTEX_GLSL_MAX_LENGTH = GLSL_SNIPPET_MAX_LENGTH;
export const GEOM_CUSTOM_FRAGMENT_GLSL_MAX_LENGTH = GLSL_SNIPPET_MAX_LENGTH;

const VERTEX_FORBIDDEN_TOKENS: readonly GlslForbiddenToken[] = [
  { token: '#', reason: 'プリプロセッサ指令（#）は使えません' },
  { token: 'gl_Position', reason: 'gl_Position への書き込みはできません（disp に変位を入れてください）' },
  { token: 'gl_PointSize', reason: 'gl_PointSize は書けません（disp に変位を入れてください）' },
  { token: 'void main', reason: 'main 関数は定義できません（断片だけを書いてください）' },
  { token: 'uniform', reason: 'uniform は宣言できません（worldPos / normal / uTime が使えます）' },
  { token: 'attribute', reason: 'attribute は宣言できません' },
  { token: 'varying', reason: 'varying は宣言できません' },
  { token: 'precision', reason: 'precision は宣言できません' },
  { token: 'texture2D', reason: 'テクスチャのサンプリングはできません' },
  { token: 'texture(', reason: 'テクスチャのサンプリングはできません' },
];

const FRAGMENT_FORBIDDEN_TOKENS: readonly GlslForbiddenToken[] = [
  { token: '#', reason: 'プリプロセッサ指令（#）は使えません' },
  { token: 'gl_FragColor', reason: 'gl_FragColor への書き込みはできません（col に色を入れてください）' },
  { token: 'void main', reason: 'main 関数は定義できません（断片だけを書いてください）' },
  { token: 'uniform', reason: 'uniform は宣言できません（col / N / V が使えます）' },
  { token: 'attribute', reason: 'attribute は宣言できません' },
  { token: 'varying', reason: 'varying は宣言できません' },
  { token: 'precision', reason: 'precision は宣言できません' },
  { token: 'texture2D', reason: 'テクスチャのサンプリングはできません' },
  { token: 'texture(', reason: 'テクスチャのサンプリングはできません' },
];

export type GeomCustomVertexGlslValidation = GlslSnippetValidation;
export type GeomCustomFragmentGlslValidation = GlslSnippetValidation;

export function validateGeomCustomVertexGlslCode(code: string): GeomCustomVertexGlslValidation {
  return validateGlslSnippet(code, VERTEX_FORBIDDEN_TOKENS, GEOM_CUSTOM_VERTEX_GLSL_MAX_LENGTH);
}

export function validateGeomCustomFragmentGlslCode(code: string): GeomCustomFragmentGlslValidation {
  return validateGlslSnippet(code, FRAGMENT_FORBIDDEN_TOKENS, GEOM_CUSTOM_FRAGMENT_GLSL_MAX_LENGTH);
}

/**
 * Resolve a stored snippet against the shared definition set
 * (Layer 1 WP11 phase C wiring): `// @use` directives expand
 * under the point's own forbidden-token list and length cap.
 * A snippet without directives resolves to the identical
 * string.
 */
export function resolveGeomCustomVertexSnippet(
  code: string,
  defs: GlslSharedSnippetSet,
): GlslSnippetResolution {
  return resolveGlslSnippet(code, defs, VERTEX_FORBIDDEN_TOKENS, GEOM_CUSTOM_VERTEX_GLSL_MAX_LENGTH);
}

export function resolveGeomCustomFragmentSnippet(
  code: string,
  defs: GlslSharedSnippetSet,
): GlslSnippetResolution {
  return resolveGlslSnippet(code, defs, FRAGMENT_FORBIDDEN_TOKENS, GEOM_CUSTOM_FRAGMENT_GLSL_MAX_LENGTH);
}

// Examples: keep the comments free of the forbidden tokens above —
// the scan covers the whole snippet, comments included.
export const GEOM_CUSTOM_VERTEX_GLSL_EXAMPLE = `// 例: 位置に応じた波の変位。
// worldPos（vec3）/ normal / uTime が読めます。
// 変位は disp（vec3）へ入れてください。
disp = vec3(0.0, sin(uTime * 2.0 + worldPos.x * 0.05) * 0.5, 0.0);`;

export const GEOM_CUSTOM_FRAGMENT_GLSL_EXAMPLE = `// 例: 法線の向きで色をわずかに変える。
// col（vec3）/ N / V が読めます。書き戻しは col のみです。
col *= 0.85 + 0.15 * N.y;`;

// ---------------------------------------------------------------------------
// Compile status stores (one per point), shared between the mesh
// assets hook (which compiles and swaps shaders) and the panel UI.

export type GeomCustomVertexGlslStatus = GlslInjectionStatus;
export type GeomCustomFragmentGlslStatus = GlslInjectionStatus;

const vertexStatusStore = createGlslInjectionStatusStore();
export const setGeomCustomVertexGlslStatus = vertexStatusStore.set;
export const getGeomCustomVertexGlslStatus = vertexStatusStore.get;
export const useGeomCustomVertexGlslStatus = vertexStatusStore.useStatus;

const fragmentStatusStore = createGlslInjectionStatusStore();
export const setGeomCustomFragmentGlslStatus = fragmentStatusStore.set;
export const getGeomCustomFragmentGlslStatus = fragmentStatusStore.get;
export const useGeomCustomFragmentGlslStatus = fragmentStatusStore.useStatus;

// ---------------------------------------------------------------------------
// Harness generation

// Vertex harness: the documented interface sits as locals in
// main (worldPos / normal from plain attributes, uTime as a
// uniform, as in the real shader), and the snippet occupies the
// same block scope it will occupy at the seam, with the same
// write-back line — a snippet that misuses disp fails here.
export function buildGeomCustomVertexHarness(customCode: string): string {
  return `
  uniform float uTime;
  void main() {
    vec3 vWorldPos = position;
    vec3 vWorldNormal = normal;
    vec3 local = position;
    { // geom vertex (user GLSL)
    vec3 worldPos = vWorldPos;
    vec3 normal = vWorldNormal;
    vec3 disp = vec3(0.0);
${customCode}
    local += disp;
    vWorldPos += disp;
    }
    gl_Position = vec4(vWorldPos + local, 1.0);
  }
`;
}

// Fragment harness: col / N / V as locals in main, the snippet in
// the same block scope as the production seam, and the final
// write consuming col exactly like GEOM_FRAG does.
export function buildGeomCustomFragmentHarness(customCode: string): string {
  return `
  void main() {
    vec3 col = vec3(0.5);
    vec3 N = vec3(0.0, 1.0, 0.0);
    vec3 V = vec3(0.0, 0.0, 1.0);
    { // geom fragment (user GLSL)
${customCode}
    }
    gl_FragColor = vec4(col, 1.0);
  }
`;
}

// Minimal counterparts paired with the harnesses for the compile
// check (compilation only — the app's own program performs the
// link at render time, and snippets cannot declare varyings, so
// no link-level mismatch is reachable from them).
export const GEOM_CUSTOM_CHECK_VERTEX = `
void main() {
  gl_Position = vec4(position, 1.0);
}
`;

export const GEOM_CUSTOM_CHECK_FRAGMENT = `
void main() {
  gl_FragColor = vec4(1.0);
}
`;

// ---------------------------------------------------------------------------
// The contracts, registered on the shared foundation. Backends:
// the snippets splice into the WebGL GEOM shaders; user GLSL
// cannot be compiled to WGSL, and the CPU fallback renderer has
// no such shader — both declare 'unsupported' rather than
// dropping the effect without a word (the capability-registry
// rule, same as the other points).

export const GEOM_CUSTOM_VERTEX_GLSL_CONTRACT: GlslInjectionContract = {
  id: 'geom-custom-vertex',
  stage: 'geom-vertex',
  variables: [
    { name: 'worldPos', type: 'vec3', access: 'read' },
    { name: 'normal', type: 'vec3', access: 'read' },
    { name: 'uTime', type: 'float', access: 'read' },
    { name: 'disp', type: 'vec3', access: 'readwrite' },
  ],
  backends: { webgl: 'supported', webgpu: 'unsupported', cpu: 'unsupported' },
  maxLength: GEOM_CUSTOM_VERTEX_GLSL_MAX_LENGTH,
  buildHarness: buildGeomCustomVertexHarness,
};

export const GEOM_CUSTOM_FRAGMENT_GLSL_CONTRACT: GlslInjectionContract = {
  id: 'geom-custom-fragment',
  stage: 'geom-fragment',
  variables: [
    { name: 'col', type: 'vec3', access: 'readwrite' },
    { name: 'N', type: 'vec3', access: 'read' },
    { name: 'V', type: 'vec3', access: 'read' },
  ],
  backends: { webgl: 'supported', webgpu: 'unsupported', cpu: 'unsupported' },
  maxLength: GEOM_CUSTOM_FRAGMENT_GLSL_MAX_LENGTH,
  buildHarness: buildGeomCustomFragmentHarness,
};

registerGlslInjection(GEOM_CUSTOM_VERTEX_GLSL_CONTRACT);
registerGlslInjection(GEOM_CUSTOM_FRAGMENT_GLSL_CONTRACT);
