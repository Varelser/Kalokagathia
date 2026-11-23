// Phase 19 stage 4 — Pyro volume raymarch system.
//
// Mounts ONLY while gpgpuPyroVolumeRender is 'raymarch' and
// the Pyro grid solver is enabled (pyroVolumeActive). With
// the default 'fog' it returns null and allocates nothing —
// the structural half of this stage's bit-identity guarantee;
// the fog layers keep rendering the field exactly as before.
//
// The draw is one box mesh over the grid domain (centre =
// origin, half-extent = the particle bounce radius, the same
// bounds the fog path publishes in uPyroGridBounds). The
// fragment shader marches the solver's scalar atlas, which
// arrives through the same PyroGridFogFeed the fog layers
// consume — published by sceneGpgpuSystem into the shared
// pyroFeedRef, so no solver change was needed. This system is
// a sibling of the GPGPU system (the grid belongs to no
// layer), mounted from AppSceneLayerContent next to it.

import React from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { ParticleConfig } from '../types';
import { PYRO_GRID_LAYOUTS, pyroGridAtlasSize, type PyroGridFogFeed } from '../lib/pyroGrid';
import {
  clampPyroVolumeDensity,
  clampPyroVolumeShadowSteps,
  pyroVolumeActive,
  resolvePyroVolumeSteps,
} from '../lib/pyroVolumeMath';
import { resolveEffectiveTierSync } from '../lib/gpuTier';
import { normalizeLightDir } from '../lib/gpgpuLight';
import { getSceneDepthSource, useSceneDepthSource } from '../lib/sceneDepth';
import { PYRO_VOLUME_FRAG, PYRO_VOLUME_VERT } from './gpgpuShaderPyroVolume';

type Props = {
  config: ParticleConfig;
  pyroFeedRef?: React.MutableRefObject<PyroGridFogFeed>;
};

/** Fixed equivalent of the fog layers' uPyroTempAmount for
 *  this layer-less global system: temperature adds
 *  uColor * min(temp, 3) * amount, the fog mapping verbatim. */
const PYRO_VOLUME_TEMP_AMOUNT = 0.5;

export const PyroVolumeSystem: React.FC<Props> = React.memo(({ config, pyroFeedRef }) => {
  const active = pyroVolumeActive(config);
  const steps = resolvePyroVolumeSteps(resolveEffectiveTierSync(), config.gpgpuPyroVolumeSteps);
  const density = clampPyroVolumeDensity(config.gpgpuPyroVolumeDensity);
  const shadowSteps = clampPyroVolumeShadowSteps(config.gpgpuPyroVolumeShadowSteps);
  const halfExtent = config.gpgpuBounceRadius;
  const lightDir = normalizeLightDir(config.gpgpuLightDirX, config.gpgpuLightDirY, config.gpgpuLightDirZ);

  const material = React.useMemo(() => {
    if (!active) return null;
    return new THREE.ShaderMaterial({
      vertexShader: PYRO_VOLUME_VERT,
      fragmentShader: PYRO_VOLUME_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.BackSide,
      uniforms: {
        uPyroAtlas: { value: null },
        uGridN: { value: 1 },
        uAtlasSize: { value: new THREE.Vector2(1, 1) },
        uAtlasTiles: { value: new THREE.Vector2(1, 1) },
        uManualTrilinear: { value: false },
        uPyroGridBounds: { value: new THREE.Vector4(0, 0, 0, halfExtent) },
        uPyroVolumeDensity: { value: density },
        uPyroVolumeSteps: { value: steps },
        uPyroVolumeShadowSteps: { value: shadowSteps },
        uPyroVolumeLightDir: { value: new THREE.Vector3(lightDir[0], lightDir[1], lightDir[2]) },
        uPyroTempAmount: { value: PYRO_VOLUME_TEMP_AMOUNT },
        uColor: { value: new THREE.Color('#e8e8e8') },
        uOpacity: { value: 1 },
        uSceneDepth: { value: null },
        uDepthReady: { value: 0 },
        uCamNear: { value: 0.1 },
        uCamFar: { value: 10000 },
        uCamForward: { value: new THREE.Vector3(0, 0, -1) },
        uResolution: { value: new THREE.Vector2(1, 1) },
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, steps, density, shadowSteps, halfExtent]);

  React.useEffect(() => () => { material?.dispose(); }, [material]);

  const geometry = React.useMemo(() => (active ? new THREE.BoxGeometry(2, 2, 2) : null), [active]);
  React.useEffect(() => () => { geometry?.dispose(); }, [geometry]);

  const depthSource = useSceneDepthSource();
  const camera = useThree((state) => state.camera);
  const gl = useThree((state) => state.gl);

  useFrame(() => {
    if (!material) return;
    const u = material.uniforms;
    const feed = pyroFeedRef?.current;
    const layout = feed?.texture ? PYRO_GRID_LAYOUTS[feed.resolution] : undefined;
    const size = feed?.texture ? pyroGridAtlasSize(feed.resolution) : null;
    if (feed?.texture && layout && size) {
      u.uPyroAtlas.value = feed.texture;
      u.uGridN.value = feed.resolution;
      (u.uAtlasSize.value as THREE.Vector2).set(size.width, size.height);
      (u.uAtlasTiles.value as THREE.Vector2).set(layout.cols, layout.rows);
      u.uManualTrilinear.value = !feed.floatLinear;
    } else {
      u.uPyroAtlas.value = null;
    }
    // Scene-depth clamp: only while the Phase 16 depth base
    // has a live source AND depth occlusion is enabled in the
    // config; otherwise uDepthReady stays 0 and the march is
    // unclamped, exactly as authored.
    const source = config.gpgpuDepthOcclusion > 0 ? (depthSource ?? getSceneDepthSource()) : null;
    if (source) {
      u.uSceneDepth.value = source.texture;
      u.uDepthReady.value = 1;
      u.uCamNear.value = source.near;
      u.uCamFar.value = source.far;
      const fwd = new THREE.Vector3();
      camera.getWorldDirection(fwd);
      (u.uCamForward.value as THREE.Vector3).copy(fwd);
      const dbSize = gl.getDrawingBufferSize(new THREE.Vector2());
      (u.uResolution.value as THREE.Vector2).set(Math.max(1, dbSize.x), Math.max(1, dbSize.y));
    } else {
      u.uSceneDepth.value = null;
      u.uDepthReady.value = 0;
    }
  });

  if (!active || !material || !geometry) return null;
  // No live feed yet (grid has not stepped): draw nothing
  // rather than a box sampled from an empty atlas. The mesh
  // stays mounted; the fragment discards on alpha 0 because
  // uPyroAtlas is null-bound only until the first feed — guard
  // here by hiding until the ref carries a texture.
  return (
    <mesh
      geometry={geometry}
      material={material}
      scale={[halfExtent, halfExtent, halfExtent]}
      frustumCulled={false}
      renderOrder={5}
    />
  );
});
PyroVolumeSystem.displayName = 'PyroVolumeSystem';
