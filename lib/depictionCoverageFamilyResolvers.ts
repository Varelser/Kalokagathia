import type { ParticleConfig } from '../types';
import { getProductPackBundleById, inferProductPackBundleId } from './productPackLibrary';
import { getProductPackSubfamilyProfile } from './productPackSubfamilies';
import { uniqueNonEmpty } from './depictionCoverageLayerResolvers';

export function getActiveSolverFamilies(config: ParticleConfig) {
  const activeModes = uniqueNonEmpty([
    config.layer2Enabled ? config.layer2Type : null,
    config.layer3Enabled ? config.layer3Type : null,
  ]);
  const activeSources = uniqueNonEmpty([
    config.layer2Enabled ? config.layer2Source : null,
    config.layer3Enabled ? config.layer3Source : null,
  ]);
  const temporalProfiles = uniqueNonEmpty([
    config.layer2Enabled ? config.layer2TemporalProfile : null,
    config.layer3Enabled ? config.layer3TemporalProfile : null,
  ]);

  const hasMode = (...modes: string[]) => modes.some((mode) => activeModes.includes(mode));
  const hasSource = (...sources: string[]) => sources.some((source) => activeSources.includes(source));
  const hasTemporal = (...profiles: string[]) => profiles.some((profile) => temporalProfiles.includes(profile));

  return uniqueNonEmpty([
    (config.layer2Enabled || config.layer3Enabled) && (config.layer2ConnectionEnabled || config.layer3ConnectionEnabled || config.screenPersistenceIntensity > 0.001 || config.screenSplitIntensity > 0.001 || config.screenInterferenceIntensity > 0.001)
      ? 'operator-graph'
      : null,
    config.gpgpuEnabled ? 'system-emitter' : null,
    (config.gpgpuEnabled && (config.gpgpuWebGPUEnabled || config.gpgpuSortEnabled || config.gpgpuRibbonEnabled || config.gpgpuSmoothTubeEnabled || config.gpgpuMetaballEnabled || config.gpgpuVolumetricEnabled))
      ? 'gpu-vfx-graph'
      : null,
    (hasTemporal('rewrite', 'recur', 'oscillate', 'resonate', 'growth') || config.screenPersistenceIntensity > 0.001)
      ? 'simulation-zone'
      : null,
    (config.gpgpuVolumetricEnabled || hasMode('volume_fog', 'dust_plume', 'ashfall', 'condense_field', 'sublimate_cloud', 'freeze_skin'))
      ? 'volumetric-solver'
      : null,
    hasMode('cloth_membrane', 'elastic_sheet', 'elastic_lattice', 'granular_fall', 'sediment_stack', 'capillary_sheet', 'fiber_field', 'skin_lattice')
      ? 'pbd-solver'
      : null,
    hasMode('sediment_stack', 'granular_fall', 'deposition_field', 'crystal_deposition', 'crystal_aggregate', 'viscous_flow', 'melt_front', 'freeze_skin', 'condense_field', 'evaporative_sheet')
      ? 'mpm-material'
      : null,
    (hasMode('fracture_grammar', 'collapse_fracture', 'shard_debris', 'erosion_trail', 'voxel_lattice') || config.layer2SparkEnabled || config.layer3SparkEnabled)
      ? 'destruction-fracture'
      : null,
    (hasSource('image', 'video', 'text') || hasMode('reaction_diffusion', 'interference_wave', 'contour_echo', 'capillary_sheet', 'ink_bleed') || config.audioEnabled)
      ? 'signal-image-field'
      : null,
    (hasMode('growth_field', 'growth_grammar', 'reaction_diffusion', 'deposition_field', 'crystal_deposition', 'crystal_aggregate', 'cellular_front') || hasTemporal('growth'))
      ? 'task-graph'
      : null,
  ]);
}


export function getActivePhysicalFamilies(config: ParticleConfig) {
  const inferredBundle = getProductPackBundleById(inferProductPackBundleId(config));
  const inferred = getProductPackSubfamilyProfile(inferredBundle);
  const activeModes = uniqueNonEmpty([
    config.layer2Enabled ? config.layer2Type : null,
    config.layer3Enabled ? config.layer3Type : null,
  ]);
  const hasMode = (...modes: string[]) => modes.some((mode) => activeModes.includes(mode));

  return uniqueNonEmpty([
    ...inferred.physicalFamilies,
    (config.postFeedbackEnabled || config.screenPersistenceIntensity > 0.001 || config.postFxStackProfile === 'touch-feedback' || config.postFxStackProfile === 'retro-feedback') ? 'feedback-field' : null,
    (config.gpgpuCurlEnabled || config.gpgpuVortexEnabled || config.gpgpuVFieldEnabled || config.gpgpuWindEnabled || config.gpgpuWellEnabled || config.gpgpuMagneticEnabled) ? 'vector-force' : null,
    (config.gpgpuEnabled || config.layer2SparkEnabled || config.layer3SparkEnabled) ? 'particle-emission' : null,
    (config.gpgpuVolumetricEnabled || config.gpgpuFluidEnabled || hasMode('volume_fog', 'dust_plume', 'condense_field', 'sublimate_cloud', 'melt_front', 'freeze_skin')) ? 'volumetric-fluid' : null,
    hasMode('cloth_membrane', 'elastic_sheet', 'elastic_lattice', 'skin_lattice') ? 'cloth-softbody' : null,
    hasMode('granular_fall', 'sediment_stack', 'deposition_field', 'crystal_deposition', 'crystal_aggregate') ? 'granular-material' : null,
    hasMode('viscous_flow', 'melt_front', 'evaporative_sheet') ? 'viscoplastic-mpm' : null,
    hasMode('fracture_grammar', 'collapse_fracture', 'shard_debris', 'erosion_trail', 'voxel_lattice') ? 'fracture-destruction' : null,
    (config.gpgpuSdfEnabled || config.gpgpuMouseEnabled || config.interLayerContactFxEnabled || config.sdfShapeEnabled) ? 'sdf-contact' : null,
    hasMode('reaction_diffusion', 'interference_wave') ? 'reaction-diffusion' : null,
    (config.audioEnabled || config.gpgpuAudioReactive) ? 'audio-modulation' : null,
    hasMode('growth_field', 'growth_grammar', 'cellular_front') ? 'growth-branching' : null,
  ]);
}

export function getActiveGeometryFamilies(config: ParticleConfig) {
  const inferredBundle = getProductPackBundleById(inferProductPackBundleId(config));
  const inferred = getProductPackSubfamilyProfile(inferredBundle);
  const activeModes = uniqueNonEmpty([
    config.layer2Enabled ? config.layer2Type : null,
    config.layer3Enabled ? config.layer3Type : null,
  ]);
  const hasMode = (...modes: string[]) => modes.some((mode) => activeModes.includes(mode));

  return uniqueNonEmpty([
    ...inferred.geometryFamilies,
    (config.layer1Enabled || config.gpgpuEnabled) ? 'particle-sprites' : null,
    (config.layer2Enabled && ['prism_threads', 'ribbon_veil', 'contour_echo', 'fiber_field'].includes(config.layer2Type)) || (config.layer3Enabled && ['prism_threads', 'ribbon_veil', 'contour_echo', 'fiber_field'].includes(config.layer3Type)) || config.gpgpuRibbonEnabled
      ? 'line-ribbon'
      : null,
    (config.gpgpuTubeEnabled || config.gpgpuSmoothTubeEnabled) ? 'tube-curve' : null,
    hasMode('voxel_lattice', 'elastic_lattice', 'surface_patch', 'reaction_diffusion') ? 'grid-lattice' : null,
    hasMode('surface_patch', 'surface_shell', 'brush_sheet', 'skin_lattice') ? 'surface-patch' : null,
    (config.gpgpuEmitShape === 'shell' || hasMode('surface_shell')) ? 'shell-volume' : null,
    config.gpgpuMetaballEnabled ? 'metaball-implicit' : null,
    hasMode('voxel_lattice', 'collapse_fracture') ? 'voxel-structure' : null,
    (config.gpgpuGeomMode !== 'point' || (config.layer2Enabled && config.layer2GeomMode3D !== 'billboard') || (config.layer3Enabled && config.layer3GeomMode3D !== 'billboard')) ? 'instanced-objects' : null,
    (config.postFxStackProfile !== 'manual' || config.screenPersistenceIntensity > 0.001 || config.screenSplitIntensity > 0.001) ? 'screen-composite' : null,
    (config.gpgpuVolumetricEnabled || hasMode('volume_fog', 'dust_plume', 'condense_field')) ? 'volumetric-cloud' : null,
    (config.gpgpuSdfEnabled || config.sdfShapeEnabled) ? 'sdf-surface' : null,
  ]);
}

export function getActiveTemporalFamilies(config: ParticleConfig) {
  const inferredBundle = getProductPackBundleById(inferProductPackBundleId(config));
  const inferred = getProductPackSubfamilyProfile(inferredBundle);
  const temporalProfiles = uniqueNonEmpty([
    config.layer2Enabled ? config.layer2TemporalProfile : null,
    config.layer3Enabled ? config.layer3TemporalProfile : null,
  ]);
  const hasTemporal = (...profiles: string[]) => profiles.some((profile) => temporalProfiles.includes(profile));
  const activeModes = uniqueNonEmpty([
    config.layer2Enabled ? config.layer2Type : null,
    config.layer3Enabled ? config.layer3Type : null,
  ]);
  const hasMode = (...modes: string[]) => modes.some((mode) => activeModes.includes(mode));

  return uniqueNonEmpty([
    ...inferred.temporalFamilies,
    (config.screenPersistenceIntensity > 0.001 || config.gpgpuTrailEnabled) ? 'persistent-feedback' : null,
    (config.layer2SparkEnabled || config.layer3SparkEnabled || config.screenBurstDrive > 0.001 || config.screenImpactFlashIntensity > 0.001) ? 'burst-impulse' : null,
    (hasTemporal('oscillate', 'pulse', 'resonate') || config.gpgpuAudioReactive) ? 'oscillation-cycle' : null,
    (hasMode('growth_field', 'growth_grammar', 'cellular_front', 'reaction_diffusion') || hasTemporal('growth')) ? 'iterative-growth' : null,
    hasMode('deposition_field', 'crystal_deposition', 'crystal_aggregate', 'sediment_stack', 'granular_fall') ? 'accumulative-deposition' : null,
    (config.gpgpuEnabled || hasTemporal('recur') || hasMode('voxel_lattice', 'elastic_lattice', 'reaction_diffusion')) ? 'step-simulation' : null,
    (config.audioEnabled || config.gpgpuAudioReactive) ? 'audio-driven' : null,
    ((['ring', 'disc', 'cone'].includes(config.gpgpuEmitShape) && (config.gpgpuVortexEnabled || config.gpgpuWellEnabled || config.gpgpuAttractorEnabled || config.gpgpuNBodyEnabled)) || hasTemporal('orbit')) ? 'orbital-loop' : null,
    (hasTemporal('rewrite') || config.postFxStackProfile === 'touch-feedback' || config.postFxStackProfile === 'retro-feedback') ? 'rewrite-resample' : null,
    (config.gpgpuCurlEnabled || config.gpgpuFluidEnabled || config.gpgpuSphEnabled || config.gpgpuVFieldEnabled || hasMode('volume_fog', 'dust_plume', 'viscous_flow')) ? 'advection-flow' : null,
  ]);
}

export function getActiveSpecialistFamilies(config: ParticleConfig) {
  const inferredBundle = getProductPackBundleById(inferProductPackBundleId(config));
  const activeModes = uniqueNonEmpty([
    config.layer2Enabled ? config.layer2Type : null,
    config.layer3Enabled ? config.layer3Type : null,
  ]);

  const hasMode = (...modes: string[]) => modes.some((mode) => activeModes.includes(mode));

  return uniqueNonEmpty([
    ...(inferredBundle?.specialistFamilies ?? []),
    (config.postFxStackProfile === 'touch-feedback' && config.layer2Enabled && config.layer2Type === 'ribbon_veil' && config.layer2Source === 'video')
      ? 'touch-feedback-topology'
      : null,
    (config.gpgpuEnabled && config.gpgpuWebGPUEnabled && config.gpgpuVFieldEnabled && config.gpgpuVFieldType === 'spiral')
      ? 'touch-pop-force-cloud'
      : null,
    (config.postFxStackProfile === 'touch-feedback' && ((config.layer2Enabled && config.layer2Source === 'image') || (config.layer3Enabled && config.layer3Source === 'image')))
      ? 'touch-curve-relief-feedback'
      : null,
    (config.postFxStackProfile === 'retro-feedback' && config.screenPersistenceIntensity > 0.001)
      ? 'universe-retro-feedback'
      : null,
    (config.postFxStackProfile === 'particular-glow' && config.gpgpuBoidsEnabled && !config.audioEnabled)
      ? 'trapcode-particular-noir'
      : null,
    (config.postFxStackProfile === 'particular-glow' && (config.audioEnabled || config.gpgpuAudioReactive))
      ? 'trapcode-particular-audio-sparks'
      : null,
    (hasMode('voxel_lattice', 'surface_patch') && config.layer2ConnectionEnabled)
      ? 'trapcode-form-lattice'
      : null,
    (config.gpgpuSdfEnabled && config.gpgpuBoidsEnabled)
      ? 'trapcode-form-sdf-swarm'
      : null,
    (config.postFxStackProfile === 'dream-smear' && (config.screenSplitIntensity > 0.001 || config.layer2GhostTrailEnabled || config.layer3GhostTrailEnabled))
      ? 'universe-broadcast-ghost'
      : null,
    ((config.audioEnabled || config.gpgpuAudioReactive) && config.screenPersistenceIntensity > 0.001)
      ? 'hybrid-audio-operator-stack'
      : null,
    (hasMode('dust_plume', 'volume_fog', 'condense_field') && (config.gpgpuVortexEnabled || config.gpgpuCurlEnabled || config.gpgpuVolumetricEnabled))
      ? 'houdini-pyro-vortex-column'
      : null,
    hasMode('granular_fall', 'cloth_membrane', 'elastic_sheet')
      ? 'houdini-vellum-granular-drape'
      : null,
    hasMode('growth_field', 'growth_grammar', 'cellular_front')
      ? 'houdini-growth-arbor'
      : null,
    hasMode('viscous_flow', 'melt_front', 'deposition_field')
      ? 'houdini-mpm-slurry-stack'
      : null,
    hasMode('shard_debris', 'collapse_fracture', 'fracture_grammar')
      ? 'houdini-destruction-fracture-debris'
      : null,
    (config.gpgpuEmitShape === 'shell' && (config.gpgpuMetaballEnabled || config.gpgpuVolumetricEnabled))
      ? 'houdini-shell-metaball-volume'
      : null,
    ((config.gpgpuEmitShape in {ring:1, disc:1, cone:1}) && (config.gpgpuWellEnabled || config.gpgpuAttractorEnabled || config.gpgpuNBodyEnabled) && config.gpgpuGeomMode !== 'point')
      ? 'niagara-stateless-orbit-mesh'
      : null,
    ((config.gpgpuSdfEnabled || config.gpgpuMouseEnabled) && (config.layer2SparkEnabled || config.layer3SparkEnabled || config.gpgpuTrailEnabled))
      ? 'niagara-collision-burst-field'
      : null,
    (config.gpgpuMagneticEnabled && config.gpgpuElasticEnabled && (config.gpgpuTubeEnabled || config.gpgpuSmoothTubeEnabled))
      ? 'niagara-chaos-magnetic-tubes'
      : null,
    hasMode('voxel_lattice', 'elastic_lattice')
      ? 'geometrynodes-simulation-lattice'
      : null,
    hasMode('reaction_diffusion', 'growth_field', 'deposition_field')
      ? 'geometrynodes-reaction-growth-plate'
      : null,
    (config.gpgpuEnabled && config.gpgpuWebGPUEnabled && config.layer2Enabled && config.layer2Type === 'surface_patch')
      ? 'unity-vfx-gpu-sheet'
      : null,
    ((config.audioEnabled || config.gpgpuAudioReactive) && config.postFxStackProfile === 'touch-feedback' && (config.layer2ConnectionEnabled || config.layer3ConnectionEnabled))
      ? 'touch-top-cop-signal-field'
      : null,
    (hasMode('growth_field', 'growth_grammar', 'reaction_diffusion') && config.screenPersistenceIntensity > 0.001)
      ? 'hybrid-pdg-variant-sweep'
      : null,
    ((config.interLayerContactFxEnabled || config.sdfShapeEnabled) && ((config.layer2Enabled && config.layer2Source === 'random') || (config.layer3Enabled && config.layer3Source === 'random')))
      ? 'hybrid-contact-sdf-scatter'
      : null,
  ]);
}

export function getActivePostFamilies(config: ParticleConfig) {
  return uniqueNonEmpty([
    config.screenScanlineIntensity > 0.001 ? 'scanlines' : null,
    config.screenNoiseIntensity > 0.001 ? 'screen-noise' : null,
    config.screenVignetteIntensity > 0.001 ? 'vignette' : null,
    config.screenPulseIntensity > 0.001 ? 'pulse-flash' : null,
    config.screenImpactFlashIntensity > 0.001 ? 'impact-flash' : null,
    config.screenBurstDrive > 0.001 ? 'burst-drive' : null,
    config.screenInterferenceIntensity > 0.001 ? 'interference' : null,
    config.screenSweepIntensity > 0.001 ? 'screen-sweep' : null,
    config.screenSplitIntensity > 0.001 ? 'channel-split' : null,
    (config.screenPersistenceIntensity > 0.001 || config.layer2GhostTrailEnabled || config.layer3GhostTrailEnabled || config.gpgpuTrailEnabled) ? 'feedback-echo' : null,
    (config.screenScanlineIntensity > 0.001 && (config.screenInterferenceIntensity > 0.001 || config.screenSplitIntensity > 0.001)) ? 'retro-crt' : null,
    config.depthFogEnabled ? 'depth-fog' : null,
    config.postBloomEnabled ? 'bloom' : null,
    config.postChromaticAberrationEnabled ? 'chromatic-aberration' : null,
    config.postDofEnabled ? 'depth-of-field' : null,
    config.postNoiseEnabled ? 'noise-grain' : null,
    config.postVignetteEnabled ? 'vignette-darken' : null,
    config.postBrightnessContrastEnabled ? 'brightness-contrast' : null,
    config.interLayerContactFxEnabled ? 'contact-fx' : null,
    config.sdfShapeEnabled ? 'sdf-shading' : null,
    config.postKaleidoscopeEnabled ? 'kaleidoscope-fold' : null,
    config.postSlitScanEnabled ? 'slit-scan' : null,
  ]);
}
