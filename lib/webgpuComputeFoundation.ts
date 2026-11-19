import type { ParticleConfig } from '../types';

export const WEBGPU_COMPUTE_SUPPORTED_FEATURES = [
  'particles',
  'metaball',
  'volumetric',
  'smooth-tube',
  'ribbon',
  'tube',
  'trail',
  // Morph attraction joined the WGSL velocity pass in Phase R
  // (baked target cloud as a storage buffer, same force law as
  // WebGL). Before Phase R morph was not even listed as a requested
  // feature, so morph configs silently lost the force on this path.
  'morph',
  // Phase X3: the WGSL passes now carry the full WebGL force set
  // (verbatim force laws in lib/webgpuCompute.ts), including the
  // OBJ normal kick inside the morph block, so every feature below
  // is genuinely implemented on this path. Still unsupported —
  // and therefore still routing to WebGL — are 'age' (the respawn
  // lifecycle lives in the WebGL position pass), 'fluid-field'
  // (its solver is a WebGL FBO pass with no WGSL counterpart),
  // 'flip' (Phase AT: the P2G / pressure-projection passes are
  // WebGL FBO passes with no WGSL counterpart) and
  // 'custom-force' (user GLSL cannot be compiled to WGSL).
  'audio-reactive',
  'verlet',
  'nbody',
  'curl',
  'boids',
  'attractor',
  'vortex',
  'wind',
  'well',
  'elastic',
  'magnetic',
  'sph',
  'vector-field',
  'spring',
  'sdf-collider',
  'mouse-force',
  'kuramoto',
  'particle-life',
  'levy',
  'floor',
] as const;

export type WebgpuComputeFeature = typeof WEBGPU_COMPUTE_SUPPORTED_FEATURES[number];

const SUPPORTED_SET = new Set<string>(WEBGPU_COMPUTE_SUPPORTED_FEATURES);

function getRequestedGpgpuFeatures(config: ParticleConfig): string[] {
  const features: string[] = ['particles'];
  if (config.gpgpuMetaballEnabled) features.push('metaball');
  if (config.gpgpuVolumetricEnabled) features.push('volumetric');
  if (config.gpgpuSmoothTubeEnabled) features.push('smooth-tube');
  if (config.gpgpuRibbonEnabled) features.push('ribbon');
  if (config.gpgpuTubeEnabled) features.push('tube');
  if (config.gpgpuTrailEnabled) features.push('trail');
  if (config.gpgpuAudioReactive) features.push('audio-reactive');
  if (config.gpgpuAgeEnabled) features.push('age');
  if (config.gpgpuVerletEnabled) features.push('verlet');
  if (config.gpgpuNBodyEnabled) features.push('nbody');
  if (config.gpgpuCurlEnabled) features.push('curl');
  if (config.gpgpuBoidsEnabled) features.push('boids');
  if (config.gpgpuAttractorEnabled) features.push('attractor');
  if (config.gpgpuVortexEnabled) features.push('vortex');
  if (config.gpgpuWindEnabled) features.push('wind');
  if (config.gpgpuWellEnabled) features.push('well');
  if (config.gpgpuElasticEnabled) features.push('elastic');
  if (config.gpgpuMagneticEnabled) features.push('magnetic');
  if (config.gpgpuSphEnabled) features.push('sph');
  if (config.gpgpuVFieldEnabled) features.push('vector-field');
  if (config.gpgpuSpringEnabled) features.push('spring');
  if (config.gpgpuSdfEnabled) features.push('sdf-collider');
  if (config.gpgpuMouseEnabled) features.push('mouse-force');
  // Multi-touch interference (Phase AO): the WGSL passes carry a
  // single mouse position only — declaring it routes to WebGL.
  if (config.gpgpuMouseEnabled && config.gpgpuMouseMultiTouch) features.push('multi-touch');
  if (config.gpgpuFluidEnabled) features.push('fluid-field');
  if (config.gpgpuMorphEnabled) features.push('morph');
  // Phase X3 inventory: the features below exist in the WebGL
  // velocity/position shaders but were never requested here, so
  // configs using them silently lost the effect on the WebGPU
  // path (the Phase R morph bug, in four more places). Kuramoto,
  // Particle Life, Lévy and floor are implemented in WGSL as of
  // Phase X3; custom force (user GLSL) and the Aux event pools
  // (WebGL FBO passes that only run off the WebGPU path) stay
  // unsupported so those configs route to WebGL instead of
  // dropping the effect without a word.
  if (config.gpgpuKuramotoEnabled) features.push('kuramoto');
  if (config.gpgpuParticleLifeEnabled) features.push('particle-life');
  if (config.gpgpuLevyEnabled) features.push('levy');
  if (config.gpgpuFloorEnabled) features.push('floor');
  if (config.gpgpuCustomForceEnabled && (config.gpgpuCustomForceCode || '').trim().length > 0) features.push('custom-force');
  if (config.gpgpuAuxMode !== 'none') features.push('aux');
  // Phase AB lifecycle grammar: the spawn gate, the kill
  // conditions, the global drag / max speed and the two new force
  // terms live in the WebGL passes only. They are requested here
  // (and deliberately NOT added to the supported list) so a
  // WebGPU-preference config using them routes to WebGL instead
  // of silently losing the effect — the Phase R morph lesson.
  // The Aux birthBurst mode needs no entry of its own: 'aux'
  // already routes every aux config to WebGL.
  if ((config.gpgpuSpawnBurst ?? 1) < 1) features.push('spawn-gate');
  // Phase AX spawn grammar: the pulse cycle limit / probability,
  // the distance spawn order and the burst event live in the
  // WebGL passes only — same treatment as the gate above.
  if ((config.gpgpuSpawnPulseCycles ?? 0) > 0 || (config.gpgpuSpawnPulseProbability ?? 1) < 1) features.push('spawn-pulse-cycles');
  if ((config.gpgpuSpawnOrderMode ?? 'hash') !== 'hash') features.push('spawn-distance-order');
  if (config.gpgpuSpawnEventEnabled) features.push('spawn-burst-event');
  if (config.gpgpuKillBoundary || config.gpgpuKillMask) features.push('kill-conditions');
  if ((config.gpgpuMaxSpeed || 0) > 0 || Math.abs((config.gpgpuDrag ?? 1.1) - 1.1) > 1e-9) features.push('global-velocity-limit');
  if (config.gpgpuParticleLifeEnabled && (config.gpgpuParticleLifeAvoid || 0) > 0) features.push('particle-life-avoid');
  if (config.gpgpuSphEnabled && (config.gpgpuSphSurfaceTension || 0) > 0) features.push('sph-surface-tension');
  // Phase AC signal & time grammar: the sim age curves
  // (velocity / force) and a non-legacy curl evolution speed live
  // in the WebGL passes only — same treatment as Phase AB above.
  // The rotation curve needs no entry: geometry spin is a WebGL
  // draw path that never runs under WebGPU compute. Modulation
  // (internal noise / envelope / lag) is engine-level config
  // modulation and applies on every path already.
  if (config.gpgpuAgeCurveVelocityEnabled || config.gpgpuAgeCurveForceEnabled) features.push('age-curve-sim');
  if (config.gpgpuCurlEnabled && Math.abs((config.gpgpuCurlSpeed ?? 1) - 1) > 1e-9) features.push('curl-speed');
  // Phase AE terrain slope force: the downhill flow samples the
  // derived gradient bake in the WebGL velocity pass only. The
  // derived-map SUPPLY (Layer Maps / mask sources) needs no
  // entry: those are draw-path textures that resolve identically
  // on every path.
  if (config.gpgpuSlopeForceEnabled) features.push('slope-force');
  // Terrain collider (Phase AI): the collider reads the derived
  // collider bake in the sim passes, which the WGSL passes do
  // not implement — declaring it routes the session to WebGL.
  if (config.gpgpuTerrainColliderEnabled) features.push('terrain-collider');
  if (config.gpgpuMeshSdfEnabled) features.push('mesh-sdf-collider');
  // Emission curve (Phase AJ): the respawn gate lives in the
  // WebGL position pass only — declaring it routes to WebGL.
  if (config.gpgpuEmissionCurveEnabled) features.push('emission-curve');
  // Named attributes (Phase AK): the velocity-side consumers
  // (force drive / group gate) read the attribute texture in
  // the WebGL velocity pass only — declaring them routes to
  // WebGL. The draw-side drives (size / brightness) need no
  // entry: they live in the draw shader, which is WebGL on
  // every path already.
  if (config.gpgpuAttrForceSlot >= 0 && config.gpgpuAttrForceAmount !== 0) features.push('attr-force');
  if (config.gpgpuGroupEnabled) features.push('attr-group');
  // Attribute feedback (Phase BV): the feedback pass's output
  // reaches the draw-side drives on every path (the draw shader
  // is WebGL throughout, exactly as with Phase BO's dynamic
  // re-evaluation), but its SIM-side consumption — the force
  // drive / group gate reading the feedback texture — is
  // WebGL-only; on the WebGPU route those consumers keep the
  // bake (the Phase BO gap, inherited). Declared here, under
  // the same conditions as 'attr-force' / 'attr-group' above,
  // so the gap is named in the capability report instead of
  // being dropped silently.
  if (config.gpgpuAttrFeedbackEnabled
    && ((config.gpgpuAttrForceSlot >= 0 && config.gpgpuAttrForceAmount !== 0) || config.gpgpuGroupEnabled)) {
    features.push('attr-feedback');
  }
  // Wind volume (Phase AL): the placed wind localisation lives in
  // the WebGL velocity pass only — declaring it routes to WebGL.
  if (config.gpgpuWindVolumeEnabled) features.push('wind-volume');
  // Grains (Phase AQ): the DEM-style contact / friction solver
  // lives in the WebGL velocity pass only — declaring it routes
  // to WebGL (the CPU fallback treats it as a no-op, like SPH).
  if (config.gpgpuGrainsEnabled) features.push('grains');
  // Vellum (Phase AR): the constraint projection pass, the tear
  // state pass and the structured grid bake live on the WebGL
  // path only — declaring it routes to WebGL (the CPU fallback
  // treats it as a no-op, like SPH / Grains).
  if (config.gpgpuVellumEnabled) features.push('vellum');
  // Pyro (Phase AS): the temperature / buoyancy / disturbance
  // terms live in the WebGL velocity pass only — declaring it
  // routes to WebGL (the CPU fallback treats it as a no-op,
  // like SPH / Grains).
  if (config.gpgpuPyroEnabled) features.push('pyro');
  // FLIP (Phase AT): the P2G splat, pressure projection and
  // G2P transfer live on the WebGL FBO path only — declaring
  // it routes to WebGL (the CPU fallback treats it as a
  // no-op, like SPH / Grains).
  if (config.gpgpuFlipEnabled) features.push('flip');
  // Whitewater (Phase BC): the foam pool's spawn / carry passes
  // are WebGL FBO passes over the FLIP field — declaring it
  // routes to WebGL (the CPU fallback treats it as a no-op,
  // like SPH / Grains).
  if (config.gpgpuWhitewaterEnabled) features.push('whitewater');
  // Rigid bodies (Phase AU): the CPU solver + texture supply
  // live on the WebGL path only — declaring it routes to WebGL
  // (the CPU fallback treats it as a no-op, like SPH / Grains).
  if (config.gpgpuRigidEnabled) features.push('rigid-bodies');
  return features;
}

export interface WebgpuComputeCapabilityReport {
  supportedFeatures: string[];
  unsupportedFeatures: string[];
  requestedFeatures: string[];
  canRunRequestedConfig: boolean;
}

export function getWebgpuComputeCapabilityReport(config: ParticleConfig): WebgpuComputeCapabilityReport {
  const requestedFeatures = getRequestedGpgpuFeatures(config);
  const supportedFeatures = requestedFeatures.filter((feature) => SUPPORTED_SET.has(feature));
  const unsupportedFeatures = requestedFeatures.filter((feature) => !SUPPORTED_SET.has(feature));
  return {
    supportedFeatures,
    unsupportedFeatures,
    requestedFeatures,
    canRunRequestedConfig: unsupportedFeatures.length === 0,
  };
}
