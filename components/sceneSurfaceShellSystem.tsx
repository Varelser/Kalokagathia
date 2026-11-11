import React, { useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { ParticleConfig } from '../types';
import {
  buildHullLayout,
  getLayoutDeps,
  getSourceShellGeometryProfile,
  resolveShellProfile,
} from './sceneSurfaceShellSystemShared';
import { getLayerSource } from '../lib/sourceAwareShaping';
import { useSurfaceShellSystemRuntime } from './sceneSurfaceShellSystemRuntime';
import { SurfaceShellSystemRender } from './sceneSurfaceShellSystemRender';

export const SurfaceShellSystem: React.FC<{
  config: ParticleConfig;
  layerIndex: 2 | 3;
  audioRef: React.MutableRefObject<{ bass: number; treble: number; pulse: number; bandA: number; bandB: number }>;
  isPlaying: boolean;
}> = ({ config, layerIndex, audioRef, isPlaying }) => {
  const shellMaterialRef = useRef<THREE.ShaderMaterial>(null);
  const wireMaterialRef = useRef<THREE.MeshBasicMaterial>(null);
  const shellMeshRef = useRef<THREE.Mesh>(null);
  const wireMeshRef = useRef<THREE.Mesh>(null);
  // eslint-disable-next-line react-hooks/use-memo, react-hooks/exhaustive-deps -- deps come from a get*Deps() helper listing the exact config fields this layout reads; a literal [config] dep would rebuild the geometry on every config change.
  const layout = useMemo(() => buildHullLayout(config, layerIndex), getLayoutDeps(config, layerIndex));
  const layerSource = getLayerSource(config, layerIndex);
  const shellProfile = useMemo(() => resolveShellProfile(config, layerIndex), [config, layerIndex]);
  const sourceProfile = useMemo(() => getSourceShellGeometryProfile(layerSource), [layerSource]);

  useSurfaceShellSystemRuntime({
    config,
    layerIndex,
    audioRef,
    isPlaying,
    layout,
    shellProfile,
    sourceProfile,
    shellMaterialRef,
    wireMaterialRef,
    shellMeshRef,
    wireMeshRef,
  });

  if (!layout) return null;

  return (
    <SurfaceShellSystemRender
      config={config}
      layerIndex={layerIndex}
      shellMaterialRef={shellMaterialRef}
      wireMaterialRef={wireMaterialRef}
      shellMeshRef={shellMeshRef}
      wireMeshRef={wireMeshRef}
    />
  );
};
