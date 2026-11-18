import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { ParticleConfig } from '../types';
import {
  clampParallaxFactor,
  getParallaxDefaultCameraPosition,
  getParallaxGroupOffset,
} from '../lib/parallax';

// Phase AZ: one depth group of the parallax grammar. Wraps a
// layer family (Layer 1 / 2 / 3, ambient, or the GPGPU family)
// in a plain group whose position is driven per frame by
// lib/parallax.ts: offset = (camera position − the config's
// default camera position) * factor.
//
// With factor 0 (the default) the offset is exactly (0, 0, 0) on
// every frame, the local matrix is the identity and the composed
// world matrices are numerically the legacy ones — the render is
// bit-identical to the scene without the wrapper. The wrapper is
// mounted unconditionally so toggling a factor never remounts the
// family inside it. During deterministic renders the camera is
// pinned to the default position, so the delta (and therefore
// the shift) is zero at any factor.
export const ParallaxGroup: React.FC<{
  config: ParticleConfig;
  factor: number;
  children: React.ReactNode;
}> = ({ config, factor, children }) => {
  const groupRef = useRef<THREE.Group>(null);

  useFrame(({ camera }) => {
    const group = groupRef.current;
    if (!group) return;
    const f = clampParallaxFactor(factor);
    if (f === 0) {
      if (group.position.x !== 0 || group.position.y !== 0 || group.position.z !== 0) {
        group.position.set(0, 0, 0);
      }
      return;
    }
    const base = getParallaxDefaultCameraPosition(config.viewMode, config.cameraDistance);
    const offset = getParallaxGroupOffset(
      [camera.position.x, camera.position.y, camera.position.z],
      base,
      f,
    );
    group.position.set(offset[0], offset[1], offset[2]);
  });

  return <group ref={groupRef}>{children}</group>;
};
