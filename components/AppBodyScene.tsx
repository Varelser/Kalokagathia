import React from 'react';
import * as THREE from 'three';
import { AppRootLayout } from './AppRootLayout';
import type { ControlPanelProps } from './controlPanelTypes';
import type { ParticleConfig } from '../types';
import type { PointCloudCaptureState } from '../lib/pointCloudExport';
import type { AudioLevels } from '../lib/audioControllerTypes';

type AppBodySceneProps = {
  audioRef: React.MutableRefObject<AudioLevels>;
  compareConfig: ParticleConfig | null;
  comparePreviewEnabled: boolean;
  comparePreviewOrientation: 'vertical' | 'horizontal';
  comparePreviewSlotIndex: number;
  config: ParticleConfig;
  controlPanelProps: ControlPanelProps;
  displayConfig: ParticleConfig;
  isPlaying: boolean;
  isSequencePlaying: boolean;
  rendererRef: React.MutableRefObject<THREE.WebGLRenderer | null>;
  saveTrigger: number;
  sequenceStepProgress: number;
  pointCloudCaptureRef: React.RefObject<PointCloudCaptureState>;
};

export const AppBodyScene: React.FC<AppBodySceneProps> = (props) => <AppRootLayout {...props} />;
