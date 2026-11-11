import React, { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { getLayerSource, withCrossFamilyPatchProfile, withSourceAwarePatchProfile } from '../lib/sourceAwareShaping';
import { SurfacePatchSystemRender } from './sceneSurfacePatchSystemRender';
import { useSurfacePatchRuntime } from './sceneSurfacePatchSystemRuntime';
import {
  buildPatchLayout,
  getLayoutDeps,
  getLayerMode,
  getPatchProfile,
  getPatchSourceProfile,
  type SurfacePatchSystemProps,
} from './sceneSurfacePatchSystemShared';

export const SurfacePatchSystem: React.FC<SurfacePatchSystemProps> = ({ config, layerIndex, audioRef, isPlaying }) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const wireMeshRef = useRef<THREE.Mesh>(null);
  const materialRef = useRef<THREE.ShaderMaterial>(null);
  const wireMaterialRef = useRef<THREE.MeshBasicMaterial>(null);
  const geometryRef = useRef<THREE.PlaneGeometry | null>(null);

  // eslint-disable-next-line react-hooks/use-memo, react-hooks/exhaustive-deps -- deps come from a get*Deps() helper listing the exact config fields this layout reads; a literal [config] dep would rebuild the geometry on every config change.
  const layout = useMemo(() => buildPatchLayout(config, layerIndex), getLayoutDeps(config, layerIndex));
  const layerMode = getLayerMode(config, layerIndex);
  const layerSource = getLayerSource(config, layerIndex);
  const patchProfile = useMemo(
    () => withCrossFamilyPatchProfile(withSourceAwarePatchProfile(getPatchProfile(layerMode), layerSource), layerMode, layerSource),
    [layerMode, layerSource],
  );
  const sourceProfile = useMemo(() => getPatchSourceProfile(layerSource), [layerSource]);

  useSurfacePatchRuntime({
    config,
    layerIndex,
    audioRef,
    isPlaying,
    layout,
    patchProfile,
    sourceProfile,
    meshRef,
    wireMeshRef,
    materialRef,
    wireMaterialRef,
    geometryRef,
  });

  if (!layout) return null;

  return (
    <SurfacePatchSystemRender
      config={config}
      layerIndex={layerIndex}
      meshRef={meshRef}
      wireMeshRef={wireMeshRef}
      materialRef={materialRef}
      wireMaterialRef={wireMaterialRef}
    />
  );
};
