import { BackgroundTone, CameraControlMode, InterLayerCollisionMode, ParticleTone, RenderQuality } from './scene';

export interface ParticleConfigCore {
  viewMode: 'perspective' | 'orthographic';
  cameraControlMode: CameraControlMode;
  // Global playback time scale (Kinetix integration B3, Kinetix
  // timeScale): multiplies the frame delta of the layer particle
  // systems and the GPGPU simulation in realtime playback. Negative
  // values run those systems backwards. 1 (default) is the exact
  // legacy behaviour. The deterministic renderer locks the scale to
  // 1 while a job runs (see lib/playbackTime.ts), so fixed-timestep
  // exports are never affected by this key.
  timeScale: number;
  renderQuality: RenderQuality;
  autoLod: boolean;
  rotationSpeedX: number;
  rotationSpeedY: number;
  manualRotationX: number;
  manualRotationY: number;
  manualRotationZ: number;

  perspective: number;
  cameraDistance: number;
  cameraImpulseStrength: number;
  cameraImpulseSpeed: number;
  cameraImpulseDrift: number;
  cameraBurstBoost: number;

  opacity: number;
  contrast: number;
  particleSoftness: number;
  particleGlow: number;
  screenScanlineIntensity: number;
  screenScanlineDensity: number;
  screenNoiseIntensity: number;
  screenVignetteIntensity: number;
  screenPulseIntensity: number;
  screenPulseSpeed: number;
  screenImpactFlashIntensity: number;
  screenBurstDrive: number;
  screenBurstNoiseBoost: number;
  screenBurstFlashBoost: number;
  screenInterferenceIntensity: number;
  screenPersistenceIntensity: number;
  screenPersistenceLayers: number;
  screenSplitIntensity: number;
  screenSplitOffset: number;
  screenSweepIntensity: number;
  screenSweepSpeed: number;
  screenSequenceDriveEnabled: boolean;
  screenSequenceDriveStrength: number;
  interLayerCollisionEnabled: boolean;
  interLayerCollisionStrength: number;
  interLayerCollisionPadding: number;
  interLayerCollisionMode: InterLayerCollisionMode;
  interLayerAudioReactive: boolean;
  interLayerAudioBoost: number;
  interLayerContactFxEnabled: boolean;
  interLayerContactGlowBoost: number;
  interLayerContactSizeBoost: number;
  interLayerContactLineBoost: number;
  interLayerContactScreenBoost: number;
  particleColor: ParticleTone;
  backgroundColor: BackgroundTone;
  // Arbitrary background colour (Kinetix integration B2): a hex string
  // such as '#060c1a'. Empty string (default) means the backgroundColor
  // tone rules exactly as before; when set it only changes the rendered
  // background surface (scene clear / fog tint / capture), while tone
  // logic (contrast normalisation, blend selection) keeps following
  // backgroundColor.
  backgroundHex: string;
  depthFogEnabled: boolean;
  depthFogNear: number;
  depthFogFar: number;
  exportScale: number;
  exportTransparent: boolean;
  // Deterministic render background (Pro-1.1): 'opaque' is the legacy
  // export exactly; 'transparent' is the conventional PostFx-off matte;
  // 'unmult' keeps the full PostFx render on black and derives a
  // straight-alpha matte at capture time (lib/unmult.ts). This is an
  // export preference only — no scene system reads it — and the
  // deterministic render UI passes it to the render job.
  deterministicBackgroundMode: 'opaque' | 'transparent' | 'unmult';

  // SDF Particle Shape & Pseudo-3D Lighting
  sdfShapeEnabled: boolean;
  sdfShape: 'sphere' | 'ring' | 'star' | 'hexagon' | 'diamond' | 'flare' | 'cloud' | 'bokeh' | 'crosshair' | 'iris' | 'lightning';
  sdfLightX: number;
  sdfLightY: number;
  sdfSpecularIntensity: number;
  sdfSpecularShininess: number;
  sdfAmbientLight: number;

  // Post Processing
  postFxStackProfile: 'manual' | 'touch-feedback' | 'particular-glow' | 'retro-feedback' | 'dream-smear';
  postBloomEnabled: boolean;
  postBloomIntensity: number;
  postBloomRadius: number;
  postBloomThreshold: number;
  postChromaticAberrationEnabled: boolean;
  postChromaticAberrationOffset: number;
  postDofEnabled: boolean;
  postDofFocusDistance: number;
  postDofFocalLength: number;
  postDofBokehScale: number;
  postNoiseEnabled: boolean;
  postNoiseOpacity: number;
  postVignetteEnabled: boolean;
  postVignetteOffset: number;
  postVignetteDarkness: number;
  postBrightnessContrastEnabled: boolean;
  postBrightness: number;
  postContrastAmount: number;
  postFeedbackEnabled: boolean;
  postFeedbackDecay: number;
  postFeedbackZoom: number;
  postFeedbackRotation: number;
  postKaleidoscopeEnabled: boolean;
  postKaleidoscopeSegments: number;
  postKaleidoscopeRotation: number;
  postSlitScanEnabled: boolean;
  postSlitScanBands: number;
  postSlitScanCycle: number;
  // Radial Blur (Kinetix integration B2): CinemaLens-style radial zoom
  // blur as its own post stage. Default off.
  postRadialBlurEnabled: boolean;
  postRadialBlurStrength: number;
  // Output grade (Kinetix integration B2): exposure multiplier and an
  // optional ACES filmic curve applied by the final post stage. The
  // defaults (1.0 / 'legacy') keep the stage inactive, so the output is
  // byte-identical to before.
  postExposure: number;
  postToneMapping: 'legacy' | 'aces';
  // Brand monochrome (Pro-2): a single-colour duotone in the same
  // final output-grade stage — luminance is remapped through a
  // black -> brand colour -> white ramp whose midpoint tracks the
  // brand colour's own luminance. Opt-in per project; the defaults
  // (disabled) keep the stage inactive and the output unchanged.
  postBrandColorEnabled: boolean;
  postBrandColor: string;
  // LightFX (Phase D): Trapcode Shine / Starglow / Lux equivalents as
  // a single post stage. One shared light-source position (UV) feeds
  // the Shine ray centre and the Lux source. Every sub-effect defaults
  // OFF; with all three off the stage is not inserted at all and the
  // output is identical to before. Monochrome by construction — the
  // streaks/glints are extracted from the frame's own highlights, so
  // they inherit whatever colour the existing paths (gradient / brand)
  // already produced; the Lux source itself is neutral white.
  postLightX: number;
  postLightY: number;
  postShineEnabled: boolean;
  postShineIntensity: number;
  postShineLength: number;
  postShineThreshold: number;
  postStarglowEnabled: boolean;
  postStarglowIntensity: number;
  postStarglowLength: number;
  postStarglowThreshold: number;
  postStarglowDiagonal: boolean;
  postLuxEnabled: boolean;
  postLuxIntensity: number;
  postLuxSize: number;
  postLuxConeLength: number;
  postLuxConeAngle: number;
  postLuxConeSpread: number;
  executionDiagnosticsEnabled: boolean;
  executionDiagnosticsVerbose: boolean;
  hybridSdfEnabled: boolean;
  hybridPatchEnabled: boolean;
  hybridFiberEnabled: boolean;
  hybridGranularEnabled: boolean;
  hybridMembraneEnabled: boolean;
}
