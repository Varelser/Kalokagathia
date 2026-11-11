import type { ParticleConfig } from './config';

export type SequenceTransitionEasing = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out';

export type SequenceDriveMode = 'inherit' | 'on' | 'off';

export type SequenceDriveStrengthMode = 'inherit' | 'override';

export interface PresetSequenceItem {
  id: string;
  presetId: string;
  label: string;
  holdSeconds: number;
  transitionSeconds: number;
  transitionEasing: SequenceTransitionEasing;
  screenSequenceDriveMode: SequenceDriveMode;
  screenSequenceDriveStrengthMode: SequenceDriveStrengthMode;
  screenSequenceDriveStrengthOverride: number | null;
  screenSequenceDriveMultiplier: number;
  keyframeConfig?: ParticleConfig | null;
}
