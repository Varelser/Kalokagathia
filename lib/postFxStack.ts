import type { ParticleConfig } from '../types';
import { configUsesEdgeSupply } from './mapSourceSupply';
import { validateCustomPostGlslCode } from './customPostGlsl';

export type PostFxStageId =
  | 'brightness-contrast'
  | 'noise'
  | 'bloom'
  | 'chromatic-aberration'
  | 'depth-of-field'
  | 'vignette'
  | 'kaleidoscope'
  | 'slit-scan'
  | 'displace'
  | 'glitch'
  | 'pixel-sort'
  | 'fractal'
  | 'cellular'
  | 'moire'
  | 'feedback'
  | 'posterize'
  | 'ordered-dither'
  | 'halftone'
  | 'edge-detect'
  | 'composite'
  | 'custom-glsl-post'
  | 'edge-capture'
  | 'radial-blur'
  | 'light-fx'
  | 'output-grade';

export type PostFxStackProfile = ParticleConfig['postFxStackProfile'];

// 'radial-blur' (B2) sits with the other spatial lens stages, after
// depth-of-field; 'output-grade' (B2) is always the final stage so
// exposure / ACES grade the finished frame. 'light-fx' (Phase D:
// Shine / Starglow / Lux) sits immediately after 'bloom' in every
// profile so streaks and glints are extracted from the bloomed
// highlights, and before 'output-grade' so the brand duotone and
// exposure grade the finished light as well.
// Phase AD stages: 'displace' is a spatial warp, so it sits
// with the other spatial stages immediately before 'feedback'
// (feedback then smears the displaced frame, the TouchDesigner
// idiom). The tonal finishes (posterize / ordered-dither /
// halftone) and the Sobel edge pass are print-style treatments
// of the finished frame, so they sit after 'feedback' and
// before 'output-grade', which still grades last.
// Phase AF: 'edge-capture' is last in every profile — it copies
// the FINISHED frame's Sobel field into the edge supply target
// and passes the frame through bit-identically, so it runs after
// 'output-grade' and changes no pixel itself.
// Phase AL: 'fractal' is a spatial field rendered over the frame,
// so it sits with the spatial stages immediately before 'feedback'
// (feedback then smears the fractal frame, the 'displace' idiom).
// Phase AM: 'glitch' / 'pixel-sort' are displacements of the frame
// itself, so they sit after 'displace' and before 'fractal';
// 'cellular' (a generated state field) sits after 'fractal' and
// before 'feedback' (feedback then smears both); 'composite'
// blends the finished frame with a supply texture, so it sits
// after 'edge-detect' and before 'output-grade', which still
// grades last ('edge-output' as its B layer therefore reads the
// previous frame's capture).
// Phase AW: 'moire' is a generated pattern field like 'fractal' /
// 'cellular', so it sits after 'cellular' and before 'feedback'
// (feedback then smears the interference field, same idiom).
// Phase BX: 'custom-glsl-post' (the user's own GLSL, spliced by
// the shared injection foundation) sits after 'composite' and
// immediately before 'output-grade' in every profile, so the
// grade stage keeps the final word on the finished frame.
const STACK_ORDERS: Record<PostFxStackProfile, PostFxStageId[]> = {
  manual: ['brightness-contrast', 'noise', 'bloom', 'light-fx', 'chromatic-aberration', 'depth-of-field', 'radial-blur', 'vignette', 'kaleidoscope', 'slit-scan', 'displace', 'glitch', 'pixel-sort', 'fractal', 'cellular', 'moire', 'feedback', 'posterize', 'ordered-dither', 'halftone', 'edge-detect', 'composite', 'custom-glsl-post', 'output-grade', 'edge-capture'],
  'touch-feedback': ['brightness-contrast', 'noise', 'chromatic-aberration', 'bloom', 'light-fx', 'vignette', 'depth-of-field', 'radial-blur', 'kaleidoscope', 'slit-scan', 'displace', 'glitch', 'pixel-sort', 'fractal', 'cellular', 'moire', 'feedback', 'posterize', 'ordered-dither', 'halftone', 'edge-detect', 'composite', 'custom-glsl-post', 'output-grade', 'edge-capture'],
  'particular-glow': ['brightness-contrast', 'bloom', 'light-fx', 'chromatic-aberration', 'noise', 'vignette', 'depth-of-field', 'radial-blur', 'kaleidoscope', 'slit-scan', 'displace', 'glitch', 'pixel-sort', 'fractal', 'cellular', 'moire', 'feedback', 'posterize', 'ordered-dither', 'halftone', 'edge-detect', 'composite', 'custom-glsl-post', 'output-grade', 'edge-capture'],
  'retro-feedback': ['brightness-contrast', 'noise', 'chromatic-aberration', 'vignette', 'bloom', 'light-fx', 'depth-of-field', 'radial-blur', 'kaleidoscope', 'slit-scan', 'displace', 'glitch', 'pixel-sort', 'fractal', 'cellular', 'moire', 'feedback', 'posterize', 'ordered-dither', 'halftone', 'edge-detect', 'composite', 'custom-glsl-post', 'output-grade', 'edge-capture'],
  'dream-smear': ['brightness-contrast', 'depth-of-field', 'bloom', 'light-fx', 'chromatic-aberration', 'noise', 'vignette', 'radial-blur', 'kaleidoscope', 'slit-scan', 'displace', 'glitch', 'pixel-sort', 'fractal', 'cellular', 'moire', 'feedback', 'posterize', 'ordered-dither', 'halftone', 'edge-detect', 'composite', 'custom-glsl-post', 'output-grade', 'edge-capture'],
};

export function getActivePostFxStageIds(config: ParticleConfig): PostFxStageId[] {
  const active = new Set<PostFxStageId>();
  if (config.postBrightnessContrastEnabled && (Math.abs(config.postBrightness) > 0.001 || Math.abs(config.postContrastAmount) > 0.001)) {
    active.add('brightness-contrast');
  }
  if (config.postNoiseEnabled && config.postNoiseOpacity > 0.001) {
    active.add('noise');
  }
  if (config.postBloomEnabled) {
    active.add('bloom');
  }
  if (config.postChromaticAberrationEnabled && config.postChromaticAberrationOffset > 0.00001) {
    active.add('chromatic-aberration');
  }
  if (config.postDofEnabled) {
    active.add('depth-of-field');
  }
  if (config.postVignetteEnabled && (config.postVignetteDarkness > 0.001 || config.postVignetteOffset > 0.001)) {
    active.add('vignette');
  }
  if (config.postKaleidoscopeEnabled) {
    active.add('kaleidoscope');
  }
  if (config.postSlitScanEnabled) {
    active.add('slit-scan');
  }
  // Phase AL: the fractal stage exists only when it would change
  // a pixel (enabled with a non-zero mix).
  if (config.postFractalEnabled && config.postFractalMix > 0.001) {
    active.add('fractal');
  }
  // Phase AM stages follow the same rule: a stage exists only
  // when it would change a pixel.
  if (config.postGlitchEnabled && config.postGlitchAmount > 0.0001) {
    active.add('glitch');
  }
  if (config.postPixelSortEnabled) {
    active.add('pixel-sort');
  }
  if (config.postCellularEnabled) {
    active.add('cellular');
  }
  // Phase AW: the moire stage follows the same rule (enabled
  // with a non-zero mix).
  if (config.postMoireEnabled && config.postMoireMix > 0.001) {
    active.add('moire');
  }
  if (config.postCompositeEnabled && config.postCompositeMix > 0.001) {
    active.add('composite');
  }
  // Phase BX: the custom GLSL post stage exists only while an
  // enabled snippet passes the static token scan — empty or
  // invalid code never inserts the stage (structural identity,
  // the same rule as the other opt-in stages). Compile-level
  // failure is handled in the composer component, which keeps
  // the previously working fragment (the custom-force fallback
  // rule), so this gate stays a pure function of the config.
  if (
    config.postCustomGlslEnabled
    && config.postCustomGlslCode.trim().length > 0
    && validateCustomPostGlslCode(config.postCustomGlslCode).ok
  ) {
    active.add('custom-glsl-post');
  }
  if (config.postFeedbackEnabled) {
    active.add('feedback');
  }
  // Phase AD stages follow the same rule as the rest of the
  // stack: a stage exists only when it would change a pixel.
  if (config.postDisplaceEnabled && Math.abs(config.postDisplaceAmount) > 0.0001) {
    active.add('displace');
  }
  if (config.postPosterizeEnabled) {
    active.add('posterize');
  }
  if (config.postDitherEnabled && config.postDitherStrength > 0.001) {
    active.add('ordered-dither');
  }
  if (config.postHalftoneEnabled) {
    active.add('halftone');
  }
  if (config.postEdgeEnabled) {
    active.add('edge-detect');
  }
  // Phase AF edge supply: the capture stage exists only while
  // some map / mask source actually requests the edge field; it
  // is independent of the display edge pass above.
  if (configUsesEdgeSupply(config)) {
    active.add('edge-capture');
  }
  if (config.postRadialBlurEnabled && config.postRadialBlurStrength > 0.001) {
    active.add('radial-blur');
  }
  // LightFX (Phase D) exists only when at least one sub-effect would
  // change a pixel; all three default OFF, so the stage is absent and
  // the output is unchanged.
  if (
    (config.postShineEnabled && config.postShineIntensity > 0.001) ||
    (config.postStarglowEnabled && config.postStarglowIntensity > 0.001) ||
    (config.postLuxEnabled && config.postLuxIntensity > 0.001)
  ) {
    active.add('light-fx');
  }
  // Output grade only exists when it would change a pixel: exposure
  // other than 1.0, the ACES curve selected, or the brand monochrome
  // duotone (Pro-2) enabled. Defaults keep it off.
  if (
    Math.abs(config.postExposure - 1.0) > 0.001 ||
    config.postToneMapping === 'aces' ||
    config.postBrandColorEnabled
  ) {
    active.add('output-grade');
  }
  return Array.from(active);
}

export function getOrderedActivePostFxStageIds(config: ParticleConfig): PostFxStageId[] {
  const active = new Set(getActivePostFxStageIds(config));
  const preferredOrder = STACK_ORDERS[config.postFxStackProfile] ?? STACK_ORDERS.manual;
  return preferredOrder.filter((stage) => active.has(stage));
}
