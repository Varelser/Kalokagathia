import type { ParticleConfig, PresetRecord, PresetSequenceItem } from '../types';
import { DEFAULT_CONFIG, normalizeConfig } from './appStateConfig';
import { buildOperatorLayerPatch, OPERATOR_PROMOTED_DEDICATED_AXES, OPERATOR_PROMOTED_DEDICATED_SUBAXES, OPERATOR_RECIPE_LIBRARY } from './operatorMatrix';
import { OPERATOR_DEDICATED_AXIS_CANDIDATES } from './operatorCollisionAnalysis';
import { EXPRESSION_ATLAS_BUNDLES } from './expressionAtlasBundles';

const OPERATOR_TIMESTAMP = '2026-03-29T00:00:00.000Z';


function optimizeStarterConfig(config: Partial<ParticleConfig>): Partial<ParticleConfig> {
  const next = { ...config };
  next.layer1Count = Math.min(next.layer1Count ?? DEFAULT_CONFIG.layer1Count, 9000);
  next.layer2Count = Math.min(next.layer2Count ?? DEFAULT_CONFIG.layer2Count, 14000);
  next.layer3Count = Math.min(next.layer3Count ?? DEFAULT_CONFIG.layer3Count, 4500);
  next.ambientCount = Math.min(next.ambientCount ?? DEFAULT_CONFIG.ambientCount, 1500);
  next.layer2AuxCount = Math.min(next.layer2AuxCount ?? DEFAULT_CONFIG.layer2AuxCount, 2800);
  next.layer3AuxCount = Math.min(next.layer3AuxCount ?? DEFAULT_CONFIG.layer3AuxCount, 1600);
  next.layer2SparkCount = Math.min(next.layer2SparkCount ?? DEFAULT_CONFIG.layer2SparkCount, 2600);
  next.layer3SparkCount = Math.min(next.layer3SparkCount ?? DEFAULT_CONFIG.layer3SparkCount, 1400);
  next.layer2Fidelity = Math.min(next.layer2Fidelity ?? DEFAULT_CONFIG.layer2Fidelity, 2);
  next.layer3Fidelity = Math.min(next.layer3Fidelity ?? DEFAULT_CONFIG.layer3Fidelity, 2);
  return next;
}

function createPreset(id: string, name: string, config: Partial<ParticleConfig>): PresetRecord {
  return {
    id,
    name,
    config: normalizeConfig({ ...DEFAULT_CONFIG, ...optimizeStarterConfig(config) }),
    createdAt: OPERATOR_TIMESTAMP,
    updatedAt: OPERATOR_TIMESTAMP,
  };
}

function createSequence(id: string, presetId: string, label: string): PresetSequenceItem {
  return {
    id,
    presetId,
    label,
    holdSeconds: 3.02,
    transitionSeconds: 1.12,
    transitionEasing: 'ease-in-out',
    screenSequenceDriveMode: 'inherit',
    screenSequenceDriveStrengthMode: 'inherit',
    screenSequenceDriveStrengthOverride: null,
    screenSequenceDriveMultiplier: 1.02,
    keyframeConfig: null,
  };
}

function mergeConfigs(...configs: Partial<ParticleConfig>[]): Partial<ParticleConfig> {
  return Object.assign({}, ...configs) as Partial<ParticleConfig>;
}

export const OPERATOR_STARTER_PRESETS: PresetRecord[] = OPERATOR_RECIPE_LIBRARY.map((recipe, index) => createPreset(
  `starter-${recipe.id}`,
  recipe.label,
  mergeConfigs(
    {
      cameraControlMode: index % 2 === 0 ? 'hybrid' : 'auto',
      renderQuality: index % 3 === 0 ? 'cinematic' : 'balanced',
      layer1Count: 1800,
      ambientEnabled: false,
    },
    buildOperatorLayerPatch(2, recipe),
  ),
));

export const OPERATOR_STARTER_SEQUENCES: PresetSequenceItem[] = OPERATOR_RECIPE_LIBRARY.map((recipe) => createSequence(
  `starter-sequence-${recipe.id}`,
  `starter-${recipe.id}`,
  recipe.label,
));

const dualCombos = [
  ['operator-fluid-advection-plane', 'operator-vapor-pressure-grid'],
  ['operator-membrane-viscoelastic-glyph', 'operator-shell-freeze-contour'],
  ['operator-granular-avalanche', 'operator-granular-jam-cube'],
  ['operator-deposition-ink-plane', 'operator-glyph-weave-text'],
  ['operator-shell-resin-palimpsest', 'operator-halo-eclipse-ring'],
] as const;

function getRecipe(id: string) {
  const recipe = OPERATOR_RECIPE_LIBRARY.find((entry) => entry.id === id);
  if (!recipe) throw new Error(`Unknown operator recipe: ${id}`);
  return recipe;
}

export const OPERATOR_COMBO_PRESETS: PresetRecord[] = dualCombos.map(([layer2Id, layer3Id]) => {
  const layer2 = getRecipe(layer2Id);
  const layer3 = getRecipe(layer3Id);
  return createPreset(
    `starter-combo-${layer2.id}-${layer3.id}`,
    `${layer2.label} + ${layer3.label}`,
    mergeConfigs(
      { cameraControlMode: 'hybrid', renderQuality: 'balanced', layer1Count: 2200, ambientEnabled: false },
      buildOperatorLayerPatch(2, layer2),
      buildOperatorLayerPatch(3, layer3),
      { layer3Enabled: true, layer3Count: Math.min(3600, layer3.count), layer3BaseSize: Math.max(0.62, layer3.baseSize * 0.92) },
    ),
  );
});

export const OPERATOR_COMBO_SEQUENCES: PresetSequenceItem[] = OPERATOR_COMBO_PRESETS.map((preset) => createSequence(
  `starter-sequence-${preset.id}`,
  preset.id,
  preset.name,
));



export const OPERATOR_DEDICATED_AXIS_PRESETS: PresetRecord[] = OPERATOR_PROMOTED_DEDICATED_AXES.map((axis, index) => {
  const layer2 = OPERATOR_RECIPE_LIBRARY.find((entry) => entry.dedicatedAxis === axis) ?? OPERATOR_RECIPE_LIBRARY[index];
  const layer3 = OPERATOR_RECIPE_LIBRARY.find((entry, candidateIndex) => candidateIndex !== index && entry.dedicatedAxis === axis) ?? layer2;
  return createPreset(
    `starter-dedicated-${axis}`,
    `Dedicated ${axis}`,
    mergeConfigs(
      { cameraControlMode: 'hybrid', renderQuality: 'balanced', layer1Count: 2200, ambientEnabled: false },
      buildOperatorLayerPatch(2, layer2),
      buildOperatorLayerPatch(3, layer3),
      {
        layer3Enabled: true,
        layer3Count: Math.min(3800, layer3.count),
        layer3BaseSize: Math.max(0.62, layer3.baseSize * 0.92),
      },
    ),
  );
});

export const OPERATOR_DEDICATED_AXIS_SEQUENCES: PresetSequenceItem[] = OPERATOR_DEDICATED_AXIS_PRESETS.map((preset) => createSequence(
  `starter-sequence-${preset.id}`,
  preset.id,
  preset.name,
));


export const OPERATOR_DEDICATED_SUBAXIS_PRESETS: PresetRecord[] = OPERATOR_PROMOTED_DEDICATED_SUBAXES.map((axis, index) => {
  const layer2 = OPERATOR_RECIPE_LIBRARY.find((entry) => entry.dedicatedSubAxis === axis) ?? OPERATOR_RECIPE_LIBRARY[index];
  const layer3 = OPERATOR_RECIPE_LIBRARY.find((entry, candidateIndex) => candidateIndex !== index && entry.dedicatedSubAxis === axis) ?? layer2;
  return createPreset(
    `starter-dedicated-sub-${axis}`,
    `Dedicated ${axis}`,
    mergeConfigs(
      { cameraControlMode: 'hybrid', renderQuality: 'balanced', layer1Count: 2200, ambientEnabled: false },
      buildOperatorLayerPatch(2, layer2),
      buildOperatorLayerPatch(3, layer3),
      { layer3Enabled: true, layer3Count: Math.min(3800, layer3.count), layer3BaseSize: Math.max(0.62, layer3.baseSize * 0.92) },
    ),
  );
});

export const OPERATOR_DEDICATED_SUBAXIS_SEQUENCES: PresetSequenceItem[] = OPERATOR_DEDICATED_SUBAXIS_PRESETS.map((preset) => createSequence(
  `starter-sequence-${preset.id}`,
  preset.id,
  preset.name,
));

export const OPERATOR_COLLISION_REVIEW_PRESETS: PresetRecord[] = OPERATOR_DEDICATED_AXIS_CANDIDATES.slice(0, 6).map((candidate, index) => {
  const recipes = candidate.recipeIds
    .map((id) => OPERATOR_RECIPE_LIBRARY.find((entry) => entry.id === id))
    .filter((recipe): recipe is NonNullable<typeof recipe> => Boolean(recipe));
  const layer2 = recipes[0] ?? OPERATOR_RECIPE_LIBRARY[index];
  const layer3 = recipes[1] ?? recipes[0] ?? OPERATOR_RECIPE_LIBRARY[index + 1];
  return createPreset(
    `starter-${candidate.id}-review`,
    `${candidate.label} Review`,
    mergeConfigs(
      { cameraControlMode: 'hybrid', renderQuality: 'balanced', layer1Count: 2200, ambientEnabled: false },
      buildOperatorLayerPatch(2, layer2),
      buildOperatorLayerPatch(3, layer3),
      { layer3Enabled: true, layer3Count: Math.min(3800, layer3.count), layer3BaseSize: Math.max(0.62, layer3.baseSize * 0.92) },
    ),
  );
});

export const OPERATOR_COLLISION_REVIEW_SEQUENCES: PresetSequenceItem[] = OPERATOR_COLLISION_REVIEW_PRESETS.map((preset) => createSequence(
  `starter-sequence-${preset.id}`,
  preset.id,
  preset.name,
));


export const OPERATOR_ATLAS_STACK_PRESETS: PresetRecord[] = EXPRESSION_ATLAS_BUNDLES.slice(0, 12).map((bundle, index) => createPreset(
  `starter-atlas-${bundle.id}`,
  `Atlas ${bundle.label}`,
  mergeConfigs(
    { cameraControlMode: 'hybrid', renderQuality: index % 2 === 0 ? 'balanced' : 'cinematic', layer1Count: 2000, ambientEnabled: false },
    { layer2Enabled: true },
    bundle.patch(2),
    { layer3Enabled: true },
    bundle.patch(3),
  ),
));

export const OPERATOR_ATLAS_STACK_SEQUENCES: PresetSequenceItem[] = OPERATOR_ATLAS_STACK_PRESETS.map((preset) => createSequence(
  `starter-sequence-${preset.id}`,
  preset.id,
  preset.name,
));

