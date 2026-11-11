import type { ExpressionAtlasBundle } from './expressionAtlasTypes';
import { EXPRESSION_ATLAS_BUNDLES_BASE_CORE } from './expressionAtlasBundlesBaseCore';
import { EXPRESSION_ATLAS_BUNDLES_BASE_EXTENDED } from './expressionAtlasBundlesBaseExtended';
import { EXPRESSION_ATLAS_BUNDLES_BASE_ANCHORS } from './expressionAtlasBundlesBaseAnchors';

export const EXPRESSION_ATLAS_BUNDLES_BASE: ExpressionAtlasBundle[] = [
  ...EXPRESSION_ATLAS_BUNDLES_BASE_CORE,
  ...EXPRESSION_ATLAS_BUNDLES_BASE_EXTENDED,
  ...EXPRESSION_ATLAS_BUNDLES_BASE_ANCHORS,
];
