import type { ParticleConfig } from '../types';

export type ScreenFxPreset = {
  id: string;
  label: string;
  values: Partial<Pick<ParticleConfig,
    'screenScanlineIntensity'
    | 'screenScanlineDensity'
    | 'screenNoiseIntensity'
    | 'screenVignetteIntensity'
    | 'screenPulseIntensity'
    | 'screenPulseSpeed'
    | 'screenImpactFlashIntensity'
    | 'screenInterferenceIntensity'
    | 'screenPersistenceIntensity'
    | 'screenPersistenceLayers'
    | 'screenSplitIntensity'
    | 'screenSplitOffset'
    | 'screenSweepIntensity'
    | 'screenSweepSpeed'
    | 'screenSequenceDriveEnabled'
    | 'screenSequenceDriveStrength'
  >>;
};

export const SCREEN_FX_PRESETS: ScreenFxPreset[] = [
  {
    id: 'clean',
    label: 'Clean',
    values: {
      screenScanlineIntensity: 0,
      screenNoiseIntensity: 0,
      screenVignetteIntensity: 0,
      screenPulseIntensity: 0,
      screenImpactFlashIntensity: 0,
      screenInterferenceIntensity: 0,
      screenPersistenceIntensity: 0,
      screenPersistenceLayers: 2,
      screenSplitIntensity: 0,
      screenSplitOffset: 0.35,
      screenSweepIntensity: 0,
      screenSequenceDriveEnabled: false,
      screenSequenceDriveStrength: 0.35,
    },
  },
  {
    id: 'broadcast',
    label: 'Broadcast',
    values: {
      screenScanlineIntensity: 0.42,
      screenScanlineDensity: 640,
      screenNoiseIntensity: 0.18,
      screenVignetteIntensity: 0.22,
      screenInterferenceIntensity: 0.14,
      screenPersistenceIntensity: 0.08,
      screenPersistenceLayers: 2,
      screenSplitIntensity: 0.1,
      screenSplitOffset: 0.28,
      screenSweepIntensity: 0.16,
      screenSweepSpeed: 0.65,
      screenSequenceDriveEnabled: true,
      screenSequenceDriveStrength: 0.22,
    },
  },
  {
    id: 'ghost',
    label: 'Ghost',
    values: {
      screenScanlineIntensity: 0.28,
      screenScanlineDensity: 520,
      screenNoiseIntensity: 0.1,
      screenVignetteIntensity: 0.16,
      screenPulseIntensity: 0.2,
      screenPulseSpeed: 0.9,
      screenInterferenceIntensity: 0.08,
      screenPersistenceIntensity: 0.34,
      screenPersistenceLayers: 4,
      screenSplitIntensity: 0.14,
      screenSplitOffset: 0.48,
      screenSweepIntensity: 0.2,
      screenSweepSpeed: 0.55,
      screenSequenceDriveEnabled: true,
      screenSequenceDriveStrength: 0.28,
    },
  },
  {
    id: 'surge',
    label: 'Surge',
    values: {
      screenScanlineIntensity: 0.18,
      screenScanlineDensity: 780,
      screenNoiseIntensity: 0.26,
      screenVignetteIntensity: 0.12,
      screenPulseIntensity: 0.42,
      screenPulseSpeed: 1.8,
      screenImpactFlashIntensity: 0.38,
      screenInterferenceIntensity: 0.24,
      screenPersistenceIntensity: 0.18,
      screenPersistenceLayers: 3,
      screenSplitIntensity: 0.22,
      screenSplitOffset: 0.62,
      screenSweepIntensity: 0.34,
      screenSweepSpeed: 1.1,
      screenSequenceDriveEnabled: true,
      screenSequenceDriveStrength: 0.42,
    },
  },
];
