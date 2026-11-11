import React from 'react';
import * as THREE from 'three';
import type { ParticleConfig } from '../types';
import {
  createMembraneUniforms,
  MEMBRANE_FRAGMENT_SHADER,
  MEMBRANE_VERTEX_SHADER,
} from './sceneMembraneSystemShared';

export const MembraneSystemRender: React.FC<{
  config: ParticleConfig;
  layerIndex: 2 | 3;
  geometry: THREE.BufferGeometry;
  surfaceMaterialRef: React.MutableRefObject<THREE.ShaderMaterial | null>;
  wireMaterialRef: React.MutableRefObject<THREE.MeshBasicMaterial | null>;
}> = ({ config, layerIndex, geometry, surfaceMaterialRef, wireMaterialRef }) => (
  <group>
    <mesh geometry={geometry} renderOrder={1}>
      <shaderMaterial
        ref={surfaceMaterialRef}
        vertexShader={MEMBRANE_VERTEX_SHADER}
        fragmentShader={MEMBRANE_FRAGMENT_SHADER}
        transparent={true}
        depthWrite={false}
        side={THREE.DoubleSide}
        blending={THREE.AdditiveBlending}
        uniforms={createMembraneUniforms(config, layerIndex)}
      />
    </mesh>
    <mesh geometry={geometry} renderOrder={2}>
      <meshBasicMaterial
        ref={wireMaterialRef}
        transparent={true}
        depthWrite={false}
        wireframe={true}
        toneMapped={false}
        opacity={0.28}
        color={layerIndex === 2 ? config.layer2Color : config.layer3Color}
      />
    </mesh>
  </group>
);
