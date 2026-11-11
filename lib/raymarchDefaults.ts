// RAYMARCH_DEFAULTS — the SINGLE place where raymarching quality
// defaults live. The GPU-tier system (lib/gpuTier.ts) drives quality by
// resolving these values per tier via getRaymarchDefaults(); every
// config default (lib/appStateDefaultLayer2.ts / lib/appStateDefaultLayer3.ts)
// and the shader fallbacks in components/sceneRaymarchSystem.tsx derive
// from here. Do NOT scatter render-scale or step-cap literals elsewhere.
//
// RAYMARCH_DEFAULTS itself stays the authored 'standard'-tier values —
// the exact numbers the iMac (Radeon Pro 5500 XT) gate passed with — so
// anything that reads it directly keeps the shipped behaviour.
//
// Performance gate history (iMac, Radeon Pro 5500 XT, 2026-11-11):
// authored at renderScale 0.5 / maxSteps 64 (33–37fps on the samples) —
// see RAYMARCH_IMPL_REPORT_20261111.md for the full gate ladder and
// GPU_TIER_IMPL_REPORT_20261111.md for the tier table. Tier values only
// affect the defaults of NEWLY created configs/layers; existing saved
// configs and presets keep the values they were saved with.
import { resolveEffectiveTierSync, type GpuTier } from './gpuTier';

export interface RaymarchDefaults {
  renderScale: number;
  maxSteps: number;
}

export const RAYMARCH_DEFAULTS: RaymarchDefaults = {
  renderScale: 0.5,
  maxSteps: 64,
} as const;

export const RAYMARCH_TIER_DEFAULTS: Record<GpuTier, RaymarchDefaults> = {
  entry: { renderScale: 0.35, maxSteps: 48 },
  standard: { renderScale: RAYMARCH_DEFAULTS.renderScale, maxSteps: RAYMARCH_DEFAULTS.maxSteps },
  high: { renderScale: 0.75, maxSteps: 96 },
  flagship: { renderScale: 1.0, maxSteps: 128 },
};

/**
 * Raymarch quality defaults for a tier (defaults to the visitor's
 * effective tier, resolved synchronously from the tier cache; before
 * detection has ever run this is 'standard' = the authored values).
 */
export function getRaymarchDefaults(tier?: GpuTier): RaymarchDefaults {
  return RAYMARCH_TIER_DEFAULTS[tier ?? resolveEffectiveTierSync()];
}
