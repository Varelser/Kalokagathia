import type { ParticleConfig } from '../types';

export const APP_STATE_DEFAULT_VIEW_DISPLAY: Partial<ParticleConfig> = {
  // View & Camera
  viewMode: 'perspective',
  timeScale: 1,
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
  // Parallax (Phase AZ): all five group factors default to 0 —
  // no group shifts and the render is the legacy one exactly.
  parallaxLayer1: 0,
  parallaxLayer2: 0,
  parallaxLayer3: 0,
  parallaxAmbient: 0,
  parallaxGpgpu: 0,

  // Display
  opacity: 0.85,
  contrast: 1.0,
  particleSoftness: 0.5,
  particleGlow: 0.2,
  particleColor: 'white',
  // Particle points vertex GLSL (Phase CD): disabled / empty —
  // the stock vertex shader is used unchanged.
  particlePointsVertexGlslEnabled: false,
  particlePointsVertexGlslCode: '',
  // Particle points fragment GLSL (Phase CE): disabled / empty
  // — the stock fragment shader is used unchanged.
  particlePointsFragmentGlslEnabled: false,
  particlePointsFragmentGlslCode: '',
  // Volume fog fragment GLSL (Phase CE): disabled / empty —
  // the stock fog fragment shader is used unchanged.
  volumeFogGlslEnabled: false,
  volumeFogGlslCode: '',
  backgroundColor: 'black',
  backgroundHex: '',
  // Horizon background (Phase I): 'solid' is the legacy background
  // exactly. The gradient defaults are a monochrome black -> dark
  // grey vertical fade (angle 90 = A at the bottom, B at the top).
  backgroundMode: 'solid',
  backgroundGradientColorA: '#000000',
  backgroundGradientColorB: '#232830',
  backgroundGradientType: 'linear',
  backgroundGradientAngle: 90,
  backgroundImageSource: '',
  backgroundImageFit: 'cover',
  // Horizon projection (Phase N): 'flat' is the Phase I plane
  // backdrop exactly; 'equirect' is the 360° panorama.
  backgroundImageProjection: 'flat',
  backgroundEquirectYaw: 0,

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
