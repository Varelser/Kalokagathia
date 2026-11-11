import type { Layer2Type, Layer3Source } from '../types';
import type { OperatorDynamicsAxis, OperatorRecipe } from './operatorMatrix';
import { OPERATOR_RECIPE_LIBRARY } from './operatorMatrix';
import type { HybridExpressionRecipe } from './hybridExpressions';
import type { HybridTemporalVariant } from './hybridTemporalVariants';

export interface OperatorCollisionPair {
  id: string;
  leftId: string;
  rightId: string;
  leftLabel: string;
  rightLabel: string;
  score: number;
  reasons: string[];
  sharedMode: boolean;
  sharedSource: boolean;
  sharedMaterial: boolean;
  sharedGeometry: boolean;
  sharedDynamics: boolean;
  sharedInscription: boolean;
  sharedTemporal: boolean;
}

export interface OperatorDedicatedAxisCandidate {
  id: string;
  label: string;
  summary: string;
  candidateKind: 'dynamics' | 'source-cluster' | 'mode-cluster';
  score: number;
  recipeIds: string[];
  focusModes: Layer2Type[];
  focusSources: Layer3Source[];
  focusDynamics: OperatorDynamicsAxis[];
  reasons: string[];
}

const SOURCE_GROUPS: Layer3Source[] = ['text', 'grid', 'ring', 'plane', 'image', 'video', 'sphere', 'cylinder', 'cube'];

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function tagOverlap(left: string[], right: string[]): number {
  const leftSet = new Set(left);
  return right.filter((tag) => leftSet.has(tag)).length;
}

function toTitle(value: string): string {
  return value
    .split(/[_-]+/g)
    .filter(Boolean)
    .map((token) => token.slice(0, 1).toUpperCase() + token.slice(1))
    .join(' ');
}

function scorePair(left: OperatorRecipe, right: OperatorRecipe): OperatorCollisionPair {
  let score = 0;
  const reasons: string[] = [];
  const sharedMode = left.mode === right.mode;
  const sharedSource = left.source === right.source;
  const sharedMaterial = left.material === right.material;
  const sharedGeometry = left.geometry === right.geometry;
  const sharedDynamics = left.dynamics === right.dynamics;
  const sharedInscription = left.inscription === right.inscription;
  const sharedTemporal = left.temporal === right.temporal;

  if (sharedMode) {
    score += 5.5;
    reasons.push(`same mode ${left.mode}`);
  }
  if (sharedSource) {
    score += 2.4;
    reasons.push(`same source ${left.source}`);
  }
  if (sharedGeometry) {
    score += 2.2;
    reasons.push(`same geometry ${left.geometry}`);
  }
  if (sharedDynamics) {
    score += 2.1;
    reasons.push(`same dynamics ${left.dynamics}`);
  }
  if (sharedMaterial) {
    score += 1.5;
    reasons.push(`same material ${left.material}`);
  }
  if (sharedInscription) {
    score += 1.4;
    reasons.push(`same inscription ${left.inscription}`);
  }
  if (sharedTemporal) {
    score += 1.0;
    reasons.push(`same temporal ${left.temporal}`);
  }

  const overlap = tagOverlap(left.reviewTags, right.reviewTags);
  if (overlap > 0) {
    score += Math.min(2.0, overlap * 0.4);
    reasons.push(`shared review tags ${overlap}`);
  }

  if (left.id.split('--')[0] === right.id.split('--')[0] && left.source !== right.source) {
    score += 1.6;
    reasons.push('same base recipe family');
  }

  if (Math.abs(left.count - right.count) < 900) {
    score += 0.6;
    reasons.push('similar count');
  }
  if (Math.abs(left.baseSize - right.baseSize) < 0.08) {
    score += 0.5;
    reasons.push('similar base size');
  }
  if (Math.abs((left.radiusScale ?? 1) - (right.radiusScale ?? 1)) < 0.08) {
    score += 0.4;
    reasons.push('similar radius scale');
  }

  return {
    id: `${left.id}__${right.id}`,
    leftId: left.id,
    rightId: right.id,
    leftLabel: left.label,
    rightLabel: right.label,
    score: Math.round(score * 100) / 100,
    reasons,
    sharedMode,
    sharedSource,
    sharedMaterial,
    sharedGeometry,
    sharedDynamics,
    sharedInscription,
    sharedTemporal,
  };
}

export const OPERATOR_COLLISION_PAIRS: OperatorCollisionPair[] = (() => {
  const pairs: OperatorCollisionPair[] = [];
  for (let i = 0; i < OPERATOR_RECIPE_LIBRARY.length; i += 1) {
    for (let j = i + 1; j < OPERATOR_RECIPE_LIBRARY.length; j += 1) {
      const pair = scorePair(OPERATOR_RECIPE_LIBRARY[i], OPERATOR_RECIPE_LIBRARY[j]);
      if (pair.score >= 6.2) pairs.push(pair);
    }
  }
  return pairs.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
})();

function buildDynamicsCandidate(dynamics: OperatorDynamicsAxis): OperatorDedicatedAxisCandidate | null {
  const recipes = OPERATOR_RECIPE_LIBRARY.filter((recipe) => recipe.dynamics === dynamics);
  if (recipes.length < 2) return null;
  const pairs = OPERATOR_COLLISION_PAIRS.filter((pair) => recipes.some((recipe) => recipe.id === pair.leftId || recipe.id === pair.rightId));
  const sameSourcePairs = pairs.filter((pair) => pair.sharedSource).length;
  const sameModePairs = pairs.filter((pair) => pair.sharedMode).length;
  const score = Math.round(((pairs.reduce((sum, pair) => sum + pair.score, 0) / Math.max(1, recipes.length)) + sameSourcePairs * 0.8 + sameModePairs * 1.2) * 100) / 100;
  if (score < 10) return null;
  return {
    id: `dedicated-dynamics-${dynamics}`,
    label: `${toTitle(dynamics)} dedicated axis candidate`,
    summary: `${toTitle(dynamics)} appears in ${recipes.length} operator recipes and still collides across source variants. Promote it toward a dedicated operator axis.`,
    candidateKind: 'dynamics',
    score,
    recipeIds: recipes.map((recipe) => recipe.id),
    focusModes: unique(recipes.map((recipe) => recipe.mode)),
    focusSources: unique(recipes.map((recipe) => recipe.source)),
    focusDynamics: [dynamics],
    reasons: [
      `${recipes.length} recipes share dynamics ${dynamics}`,
      `${sameSourcePairs} high-score collisions keep the same source`,
      `${sameModePairs} high-score collisions keep the same mode`,
    ],
  };
}

function buildSourceClusterCandidate(source: Layer3Source): OperatorDedicatedAxisCandidate | null {
  const recipes = OPERATOR_RECIPE_LIBRARY.filter((recipe) => recipe.source === source);
  const pairs = OPERATOR_COLLISION_PAIRS.filter((pair) => pair.sharedSource && recipes.some((recipe) => recipe.id === pair.leftId || recipe.id === pair.rightId));
  if (recipes.length < 5 || pairs.length < 4) return null;
  const score = Math.round((pairs.reduce((sum, pair) => sum + pair.score, 0) / Math.max(1, pairs.length) + recipes.length * 0.5) * 100) / 100;
  return {
    id: `dedicated-source-${source}`,
    label: `${toTitle(source)} source cluster candidate`,
    summary: `${toTitle(source)} recipes are numerous and still collide after source-aware weighting. This source cluster is a good dedicated-axis candidate.`,
    candidateKind: 'source-cluster',
    score,
    recipeIds: recipes.map((recipe) => recipe.id),
    focusModes: unique(recipes.map((recipe) => recipe.mode)),
    focusSources: [source],
    focusDynamics: unique(recipes.map((recipe) => recipe.dynamics)),
    reasons: [
      `${recipes.length} recipes anchored to ${source}`,
      `${pairs.length} high-score same-source collisions remain`,
    ],
  };
}

function buildModeClusterCandidate(mode: Layer2Type): OperatorDedicatedAxisCandidate | null {
  const recipes = OPERATOR_RECIPE_LIBRARY.filter((recipe) => recipe.mode === mode);
  if (recipes.length < 3) return null;
  const pairs = OPERATOR_COLLISION_PAIRS.filter((pair) => recipes.some((recipe) => recipe.id === pair.leftId || recipe.id === pair.rightId));
  const score = Math.round((pairs.reduce((sum, pair) => sum + pair.score, 0) / Math.max(1, recipes.length) + recipes.length * 0.9) * 100) / 100;
  if (score < 10.5) return null;
  return {
    id: `dedicated-mode-${mode}`,
    label: `${toTitle(mode)} mode cluster candidate`,
    summary: `${mode} is reused across several operator variants and now needs a stronger dedicated-axis signature to stay distinct.`,
    candidateKind: 'mode-cluster',
    score,
    recipeIds: recipes.map((recipe) => recipe.id),
    focusModes: [mode],
    focusSources: unique(recipes.map((recipe) => recipe.source)),
    focusDynamics: unique(recipes.map((recipe) => recipe.dynamics)),
    reasons: [
      `${recipes.length} recipes reuse ${mode}`,
      `${pairs.length} high-score pairings remain around the same mode`,
    ],
  };
}

const dynamicsCandidates = unique(OPERATOR_RECIPE_LIBRARY.map((recipe) => recipe.dynamics))
  .map((dynamics) => buildDynamicsCandidate(dynamics))
  .filter((candidate): candidate is OperatorDedicatedAxisCandidate => Boolean(candidate));

const sourceCandidates = SOURCE_GROUPS
  .map((source) => buildSourceClusterCandidate(source))
  .filter((candidate): candidate is OperatorDedicatedAxisCandidate => Boolean(candidate));

const modeCandidates = unique(OPERATOR_RECIPE_LIBRARY.map((recipe) => recipe.mode))
  .map((mode) => buildModeClusterCandidate(mode))
  .filter((candidate): candidate is OperatorDedicatedAxisCandidate => Boolean(candidate));

export const OPERATOR_DEDICATED_AXIS_CANDIDATES: OperatorDedicatedAxisCandidate[] = [
  ...dynamicsCandidates,
  ...sourceCandidates,
  ...modeCandidates,
]
  .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
  .slice(0, 14);

function pickRecipes(candidate: OperatorDedicatedAxisCandidate): OperatorRecipe[] {
  return candidate.recipeIds
    .map((id) => OPERATOR_RECIPE_LIBRARY.find((recipe) => recipe.id === id))
    .filter((recipe): recipe is OperatorRecipe => Boolean(recipe));
}

export const OPERATOR_COLLISION_REVIEW_HYBRIDS: HybridExpressionRecipe[] = OPERATOR_DEDICATED_AXIS_CANDIDATES.slice(0, 8).map((candidate) => {
  const recipes = pickRecipes(candidate);
  const layer2Modes = unique(recipes.slice(0, 4).map((recipe) => recipe.mode));
  const layer3Modes = unique(recipes.slice(4, 8).map((recipe) => recipe.mode));
  return {
    id: `${candidate.id}-review`,
    name: `${candidate.label} review`,
    summary: `${candidate.summary} Review the cluster before promoting it to a dedicated operator axis.`,
    layer2Modes: layer2Modes.length > 0 ? layer2Modes : candidate.focusModes.slice(0, 4),
    layer3Modes: layer3Modes.length > 0 ? layer3Modes : candidate.focusModes.slice(0, 4),
    emphasis: [candidate.candidateKind, ...candidate.reasons].slice(0, 4),
  };
});

const temporalByKind: Record<OperatorDedicatedAxisCandidate['candidateKind'], [string, string]> = {
  dynamics: ['hysteresis', 'fatigue'],
  'source-cluster': ['rewrite', 'recur'],
  'mode-cluster': ['oscillate', 'recover'],
};

export const OPERATOR_COLLISION_REVIEW_TEMPORALS: HybridTemporalVariant[] = OPERATOR_DEDICATED_AXIS_CANDIDATES.slice(0, 8).map((candidate) => ({
  id: `${candidate.id}-temporal`,
  label: `${candidate.label} temporal review`,
  summary: `Temporal review for ${candidate.label}.`,
  requiredHybridId: `${candidate.id}-review`,
  layer2Temporal: temporalByKind[candidate.candidateKind][0],
  layer3Temporal: temporalByKind[candidate.candidateKind][1],
}));
