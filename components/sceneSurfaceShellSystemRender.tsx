import React from 'react';
import * as THREE from 'three';
import type { ParticleConfig } from '../types';
import { createShellUniforms, SHELL_FRAGMENT_SHADER, SHELL_VERTEX_SHADER } from './sceneSurfaceShellSystemShared';

type SurfaceShellSystemRenderProps = {
  config: ParticleConfig;
  layerIndex: 2 | 3;
  shellMaterialRef: React.RefObject<THREE.ShaderMaterial | null>;
  wireMaterialRef: React.RefObject<THREE.MeshBasicMaterial | null>;
  shellMeshRef: React.RefObject<THREE.Mesh | null>;
  wireMeshRef: React.RefObject<THREE.Mesh | null>;
};

export function SurfaceShellSystemRender({
  config,
  layerIndex,
  shellMaterialRef,
  wireMaterialRef,
  shellMeshRef,
  wireMeshRef,
}: SurfaceShellSystemRenderProps) {
  return (
    <group>
      <mesh ref={shellMeshRef} renderOrder={1}>
        <shaderMaterial
          ref={shellMaterialRef}
          vertexShader={SHELL_VERTEX_SHADER}
          fragmentShader={SHELL_FRAGMENT_SHADER}
          transparent={true}
          depthWrite={false}
          side={THREE.DoubleSide}
          blending={THREE.AdditiveBlending}
          uniforms={createShellUniforms(config, layerIndex)}
        />
      </mesh>
      <mesh ref={wireMeshRef} renderOrder={2}>
        <meshBasicMaterial ref={wireMaterialRef} transparent={true} depthWrite={false} wireframe={true} toneMapped={false} opacity={0.28} color={layerIndex === 2 ? config.layer2Color : config.layer3Color} />
      </mesh>
    </group>
  );
}
