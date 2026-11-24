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
  // Parallax (Phase AZ): per-group view-shift coefficients for
  // the scene's layer families. Each group is translated by
  // (camera position − the config's default camera position) *
  // factor (lib/parallax.ts). 0 (default for all five) leaves the
  // group's wrapper at the identity, so the render is exactly the
  // legacy one; deterministic renders pin the camera to the
  // default position, so exports stay parallax-free at any value.
  parallaxLayer1: number;
  parallaxLayer2: number;
  parallaxLayer3: number;
  parallaxAmbient: number;
  parallaxGpgpu: number;

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
  // Horizon background (Phase I): the background surface is one of
  // three modes. 'solid' (default) is the legacy behaviour exactly —
  // backgroundColor tone / backgroundHex as before, and every system
  // that reads the background (scene background sync, captures,
  // stream modes) behaves as it always has. 'gradient' renders a
  // two-colour gradient (linear at an angle, or radial from the
  // centre) baked into a scene-background texture; 'image' shows a
  // user image (data URL in backgroundImageSource, downscaled by the
  // UI) as the background. The texture travels through
  // scene.background, so the existing transparent / UnMult handling
  // (which nulls or forces the scene background at capture time)
  // applies unchanged: transparent exports and the stream
  // transparent variant never see the Horizon background, and UnMult
  // still derives its matte from a forced black background. Stream
  // solid overrides (chroma key / black) also win over Horizon.
  backgroundMode: 'solid' | 'gradient' | 'image';
  backgroundGradientColorA: string;
  backgroundGradientColorB: string;
  backgroundGradientType: 'linear' | 'radial';
  /** Linear gradient direction in degrees, screen space: 0 points
   *  right (A at the left, B at the right), 90 points up (A at the
   *  bottom, B at the top). Ignored for the radial type. */
  backgroundGradientAngle: number;
  /** Background image source (data URL); empty means image mode has
   *  no image yet and the solid background shows instead (the UI
   *  states this explicitly — no silent substitution). */
  backgroundImageSource: string;
  /** 'cover' fills the frame (cropping the overflow, the default);
   *  'fit' shows the whole image with the solid background in the
   *  letterbox area. */
  backgroundImageFit: 'cover' | 'fit';
  /** Horizon image projection (Phase N): 'flat' (default) is the
   *  Phase I plane backdrop exactly — the image is baked at the
   *  frame aspect with cover/fit applied. 'equirect' treats the
   *  source as a 360° equirectangular panorama: the texture is
   *  loaded with THREE.EquirectangularReflectionMapping and set as
   *  scene.background, so three.js renders it on the inside of the
   *  background sphere and the view follows the camera (the
   *  Trapcode Horizon core behaviour). The fit key is ignored in
   *  equirect mode; a 2:1 source is recommended (other aspects are
   *  stretched over the sphere, never broken). */
  backgroundImageProjection: 'flat' | 'equirect';
  /** Equirect yaw offset in degrees (Phase N): rotates the
   *  panorama horizontally via scene.backgroundRotation.y.
   *  Default 0. Only read in equirect projection. */
  backgroundEquirectYaw: number;
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

  // Preset transition shape (Phase AW): how a preset morph
  // distributes its progress across the config keys. 'crossfade'
  // is the legacy uniform morph (the default, bit-identical);
  // the other shapes stagger the keys (lib/transitionShape.ts).
  presetTransitionShape: 'crossfade' | 'wipe' | 'dissolve' | 'circle';

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
  // Feedback mask (Phase AF): the raster mask source modulates
  // the feedback decay spatially (mask white = full decay).
  postFeedbackMaskEnabled: boolean;
  postFeedbackMaskStrength: number;
  postKaleidoscopeEnabled: boolean;
  postKaleidoscopeSegments: number;
  postKaleidoscopeRotation: number;
  // Escape-time fractal (Phase AL): a post stage rendering the
  // Mandelbrot / Julia escape-time field as a monochrome luminance
  // image, mixed over the frame. Default off = the stage is absent
  // from the stack and the output is identical to before.
  postFractalEnabled: boolean;
  postFractalKind: 'mandelbrot' | 'julia';
  postFractalCenterX: number;
  postFractalCenterY: number;
  postFractalZoom: number;
  postFractalIterations: number;
  postFractalJuliaX: number;
  postFractalJuliaY: number;
  postFractalMix: number;
  // Moire (Phase AW): a post stage overlaying two regular
  // patterns (grid / rings / lines) whose product is the moire
  // interference field — the second pattern is the first rotated
  // by Angle and shifted by Phase. Default off = the stage is
  // absent from the stack and the output is identical.
  postMoireEnabled: boolean;
  postMoirePattern: 'grid' | 'rings' | 'lines';
  postMoireSpacing: number;
  postMoireAngle: number;
  postMoirePhase: number;
  postMoireMix: number;
  // Composite (Phase AM): a two-layer composite post stage — the
  // frame blended with an AF supply texture (text-raster /
  // path-raster / edge-output) under a blend-mode group. Default
  // off = the stage is absent and the output is identical.
  postCompositeEnabled: boolean;
  postCompositeSource: string;
  postCompositeMode: 'normal' | 'multiply' | 'screen' | 'overlay' | 'soft-light' | 'difference' | 'add' | 'subtract';
  postCompositeMix: number;
  // Glitch (Phase AM): horizontal band displacement by a
  // deterministic (band, time-quantum) hash. Default off.
  postGlitchEnabled: boolean;
  postGlitchAmount: number;
  postGlitchBands: number;
  postGlitchRate: number;
  // Pixel sort (Phase AM): odd-even compare-exchange sorting of
  // the in-span pixels along rows / columns, stateless per
  // frame. Default off.
  postPixelSortEnabled: boolean;
  postPixelSortDirection: 'horizontal' | 'vertical';
  postPixelSortLow: number;
  postPixelSortHigh: number;
  postPixelSortPasses: number;
  // Discrete cellular automaton (Phase AM): a B/S rule engine
  // over a low-resolution ping-pong state texture, seeded from
  // the frame's luminance. Default off.
  postCellularEnabled: boolean;
  postCellularRule: 'life' | 'highlife' | 'daynight' | 'seeds' | 'maze' | 'coral';
  postCellularCellSize: number;
  postCellularSeedThreshold: number;
  postCellularMix: number;
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
  // Reserved palette ramp (Phase 15, ink): the output grade stage
  // remaps the finished frame into [floor, ceiling], reserving the
  // extremes of the range so highlights structurally cannot blow
  // out to pure white and shadows cannot crush to pure black.
  // Runs last in the stage (after the tone curve and the brand
  // duotone). Disabled by default — the stage stays inactive.
  postReservedPaletteEnabled: boolean;
  postReservedFloor: number;
  postReservedCeiling: number;
  // Chroma key (Phase 15, TD §6): the final delivery stage builds
  // an alpha matte from the finished frame's colour distance to
  // the key colour, with spill suppression. Disabled by default —
  // the stage is then absent and the output is bit-identical.
  // Video export stays opaque (alpha is a stills/capture feature).
  postChromaKeyEnabled: boolean;
  postChromaKeyColor: string;
  postChromaKeySimilarity: number;
  postChromaKeySmoothness: number;
  postChromaKeySpill: number;
  // Brush accumulation (Phase 15, 2D §6): the brush line ribbons
  // accumulate into a dedicated ping-pong target with a per-frame
  // decay, so strokes persist and build up. Disabled by default —
  // the stage is then absent and the output is bit-identical.
  // Live only: the deterministic renderer bypasses the composer.
  layer1BrushAccumEnabled: boolean;
  layer1BrushAccumDecay: number;
  layer1BrushAccumStrength: number;
  // Custom GLSL post (Phase BX): the user's own GLSL snippet in a
  // fullscreen post stage immediately before 'output-grade',
  // registered on the shared injection foundation
  // (lib/glslInjection.ts). The stage only exists while an
  // enabled, statically valid snippet is set; the defaults
  // (disabled / empty) keep the composer output bit-identical.
  // The luminance lock re-projects the snippet's result onto
  // luminance so colour-producing snippets cannot silently
  // dissolve the monochrome policy. Default OFF.
  postCustomGlslEnabled: boolean;
  postCustomGlslCode: string;
  postCustomGlslLumaLock: boolean;
  // Particle points vertex GLSL (Phase CD): the third injection
  // point on the shared foundation (lib/glslInjection.ts),
  // spliced into the particle points vertex shader where `pos`
  // is final, just before the model-view transform. The snippet
  // writes its displacement into `disp`. The defaults (disabled
  // / empty) keep the stock vertex shader in use as-is, so the
  // rendering stays bit-identical.
  particlePointsVertexGlslEnabled: boolean;
  particlePointsVertexGlslCode: string;
  // Particle points fragment GLSL (Phase CE): the fourth
  // injection point, spliced into the particle points fragment
  // shader at both write seams (mask branch + final write),
  // after the colour is fully determined. The snippet reads
  // vUv / vLife / vVelocity / vAlpha / uTime and writes the
  // composed `color` (vec4). Defaults keep the stock fragment
  // shader in use as-is (bit-identical rendering).
  particlePointsFragmentGlslEnabled: boolean;
  particlePointsFragmentGlslCode: string;
  // Volume fog fragment GLSL (Phase CE): the fifth injection
  // point, spliced into the volume fog fragment shader where
  // the density application completes, before the fades. The
  // snippet reads vUv / vSlice / uTime and writes `alpha`. The
  // same built shader serves every slice material. Defaults
  // keep the stock fragment shader in use as-is.
  volumeFogGlslEnabled: boolean;
  volumeFogGlslCode: string;
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
  postShineDensity: number;
  postStarglowEnabled: boolean;
  postStarglowIntensity: number;
  postStarglowLength: number;
  postStarglowThreshold: number;
  postStarglowDiagonal: boolean;
  // Shimmer (Phase M): deterministic (frame-count) glint twinkle.
  // Amount 0 (default) reproduces the legacy Starglow exactly.
  postStarglowShimmer: number;
  postStarglowShimmerSpeed: number;
  postLuxEnabled: boolean;
  postLuxIntensity: number;
  postLuxSize: number;
  postLuxConeLength: number;
  postLuxConeAngle: number;
  postLuxConeSpread: number;
  // Tone grade + edge + displace (Phase AD): five more post
  // stages in the same opt-in shape — every one defaults OFF, so
  // the stack is unchanged and the output is identical until the
  // user enables them. Posterize / ordered dither / halftone are
  // the print-style tonal finishes (lib/postFxMath.ts holds the
  // CPU twins of the shader math); edge is a Sobel pass that can
  // overlay on or replace the frame; displace warps the frame by
  // the gradient image (red/green channels by default, the
  // TouchDesigner Displace convention).
  postPosterizeEnabled: boolean;
  postPosterizeLevels: number;
  postDitherEnabled: boolean;
  postDitherStrength: number;
  // Dither mode (Phase AW): 'bayer' is the Phase AD ordered
  // dither (the default, bit-identical); 'diffusion' switches
  // the pass to a Floyd–Steinberg-style error-diffusion
  // approximation (single-pass, neighbour-error estimate — see
  // lib/postFxMath.ts; not a true sequential scan).
  postDitherMode: 'bayer' | 'diffusion';
  // Dither anchor (Phase 15, ink): 'screen' (default) indexes the
  // Bayer pattern by gl_FragCoord — the pattern is fixed to the
  // screen and the content swims under it when the camera moves.
  // 'world' offsets the pattern by the world origin's projected
  // screen position, so the pattern phase stays fixed on the
  // subject at the origin (exact under pan / zoom on the origin
  // plane, approximate under orbit rotation). Bayer mode only.
  postDitherAnchor: 'screen' | 'world';
  postHalftoneEnabled: boolean;
  postHalftoneCellSize: number;
  postHalftoneAngle: number;
  postEdgeEnabled: boolean;
  postEdgeThreshold: number;
  postEdgeMode: 'overlay' | 'only';
  postDisplaceEnabled: boolean;
  postDisplaceAmount: number;
  postDisplaceChannel: 'red-green' | 'luma' | 'red' | 'green' | 'blue';
  // Texture Pack noise generation (Phase AD): the cloud-noise
  // tile in the Tools tab is generated from these parameters.
  // The defaults reproduce the pre-AD map bit-for-bit, so every
  // existing applied texture keeps its exact values.
  textureNoiseKind: 'value' | 'ridge' | 'turbulence';
  textureNoisePeriod: number;
  textureNoiseOctaves: number;
  textureNoiseSeed: number;
  executionDiagnosticsEnabled: boolean;
  executionDiagnosticsVerbose: boolean;
  hybridSdfEnabled: boolean;
  hybridPatchEnabled: boolean;
  hybridFiberEnabled: boolean;
  hybridGranularEnabled: boolean;
  hybridMembraneEnabled: boolean;
}
