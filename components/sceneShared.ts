import * as THREE from 'three';
import type { ParticleConfig } from '../types';

export type ShaderUniformMap = Record<string, THREE.IUniform>;

export const getParticleBlendMode = (backgroundColor: ParticleConfig['backgroundColor']) => (
  backgroundColor === 'white' ? THREE.NormalBlending : THREE.AdditiveBlending
);

export const getLineBlendMode = (backgroundColor: ParticleConfig['backgroundColor']) => (
  backgroundColor === 'white' ? THREE.NormalBlending : THREE.AdditiveBlending
);
