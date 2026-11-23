import React from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import type { ParticleConfig } from '../types';
import { getConfigPerformanceScore } from '../lib/performanceHints';
import { isCameraDeterminismLocked } from '../lib/cameraDeterminism';
import { getBurstDriveEnergy } from './sceneBurstDrive';
import { applySceneEnvIntensityToMaterials, createPmremEnvironmentFromEquirect, resolveIblEnvironment, shouldApplySceneEnvironment } from '../lib/iblEnvironment';
import type { SceneAudioRef } from './AppSceneTypes';

function getQualityDprRange(quality: ParticleConfig['renderQuality']) {
  if (quality === 'draft') return [1, 1.25] as [number, number];
  if (quality === 'cinematic') return [1, 2] as [number, number];
  return [1, 1.5] as [number, number];
}

export function getAdaptiveDprRange(config: ParticleConfig) {
  const [minDpr, maxDpr] = getQualityDprRange(config.renderQuality);
  const score = getConfigPerformanceScore(config);
  if (score >= 10) return [1, Math.min(1.1, maxDpr)] as [number, number];
  if (score >= 7) return [1, Math.min(1.25, maxDpr)] as [number, number];
  if (score >= 5) return [minDpr, Math.min(1.35, maxDpr)] as [number, number];
  return [minDpr, maxDpr] as [number, number];
}

export function shouldUseAntialias(config: ParticleConfig) {
  return config.renderQuality !== 'draft' && getConfigPerformanceScore(config) < 7.5;
}

function getDefaultCameraPosition(config: ParticleConfig) {
  if (config.viewMode === 'orthographic') {
    return new THREE.Vector3(0, 0, 500);
  }
  return new THREE.Vector3(0, 0, config.cameraDistance + 200);
}

export const SceneBackgroundSync: React.FC<{
  backgroundColor: ParticleConfig['backgroundColor'];
  /** Stream mode (Phase 8): keep the framebuffer transparent — no
   *  scene background, clear alpha 0 — so a compositor (OBS) can lay
   *  the canvas over other sources. */
  transparentBackground?: boolean;
  /** Stream chroma variants: solid background colour in place of the
   *  config tone. */
  backgroundOverrideColor?: string;
  /** Horizon background (Phase I): while a gradient / image
   *  background is active, components/HorizonBackground.tsx owns
   *  scene.background; this sync then only keeps the renderer's
   *  clear colour on the legacy colour (the fallback seen before
   *  the background texture is ready, and the letterbox base). */
  horizonActive?: boolean;
}> = ({ backgroundColor, transparentBackground = false, backgroundOverrideColor, horizonActive = false }) => {
  const { gl, scene } = useThree();

  React.useEffect(() => {
    if (transparentBackground) {
      gl.setClearColor(0x000000, 0);
      scene.background = null;
      return;
    }
    const color = new THREE.Color(backgroundOverrideColor ?? backgroundColor);
    gl.setClearColor(color, 1);
    if (!horizonActive) {
      scene.background = color;
    }
  }, [backgroundColor, backgroundOverrideColor, gl, horizonActive, scene, transparentBackground]);

  return null;
};

export const SceneEnvironmentSync: React.FC<{ config: ParticleConfig }> = ({ config }) => {
  const { gl, scene } = useThree();
  const handleRef = React.useRef<ReturnType<typeof createPmremEnvironmentFromEquirect>>(null);
  const sourceRef = React.useRef<unknown>(null);
  const intensity = config.gpgpuSceneEnvIntensity ?? 0;

  React.useEffect(() => {
    // Intensity 0 (default): never wire scene.environment — the
    // v1.97.0 state. Any previously created PMREM target is freed.
    if (!shouldApplySceneEnvironment(intensity)) {
      handleRef.current?.dispose();
      handleRef.current = null;
      sourceRef.current = null;
      if (scene.environment) scene.environment = null;
      return;
    }
    const env = resolveIblEnvironment(config);
    if (!env.texture) return;
    if (sourceRef.current !== env.texture || !handleRef.current) {
      handleRef.current?.dispose();
      handleRef.current = createPmremEnvironmentFromEquirect(gl, env.texture);
      sourceRef.current = env.texture;
    }
    if (handleRef.current) {
      scene.environment = handleRef.current.texture;
      applySceneEnvIntensityToMaterials(scene, intensity);
    }
  }, [config, gl, intensity, scene]);

  // Materials mount after the effect above; re-apply the intensity
  // periodically while active so late-mounted Standard materials
  // pick it up. Inert (early return) at intensity 0.
  const frameRef = React.useRef(0);
  useFrame(() => {
    if (!shouldApplySceneEnvironment(intensity)) return;
    frameRef.current += 1;
    if (frameRef.current % 30 === 0) applySceneEnvIntensityToMaterials(scene, intensity);
  });

  React.useEffect(() => () => {
    handleRef.current?.dispose();
    handleRef.current = null;
  }, []);

  return null;
};

export const CameraImpulseRig: React.FC<{
  audioRef: SceneAudioRef;
  config: ParticleConfig;
  controlsRef: React.MutableRefObject<OrbitControlsImpl | null>;
  isInteractingRef: React.MutableRefObject<boolean>;
  isPlaying: boolean;
}> = ({ audioRef, config, controlsRef, isInteractingRef, isPlaying }) => {
  const { camera } = useThree();
  const basePositionRef = React.useRef(getDefaultCameraPosition(config));
  const baseTargetRef = React.useRef(new THREE.Vector3(0, 0, 0));
  const baseFovRef = React.useRef('fov' in camera ? camera.fov : 50);
  const baseZoomRef = React.useRef('zoom' in camera ? camera.zoom : 1);
  const baseModeRef = React.useRef(config.viewMode);
  const baseDistanceRef = React.useRef(config.cameraDistance);
  const initializedRef = React.useRef(false);

  useFrame(({ clock }) => {
    if (config.cameraControlMode === 'manual') {
      return;
    }
    if (isCameraDeterminismLocked()) {
      // Deterministic export in progress (Phase G): pin the camera to the
      // config's canonical framing — the position / target a fresh load
      // shows — and apply no impulse, drift or fov terms. The rig's normal
      // time source (clock.getElapsedTime()) is wall-clock driven, so
      // without this pin identical exports rendered from different camera
      // distances run to run. The base refs are re-synced to the canonical
      // values so the first live frame after the job does not snap.
      const canonical = getDefaultCameraPosition(config);
      basePositionRef.current.copy(canonical);
      baseTargetRef.current.set(0, 0, 0);
      baseModeRef.current = config.viewMode;
      baseDistanceRef.current = config.cameraDistance;
      initializedRef.current = true;
      camera.position.copy(canonical);
      if (controlsRef.current) {
        controlsRef.current.target.set(0, 0, 0);
        controlsRef.current.update();
      } else {
        camera.lookAt(0, 0, 0);
      }
      if ('fov' in camera && config.viewMode !== 'orthographic') {
        const canonicalFov = config.perspective / 20;
        if (Math.abs(camera.fov - canonicalFov) > 1e-6) {
          camera.fov = canonicalFov;
          camera.updateProjectionMatrix();
        }
        baseFovRef.current = canonicalFov;
      } else if ('zoom' in camera && config.viewMode === 'orthographic') {
        const canonicalZoom = Math.max(1, 1500 / Math.max(10, config.cameraDistance));
        if (Math.abs(camera.zoom - canonicalZoom) > 1e-6) {
          camera.zoom = canonicalZoom;
          camera.updateProjectionMatrix();
        }
        baseZoomRef.current = canonicalZoom;
      }
      return;
    }
    const t = clock.getElapsedTime();
    const controls = controlsRef.current;
    const impulse = config.cameraImpulseStrength;
    const cameraAudioInput = config.audioEnabled
      ? (audioRef.current.bass * config.audioBeatScale + audioRef.current.pulse * config.audioBurstScale * 0.65) * config.audioCameraScale
      : 0;
    const burstEnergy = getBurstDriveEnergy(config, t, isPlaying, config.audioEnabled ? audioRef.current.pulse * config.audioBurstScale : 0);
    const needsSync =
      !initializedRef.current ||
      isInteractingRef.current ||
      baseModeRef.current !== config.viewMode ||
      Math.abs(baseDistanceRef.current - config.cameraDistance) > 0.001;
    if (needsSync) {
      initializedRef.current = true;
      basePositionRef.current.copy(
        config.cameraControlMode === 'auto'
          ? getDefaultCameraPosition(config)
          : camera.position,
      );
      baseTargetRef.current.copy(controls?.target ?? new THREE.Vector3(0, 0, 0));
      if ('fov' in camera) baseFovRef.current = camera.fov;
      if ('zoom' in camera) baseZoomRef.current = camera.zoom;
      baseModeRef.current = config.viewMode;
      baseDistanceRef.current = config.cameraDistance;
    }
    if ((impulse <= 0 && config.cameraBurstBoost <= 0) || isInteractingRef.current) {
      return;
    }
    const audioBoost = cameraAudioInput;
    const rawStrength = impulse * (1 + audioBoost * 0.65) + burstEnergy * config.cameraBurstBoost * 0.55;
    const strength = THREE.MathUtils.clamp(rawStrength, 0, 2);
    const speed = Math.max(0.05, config.cameraImpulseSpeed) * (isPlaying ? 1 : 0.25);
    const drift = config.cameraImpulseDrift;
    camera.position.copy(basePositionRef.current);
    camera.position.x += Math.sin(t * speed) * strength * 28;
    camera.position.y += Math.cos(t * speed * 0.83) * strength * 18;
    camera.position.z += Math.sin(t * speed * 0.47) * drift * 60;
    if (controls) {
      controls.target.copy(baseTargetRef.current);
      controls.update();
    } else {
      camera.lookAt(baseTargetRef.current);
    }
    if ('fov' in camera && config.viewMode !== 'orthographic') {
      camera.fov = baseFovRef.current + Math.sin(t * speed * 0.6) * strength * 0.8;
      camera.updateProjectionMatrix();
    } else if ('zoom' in camera && config.viewMode === 'orthographic') {
      camera.zoom = Math.max(1, baseZoomRef.current + Math.sin(t * speed * 0.6) * drift * 0.6);
      camera.updateProjectionMatrix();
    }
  });

  return null;
};
