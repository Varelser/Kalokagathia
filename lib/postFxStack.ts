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
  | 'brush-accum'
  | 'posterize'
  | 'ordered-dither'
  | 'halftone'
  | 'edge-detect'
  | 'composite'
  | 'custom-glsl-post'
  | 'edge-capture'
  | 'radial-blur'
  | 'light-fx'
  | 'output-grade'
  | 'chroma-key';

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
// Phase 15: 'chroma-key' is the delivery stage — it builds the
// alpha matte from the finished frame, so it runs after
// 'edge-capture' in every profile (edge capture must keep
// reading the un-keyed frame).
// Phase 15 (2D section 6): 'brush-accum' sits immediately after
// 'feedback' in every profile — both are frame-history stages,
// and the accumulated strokes should still pass through the
// tonal finishes and the output grade like the rest of the frame.
const STACK_ORDERS: Record<PostFxStackProfile, PostFxStageId[]> = {
  manual: ['brightness-contrast', 'noise', 'bloom', 'light-fx', 'chromatic-aberration', 'depth-of-field', 'radial-blur', 'vignette', 'kaleidoscope', 'slit-scan', 'displace', 'glitch', 'pixel-sort', 'fractal', 'cellular', 'moire', 'feedback', 'brush-accum', 'posterize', 'ordered-dither', 'halftone', 'edge-detect', 'composite', 'custom-glsl-post', 'output-grade', 'edge-capture', 'chroma-key'],
  'touch-feedback': ['brightness-contrast', 'noise', 'chromatic-aberration', 'bloom', 'light-fx', 'vignette', 'depth-of-field', 'radial-blur', 'kaleidoscope', 'slit-scan', 'displace', 'glitch', 'pixel-sort', 'fractal', 'cellular', 'moire', 'feedback', 'brush-accum', 'posterize', 'ordered-dither', 'halftone', 'edge-detect', 'composite', 'custom-glsl-post', 'output-grade', 'edge-capture', 'chroma-key'],
  'particular-glow': ['brightness-contrast', 'bloom', 'light-fx', 'chromatic-aberration', 'noise', 'vignette', 'depth-of-field', 'radial-blur', 'kaleidoscope', 'slit-scan', 'displace', 'glitch', 'pixel-sort', 'fractal', 'cellular', 'moire', 'feedback', 'brush-accum', 'posterize', 'ordered-dither', 'halftone', 'edge-detect', 'composite', 'custom-glsl-post', 'output-grade', 'edge-capture', 'chroma-key'],
  'retro-feedback': ['brightness-contrast', 'noise', 'chromatic-aberration', 'vignette', 'bloom', 'light-fx', 'depth-of-field', 'radial-blur', 'kaleidoscope', 'slit-scan', 'displace', 'glitch', 'pixel-sort', 'fractal', 'cellular', 'moire', 'feedback', 'brush-accum', 'posterize', 'ordered-dither', 'halftone', 'edge-detect', 'composite', 'custom-glsl-post', 'output-grade', 'edge-capture', 'chroma-key'],
  'dream-smear': ['brightness-contrast', 'depth-of-field', 'bloom', 'light-fx', 'chromatic-aberration', 'noise', 'vignette', 'radial-blur', 'kaleidoscope', 'slit-scan', 'displace', 'glitch', 'pixel-sort', 'fractal', 'cellular', 'moire', 'feedback', 'brush-accum', 'posterize', 'ordered-dither', 'halftone', 'edge-detect', 'composite', 'custom-glsl-post', 'output-grade', 'edge-capture', 'chroma-key'],
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
  // Phase 15: the chroma key stage exists only while enabled —
  // disabled means no stage and a bit-identical output.
  if (config.postChromaKeyEnabled) {
    active.add('chroma-key');
  }
  // Phase 15 (2D section 6): the brush accumulation stage exists
  // only while enabled — disabled means no stage and a
  // bit-identical output.
  if (config.layer1BrushAccumEnabled) {
    active.add('brush-accum');
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
  // other than 1.0, the ACES curve selected, the brand monochrome
  // duotone (Pro-2) enabled, or the reserved palette ramp
  // (Phase 15, ink) enabled. Defaults keep it off.
  if (
    Math.abs(config.postExposure - 1.0) > 0.001 ||
    config.postToneMapping === 'aces' ||
    config.postBrandColorEnabled ||
    config.postReservedPaletteEnabled
  ) {
    active.add('output-grade');
  }
  return Array.from(active);
}

// Phase 35 (TD §7 stage 3): a user-declared stage order.
// The postFxStackOrder key ('' = profile order) holds a
// comma-separated list of stage ids. Correction is total,
// mirroring lib/gpgpuForceOrder.ts: unknown ids and
// duplicates are dropped, and any stage the list omits is
// appended in profile order, so the result is always a
// permutation of the full 27-stage set over the selected
// profile's order. With the key unset, resolution returns
// the profile order itself and behaviour is unchanged.

export function getPostFxProfileOrder(profile?: PostFxStackProfile | null): PostFxStageId[] {
  return [...(STACK_ORDERS[profile ?? 'manual'] ?? STACK_ORDERS.manual)];
}

const POST_FX_STAGE_IDS = new Set<PostFxStageId>(STACK_ORDERS.manual);

/** Normalise any order input into a full permutation over the base order. */
export function normalizePostFxStackOrder(
  order: string | readonly string[] | null | undefined,
  baseOrder: readonly PostFxStageId[],
): PostFxStageId[] {
  const raw = typeof order === 'string'
    ? order.split(',')
    : Array.isArray(order)
      ? order
      : [];
  const seen = new Set<PostFxStageId>();
  const result: PostFxStageId[] = [];
  for (const entry of raw) {
    const name = String(entry).trim() as PostFxStageId;
    if (!name || !POST_FX_STAGE_IDS.has(name) || seen.has(name)) continue;
    seen.add(name);
    result.push(name);
  }
  for (const name of baseOrder) {
    if (!seen.has(name)) result.push(name);
  }
  return result;
}

/** The full stage order in effect for a config (custom order wins). */
export function resolvePostFxStackOrder(config: ParticleConfig): PostFxStageId[] {
  const base = getPostFxProfileOrder(config.postFxStackProfile);
  if (typeof config.postFxStackOrder !== 'string' || config.postFxStackOrder.trim() === '') {
    return base;
  }
  return normalizePostFxStackOrder(config.postFxStackOrder, base);
}

/** True when the input denotes the profile order (including '' / unset). */
export function isProfilePostFxStackOrder(
  order: string | readonly string[] | null | undefined,
  profile?: PostFxStackProfile | null,
): boolean {
  if (order == null) return true;
  if (typeof order === 'string' && order.trim() === '') return true;
  const base = getPostFxProfileOrder(profile);
  const names = normalizePostFxStackOrder(order, base);
  return names.every((name, index) => name === base[index]);
}

/** Serialise a (possibly partial) order back to the canonical key form. */
export function serializePostFxStackOrder(
  order: string | readonly string[] | null | undefined,
  profile?: PostFxStackProfile | null,
): string {
  if (isProfilePostFxStackOrder(order, profile)) return '';
  return normalizePostFxStackOrder(order, getPostFxProfileOrder(profile)).join(',');
}

export function getOrderedActivePostFxStageIds(config: ParticleConfig): PostFxStageId[] {
  const active = new Set(getActivePostFxStageIds(config));
  const preferredOrder = resolvePostFxStackOrder(config);
  return preferredOrder.filter((stage) => active.has(stage));
}
