import React, { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { ParticleConfig } from '../types';
import { buildCrystalLayout, createCrystalGeometry, getCrystalLayoutDeps, getCrystalProfile, getCrystalSettings } from './sceneCrystalAggregateSystemShared';
import { updateCrystalAggregateFrame } from './sceneCrystalAggregateSystemRuntime';

export const CrystalAggregateSystem: React.FC<{
  config: ParticleConfig;
  layerIndex: 2 | 3;
  audioRef: React.MutableRefObject<{ bass: number; treble: number; pulse: number; bandA: number; bandB: number }>;
  isPlaying: boolean;
}> = ({ config, layerIndex, audioRef, isPlaying }) => {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const materialRef = useRef<THREE.MeshStandardMaterial>(null);
  const crystalSettings = getCrystalSettings(config, layerIndex);
  const mode = layerIndex === 2 ? config.layer2Type : config.layer3Type;
  const profile = useMemo(() => getCrystalProfile(mode, crystalSettings.source, crystalSettings.materialStyle), [mode, crystalSettings.materialStyle, crystalSettings.source]);
  // eslint-disable-next-line react-hooks/use-memo, react-hooks/exhaustive-deps -- deps come from a get*Deps() helper listing the exact config fields this layout reads; a literal [config] dep would rebuild the geometry on every config change.
  const layout = useMemo(() => buildCrystalLayout(config, layerIndex), getCrystalLayoutDeps(config, layerIndex));
  const geometry = useMemo(() => createCrystalGeometry(profile.geometry), [profile.geometry]);

  React.useEffect(() => () => geometry.dispose(), [geometry]);

  useFrame(({ clock }) => {
    const mesh = meshRef.current;
    const material = materialRef.current;
    if (!mesh || !material || !layout) return;
    updateCrystalAggregateFrame({
      audioRef,
      config,
      isPlaying,
      layerIndex,
      layout,
      material,
      mesh,
      time: clock.getElapsedTime(),
    });
  });

  if (!layout) return null;

  return (
    <instancedMesh ref={meshRef} args={[geometry, undefined, layout.instanceCount]} renderOrder={2}>
      <meshStandardMaterial
        ref={materialRef}
        transparent={true}
        depthWrite={false}
        vertexColors={true}
        blending={THREE.AdditiveBlending}
      />
    </instancedMesh>
  );
};
