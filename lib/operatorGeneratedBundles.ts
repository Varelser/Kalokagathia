import type { ExpressionAtlasBundle } from './expressionAtlasBundles';
import { buildOperatorLayerPatch, OPERATOR_PROMOTED_DEDICATED_AXES, OPERATOR_PROMOTED_DEDICATED_AXIS_SUMMARY, OPERATOR_PROMOTED_DEDICATED_SUBAXES, OPERATOR_PROMOTED_DEDICATED_SUBAXIS_SUMMARY, OPERATOR_RECIPE_LIBRARY, type OperatorRecipe } from './operatorMatrix';
import { OPERATOR_DEDICATED_AXIS_CANDIDATES } from './operatorCollisionAnalysis';

function resolveOperatorPostStackId(recipe: OperatorRecipe): string {
  if (recipe.dedicatedAxis === 'erosion-wear' || ['erode', 'dissolve', 'abrade', 'corrode', 'pit'].includes(recipe.dynamics) || ['ash', 'dust', 'metal'].includes(recipe.material)) {
    return 'post-stack-retro-feedback';
  }
  if (recipe.dedicatedAxis === 'phase-transition' || ['freeze', 'melt', 'sublimate'].includes(recipe.dynamics) || ['shell', 'sheet'].includes(recipe.geometry) || recipe.material === 'resin') {
    return 'post-stack-dream-smear';
  }
  if (recipe.dedicatedAxis === 'ring-orbit' || ['ring', 'video'].includes(recipe.source) || ['fog', 'halo'].includes(recipe.geometry) || ['vortex', 'pressure', 'advection'].includes(recipe.dynamics)) {
    return 'post-stack-touch-smear';
  }
  if (recipe.dedicatedAxis === 'grid-architectonic' || ['grid', 'cube', 'cylinder'].includes(recipe.source) || ['lattice', 'mesh', 'aggregate', 'front'].includes(recipe.geometry) || ['growth', 'grammar', 'static', 'jam', 'creep'].includes(recipe.dynamics)) {
    return 'post-stack-particular-glow';
  }
  return 'post-stack-manual-neutral';
}

const recipeBundles: ExpressionAtlasBundle[] = OPERATOR_RECIPE_LIBRARY.map((recipe) => ({
  id: `operator-${recipe.id}`,
  label: recipe.label,
  summary: `${recipe.summary} / axes: ${recipe.material} × ${recipe.geometry} × ${recipe.dynamics} × ${recipe.inscription}`,
  postStackId: resolveOperatorPostStackId(recipe),
  patch: (layerIndex) => buildOperatorLayerPatch(layerIndex, recipe),
}));


const dedicatedBundles: ExpressionAtlasBundle[] = OPERATOR_PROMOTED_DEDICATED_AXES.map((axis, index) => {
  const recipe = OPERATOR_RECIPE_LIBRARY.find((entry) => entry.dedicatedAxis === axis) ?? OPERATOR_RECIPE_LIBRARY[index];
  return {
    id: `operator-dedicated-${axis}`,
    label: `Dedicated ${axis}`,
    summary: OPERATOR_PROMOTED_DEDICATED_AXIS_SUMMARY[axis],
    postStackId: resolveOperatorPostStackId(recipe),
    patch: (layerIndex) => buildOperatorLayerPatch(layerIndex, recipe),
  } satisfies ExpressionAtlasBundle;
});


const dedicatedSubAxisBundles: ExpressionAtlasBundle[] = OPERATOR_PROMOTED_DEDICATED_SUBAXES.map((axis, index) => {
  const recipe = OPERATOR_RECIPE_LIBRARY.find((entry) => entry.dedicatedSubAxis === axis) ?? OPERATOR_RECIPE_LIBRARY[index];
  return {
    id: `operator-dedicated-sub-${axis}`,
    label: `Dedicated ${axis}`,
    summary: OPERATOR_PROMOTED_DEDICATED_SUBAXIS_SUMMARY[axis],
    postStackId: resolveOperatorPostStackId(recipe),
    patch: (layerIndex) => buildOperatorLayerPatch(layerIndex, recipe),
  } satisfies ExpressionAtlasBundle;
});

const reviewBundles: ExpressionAtlasBundle[] = OPERATOR_DEDICATED_AXIS_CANDIDATES.slice(0, 8).map((candidate, index) => {
  const recipe = candidate.recipeIds
    .map((id) => OPERATOR_RECIPE_LIBRARY.find((entry) => entry.id === id))
    .find(Boolean) ?? OPERATOR_RECIPE_LIBRARY[index];
  return {
    id: `operator-${candidate.id}-review`,
    label: `${candidate.label} review`,
    summary: `${candidate.summary} / score ${candidate.score}`,
    postStackId: resolveOperatorPostStackId(recipe),
    patch: (layerIndex) => buildOperatorLayerPatch(layerIndex, recipe),
  } satisfies ExpressionAtlasBundle;
});

export const OPERATOR_ATLAS_BUNDLES: ExpressionAtlasBundle[] = [
  ...recipeBundles,
  ...dedicatedBundles,
  ...dedicatedSubAxisBundles,
  ...reviewBundles,
];
