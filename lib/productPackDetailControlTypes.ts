import type { ParticleConfig } from '../types';

export type ProductPackDetailControl =
  | {
      kind: 'slider';
      key: keyof ParticleConfig;
      label: string;
      min: number;
      max: number;
      step: number;
      description?: string;
    }
  | {
      kind: 'toggle';
      key: keyof ParticleConfig;
      label: string;
      options: Array<{ label: string; val: string | number | boolean }>;
      description?: string;
    };

export interface ProductPackDetailGroup {
  id: string;
  label: string;
  summary: string;
  controls: ProductPackDetailControl[];
}
