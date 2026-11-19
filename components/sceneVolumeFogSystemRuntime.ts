import React from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { withCrossFamilyFogProfile, withSourceAwareFogProfile } from '../lib/sourceAwareShaping';
import { getFogProfile } from './sceneVolumeFogSystemProfiles';
import { getFogSliceTransform } from './sceneVolumeFogSystemTransforms';
import { applyVolumeFogMaterialUniforms, getVolumeFogPlaneScale } from './sceneVolumeFogSystemMaterial';
import { buildVolumeFogShader, FRAGMENT_SHADER } from './sceneVolumeFogSystemShaders';
import { compileCheckShader } from '../lib/glslInjection';
import {
  buildVolumeFogHarness,
  VOLUME_FOG_CHECK_VERTEX,
  setVolumeFogGlslStatus,
  validateVolumeFogGlslCode,
} from '../lib/volumeFogGlsl';
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
  pyroDensityAmount: number;
  pyroTempAmount: number;
  // The effective fog fragment shader (Phase CE): the stock
  // FRAGMENT_SHADER unless a validated snippet was built into
  // it; every slice material is created from this one string.
  fogFragmentShader: string;
};

export function useVolumeFogRuntime({ config, layerIndex, audioRef, isPlaying, pyroFeedRef }: VolumeFogSystemProps): VolumeFogRuntimeState {
  const { camera } = useThree();
  const gl = useThree((state) => state.gl);
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

  // Volume fog fragment GLSL (Phase CE): validate +
  // compile-check the snippet against the live GL context, and
  // only then swap the built fragment shader in. On any failure
  // the previously working shader stays active and the panel
  // shows the error via the point's status store — the shared
  // injection fallback rule. While disabled / empty the stock
  // shader string is used as-is. When the effective string
  // changes, the render component disposes the slice
  // materials and recreates them from the new string (see the
  // reset there), so every slice always runs the same shader.
  const [fogFragmentShader, setFogFragmentShader] = React.useState(FRAGMENT_SHADER);
  const appliedFogCodeRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    const code = config.volumeFogGlslEnabled ? config.volumeFogGlslCode : '';
    if (!code.trim()) {
      if (appliedFogCodeRef.current !== null) {
        setFogFragmentShader(FRAGMENT_SHADER);
        appliedFogCodeRef.current = null;
      }
      setVolumeFogGlslStatus({ state: 'inactive' });
      return;
    }
    if (appliedFogCodeRef.current === code) return;
    const validation = validateVolumeFogGlslCode(code);
    if (!validation.ok) {
      setVolumeFogGlslStatus({ state: 'error', message: validation.error ?? 'invalid code' });
      return;
    }
    const check = compileCheckShader(
      gl.getContext() as WebGL2RenderingContext,
      VOLUME_FOG_CHECK_VERTEX,
      buildVolumeFogHarness(code),
    );
    if (!check.ok) {
      setVolumeFogGlslStatus({ state: 'error', message: check.error ?? 'compile failed' });
      return;
    }
    setFogFragmentShader(buildVolumeFogShader(code));
    appliedFogCodeRef.current = code;
    setVolumeFogGlslStatus({ state: 'active' });
  }, [config.volumeFogGlslEnabled, config.volumeFogGlslCode, gl]);

  // Note: the slice materials are NOT disposed from an effect
  // here. They are created from materialsRef during the render
  // component's render, so clearing the ref in an effect (the
  // first CE arrangement) left the meshes rendering the
  // disposed previous materials — no further render was
  // guaranteed to follow the effect, and in a settled live
  // session the second and later swaps never reached the
  // screen (caught by the Phase CE iMac gate's linked-program
  // recording). The render component resets the ref during
  // its own render when the effective shader changes.

  useFrame(({ clock }) => {
    if (!rootRef.current) return;
    rootRef.current.quaternion.copy(camera.quaternion);
    const t = clock.getElapsedTime();
    const audio = config.audioEnabled
      ? (audioRef.current.pulse * 0.65 + audioRef.current.bass * 0.35) * fogAudioReactive
      : 0;

    const pyroFeed = pyroFeedRef?.current;
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
        pyroTexture: pyroFeed?.texture ?? null,
        pyroResolution: pyroFeed?.resolution ?? 0,
        pyroFloatLinear: pyroFeed?.floatLinear ?? false,
        pyroDensityAmount: fogRuntime.pyroDensityAmount,
        pyroTempAmount: fogRuntime.pyroTempAmount,
        pyroHalfExtent: config.gpgpuBounceRadius,
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
    pyroDensityAmount: fogRuntime.pyroDensityAmount,
    pyroTempAmount: fogRuntime.pyroTempAmount,
    fogFragmentShader,
  };
}
