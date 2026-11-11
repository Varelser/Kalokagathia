import React from 'react';
import * as THREE from 'three';
import type { ParticleConfig } from '../types';

export type VolumeFogSystemProps = {
  config: ParticleConfig;
  layerIndex: 2 | 3;
  audioRef: React.MutableRefObject<{ bass: number; treble: number; pulse: number; bandA: number; bandB: number }>;
  isPlaying: boolean;
};

export type FogMode = ParticleConfig['layer2Type'];

export type FogProfile = {
  sliceMul: number;
  opacityMul: number;
  opacityAdd: number;
  densityMul: number;
  scaleMul: number;
  driftMul: number;
  driftAdd: number;
  glowMul: number;
  glowAdd: number;
  anisotropyAdd: number;
  planeScaleMul: number;
  depthMul: number;
  streak: number;
  grain: number;
  swirl: number;
  verticalBias: number;
  coreTightness: number;
  pulseNoise: number;
  ember: number;
  plumeAmount: number;
  fallAmount: number;
  mirageAmount: number;
  staticAmount: number;
  dustAmount: number;
  sootAmount: number;
  runeAmount: number;
  velvetAmount: number;
  ledgerAmount: number;
  edgeFade: number;
  blending: 'additive' | 'normal';
};

export type FogSliceTransform = {
  position: THREE.Vector3;
  rotation: THREE.Euler;
  scale: THREE.Vector3;
};

export type VolumeFogUniformParams = {
  sharedColor: THREE.Color;
  fogOpacity: number;
  fogDensity: number;
  fogScale: number;
  fogDrift: number;
  fogGlow: number;
  fogAnisotropy: number;
  materialStyleIndex: number;
  sliceCount: number;
  profile: FogProfile;
};
