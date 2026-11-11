import React from 'react';
import * as THREE from 'three';
import {
  createGrowthUniforms,
  GROWTH_FRAGMENT_SHADER,
  GROWTH_VERTEX_SHADER,
} from './sceneGrowthFieldSystemShared';

export const GrowthFieldRender: React.FC<{
  lineRef: React.MutableRefObject<THREE.LineSegments | null>;
  materialRef: React.MutableRefObject<THREE.ShaderMaterial | null>;
}> = ({ lineRef, materialRef }) => (
  <lineSegments ref={lineRef} renderOrder={2}>
    <shaderMaterial
      ref={materialRef}
      transparent={true}
      depthWrite={false}
      blending={THREE.AdditiveBlending}
      vertexShader={GROWTH_VERTEX_SHADER}
      fragmentShader={GROWTH_FRAGMENT_SHADER}
      uniforms={createGrowthUniforms()}
    />
  </lineSegments>
);
