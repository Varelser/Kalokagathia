import type { ParticleConfig } from '../types';

export const APP_STATE_DEFAULT_VIEW_DISPLAY: Partial<ParticleConfig> = {
  // View & Camera
  viewMode: 'perspective',
  cameraControlMode: 'hybrid',
  renderQuality: 'balanced',
  autoLod: false,
  rotationSpeedX: 0.0005,
  rotationSpeedY: 0.001,
  manualRotationX: 0,
  manualRotationY: 0,
  manualRotationZ: 0,
  perspective: 1000,
  cameraDistance: 60,
  cameraImpulseStrength: 0,
  cameraImpulseSpeed: 1.1,
  cameraImpulseDrift: 0.2,
  cameraBurstBoost: 0.35,

  // Display
  opacity: 0.85,
  contrast: 1.0,
  particleSoftness: 0.5,
  particleGlow: 0.2,
  particleColor: 'white',
  backgroundColor: 'black',

  // Screen FX
  screenScanlineIntensity: 0.0,
  screenScanlineDensity: 420,
  screenNoiseIntensity: 0.0,
  screenVignetteIntensity: 0.0,
  screenPulseIntensity: 0.0,
  screenPulseSpeed: 1.2,
  screenImpactFlashIntensity: 0.0,
  screenBurstDrive: 0.0,
  screenBurstNoiseBoost: 0.28,
  screenBurstFlashBoost: 0.32,
  screenInterferenceIntensity: 0.0,
  screenPersistenceIntensity: 0.0,
  screenPersistenceLayers: 2,
  screenSplitIntensity: 0.0,
  screenSplitOffset: 0.35,
  screenSweepIntensity: 0.0,
  screenSweepSpeed: 0.8,
  screenSequenceDriveEnabled: false,
  screenSequenceDriveStrength: 0.35,
};
