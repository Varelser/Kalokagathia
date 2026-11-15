import type { ParticleConfig } from '../types';

export type PostFxStageId =
  | 'brightness-contrast'
  | 'noise'
  | 'bloom'
  | 'chromatic-aberration'
  | 'depth-of-field'
  | 'vignette'
  | 'kaleidoscope'
  | 'slit-scan'
  | 'feedback'
  | 'radial-blur'
  | 'output-grade';

export type PostFxStackProfile = ParticleConfig['postFxStackProfile'];

// 'radial-blur' (B2) sits with the other spatial lens stages, after
// depth-of-field; 'output-grade' (B2) is always the final stage so
// exposure / ACES grade the finished frame.
const STACK_ORDERS: Record<PostFxStackProfile, PostFxStageId[]> = {
  manual: ['brightness-contrast', 'noise', 'bloom', 'chromatic-aberration', 'depth-of-field', 'radial-blur', 'vignette', 'kaleidoscope', 'slit-scan', 'feedback', 'output-grade'],
  'touch-feedback': ['brightness-contrast', 'noise', 'chromatic-aberration', 'bloom', 'vignette', 'depth-of-field', 'radial-blur', 'kaleidoscope', 'slit-scan', 'feedback', 'output-grade'],
  'particular-glow': ['brightness-contrast', 'bloom', 'chromatic-aberration', 'noise', 'vignette', 'depth-of-field', 'radial-blur', 'kaleidoscope', 'slit-scan', 'feedback', 'output-grade'],
  'retro-feedback': ['brightness-contrast', 'noise', 'chromatic-aberration', 'vignette', 'bloom', 'depth-of-field', 'radial-blur', 'kaleidoscope', 'slit-scan', 'feedback', 'output-grade'],
  'dream-smear': ['brightness-contrast', 'depth-of-field', 'bloom', 'chromatic-aberration', 'noise', 'vignette', 'radial-blur', 'kaleidoscope', 'slit-scan', 'feedback', 'output-grade'],
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
  if (config.postFeedbackEnabled) {
    active.add('feedback');
  }
  if (config.postRadialBlurEnabled && config.postRadialBlurStrength > 0.001) {
    active.add('radial-blur');
  }
  // Output grade only exists when it would change a pixel: exposure
  // other than 1.0 or the ACES curve selected. Defaults keep it off.
  if (Math.abs(config.postExposure - 1.0) > 0.001 || config.postToneMapping === 'aces') {
    active.add('output-grade');
  }
  return Array.from(active);
}

export function getOrderedActivePostFxStageIds(config: ParticleConfig): PostFxStageId[] {
  const active = new Set(getActivePostFxStageIds(config));
  const preferredOrder = STACK_ORDERS[config.postFxStackProfile] ?? STACK_ORDERS.manual;
  return preferredOrder.filter((stage) => active.has(stage));
}
