import type { ParticleConfig } from '../types';

export type ProductPackFamily = 'touchdesigner' | 'trapcode' | 'universe' | 'hybrid' | 'houdini' | 'niagara' | 'geometrynodes' | 'unityvfx';

export interface ProductPackBundle {
  id: string;
  label: string;
  family: ProductPackFamily;
  summary: string;
  emphasis: string[];
  postStackId: string;
  solverFamilies: string[];
  specialistFamilies: string[];
  patch: Partial<ParticleConfig>;
  signature: Partial<ParticleConfig>;
}
