import type { ParticleConfig } from '../types';
import { getActiveHybridRecipes } from './hybridExpressions';
import { OPERATOR_COLLISION_REVIEW_TEMPORALS } from './operatorCollisionAnalysis';
import { OPERATOR_HYBRID_TEMPORAL_VARIANTS } from './operatorGeneratedHybrids';
import { HYBRID_TEMPORAL_VARIANTS_BASE } from './hybridTemporalVariantBase';
import { HYBRID_TEMPORAL_VARIANTS_CYCLES } from './hybridTemporalVariantCycles';
import { HYBRID_TEMPORAL_VARIANTS_REVIEW } from './hybridTemporalVariantReview';
import type { HybridTemporalVariant } from './hybridTemporalVariantTypes';

export type { HybridTemporalVariant } from './hybridTemporalVariantTypes';

export const HYBRID_TEMPORAL_VARIANTS: HybridTemporalVariant[] = [
  ...HYBRID_TEMPORAL_VARIANTS_BASE,
  ...HYBRID_TEMPORAL_VARIANTS_CYCLES,
  ...HYBRID_TEMPORAL_VARIANTS_REVIEW,
  ...OPERATOR_HYBRID_TEMPORAL_VARIANTS,
  ...OPERATOR_COLLISION_REVIEW_TEMPORALS,
];

export function getActiveHybridTemporalVariants(config: ParticleConfig): HybridTemporalVariant[] {
  const activeHybrids = new Set(getActiveHybridRecipes(config).map((recipe) => recipe.id));
  return HYBRID_TEMPORAL_VARIANTS.filter(
    (variant) => activeHybrids.has(variant.requiredHybridId)
      && config.layer2TemporalProfile === variant.layer2Temporal
      && config.layer3TemporalProfile === variant.layer3Temporal,
  );
}

export function getHybridTemporalFeatureIds(config: ParticleConfig): string[] {
  return getActiveHybridTemporalVariants(config).map((variant) => `hybrid-temporal-${variant.id}`);
}
