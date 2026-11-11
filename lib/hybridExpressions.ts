import type { ParticleConfig } from '../types';
import { OPERATOR_HYBRID_RECIPES } from './operatorGeneratedHybrids';
import { OPERATOR_COLLISION_REVIEW_HYBRIDS } from './operatorCollisionAnalysis';
import type { HybridExpressionRecipe } from './hybridExpressionTypes';
import { HYBRID_EXPRESSION_BASE_RECIPES } from './hybridExpressionBase';
import { HYBRID_EXPRESSION_REVIEW_RECIPES } from './hybridExpressionReview';
import { HYBRID_EXPRESSION_PHYSICAL_RECIPES } from './hybridExpressionPhysical';

export type { HybridExpressionRecipe } from './hybridExpressionTypes';

export const HYBRID_EXPRESSION_RECIPES: HybridExpressionRecipe[] = [
  ...HYBRID_EXPRESSION_BASE_RECIPES,
  ...HYBRID_EXPRESSION_REVIEW_RECIPES,
  ...HYBRID_EXPRESSION_PHYSICAL_RECIPES,
  ...OPERATOR_HYBRID_RECIPES,
  ...OPERATOR_COLLISION_REVIEW_HYBRIDS,
].filter((recipe): recipe is HybridExpressionRecipe => Boolean(recipe));

export function getActiveHybridRecipes(config: ParticleConfig): HybridExpressionRecipe[] {
  if (!config.layer2Enabled || !config.layer3Enabled) return [];
  return HYBRID_EXPRESSION_RECIPES.filter((recipe) => (
    recipe.layer2Modes.includes(config.layer2Type) && recipe.layer3Modes.includes(config.layer3Type)
  ));
}

export function getHybridFeatureIds(config: ParticleConfig): string[] {
  return getActiveHybridRecipes(config).map((recipe) => `hybrid-${recipe.id}`);
}
