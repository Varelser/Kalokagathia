import type { ParticleConfig } from "../types";

export type ExpressionAtlasBundle = {
  id: string;
  label: string;
  summary: string;
  postStackId?: string | null;
  patch: (layerIndex: 2 | 3) => Partial<ParticleConfig>;
};
