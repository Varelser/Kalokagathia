import type { ParticleConfig } from '../types';

export type ProceduralMode = ParticleConfig['layer2Type'];

export type ProceduralGuide = {
  summary: string;
  bestSources: string[];
  useCases: string[];
  tips: string[];
  recommendedRanges: Array<{ label: string; value: string }>;
};

type ProceduralPatchValue = string | number | boolean;

export type ProceduralQuickPreset = {
  label: string;
  description: string;
  patch: (layerIndex: 2 | 3) => Partial<ParticleConfig>;
};

export const proceduralLayerPatch = (
  layerIndex: 2 | 3,
  values: Record<string, ProceduralPatchValue>,
): Partial<ParticleConfig> => {
  const prefix = layerIndex === 2 ? 'layer2' : 'layer3';
  const patch: Partial<ParticleConfig> = {};
  for (const [suffix, value] of Object.entries(values)) {
    const nextKey = `${prefix}${suffix}` as keyof ParticleConfig;
    (patch as Record<string, ProceduralPatchValue>)[nextKey] = value;
  }
  return patch;
};
