import type { PlaneGeometry } from 'three';
import type { ParticleConfig } from '../types';

export type BrushSettings = {
  opacity: number;
  layers: number;
  scale: number;
  jitter: number;
  audioReactive: number;
  color: string;
  materialStyle: ParticleConfig['layer2MaterialStyle'];
  source: ParticleConfig['layer2Source'];
};

export type BrushMode = ParticleConfig['layer2Type'];

export type BrushSourceProfile = {
  spiralAmount: number;
  advectAmount: number;
  meltAmount: number;
  evaporateAmount: number;
  curlAmount: number;
  fanAmount: number;
  curtainAmount: number;
  widthMul: number;
  heightMul: number;
  alphaMul: number;
  trailShearAdd: number;
  rotYAdd: number;
  rotZAdd: number;
};

export type BrushProfile = {
  groupRotX: number;
  groupRotY: number;
  groupRotZ: number;
  jitterMul: number;
  ribbonDrift: number;
  smearDrift: number;
  zStretch: number;
  pulseMul: number;
  widthBase: number;
  widthMix: number;
  heightBase: number;
  heightMix: number;
  squashBase: number;
  squashOsc: number;
  baseScale: number;
  rotXMul: number;
  rotYMul: number;
  rotZMul: number;
  trailShear: number;
  edgeSoftness: number;
  streakFreq: number;
  tearFreq: number;
  bandFreq: number;
  bleedWarp: number;
  veilCurve: number;
  alphaMul: number;
  additive: boolean;
  spiralAmount: number;
  advectAmount: number;
  meltAmount: number;
  evaporateAmount: number;
  curlAmount: number;
  fanAmount: number;
  curtainAmount: number;
};

export type BrushPlane = {
  key: string;
  mix: number;
  seed: number;
  rotX: number;
  rotY: number;
  rotZ: number;
  zOffset: number;
  geometry: PlaneGeometry;
};
