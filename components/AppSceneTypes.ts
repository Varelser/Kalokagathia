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
};
