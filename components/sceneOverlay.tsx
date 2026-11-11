import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { ParticleConfig } from '../types';
import { getBurstDriveEnergy } from './sceneBurstDrive';
import { SCREEN_OVERLAY_FRAGMENT_SHADER, SCREEN_OVERLAY_VERTEX_SHADER } from './sceneShaders';

export const ScreenOverlay: React.FC<{ audioRef: React.MutableRefObject<{ bass: number; treble: number; pulse: number }>; config: ParticleConfig; isPlaying: boolean; contactAmount: number; isSequencePlaying: boolean; sequenceStepProgress: number }> = ({ audioRef, config, isPlaying, contactAmount, isSequencePlaying, sequenceStepProgress }) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const screenImpactBoost = config.interLayerContactFxEnabled && config.interLayerCollisionEnabled ? contactAmount * config.interLayerContactScreenBoost : 0;
  const impactFlashAmount = config.interLayerContactFxEnabled && config.interLayerCollisionEnabled ? contactAmount : 0;
  const sequenceDriveAmount = config.screenSequenceDriveEnabled && isSequencePlaying
    ? Math.sin(Math.max(0, Math.min(1, sequenceStepProgress)) * Math.PI) * config.screenSequenceDriveStrength
    : 0;

  useFrame(({ clock }, delta) => {
    if (!meshRef.current) return;
    const material = meshRef.current.material as THREE.ShaderMaterial;
    if (isPlaying) material.uniforms.uTime.value += delta;
    const pulseDrive = config.audioEnabled ? audioRef.current.pulse * config.audioScreenScale : 0;
    const trebleDrive = config.audioEnabled ? audioRef.current.treble * config.audioJitterScale * config.audioScreenScale : 0;
    const burstDriveAmount = getBurstDriveEnergy(config, clock.getElapsedTime(), isPlaying, config.audioEnabled ? audioRef.current.pulse * config.audioBurstScale : 0) * config.screenBurstDrive;
    material.uniforms.uColor.value.set(config.particleColor);
    material.uniforms.uScanlineIntensity.value = Math.min(1.25, config.screenScanlineIntensity + screenImpactBoost * 0.18 + sequenceDriveAmount * 0.08 + pulseDrive * 0.1);
    material.uniforms.uScanlineDensity.value = config.screenScanlineDensity + sequenceDriveAmount * 180.0;
    material.uniforms.uNoiseIntensity.value = Math.min(1.5, config.screenNoiseIntensity + screenImpactBoost * 0.45 + sequenceDriveAmount * 0.18 + burstDriveAmount * config.screenBurstNoiseBoost * 0.35 + trebleDrive * 0.3);
    material.uniforms.uVignetteIntensity.value = Math.min(1.5, config.screenVignetteIntensity + screenImpactBoost * 0.35 + sequenceDriveAmount * 0.08 + burstDriveAmount * 0.06);
    material.uniforms.uPulseIntensity.value = Math.min(1.2, config.screenPulseIntensity + sequenceDriveAmount * 0.35 + burstDriveAmount * 0.28 + pulseDrive * 0.42);
    material.uniforms.uPulseSpeed.value = config.screenPulseSpeed + sequenceDriveAmount * 0.9 + burstDriveAmount * 0.42 + pulseDrive * 0.65;
    material.uniforms.uImpactFlashIntensity.value = Math.min(1.2, config.screenImpactFlashIntensity + sequenceDriveAmount * 0.16 + burstDriveAmount * config.screenBurstFlashBoost * 0.3 + pulseDrive * 0.28);
    material.uniforms.uImpactAmount.value = impactFlashAmount;
    material.uniforms.uInterferenceIntensity.value = Math.min(1.2, config.screenInterferenceIntensity + sequenceDriveAmount * 0.12 + burstDriveAmount * 0.08 + trebleDrive * 0.2);
    material.uniforms.uPersistenceIntensity.value = Math.min(1.2, config.screenPersistenceIntensity + sequenceDriveAmount * 0.2 + burstDriveAmount * 0.16 + pulseDrive * 0.16);
    material.uniforms.uPersistenceLayers.value = config.screenPersistenceLayers;
    material.uniforms.uSplitIntensity.value = Math.min(1.2, config.screenSplitIntensity + sequenceDriveAmount * 0.14 + burstDriveAmount * 0.09 + trebleDrive * 0.14);
    material.uniforms.uSplitOffset.value = config.screenSplitOffset + sequenceDriveAmount * 0.08 + burstDriveAmount * 0.03;
    material.uniforms.uSweepIntensity.value = Math.min(1.2, config.screenSweepIntensity + sequenceDriveAmount * 0.28 + burstDriveAmount * 0.22 + pulseDrive * 0.18);
    material.uniforms.uSweepSpeed.value = config.screenSweepSpeed + sequenceDriveAmount * 0.85 + burstDriveAmount * 0.45 + trebleDrive * 0.5;
  });

  if (
    config.screenScanlineIntensity <= 0.001 &&
    config.screenNoiseIntensity <= 0.001 &&
    config.screenVignetteIntensity <= 0.001 &&
    config.screenPulseIntensity <= 0.001 &&
    config.screenImpactFlashIntensity <= 0.001 &&
    config.screenBurstDrive <= 0.001 &&
    config.screenInterferenceIntensity <= 0.001 &&
    config.screenPersistenceIntensity <= 0.001 &&
    config.screenSplitIntensity <= 0.001 &&
    config.screenSweepIntensity <= 0.001 &&
    screenImpactBoost <= 0.001 &&
    (!config.audioEnabled || config.audioScreenScale <= 0.001)
  ) {
    return null;
  }

  const initialPulseDrive = config.audioEnabled ? audioRef.current.pulse * config.audioScreenScale : 0;
  const initialTrebleDrive = config.audioEnabled ? audioRef.current.treble * config.audioJitterScale * config.audioScreenScale : 0;
  const burstDriveAmount = getBurstDriveEnergy(config, 0, isPlaying, config.audioEnabled ? audioRef.current.pulse * config.audioBurstScale : 0) * config.screenBurstDrive;

  return (
    <mesh ref={meshRef} frustumCulled={false} renderOrder={999}>
      <planeGeometry args={[2, 2]} />
      <shaderMaterial
        vertexShader={SCREEN_OVERLAY_VERTEX_SHADER}
        fragmentShader={SCREEN_OVERLAY_FRAGMENT_SHADER}
        transparent={true}
        depthWrite={false}
        depthTest={false}
        uniforms={{
          uTime: { value: 0 },
          uColor: { value: new THREE.Color(config.particleColor) },
          uScanlineIntensity: { value: Math.min(1.25, config.screenScanlineIntensity + screenImpactBoost * 0.18 + sequenceDriveAmount * 0.08 + initialPulseDrive * 0.1) },
          uScanlineDensity: { value: config.screenScanlineDensity + sequenceDriveAmount * 180.0 },
          uNoiseIntensity: { value: Math.min(1.5, config.screenNoiseIntensity + screenImpactBoost * 0.45 + sequenceDriveAmount * 0.18 + burstDriveAmount * config.screenBurstNoiseBoost * 0.35 + initialTrebleDrive * 0.3) },
          uVignetteIntensity: { value: Math.min(1.5, config.screenVignetteIntensity + screenImpactBoost * 0.35 + sequenceDriveAmount * 0.08 + burstDriveAmount * 0.06) },
          uPulseIntensity: { value: Math.min(1.2, config.screenPulseIntensity + sequenceDriveAmount * 0.35 + burstDriveAmount * 0.28 + initialPulseDrive * 0.42) },
          uPulseSpeed: { value: config.screenPulseSpeed + sequenceDriveAmount * 0.9 + burstDriveAmount * 0.42 + initialPulseDrive * 0.65 },
          uImpactFlashIntensity: { value: Math.min(1.2, config.screenImpactFlashIntensity + sequenceDriveAmount * 0.16 + burstDriveAmount * config.screenBurstFlashBoost * 0.3 + initialPulseDrive * 0.28) },
          uImpactAmount: { value: impactFlashAmount },
          uInterferenceIntensity: { value: Math.min(1.2, config.screenInterferenceIntensity + sequenceDriveAmount * 0.12 + burstDriveAmount * 0.08 + initialTrebleDrive * 0.2) },
          uPersistenceIntensity: { value: Math.min(1.2, config.screenPersistenceIntensity + sequenceDriveAmount * 0.2 + burstDriveAmount * 0.16 + initialPulseDrive * 0.16) },
          uPersistenceLayers: { value: config.screenPersistenceLayers },
          uSplitIntensity: { value: Math.min(1.2, config.screenSplitIntensity + sequenceDriveAmount * 0.14 + burstDriveAmount * 0.09 + initialTrebleDrive * 0.14) },
          uSplitOffset: { value: config.screenSplitOffset + sequenceDriveAmount * 0.08 + burstDriveAmount * 0.03 },
          uSweepIntensity: { value: Math.min(1.2, config.screenSweepIntensity + sequenceDriveAmount * 0.28 + burstDriveAmount * 0.22 + initialPulseDrive * 0.18) },
          uSweepSpeed: { value: config.screenSweepSpeed + sequenceDriveAmount * 0.85 + burstDriveAmount * 0.45 + initialTrebleDrive * 0.5 },
        }}
      />
    </mesh>
  );
};
