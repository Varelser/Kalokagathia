import type { ParticleConfig } from '../types';
import { getProceduralFeatureTag } from './proceduralModeRegistry';
import { normalizeSourceFamily, uniqueNonEmpty } from './depictionCoverageLayerResolvers';

export function getActiveGpgpuFeatures(config: ParticleConfig) {
  if (!config.gpgpuEnabled) return [];

  return uniqueNonEmpty([
    'gpu-particles',
    config.gpgpuTrailEnabled ? 'trail' : null,
    config.gpgpuRibbonEnabled ? 'ribbon' : null,
    config.gpgpuTubeEnabled ? 'tube' : null,
    config.gpgpuSmoothTubeEnabled ? 'smooth-tube' : null,
    config.gpgpuMetaballEnabled ? 'metaball' : null,
    config.gpgpuVolumetricEnabled ? 'volumetric' : null,
    config.gpgpuBoidsEnabled ? 'boids' : null,
    config.gpgpuFluidEnabled ? 'fluid' : null,
    config.gpgpuWebGPUEnabled ? 'webgpu' : null,
    config.gpgpuSortEnabled ? 'gpu-sort' : null,
    config.gpgpuCurlEnabled ? 'curl' : null,
    config.gpgpuAttractorEnabled ? `attractor-${config.gpgpuAttractorType}` : null,
    config.gpgpuVortexEnabled ? 'vortex' : null,
    config.gpgpuWindEnabled ? 'wind' : null,
    config.gpgpuWellEnabled ? 'gravity-well' : null,
    config.gpgpuElasticEnabled ? 'elastic' : null,
    config.gpgpuMagneticEnabled ? 'magnetic' : null,
    config.gpgpuSphEnabled ? 'sph' : null,
    config.gpgpuVFieldEnabled ? `vector-field-${config.gpgpuVFieldType}` : null,
    config.gpgpuSpringEnabled ? 'spring' : null,
    config.gpgpuVerletEnabled ? 'verlet' : null,
    config.gpgpuSdfEnabled ? `sdf-${config.gpgpuSdfShape}` : null,
    config.gpgpuMouseEnabled ? `mouse-${config.gpgpuMouseMode}` : null,
    config.gpgpuAgeEnabled ? 'age' : null,
    config.gpgpuAgeColorEnabled ? 'age-color' : null,
    config.gpgpuAgeSizeEnabled ? 'age-size' : null,
    config.gpgpuVelColorEnabled ? 'velocity-color' : null,
    config.gpgpuAudioReactive ? 'audio-reactive' : null,
    config.gpgpuNBodyEnabled ? 'n-body' : null,
  ]);
}

export function getActiveGpgpuDepictionMethods(config: ParticleConfig) {
  if (!config.gpgpuEnabled) return [];

  return uniqueNonEmpty([
    'gpu-particles',
    config.gpgpuGeomMode !== 'point' ? 'gpu-instanced-solids' : null,
    config.gpgpuStreakEnabled ? 'gpu-streak-lines' : null,
    config.gpgpuRibbonEnabled ? 'gpu-ribbons' : null,
    config.gpgpuTubeEnabled ? 'gpu-tubes' : null,
    config.gpgpuSmoothTubeEnabled ? 'gpu-smooth-tubes' : null,
    config.gpgpuMetaballEnabled ? 'gpu-metaballs' : null,
    config.gpgpuVolumetricEnabled ? 'gpu-volumetric' : null,
  ]);
}

export function getActiveGpgpuMotionFamilies(config: ParticleConfig) {
  if (!config.gpgpuEnabled) return [];

  return uniqueNonEmpty([
    'particles',
    config.gpgpuBoidsEnabled ? 'swarm' : null,
    config.gpgpuFluidEnabled || config.gpgpuSphEnabled ? 'fluid' : null,
    config.gpgpuCurlEnabled || config.gpgpuVortexEnabled ? 'vortex' : null,
    config.gpgpuAttractorEnabled ? 'chaos' : null,
    config.gpgpuWindEnabled || config.gpgpuVFieldEnabled || config.gpgpuWellEnabled ? 'field' : null,
    config.gpgpuElasticEnabled || config.gpgpuSpringEnabled || config.gpgpuVerletEnabled ? 'elastic' : null,
    config.gpgpuElasticEnabled || config.gpgpuSpringEnabled || config.gpgpuVerletEnabled ? 'structure' : null,
    config.gpgpuMagneticEnabled ? 'magnetic' : null,
    config.gpgpuSdfEnabled || config.gpgpuMouseEnabled ? 'collision' : null,
    config.gpgpuAudioReactive ? 'oscillation' : null,
    (['ring', 'disc', 'cone'].includes(config.gpgpuEmitShape) && (config.gpgpuVortexEnabled || config.gpgpuWellEnabled || config.gpgpuAttractorEnabled)) ? 'orbit' : null,
    (config.gpgpuMouseEnabled || config.gpgpuAgeColorEnabled || config.gpgpuAgeSizeEnabled) ? 'transform' : null,
    config.gpgpuMetaballEnabled || config.gpgpuVolumetricEnabled ? 'volumetric' : null,
    config.gpgpuNBodyEnabled ? 'n-body' : null,
  ]);
}

export function getActiveGpgpuSourceFamilies(config: ParticleConfig) {
  if (!config.gpgpuEnabled) return [];
  return uniqueNonEmpty([
    normalizeSourceFamily(config.gpgpuEmitShape),
    ['ring', 'disc', 'cone'].includes(config.gpgpuEmitShape) ? 'curve-path' : null,
    ['shell'].includes(config.gpgpuEmitShape) ? 'surface-map' : null,
    config.gpgpuEmitShape === 'shell' ? 'shell-volume' : null,
    config.gpgpuAudioReactive ? 'audio-control' : null,
  ]);
}

export function getActiveGpgpuRenderFamilies(config: ParticleConfig) {
  if (!config.gpgpuEnabled) return [];

  return uniqueNonEmpty([
    'gpu-points',
    config.gpgpuGeomMode !== 'point' ? 'instanced-geometry' : null,
    config.gpgpuGeomMode !== 'point' ? 'instanced-object-swarm' : null,
    config.gpgpuTrailEnabled ? 'gpu-trails' : null,
    config.gpgpuStreakEnabled ? 'gpu-streak-lines' : null,
    config.gpgpuRibbonEnabled ? 'gpu-ribbons' : null,
    config.gpgpuRibbonEnabled ? 'curve-ribbons' : null,
    config.gpgpuTubeEnabled ? 'gpu-tubes' : null,
    config.gpgpuSmoothTubeEnabled ? 'gpu-smooth-tubes' : null,
    config.gpgpuMetaballEnabled ? 'gpu-metaballs' : null,
    config.gpgpuVolumetricEnabled ? 'gpu-volumetric' : null,
    config.gpgpuSortEnabled ? 'gpu-sorted-transparency' : null,
    config.gpgpuVelColorEnabled || config.gpgpuAgeColorEnabled ? 'color-gradient' : null,
    config.gpgpuAgeSizeEnabled ? 'size-over-life' : null,
  ]);
}

function usesMediaMap(config: ParticleConfig) {
  return Boolean(
    (config.layer2Enabled && ['image', 'video', 'text'].includes(config.layer2Source)) ||
    (config.layer3Enabled && ['image', 'video', 'text'].includes(config.layer3Source))
  );
}

function usesInstancedMeshPipeline(config: ParticleConfig) {
  return Boolean(
    (config.layer2Enabled && config.layer2GeomMode3D !== 'billboard') ||
    (config.layer3Enabled && config.layer3GeomMode3D !== 'billboard') ||
    (config.gpgpuEnabled && config.gpgpuGeomMode !== 'point')
  );
}

export function getActiveComputeBackends(config: ParticleConfig) {
  return uniqueNonEmpty([
    config.layer1Enabled || config.layer2Enabled || config.layer3Enabled ? 'cpu-particle-layers' : null,
    (config.layer2Enabled && Boolean(getProceduralFeatureTag(config.layer2Type))) || (config.layer3Enabled && Boolean(getProceduralFeatureTag(config.layer3Type)))
      ? 'procedural-geometry'
      : null,
    usesInstancedMeshPipeline(config) ? 'instanced-mesh-pipeline' : null,
    usesMediaMap(config) ? 'media-map-sampler' : null,
    config.screenPersistenceIntensity > 0.001 ? 'feedback-buffer' : null,
    config.gpgpuEnabled ? 'webgl-gpgpu' : null,
    config.gpgpuEnabled && config.gpgpuWebGPUEnabled ? 'webgpu-compute' : null,
  ]);
}
