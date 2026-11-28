// Full-fragment replacement slots for the three terminal
// drawing points (Layer 1 WP11, phase D2).
//
// The shared machinery — the contract type, the base
// forbidden-token list, the validation (scan + output form) and
// the registry — lives in lib/glslInjection.ts next to the
// snippet foundation. This module holds the three slots the
// WP11 phase-D decision (branch 2, option (b)) opened, one per
// terminal point:
//
//   custom-glsl-post        (lib/customPostGlsl.ts)
//   particle-points-fragment (lib/particlePointsFragmentGlsl.ts)
//   volume-fog-fragment     (lib/volumeFogGlsl.ts)
//
// Each slot's contract is DERIVED from its point's existing
// snippet contract: same stage, same per-backend support, same
// length cap, and the host-supplied declarations are exactly
// the interface the snippet contract documents, written out as
// the declarations the host prepends. The snippet form stays
// registered and untouched at every point — the replacement is
// a second, selectable form, and a configuration that does not
// use it builds byte-identical shaders.
//
// Per-point premises the replacement author takes over (the
// material's warning that whole-fragment replacement can break
// host premises, closed here to a single colour):
//
// - Post: the host fragment used to sample the frame into
//   `color`, run the snippet, apply the optional luminance
//   lock and write alpha 1.0. In replacement form the code
//   samples tDiffuse itself and owns the output alpha; the
//   uLumaLock declaration is still supplied with the current
//   toggle value, but honouring it is the code's own choice.
// - Particle points: only the snippet contract's varyings and
//   uTime are supplied. The body's own determination (sprite
//   shapes, SDF lighting, layer gradient, hue / ink stages) is
//   NOT part of the replacement — writing a replacement means
//   the code alone decides the particle's colour. The vertex
//   shader (and its injection point) is unchanged and still
//   writes the varyings.
// - Volume fog: the same code runs on every slice, as at the
//   snippet point (the per-slice uniforms stay undeclared).
//   The colour the body used to compute from `alpha` is the
//   code's own output now.
//
// Sampling: only the post slot declares a texture input, so
// only there may the code sample. At the other two slots the
// sampling tokens stay forbidden, and `discard` stays
// forbidden at both — their documented discipline (fade
// through the output alpha) carries over to the replacement's
// gl_FragColor.a.

import {
  assembleGlslReplacementFragment,
  createGlslInjectionStatusStore,
  registerGlslReplacement,
  validateGlslReplacementCode,
  type GlslForbiddenToken,
  type GlslInjectionContract,
  type GlslInjectionStatus,
  type GlslReplacementContract,
  type GlslSnippetValidation,
} from './glslInjection';
import { CUSTOM_POST_GLSL_CONTRACT } from './customPostGlsl';
import { PARTICLE_POINTS_FRAGMENT_GLSL_CONTRACT } from './particlePointsFragmentGlsl';
import { VOLUME_FOG_GLSL_CONTRACT } from './volumeFogGlsl';

// ---------------------------------------------------------------------------
// Post (custom-glsl-post)

// Exactly the declaration header the host's own fragment
// builder (buildCustomPostGlslFragment) opens with.
export const POST_GLSL_REPLACEMENT_DECLARATIONS = `uniform sampler2D tDiffuse;
uniform float uTime;
uniform vec2 uResolution;
uniform float uLumaLock;
varying vec2 vUv;`;

// Keep the comments free of the base list's tokens (the scan
// covers comments too): no preprocessor marks, and the words
// for the declaration kinds the host supplies must not appear.
export const POST_GLSL_REPLACEMENT_EXAMPLE = `// 例: 入力フレームをサンプリングして反転し、画面端を少し暗くする。
// tDiffuse / vUv / uTime / uResolution / uLumaLock が読めます。
void main() {
  vec3 c = texture2D(tDiffuse, vUv).rgb;
  c = vec3(1.0) - c;
  float d = distance(vUv, vec2(0.5));
  c *= 1.0 - 0.35 * smoothstep(0.45, 0.95, d);
  gl_FragColor = vec4(c, 1.0);
}`;

// ---------------------------------------------------------------------------
// Particle points fragment (particle-points-fragment)

// The snippet contract's documented interface as declarations:
// the varyings the (unchanged) vertex shader writes, plus
// uTime. Nothing of the body's internal interface (sprite
// switches, SDF, layer gradient) is supplied.
export const PARTICLE_POINTS_FRAGMENT_REPLACEMENT_DECLARATIONS = `uniform float uTime;
varying vec2 vUv;
varying float vLife;
varying float vVelocity;
varying float vAlpha;`;

export const PARTICLE_POINTS_FRAGMENT_REPLACEMENT_EXAMPLE = `// 例: 寿命で色を白へ寄せ、速度で透明度を変える。
// vUv / vLife / vVelocity / vAlpha / uTime が読めます。
void main() {
  vec3 c = mix(vec3(0.15), vec3(1.0), vLife);
  float a = vAlpha * clamp(0.35 + vVelocity * 0.65, 0.0, 1.0);
  gl_FragColor = vec4(c, a);
}`;

const PARTICLE_POINTS_REPLACEMENT_FORBIDDEN_TOKENS: readonly GlslForbiddenToken[] = [
  { token: 'discard', reason: 'discard は使えません（透明にしたい場合は gl_FragColor.a を下げてください）' },
  { token: 'texture2D', reason: 'テクスチャのサンプリングはできません（サンプリングできる入力はありません）' },
  { token: 'texture(', reason: 'テクスチャのサンプリングはできません（サンプリングできる入力はありません）' },
];

// ---------------------------------------------------------------------------
// Volume fog fragment (volume-fog-fragment)

// The snippet contract's documented interface as declarations.
// vSlice is declared here, mirroring the fragment-side
// declaration the built shader adds while the point is active.
export const VOLUME_FOG_REPLACEMENT_DECLARATIONS = `uniform float uTime;
varying vec2 vUv;
varying float vSlice;`;

export const VOLUME_FOG_REPLACEMENT_EXAMPLE = `// 例: スライス位置と時間で脈動する単色の霧。
// vUv / vSlice / uTime が読めます。
void main() {
  float pulse = 0.5 + 0.5 * sin(vSlice * 0.05 + uTime);
  float edge = smoothstep(0.0, 0.15, vUv.x) * smoothstep(1.0, 0.85, vUv.x);
  gl_FragColor = vec4(vec3(0.9), 0.35 * pulse * edge);
}`;

const VOLUME_FOG_REPLACEMENT_FORBIDDEN_TOKENS: readonly GlslForbiddenToken[] = [
  { token: 'discard', reason: 'discard は使えません（消したい場合は gl_FragColor.a を 0 にしてください）' },
  { token: 'texture2D', reason: 'テクスチャのサンプリングはできません（サンプリングできる入力はありません）' },
  { token: 'texture(', reason: 'テクスチャのサンプリングはできません（サンプリングできる入力はありません）' },
];

// ---------------------------------------------------------------------------
// The contracts, derived from the points' snippet contracts

function deriveReplacementContract(
  point: GlslInjectionContract,
  declarations: string,
  variables: GlslReplacementContract['variables'],
  forbiddenTokens: readonly GlslForbiddenToken[],
): GlslReplacementContract {
  return {
    pointId: point.id,
    stage: point.stage,
    declarations,
    variables,
    backends: point.backends,
    maxLength: point.maxLength,
    forbiddenTokens,
    buildHarness: (code: string) => assembleGlslReplacementFragment(declarations, code),
    buildFragment: (code: string) => assembleGlslReplacementFragment(declarations, code),
  };
}

export const POST_GLSL_REPLACEMENT_CONTRACT: GlslReplacementContract = deriveReplacementContract(
  CUSTOM_POST_GLSL_CONTRACT,
  POST_GLSL_REPLACEMENT_DECLARATIONS,
  [
    { name: 'tDiffuse', type: 'sampler2D', access: 'read' },
    { name: 'vUv', type: 'vec2', access: 'read' },
    { name: 'uTime', type: 'float', access: 'read' },
    { name: 'uResolution', type: 'vec2', access: 'read' },
    { name: 'uLumaLock', type: 'float', access: 'read' },
  ],
  [],
);

export const PARTICLE_POINTS_FRAGMENT_REPLACEMENT_CONTRACT: GlslReplacementContract =
  deriveReplacementContract(
    PARTICLE_POINTS_FRAGMENT_GLSL_CONTRACT,
    PARTICLE_POINTS_FRAGMENT_REPLACEMENT_DECLARATIONS,
    [
      { name: 'vUv', type: 'vec2', access: 'read' },
      { name: 'vLife', type: 'float', access: 'read' },
      { name: 'vVelocity', type: 'float', access: 'read' },
      { name: 'vAlpha', type: 'float', access: 'read' },
      { name: 'uTime', type: 'float', access: 'read' },
    ],
    PARTICLE_POINTS_REPLACEMENT_FORBIDDEN_TOKENS,
  );

export const VOLUME_FOG_REPLACEMENT_CONTRACT: GlslReplacementContract = deriveReplacementContract(
  VOLUME_FOG_GLSL_CONTRACT,
  VOLUME_FOG_REPLACEMENT_DECLARATIONS,
  [
    { name: 'vUv', type: 'vec2', access: 'read' },
    { name: 'vSlice', type: 'float', access: 'read' },
    { name: 'uTime', type: 'float', access: 'read' },
  ],
  VOLUME_FOG_REPLACEMENT_FORBIDDEN_TOKENS,
);

registerGlslReplacement(POST_GLSL_REPLACEMENT_CONTRACT);
registerGlslReplacement(PARTICLE_POINTS_FRAGMENT_REPLACEMENT_CONTRACT);
registerGlslReplacement(VOLUME_FOG_REPLACEMENT_CONTRACT);

// ---------------------------------------------------------------------------
// Validation entry points, one per slot (the shared core does
// the work; these pin which contract each point validates
// against).

export function validatePostGlslReplacementCode(code: string): GlslSnippetValidation {
  return validateGlslReplacementCode(code, POST_GLSL_REPLACEMENT_CONTRACT);
}

export function validateParticlePointsFragmentReplacementCode(code: string): GlslSnippetValidation {
  return validateGlslReplacementCode(code, PARTICLE_POINTS_FRAGMENT_REPLACEMENT_CONTRACT);
}

export function validateVolumeFogReplacementCode(code: string): GlslSnippetValidation {
  return validateGlslReplacementCode(code, VOLUME_FOG_REPLACEMENT_CONTRACT);
}

// ---------------------------------------------------------------------------
// Compile status stores, one per slot — the same shape and the
// same rule as the snippet points': the consumer that compiles
// and swaps fragments reports through these, and on any failure
// the previously working fragment stays active.

export type GlslReplacementStatus = GlslInjectionStatus;

const postReplacementStatusStore = createGlslInjectionStatusStore();
export const setPostGlslReplacementStatus = postReplacementStatusStore.set;
export const getPostGlslReplacementStatus = postReplacementStatusStore.get;
export const usePostGlslReplacementStatus = postReplacementStatusStore.useStatus;

const particlePointsReplacementStatusStore = createGlslInjectionStatusStore();
export const setParticlePointsFragmentReplacementStatus = particlePointsReplacementStatusStore.set;
export const getParticlePointsFragmentReplacementStatus = particlePointsReplacementStatusStore.get;
export const useParticlePointsFragmentReplacementStatus = particlePointsReplacementStatusStore.useStatus;

const volumeFogReplacementStatusStore = createGlslInjectionStatusStore();
export const setVolumeFogReplacementStatus = volumeFogReplacementStatusStore.set;
export const getVolumeFogReplacementStatus = volumeFogReplacementStatusStore.get;
export const useVolumeFogReplacementStatus = volumeFogReplacementStatusStore.useStatus;
