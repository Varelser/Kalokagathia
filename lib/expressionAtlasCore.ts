import type { ParticleConfig } from "../types";

type Primitive = string | number | boolean;

export const layerPatch = (layerIndex: 2 | 3, values: Record<string, Primitive>): Partial<ParticleConfig> => {
  const prefix = layerIndex === 2 ? 'layer2' : 'layer3';
  const patch: Partial<ParticleConfig> = {};
  for (const [suffix, value] of Object.entries(values)) {
    (patch as Record<string, Primitive>)[`${prefix}${suffix}`] = value;
  }
  return patch;
};
