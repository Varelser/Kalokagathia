import type { MutableRefObject } from 'react';
import type { ParticleConfig } from '../types';
import { type ParticleData } from './particleData';
import { getLayerParticleLayoutDeps, getLayerRuntimeFiberSnapshot, getLayerRuntimeMode } from '../lib/sceneRenderRouting';

export type FiberLayout = {
  particleData: ParticleData;
  sampledIndices: Uint32Array;
  strandCount: number;
};

export type FiberProfile = {
  densityBoost: number;
  lengthBase: number;
  curlBoost: number;
  tangentStretch: number;
  normalBias: number;
  bitangentBias: number;
  seedBias: number;
  verticalBias: number;
  radialLift: number;
  radialPull: number;
  planarPull: number;
  curtainAmount: number;
  braidAmount: number;
  quantize: number;
  waveAmplitude: number;
  waveFrequency: number;
  phaseSpeed: number;
  glow: number;
  bandFrequency: number;
  bandMix: number;
  prismAmount: number;
  gateAmount: number;
  shimmerScale: number;
  pulseMix: number;
  alphaMul: number;
  charAmount: number;
  canopyAmount: number;
  stormAmount: number;
  fractureAmount: number;
  droopAmount: number;
  spineAmount: number;
  fanAmount: number;
};

export type FiberAudioState = {
  bass: number;
  treble: number;
  pulse: number;
  bandA: number;
  bandB: number;
};

export type FiberFieldSystemProps = {
  config: ParticleConfig;
  layerIndex: 2 | 3;
  audioRef: MutableRefObject<FiberAudioState>;
  isPlaying: boolean;
};

export function getLayerMode(config: ParticleConfig, layerIndex: 2 | 3) {
  return getLayerRuntimeMode(config, layerIndex);
}

export function getLayerFiberSettings(config: ParticleConfig, layerIndex: 2 | 3) {
  const runtime = getLayerRuntimeFiberSnapshot(config, layerIndex);
  return {
    strandCount: runtime.strandCount,
    opacity: runtime.opacity,
    length: runtime.length,
    curl: runtime.curl,
    audioReactive: runtime.audioReactive,
    color: runtime.color,
    materialStyle: runtime.materialStyle,
    source: runtime.source,
    radiusScale: runtime.radiusScale,
  };
}

export function getLayoutDeps(config: ParticleConfig, layerIndex: 2 | 3) {
  const runtime = getLayerRuntimeFiberSnapshot(config, layerIndex);
  return getLayerParticleLayoutDeps(config, layerIndex, [runtime.strandCount]);
}
