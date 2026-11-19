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
  vertexShader = PARTICLE_VERTEX_SHADER,
  fragmentShader = FRAGMENT_SHADER,
}: {
  config: ParticleConfig;
  layerIndex: 1 | 2 | 3 | 4;
  isAux: boolean;
  uniforms: Record<string, { value: unknown }>;
  maxGhost: number;
  // The effective vertex shader (Phase CD): the stock shader
  // unless a validated snippet was built into it, so ghosts —
  // the same particles a few instants earlier — displace
  // together with the primary material.
  vertexShader?: string;
  // The effective fragment shader (Phase CE): same rule as the
  // vertex shader — ghosts are the same particles, so a colour
  // / alpha snippet applies to them together with the primary
  // material.
  fragmentShader?: string;
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
      vertexShader,
      fragmentShader,
      uniforms: cloned,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: getParticleBlendMode(config.backgroundColor),
    });
  });
};
