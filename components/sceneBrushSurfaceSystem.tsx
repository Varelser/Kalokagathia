import React, { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { ParticleConfig } from '../types';
import { generateParticleData } from './particleData';
import { getLayerSource } from '../lib/sourceAwareShaping';
import {
  getBrushProfile,
  getBrushSettings,
  getLayerMode,
  getParticleDeps,
  withSourceAwareBrushProfile,
} from './sceneBrushSurfaceSystemShared';
import { createBrushPlanes, disposeBrushPlanes, updateBrushSurfaceFrame } from './sceneBrushSurfaceSystemRuntime';
import { renderBrushSurfaceMeshes } from './sceneBrushSurfaceSystemRender';

export const BrushSurfaceSystem: React.FC<{
  config: ParticleConfig;
  layerIndex: 2 | 3;
  audioRef: React.MutableRefObject<{ bass: number; treble: number; pulse: number; bandA: number; bandB: number }>;
  isPlaying: boolean;
}> = ({ config, layerIndex, audioRef, isPlaying }) => {
  const groupRef = useRef<THREE.Group>(null);
  const materialRefs = useRef<THREE.ShaderMaterial[]>([]);
  const settings = getBrushSettings(config, layerIndex);
  const layerMode = getLayerMode(config, layerIndex);
  const layerSource = getLayerSource(config, layerIndex);
  const brushProfile = useMemo(() => withSourceAwareBrushProfile(getBrushProfile(layerMode), layerSource), [layerMode, layerSource]);
  // eslint-disable-next-line react-hooks/use-memo, react-hooks/exhaustive-deps -- deps come from a get*Deps() helper listing the exact config fields this layout reads; a literal [config] dep would rebuild the geometry on every config change.
  const particleData = useMemo(() => generateParticleData(config, layerIndex, false, 'aux'), getParticleDeps(config, layerIndex));
  const planes = useMemo(() => createBrushPlanes(settings.layers), [settings.layers]);

  React.useEffect(() => () => {
    disposeBrushPlanes(planes);
  }, [planes]);

  useFrame(({ clock }) => {
    const group = groupRef.current;
    if (!group || !particleData || particleData.count === 0) return;
    updateBrushSurfaceFrame({
      group,
      materialRefs,
      config,
      layerIndex,
      particleData,
      brushProfile,
      settings,
      planes,
      audioRef,
      isPlaying,
      time: clock.getElapsedTime(),
    });
  });

  if (!particleData || particleData.count === 0) return null;

  return <group ref={groupRef} renderOrder={1}>{renderBrushSurfaceMeshes({ planes, materialRefs, settings })}</group>;
};
