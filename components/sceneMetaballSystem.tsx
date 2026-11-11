// components/sceneMetaballSystem.tsx
// Metaball isosurface via three-stdlib MarchingCubes.
// Reads particle positions from GpgpuSystem's posReadbackRef,
// evaluates metaball field and regenerates the mesh each frame.

import React, { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { MarchingCubes } from 'three-stdlib';
import type { ParticleConfig } from '../types';
import { getMaxGpgpuTexSize } from './useGpgpuRuntime';

type Props = {
  config: ParticleConfig;
  posReadbackRef: React.RefObject<Float32Array | null>;
  texSize: number;
  isPlaying: boolean;
};

export const MetaballSystem: React.FC<Props> = React.memo(
  ({ config, posReadbackRef, texSize, isPlaying }) => {

  const matRef = useRef<THREE.MeshStandardMaterial | null>(null);
  const mcRef  = useRef<MarchingCubes | null>(null);
  const frameCountRef = useRef(0);

  // Resolution — must be integer 16..64; recreate mesh when it changes
  const resolution = Math.round(
    Math.max(16, Math.min(64, config.gpgpuMetaballResolution)),
  );

  // Create/recreate MarchingCubes object when resolution changes
  const mc = useMemo(() => {
    matRef.current?.dispose();
    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(config.gpgpuMetaballColor),
      opacity: config.gpgpuMetaballOpacity,
      transparent: config.gpgpuMetaballOpacity < 1,
      side: THREE.DoubleSide,
      metalness: config.gpgpuMetaballMetalness,
      roughness: config.gpgpuMetaballRoughness,
      depthWrite: config.gpgpuMetaballOpacity >= 0.99,
    });
    matRef.current = mat;

    // maxPolyCount = resolution³ * 5 (generous upper bound)
    const maxPoly = resolution ** 3 * 5;
    const obj = new MarchingCubes(resolution, mat, false, false, maxPoly);
    obj.isolation = config.gpgpuMetaballIsoLevel;
    // Scale the MC volume to match bounceRadius
    obj.scale.setScalar(config.gpgpuBounceRadius);
    mcRef.current = obj;
    return obj;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolution]);

  // Dispose on unmount
  useEffect(() => {
    return () => {
      mcRef.current?.geometry.dispose();
      matRef.current?.dispose();
    };
  }, []);

  useFrame(() => {
    const obj = mcRef.current;
    const mat = matRef.current;
    const positions = posReadbackRef.current;
    if (!obj || !mat || !positions) return;

    // Update material params live
    mat.color.setStyle(config.gpgpuMetaballColor);
    mat.opacity = config.gpgpuMetaballOpacity;
    mat.transparent = config.gpgpuMetaballOpacity < 0.99;
    mat.depthWrite = config.gpgpuMetaballOpacity >= 0.99;
    mat.wireframe = config.gpgpuMetaballWireframe;
    mat.metalness = config.gpgpuMetaballMetalness;
    mat.roughness = config.gpgpuMetaballRoughness;

    obj.isolation = config.gpgpuMetaballIsoLevel;
    obj.scale.setScalar(config.gpgpuBounceRadius);

    if (!isPlaying) return;

    // Frame skipping to reduce CPU load from MarchingCubes
    frameCountRef.current += 1;
    if (frameCountRef.current % Math.max(1, config.gpgpuMetaballUpdateSkip) !== 0) {
      return;
    }

    obj.reset();

    // Normalize positions into [0,1] for MarchingCubes
    const invR = 0.5 / config.gpgpuBounceRadius; // [-R,R] → [-0.5,0.5]
    const N = texSize * texSize;
    const limit = Math.min(N, Math.max(16, config.gpgpuMetaballParticleLimit));
    // Stride for uniform sampling when limit < N
    const stride = Math.max(1, Math.floor(N / limit));

    const strength = config.gpgpuMetaballStrength;
    const sub = config.gpgpuMetaballSubtract;

    for (let i = 0; i < N; i += stride) {
      const bx = positions[i * 4]     * invR + 0.5;
      const by = positions[i * 4 + 1] * invR + 0.5;
      const bz = positions[i * 4 + 2] * invR + 0.5;
      // Skip out-of-bounds particles (e.g. uninitialized)
      if (bx < 0 || bx > 1 || by < 0 || by > 1 || bz < 0 || bz > 1) continue;
      obj.addBall(bx, by, bz, strength, sub);
    }
  });

  return <primitive object={mc} />;
});
MetaballSystem.displayName = 'MetaballSystem';

// Returns the texSize that corresponds to a given gpgpuCount.
// Mirrors the logic used in sceneGpgpuSystem.tsx, including its bounded
// generation cap (see MAX_GPGPU_TEX_SIZE in useGpgpuRuntime.ts; the cap
// itself is GPU-tier driven via getMaxGpgpuTexSize).
export function getTexSizeForCount(count: number): number {
  const cap = getMaxGpgpuTexSize();
  const n = Math.ceil(Math.sqrt(count));
  const sizes = [16, 32, 64, 128, 256, 512, 768, 1024].filter((s) => s <= cap);
  return sizes.find((s) => s >= n) ?? cap;
}
