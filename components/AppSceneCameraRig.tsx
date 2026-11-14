import React from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import type { ParticleConfig } from '../types';
import { getConfigPerformanceScore } from '../lib/performanceHints';
import { getBurstDriveEnergy } from './sceneBurstDrive';
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
}> = ({ backgroundColor, transparentBackground = false, backgroundOverrideColor }) => {
  const { gl, scene } = useThree();

  React.useEffect(() => {
    if (transparentBackground) {
      gl.setClearColor(0x000000, 0);
      scene.background = null;
      return;
    }
    const color = new THREE.Color(backgroundOverrideColor ?? backgroundColor);
    gl.setClearColor(color, 1);
    scene.background = color;
  }, [backgroundColor, backgroundOverrideColor, gl, scene, transparentBackground]);

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
