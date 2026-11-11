import React from 'react';
import * as THREE from 'three';
import {
  createFiberUniforms,
  FIBER_FRAGMENT_SHADER,
  FIBER_VERTEX_SHADER,
  type FiberProfile,
} from './sceneFiberFieldSystemShared';

export const FiberFieldSystemRender: React.FC<{
  lineRef: React.RefObject<THREE.LineSegments | null>;
  materialRef: React.RefObject<THREE.ShaderMaterial | null>;
  blending: THREE.Blending;
  fiberProfile: FiberProfile;
}> = ({ lineRef, materialRef, blending, fiberProfile }) => (
  <lineSegments ref={lineRef} renderOrder={2}>
    <shaderMaterial
      ref={materialRef}
      transparent={true}
      depthWrite={false}
      blending={blending}
      vertexShader={FIBER_VERTEX_SHADER}
      fragmentShader={FIBER_FRAGMENT_SHADER}
      uniforms={createFiberUniforms(fiberProfile)}
    />
  </lineSegments>
);
