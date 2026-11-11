import React from 'react';
import * as THREE from 'three';
import type { ParticleConfig } from '../types';
import { PATCH_FRAGMENT_SHADER, PATCH_VERTEX_SHADER, createPatchUniforms, getLayerPatchSettings } from './sceneSurfacePatchSystemShared';

type SurfacePatchRenderProps = {
  config: ParticleConfig;
  layerIndex: 2 | 3;
  meshRef: React.MutableRefObject<THREE.Mesh | null>;
  wireMeshRef: React.MutableRefObject<THREE.Mesh | null>;
  materialRef: React.MutableRefObject<THREE.ShaderMaterial | null>;
  wireMaterialRef: React.MutableRefObject<THREE.MeshBasicMaterial | null>;
};

export function SurfacePatchSystemRender({
  config,
  layerIndex,
  meshRef,
  wireMeshRef,
  materialRef,
  wireMaterialRef,
}: SurfacePatchRenderProps) {
  return (
    <group>
      <mesh ref={meshRef} renderOrder={1}>
        <shaderMaterial
          ref={materialRef}
          vertexShader={PATCH_VERTEX_SHADER}
          fragmentShader={PATCH_FRAGMENT_SHADER}
          transparent={true}
          depthWrite={false}
          side={THREE.DoubleSide}
          blending={THREE.AdditiveBlending}
          uniforms={createPatchUniforms(config, layerIndex)}
        />
      </mesh>
      <mesh ref={wireMeshRef} renderOrder={2}>
        <meshBasicMaterial
          ref={wireMaterialRef}
          transparent={true}
          depthWrite={false}
          wireframe={true}
          toneMapped={false}
          opacity={0.2}
          color={getLayerPatchSettings(config, layerIndex).color}
        />
      </mesh>
    </group>
  );
}
