import React from 'react';
import * as THREE from 'three';
import {
  createErosionTrailUniforms,
  EROSION_TRAIL_FRAGMENT_SHADER,
  EROSION_TRAIL_VERTEX_SHADER,
} from './sceneErosionTrailSystemShared';

export const ErosionTrailRender: React.FC<{
  lineRef: React.MutableRefObject<THREE.LineSegments | null>;
  materialRef: React.MutableRefObject<THREE.ShaderMaterial | null>;
}> = ({ lineRef, materialRef }) => (
  <lineSegments ref={lineRef} renderOrder={2}>
    <shaderMaterial
      ref={materialRef}
      transparent={true}
      depthWrite={false}
      blending={THREE.AdditiveBlending}
      vertexShader={EROSION_TRAIL_VERTEX_SHADER}
      fragmentShader={EROSION_TRAIL_FRAGMENT_SHADER}
      uniforms={createErosionTrailUniforms()}
    />
  </lineSegments>
);
