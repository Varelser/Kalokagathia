import type { ParticleConfig } from '../types';
import type { Primitive, OperatorRecipe } from './operatorMatrixTypes';
import {
  dedicatedAxisPatch,
  dedicatedSubAxisPatch,
  dynamicsPatch,
  geometryPatch,
  inscriptionPatch,
  materialPatch,
  mergeSuffix,
} from './operatorMatrixPatchPresets';
import { clampNumber, roundTo, sourceAutoWeight } from './operatorMatrixSourceAutoWeight';

function toLayerPatch(layerIndex: 2 | 3, values: Record<string, Primitive>): Partial<ParticleConfig> {
  const prefix = layerIndex === 2 ? 'layer2' : 'layer3';
  const patch: Partial<ParticleConfig> = {};
  for (const [suffix, value] of Object.entries(values)) {
    if (value === undefined || value === null) continue;
    (patch as Record<string, Primitive>)[`${prefix}${suffix}`] = value as Primitive;
  }
  return patch;
}

export function buildOperatorLayerPatch(layerIndex: 2 | 3, recipe: OperatorRecipe): Partial<ParticleConfig> {
  const sourceWeight = sourceAutoWeight(recipe.source, recipe.geometry, recipe.inscription);
  const suffix = mergeSuffix(
    {
      Enabled: true,
      Type: recipe.mode,
      Source: recipe.source,
      MaterialStyle: recipe.materialStyle,
      TemporalProfile: recipe.temporal,
      TemporalStrength: roundTo(sourceWeight.temporalStrength, 2),
      Count: Math.round(clampNumber(recipe.count * sourceWeight.countMultiplier, 4800, 15000)),
      BaseSize: roundTo(clampNumber(recipe.baseSize * sourceWeight.baseSizeMultiplier, 0.52, 1.34), 2),
      RadiusScale: roundTo(clampNumber((recipe.radiusScale ?? 1.0) * sourceWeight.radiusScaleMultiplier, 0.8, 1.34), 2),
    },
    materialPatch(recipe.material),
    geometryPatch(recipe.geometry),
    dynamicsPatch(recipe.dynamics),
    inscriptionPatch(recipe.inscription, recipe.source, recipe.label),
    dedicatedAxisPatch(recipe.dedicatedAxis),
    dedicatedSubAxisPatch(recipe.dedicatedSubAxis),
    sourceWeight.suffixPatch,
    recipe.autoSourcePatch ?? {},
  );
  const base = toLayerPatch(layerIndex, suffix as Record<string, Primitive>);
  return recipe.extraPatch ? { ...base, ...recipe.extraPatch } : base;
}
