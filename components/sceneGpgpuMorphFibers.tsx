// components/sceneGpgpuMorphFibers.tsx
// Morph-surface fibers (Phase AG): strands grown from the morph
// bake's surface points along their normals, drawn as line
// segments tinted by the GPGPU colour. The bake is deterministic,
// so this overlay rebuilds the same surface cloud the simulation
// consumes (at a reduced 96×96 bake) and roots the strands on it
// via lib/morphFiber.ts — roots sit on the surface, directions
// inherit the surface normals (OBJ companion normals; radial
// fallback elsewhere), and the curl key grooms the bend.
// Display only: nothing feeds back into the simulation, and the
// component mounts only when the fiber key is on, so the default
// scene pays nothing for it.

import React, { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { ParticleConfig } from '../types';
import { buildMorphFiberStrands } from '../lib/morphFiber';
import { buildMorphBakeData } from './useGpgpuRuntime';

type Props = {
  config: ParticleConfig;
};

const FIBER_BAKE_TEX_SIZE = 96;

export const GpgpuMorphFibers: React.FC<Props> = React.memo(({ config }) => {
  const strands = useMemo(() => {
    if (!config.gpgpuMorphEnabled || !config.gpgpuMorphFiberEnabled) return null;
    const bake = buildMorphBakeData(config, FIBER_BAKE_TEX_SIZE);
    if (!bake) return null;
    const count = FIBER_BAKE_TEX_SIZE * FIBER_BAKE_TEX_SIZE;
    const points = new Float32Array(count * 3);
    const normals = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      points[i * 3] = bake.data[i * 4];
      points[i * 3 + 1] = bake.data[i * 4 + 1];
      points[i * 3 + 2] = bake.data[i * 4 + 2];
      normals[i * 3] = bake.normalData[i * 4];
      normals[i * 3 + 1] = bake.normalData[i * 4 + 1];
      normals[i * 3 + 2] = bake.normalData[i * 4 + 2];
    }
    return buildMorphFiberStrands(points, normals, count, {
      count: config.gpgpuMorphFiberCount,
      length: config.gpgpuMorphFiberLength * Math.max(0.01, config.gpgpuBounceRadius),
      curl: config.gpgpuMorphFiberCurl,
      seed: config.gpgpuSeed,
    });
  }, [config]);

  const geometry = useMemo(() => {
    if (!strands || strands.strandCount === 0) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(strands.positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(strands.colors, 3));
    return geo;
  }, [strands]);
  useEffect(() => () => geometry?.dispose(), [geometry]);

  const material = useMemo(() => new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
  }), []);
  useEffect(() => () => material.dispose(), [material]);

  useFrame(() => {
    material.color.set(config.gpgpuColor);
    material.opacity = Math.max(0, Math.min(1, config.gpgpuOpacity)) * 0.85;
  });

  if (!geometry) return null;
  return <lineSegments geometry={geometry} material={material} frustumCulled={false} />;
});
GpgpuMorphFibers.displayName = 'GpgpuMorphFibers';
