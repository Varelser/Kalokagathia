import React from 'react';
import * as THREE from 'three';
import type { ParticleConfig } from '../types';
import type { PointCloudCaptureState } from '../lib/pointCloudExport';

export type SceneAudioLevels = {
  bass: number;
  treble: number;
  pulse: number;
  bandA: number;
  bandB: number;
  sub: number;
  low: number;
  mid: number;
  high: number;
  presence: number;
  level: number;
};

export type SceneAudioRef = React.MutableRefObject<SceneAudioLevels>;

export type AppSceneProps = {
  audioRef: SceneAudioRef;
  config: ParticleConfig;
  interLayerContactAmount: number;
  isPlaying: boolean;
  isSequencePlaying: boolean;
  rendererRef: React.MutableRefObject<THREE.WebGLRenderer | null>;
  saveTrigger: number;
  sequenceStepProgress: number;
  pointCloudCaptureRef?: React.RefObject<PointCloudCaptureState>;
  /** Stream mode (Phase 8, lib/streamMode): render onto a transparent
   *  matte — the WebGL context is created with alpha:true, the clear
   *  alpha is 0, no scene background is attached and PostFx is NOT
   *  mounted (the custom post passes force alpha to 1.0, so the
   *  composer chain cannot carry a matte). Default false: every other
   *  mode renders exactly as before. */
  transparentBackground?: boolean;
  /** Stream chroma variants: paint this solid colour as the scene
   *  background instead of the config tone (config backgroundColor is
   *  only 'black' | 'white', so a key green cannot travel through the
   *  config). PostFx stays mounted over the solid colour. Ignored when
   *  transparentBackground is set. */
  backgroundOverrideColor?: string;
};
