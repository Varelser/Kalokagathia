import type { ParticleConfig } from "../types";
import { buildPostFxStackPatch } from './postFxLibrary';
import { OPERATOR_ATLAS_BUNDLES } from './operatorGeneratedBundles';
import { EXPRESSION_ATLAS_BUNDLES_ANCHORS_ELASTIC } from './expressionAtlasBundlesAnchorsElastic';
import { EXPRESSION_ATLAS_BUNDLES_ANCHORS_FLOW } from './expressionAtlasBundlesAnchorsFlow';
import { EXPRESSION_ATLAS_BUNDLES_ANCHORS_GRANULAR } from './expressionAtlasBundlesAnchorsGranular';
import { EXPRESSION_ATLAS_BUNDLES_ANCHORS_MATERIAL } from './expressionAtlasBundlesAnchorsMaterial';
import { EXPRESSION_ATLAS_BUNDLES_ANCHORS_PHASE } from './expressionAtlasBundlesAnchorsPhase';
import { EXPRESSION_ATLAS_BUNDLES_BASE } from './expressionAtlasBundlesBase';
import { EXPRESSION_ATLAS_BUNDLES_REVIEW } from './expressionAtlasBundlesReview';
import type { ExpressionAtlasBundle } from './expressionAtlasTypes';

export type { ExpressionAtlasBundle } from './expressionAtlasTypes';

export const EXPRESSION_ATLAS_BUNDLES: ExpressionAtlasBundle[] = [
  ...EXPRESSION_ATLAS_BUNDLES_BASE,
  ...EXPRESSION_ATLAS_BUNDLES_REVIEW,
  ...EXPRESSION_ATLAS_BUNDLES_ANCHORS_MATERIAL,
  ...EXPRESSION_ATLAS_BUNDLES_ANCHORS_ELASTIC,
  ...EXPRESSION_ATLAS_BUNDLES_ANCHORS_GRANULAR,
  ...EXPRESSION_ATLAS_BUNDLES_ANCHORS_FLOW,
  ...EXPRESSION_ATLAS_BUNDLES_ANCHORS_PHASE,
  ...OPERATOR_ATLAS_BUNDLES,
];

const EXPRESSION_ATLAS_BUNDLE_BY_ID = new Map(EXPRESSION_ATLAS_BUNDLES.map((bundle) => [bundle.id, bundle]));

export function getExpressionAtlasBundleById(id: string | null | undefined) {
  if (!id) return null;
  return EXPRESSION_ATLAS_BUNDLE_BY_ID.get(id) ?? null;
}

export function buildExpressionAtlasPatch(bundleOrId: ExpressionAtlasBundle | string, layerIndex: 2 | 3): Partial<ParticleConfig> {
  const bundle = typeof bundleOrId === 'string' ? getExpressionAtlasBundleById(bundleOrId) : bundleOrId;
  if (!bundle) return {};
  return {
    ...bundle.patch(layerIndex),
    ...(bundle.postStackId ? buildPostFxStackPatch(bundle.postStackId) : {}),
  };
}

export function getReferencedExpressionAtlasPostFxStackBundleIds(bundles: ExpressionAtlasBundle[]): string[] {
  return Array.from(new Set(bundles
    .map((bundle) => bundle.postStackId)
    .filter((value): value is string => typeof value === 'string' && value.length > 0)));
}
