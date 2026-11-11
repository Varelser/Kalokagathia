import type { ParticleConfig } from '../types';
import type { CoverageProfile } from './depictionCoverageTargets';
import {
  TARGET_COMPUTE_BACKENDS,
  TARGET_GEOMETRY_SUBFAMILIES,
  TARGET_MOTION_FAMILIES,
  TARGET_PHYSICAL_SUBFAMILIES,
  TARGET_POST_FAMILIES,
  TARGET_RENDER_FAMILIES,
  TARGET_SOLVER_FAMILIES,
  TARGET_SOURCE_FAMILIES,
  TARGET_SPECIALIST_FAMILIES,
  TARGET_TEMPORAL_SUBFAMILIES,
} from './depictionCoverageTargets';
import {
  getLayerDepictionMethod,
  getLayerMotionFamilies,
  getLayerSourceFamilies,
  getLayerRenderFamilies,
  uniqueNonEmpty,
} from './depictionCoverageLayerResolvers';
import {
  getActiveComputeBackends,
  getActiveGpgpuDepictionMethods,
  getActiveGpgpuFeatures,
  getActiveGpgpuMotionFamilies,
  getActiveGpgpuRenderFamilies,
  getActiveGpgpuSourceFamilies,
} from './depictionCoverageGpgpuResolvers';
import {
  getActiveGeometryFamilies,
  getActivePhysicalFamilies,
  getActivePostFamilies,
  getActiveSolverFamilies,
  getActiveSpecialistFamilies,
  getActiveTemporalFamilies,
} from './depictionCoverageFamilyResolvers';

function buildGapTargets(profile: Omit<CoverageProfile, 'gapTargets'>) {
  const gaps = [
    ...TARGET_SOURCE_FAMILIES.filter((target) => !profile.sourceFamilies.includes(target)).map((target) => `source/${target}`),
    ...TARGET_RENDER_FAMILIES.filter((target) => !profile.renderFamilies.includes(target)).map((target) => `render/${target}`),
    ...TARGET_POST_FAMILIES.filter((target) => !profile.postFamilies.includes(target)).map((target) => `post/${target}`),
    ...TARGET_COMPUTE_BACKENDS.filter((target) => !profile.computeBackends.includes(target)).map((target) => `compute/${target}`),
    ...TARGET_MOTION_FAMILIES.filter((target) => !profile.motionFamilies.includes(target)).map((target) => `motion/${target}`),
    ...TARGET_SOLVER_FAMILIES.filter((target) => !profile.solverFamilies.includes(target)).map((target) => `solver/${target}`),
    ...TARGET_SPECIALIST_FAMILIES.filter((target) => !profile.specialistFamilies.includes(target)).map((target) => `specialist/${target}`),
    ...TARGET_PHYSICAL_SUBFAMILIES.filter((target) => !profile.physicalFamilies.includes(target)).map((target) => `physical/${target}`),
    ...TARGET_GEOMETRY_SUBFAMILIES.filter((target) => !profile.geometryFamilies.includes(target)).map((target) => `geometry/${target}`),
    ...TARGET_TEMPORAL_SUBFAMILIES.filter((target) => !profile.temporalFamilies.includes(target)).map((target) => `temporal/${target}`),
  ];
  return gaps.slice(0, 18);
}

export function getCoverageProfile(config: ParticleConfig): CoverageProfile {
  const profileWithoutGaps = {
    depictionMethods: uniqueNonEmpty([
      getLayerDepictionMethod(config, 'layer1'),
      getLayerDepictionMethod(config, 'layer2'),
      getLayerDepictionMethod(config, 'layer3'),
      ...getActiveGpgpuDepictionMethods(config),
    ]),
    motionFamilies: uniqueNonEmpty([
      ...getLayerMotionFamilies(config, 'layer2'),
      ...getLayerMotionFamilies(config, 'layer3'),
      ...getActiveGpgpuMotionFamilies(config),
    ]),
    computeBackends: getActiveComputeBackends(config),
    sourceFamilies: uniqueNonEmpty([
      ...getLayerSourceFamilies(config, 'layer1'),
      ...getLayerSourceFamilies(config, 'layer2'),
      ...getLayerSourceFamilies(config, 'layer3'),
      ...getActiveGpgpuSourceFamilies(config),
      config.audioEnabled ? 'audio-control' : null,
    ]),
    renderFamilies: uniqueNonEmpty([
      ...getLayerRenderFamilies(config, 'layer1'),
      ...getLayerRenderFamilies(config, 'layer2'),
      ...getLayerRenderFamilies(config, 'layer3'),
      ...getActiveGpgpuRenderFamilies(config),
    ]),
    postFamilies: getActivePostFamilies(config),
    solverFamilies: getActiveSolverFamilies(config),
    specialistFamilies: getActiveSpecialistFamilies(config),
    physicalFamilies: getActivePhysicalFamilies(config),
    geometryFamilies: getActiveGeometryFamilies(config),
    temporalFamilies: getActiveTemporalFamilies(config),
    gpgpuFeatures: getActiveGpgpuFeatures(config),
  };

  return {
    ...profileWithoutGaps,
    gapTargets: buildGapTargets(profileWithoutGaps),
  };
}
