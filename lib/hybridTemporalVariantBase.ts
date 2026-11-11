import type { HybridTemporalVariant } from './hybridTemporalVariantTypes';
import { HYBRID_TEMPORAL_VARIANTS_BASE_CORE } from './hybridTemporalVariantBaseCore';
import { HYBRID_TEMPORAL_VARIANTS_BASE_EXPANSION } from './hybridTemporalVariantBaseExpansion';
import { HYBRID_TEMPORAL_VARIANTS_BASE_SPECIALIST } from './hybridTemporalVariantBaseSpecialist';
import { HYBRID_TEMPORAL_VARIANTS_BASE_SOURCE_ANCHORS } from './hybridTemporalVariantBaseSourceAnchors';

export const HYBRID_TEMPORAL_VARIANTS_BASE: HybridTemporalVariant[] = [
  ...HYBRID_TEMPORAL_VARIANTS_BASE_CORE,
  ...HYBRID_TEMPORAL_VARIANTS_BASE_EXPANSION,
  ...HYBRID_TEMPORAL_VARIANTS_BASE_SPECIALIST,
  ...HYBRID_TEMPORAL_VARIANTS_BASE_SOURCE_ANCHORS,
];
