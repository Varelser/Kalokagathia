import type { Layer2Type } from '../types';

export interface HybridExpressionRecipe {
  id: string;
  name: string;
  summary: string;
  layer2Modes: Layer2Type[];
  layer3Modes: Layer2Type[];
  emphasis: string[];
}
