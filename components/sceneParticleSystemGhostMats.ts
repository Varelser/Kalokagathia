import * as THREE from 'three';
import type { ParticleConfig } from '../types';
import { FRAGMENT_SHADER, PARTICLE_VERTEX_SHADER } from './sceneShaders';
import { getParticleBlendMode } from './sceneShared';

export const createParticleGhostMaterials = ({
  config,
  layerIndex,
  isAux,
  uniforms,
  maxGhost,
}: {
  config: ParticleConfig;
  layerIndex: 1 | 2 | 3 | 4;
  isAux: boolean;
  uniforms: Record<string, { value: unknown }>;
  maxGhost: number;
}) => {
  if ((layerIndex !== 2 && layerIndex !== 3) || isAux) return [] as THREE.ShaderMaterial[];

  return Array.from({ length: maxGhost }, () => {
    const cloned: Record<string, { value: unknown }> = {};
    for (const [key, uniform] of Object.entries(uniforms)) {
      const value = uniform.value;
      if (value instanceof THREE.Color) cloned[key] = { value: value.clone() };
      else if (value instanceof THREE.Vector2) cloned[key] = { value: value.clone() };
      else if (value instanceof THREE.Vector3) cloned[key] = { value: value.clone() };
      else if (value instanceof THREE.Vector4) cloned[key] = { value: value.clone() };
      else if (Array.isArray(value)) cloned[key] = { value: (value as { clone?: () => unknown }[]).map((entry) => entry?.clone?.() ?? entry) };
      else cloned[key] = { value };
    }

    return new THREE.ShaderMaterial({
      vertexShader: PARTICLE_VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      uniforms: cloned,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: getParticleBlendMode(config.backgroundColor),
    });
  });
};
