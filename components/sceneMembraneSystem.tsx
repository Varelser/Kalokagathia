import React, { useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { ParticleConfig } from '../types';
import { MembraneSystemRender } from './sceneMembraneSystemRender';
import {
  buildMembraneLayout,
  getLayoutDeps,
  type MembraneAudioState,
} from './sceneMembraneSystemShared';
import { useMembraneGeometryBindings, useMembraneRuntime } from './sceneMembraneSystemRuntime';

export const MembraneSystem: React.FC<{
  config: ParticleConfig;
  layerIndex: 2 | 3;
  audioRef: React.MutableRefObject<MembraneAudioState>;
  isPlaying: boolean;
}> = ({ config, layerIndex, audioRef, isPlaying }) => {
  const surfaceMaterialRef = useRef<THREE.ShaderMaterial>(null);
  const wireMaterialRef = useRef<THREE.MeshBasicMaterial>(null);
  const frameCounterRef = useRef(0);
  // eslint-disable-next-line react-hooks/use-memo, react-hooks/exhaustive-deps -- deps come from a get*Deps() helper listing the exact config fields this layout reads; a literal [config] dep would rebuild the geometry on every config change.
  const layout = useMemo(() => buildMembraneLayout(config, layerIndex), getLayoutDeps(config, layerIndex));
  const geometry = useMemo(() => new THREE.BufferGeometry(), []);

  useMembraneGeometryBindings(geometry, layout);
  useMembraneRuntime({
    config,
    layerIndex,
    audioRef,
    isPlaying,
    layout,
    geometry,
    surfaceMaterialRef,
    wireMaterialRef,
    frameCounterRef,
  });

  if (!layout) return null;

  return (
    <MembraneSystemRender
      config={config}
      layerIndex={layerIndex}
      geometry={geometry}
      surfaceMaterialRef={surfaceMaterialRef}
      wireMaterialRef={wireMaterialRef}
    />
  );
};
