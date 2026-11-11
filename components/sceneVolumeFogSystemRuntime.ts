import React from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { withCrossFamilyFogProfile, withSourceAwareFogProfile } from '../lib/sourceAwareShaping';
import { getFogProfile } from './sceneVolumeFogSystemProfiles';
import { getFogSliceTransform } from './sceneVolumeFogSystemTransforms';
import { applyVolumeFogMaterialUniforms, getVolumeFogPlaneScale } from './sceneVolumeFogSystemMaterial';
import { getLayerRuntimeFogSnapshot } from '../lib/sceneRenderRouting';
import type { VolumeFogSystemProps } from './sceneVolumeFogSystemTypes';

export type VolumeFogRuntimeState = {
  rootRef: React.MutableRefObject<THREE.Group | null>;
  materialsRef: React.MutableRefObject<THREE.ShaderMaterial[]>;
  sliceMeshRefs: React.MutableRefObject<(THREE.Mesh | null)[]>;
  layerMode: VolumeFogSystemProps['config']['layer2Type'];
  layerSource: VolumeFogSystemProps['config']['layer2Source'];
  profile: ReturnType<typeof getFogProfile>;
  sharedColor: THREE.Color;
  fogOpacity: number;
  fogDensity: number;
  fogDepth: number;
  fogScale: number;
  fogDrift: number;
  fogGlow: number;
  fogAnisotropy: number;
  materialStyleIndex: number;
  sliceCount: number;
  sliceOffsets: number[];
  planeScale: number;
  globalRadius: number;
};

export function useVolumeFogRuntime({ config, layerIndex, audioRef, isPlaying }: VolumeFogSystemProps): VolumeFogRuntimeState {
  const { camera } = useThree();
  const rootRef = React.useRef<THREE.Group>(null);
  const materialsRef = React.useRef<THREE.ShaderMaterial[]>([]);
  const sliceMeshRefs = React.useRef<(THREE.Mesh | null)[]>([]);

  const fogRuntime = getLayerRuntimeFogSnapshot(config, layerIndex);
  const layerMode = fogRuntime.mode;
  const layerColor = fogRuntime.color;
  const fogOpacity = fogRuntime.opacity;
  const fogDensity = fogRuntime.density;
  const fogDepth = fogRuntime.depth;
  const fogScale = fogRuntime.scale;
  const fogDrift = fogRuntime.drift;
  const fogSlices = fogRuntime.slices;
  const fogGlow = fogRuntime.glow;
  const fogAnisotropy = fogRuntime.anisotropy;
  const fogAudioReactive = fogRuntime.audioReactive;
  const materialStyle = fogRuntime.materialStyle;
  const materialStyleIndex = materialStyle === 'glass' ? 1 : materialStyle === 'hologram' ? 2 : materialStyle === 'chrome' ? 3 : materialStyle === 'halftone' ? 4 : 0;
  const layerSource = fogRuntime.source;
  const profile = React.useMemo(
    () => withCrossFamilyFogProfile(withSourceAwareFogProfile(getFogProfile(layerMode), layerSource), layerMode, layerSource),
    [layerMode, layerSource],
  );
  const globalRadius = config.sphereRadius * fogRuntime.radiusScale;

  const sliceCount = Math.max(4, Math.min(48, Math.round(fogSlices * profile.sliceMul)));
  const sliceOffsets = React.useMemo(() => {
    const depth = fogDepth * profile.depthMul;
    return Array.from({ length: sliceCount }, (_, index) => {
      if (sliceCount === 1) return 0;
      const t = index / (sliceCount - 1);
      return THREE.MathUtils.lerp(-depth * 0.5, depth * 0.5, t);
    });
  }, [sliceCount, fogDepth, profile.depthMul]);

  const sharedColor = React.useMemo(() => new THREE.Color(layerColor), [layerColor]);
  const planeScale = getVolumeFogPlaneScale(config, fogDepth);

  React.useEffect(() => {
    materialsRef.current.forEach((mat) => mat.dispose());
    materialsRef.current = [];
  }, [sliceCount, layerMode, layerSource]);

  useFrame(({ clock }) => {
    if (!rootRef.current) return;
    rootRef.current.quaternion.copy(camera.quaternion);
    const t = clock.getElapsedTime();
    const audio = config.audioEnabled
      ? (audioRef.current.pulse * 0.65 + audioRef.current.bass * 0.35) * fogAudioReactive
      : 0;

    materialsRef.current.forEach((material, index) => {
      applyVolumeFogMaterialUniforms(material, {
        sharedColor,
        fogOpacity,
        fogDensity,
        fogScale,
        fogDrift,
        fogGlow,
        fogAnisotropy,
        materialStyleIndex,
        sliceCount,
        profile,
        audio,
        time: t * (isPlaying ? 1 : 0.1),
        sliceIndex: index,
      });
    });

    sliceMeshRefs.current.forEach((mesh, index) => {
      if (!mesh) return;
      const transform = getFogSliceTransform(
        layerMode,
        layerSource,
        index,
        sliceCount,
        sliceOffsets[index] ?? 0,
        planeScale * profile.planeScaleMul,
        globalRadius,
        t * (isPlaying ? 1 : 0.25),
      );
      mesh.position.copy(transform.position);
      mesh.rotation.copy(transform.rotation);
      mesh.scale.copy(transform.scale);
    });
  });

  return {
    rootRef,
    materialsRef,
    sliceMeshRefs,
    layerMode,
    layerSource,
    profile,
    sharedColor,
    fogOpacity,
    fogDensity,
    fogDepth,
    fogScale,
    fogDrift,
    fogGlow,
    fogAnisotropy,
    materialStyleIndex,
    sliceCount,
    sliceOffsets,
    planeScale,
    globalRadius,
  };
}
