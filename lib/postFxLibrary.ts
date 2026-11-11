import type { ParticleConfig } from '../types';
import { DEFAULT_CONFIG } from './appStateConfig';
import type { PostFxStackProfile } from './postFxStack';

export type PostFxPatch = Partial<Pick<ParticleConfig,
  | 'postFxStackProfile'
  | 'postBloomEnabled'
  | 'postBloomIntensity'
  | 'postBloomRadius'
  | 'postBloomThreshold'
  | 'postChromaticAberrationEnabled'
  | 'postChromaticAberrationOffset'
  | 'postDofEnabled'
  | 'postDofFocusDistance'
  | 'postDofFocalLength'
  | 'postDofBokehScale'
  | 'postNoiseEnabled'
  | 'postNoiseOpacity'
  | 'postVignetteEnabled'
  | 'postVignetteOffset'
  | 'postVignetteDarkness'
  | 'postBrightnessContrastEnabled'
  | 'postBrightness'
  | 'postContrastAmount'
>>;

export interface PostFxStackBundle {
  id: string;
  label: string;
  summary: string;
  productFamily: 'neutral' | 'touchdesigner' | 'red-giant' | 'hybrid';
  profile: PostFxStackProfile;
  emphasis: string[];
  patch: PostFxPatch;
}

const POST_FX_STACK_RESET_PATCH: PostFxPatch = {
  postFxStackProfile: DEFAULT_CONFIG.postFxStackProfile,
  postBloomEnabled: DEFAULT_CONFIG.postBloomEnabled,
  postBloomIntensity: DEFAULT_CONFIG.postBloomIntensity,
  postBloomRadius: DEFAULT_CONFIG.postBloomRadius,
  postBloomThreshold: DEFAULT_CONFIG.postBloomThreshold,
  postChromaticAberrationEnabled: DEFAULT_CONFIG.postChromaticAberrationEnabled,
  postChromaticAberrationOffset: DEFAULT_CONFIG.postChromaticAberrationOffset,
  postDofEnabled: DEFAULT_CONFIG.postDofEnabled,
  postDofFocusDistance: DEFAULT_CONFIG.postDofFocusDistance,
  postDofFocalLength: DEFAULT_CONFIG.postDofFocalLength,
  postDofBokehScale: DEFAULT_CONFIG.postDofBokehScale,
  postNoiseEnabled: DEFAULT_CONFIG.postNoiseEnabled,
  postNoiseOpacity: DEFAULT_CONFIG.postNoiseOpacity,
  postVignetteEnabled: DEFAULT_CONFIG.postVignetteEnabled,
  postVignetteOffset: DEFAULT_CONFIG.postVignetteOffset,
  postVignetteDarkness: DEFAULT_CONFIG.postVignetteDarkness,
  postBrightnessContrastEnabled: DEFAULT_CONFIG.postBrightnessContrastEnabled,
  postBrightness: DEFAULT_CONFIG.postBrightness,
  postContrastAmount: DEFAULT_CONFIG.postContrastAmount,
};

export const POST_FX_STACK_BUNDLES: PostFxStackBundle[] = [
  {
    id: 'post-stack-manual-neutral',
    label: 'Manual Neutral',
    summary: 'Base neutral stack with the manual stage order kept clean.',
    productFamily: 'neutral',
    profile: 'manual',
    emphasis: ['neutral base', 'manual ordering', 'clean reset'],
    patch: {
      postFxStackProfile: 'manual',
      postBrightnessContrastEnabled: true,
      postContrastAmount: 0.08,
      postBrightness: 0.01,
      postVignetteEnabled: true,
      postVignetteOffset: 0.34,
      postVignetteDarkness: 0.24,
    },
  },
  {
    id: 'post-stack-touch-smear',
    label: 'Touch Smear',
    summary: 'Feedback-like noise, bloom, and split-fringe order for TouchDesigner-style smearing.',
    productFamily: 'touchdesigner',
    profile: 'touch-feedback',
    emphasis: ['feedback', 'smear', 'chromatic edge'],
    patch: {
      postFxStackProfile: 'touch-feedback',
      postNoiseEnabled: true,
      postNoiseOpacity: 0.16,
      postChromaticAberrationEnabled: true,
      postChromaticAberrationOffset: 0.0014,
      postBloomEnabled: true,
      postBloomIntensity: 0.32,
      postBloomRadius: 0.44,
      postBloomThreshold: 0.16,
      postVignetteEnabled: true,
      postVignetteOffset: 0.32,
      postVignetteDarkness: 0.42,
      postBrightnessContrastEnabled: true,
      postContrastAmount: 0.12,
    },
  },
  {
    id: 'post-stack-particular-glow',
    label: 'Particular Glow',
    summary: 'Bloom-first glow stack with light chromatic bleed for Trapcode-like particle emphasis.',
    productFamily: 'red-giant',
    profile: 'particular-glow',
    emphasis: ['glow', 'particle lift', 'luma-first'],
    patch: {
      postFxStackProfile: 'particular-glow',
      postBloomEnabled: true,
      postBloomIntensity: 0.38,
      postBloomRadius: 0.52,
      postBloomThreshold: 0.14,
      postChromaticAberrationEnabled: true,
      postChromaticAberrationOffset: 0.001,
      postNoiseEnabled: true,
      postNoiseOpacity: 0.08,
      postVignetteEnabled: true,
      postVignetteOffset: 0.28,
      postVignetteDarkness: 0.36,
      postBrightnessContrastEnabled: true,
      postContrastAmount: 0.18,
      postBrightness: 0.02,
    },
  },
  {
    id: 'post-stack-retro-feedback',
    label: 'Retro Feedback',
    summary: 'Noise-heavy retro stack with split fringe and darker vignette for Universe-like treatments.',
    productFamily: 'red-giant',
    profile: 'retro-feedback',
    emphasis: ['retro', 'feedback', 'screen damage'],
    patch: {
      postFxStackProfile: 'retro-feedback',
      postNoiseEnabled: true,
      postNoiseOpacity: 0.24,
      postChromaticAberrationEnabled: true,
      postChromaticAberrationOffset: 0.0018,
      postVignetteEnabled: true,
      postVignetteOffset: 0.38,
      postVignetteDarkness: 0.58,
      postBrightnessContrastEnabled: true,
      postContrastAmount: 0.24,
      postBrightness: -0.04,
    },
  },
  {
    id: 'post-stack-dream-smear',
    label: 'Dream Smear',
    summary: 'Soft DOF-first smear with bloom lift and restrained noise for hybrid dream states.',
    productFamily: 'hybrid',
    profile: 'dream-smear',
    emphasis: ['dof haze', 'soft smear', 'dream bloom'],
    patch: {
      postFxStackProfile: 'dream-smear',
      postDofEnabled: true,
      postDofFocusDistance: 0.028,
      postDofFocalLength: 0.06,
      postDofBokehScale: 3.2,
      postBloomEnabled: true,
      postBloomIntensity: 0.28,
      postBloomRadius: 0.5,
      postBloomThreshold: 0.15,
      postChromaticAberrationEnabled: true,
      postChromaticAberrationOffset: 0.0008,
      postNoiseEnabled: true,
      postNoiseOpacity: 0.06,
      postVignetteEnabled: true,
      postVignetteOffset: 0.26,
      postVignetteDarkness: 0.28,
      postBrightnessContrastEnabled: true,
      postBrightness: 0.03,
      postContrastAmount: 0.08,
    },
  },
];

const POST_FX_STACK_BUNDLES_BY_ID = new Map(POST_FX_STACK_BUNDLES.map((bundle) => [bundle.id, bundle]));
const POST_FX_STACK_BUNDLE_ID_BY_PROFILE = new Map<PostFxStackProfile, string>(
  POST_FX_STACK_BUNDLES.map((bundle) => [bundle.profile, bundle.id]),
);

export function getPostFxStackBundleById(id: string | null | undefined) {
  if (!id) return null;
  return POST_FX_STACK_BUNDLES_BY_ID.get(id) ?? null;
}

export function buildPostFxStackPatch(bundleOrId: PostFxStackBundle | string): PostFxPatch {
  const bundle = typeof bundleOrId === 'string' ? getPostFxStackBundleById(bundleOrId) : bundleOrId;
  if (!bundle) return { ...POST_FX_STACK_RESET_PATCH };
  return {
    ...POST_FX_STACK_RESET_PATCH,
    ...bundle.patch,
    postFxStackProfile: bundle.profile,
  };
}

export function applyPostFxStackBundle(config: ParticleConfig, bundleOrId: PostFxStackBundle | string): ParticleConfig {
  return {
    ...config,
    ...buildPostFxStackPatch(bundleOrId),
  };
}

export function inferPostFxStackBundleId(config: ParticleConfig): string | null {
  return POST_FX_STACK_BUNDLE_ID_BY_PROFILE.get(config.postFxStackProfile) ?? null;
}

export function getReferencedPostFxStackBundleIds(configs: ParticleConfig[]): string[] {
  return Array.from(new Set(configs
    .map((config) => inferPostFxStackBundleId(config))
    .filter((value): value is string => typeof value === 'string' && value.length > 0)));
}
