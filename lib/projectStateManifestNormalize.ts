import type { ParticleConfig, PresetRecord, PresetSequenceItem, ProjectLayerSnapshot, ProjectManifest } from '../types';
import { PROJECT_MANIFEST_SCHEMA_VERSION, PROJECT_SERIALIZATION_SCHEMA_VERSION, isPlainObject, uniqueNonEmpty } from './projectStateShared';
import { buildProjectManifest } from './projectStateManifestBuild';

export function normalizeProjectManifest(payload: unknown, config: ParticleConfig, presets: PresetRecord[], presetSequence: PresetSequenceItem[]): ProjectManifest {
  if (!isPlainObject(payload) || !Array.isArray(payload.layers) || !isPlainObject(payload.stats)) {
    return buildProjectManifest(config, presets, presetSequence);
  }

  const manifestPayload = payload as Record<string, unknown>;
  const fallback = buildProjectManifest(config, presets, presetSequence);
  const layers = fallback.layers.map((fallbackLayer) => {
    const manifestLayers = manifestPayload.layers as unknown[];
    const matched = manifestLayers.find((item) => isPlainObject(item) && item.key === fallbackLayer.key);
    if (!isPlainObject(matched)) return fallbackLayer;
    return {
      ...fallbackLayer,
      label: typeof matched.label === 'string' ? matched.label : fallbackLayer.label,
      enabled: typeof matched.enabled === 'boolean' ? matched.enabled : fallbackLayer.enabled,
      mode: typeof matched.mode === 'string' ? matched.mode : fallbackLayer.mode,
      source: typeof matched.source === 'string' ? matched.source : fallbackLayer.source,
      material: typeof matched.material === 'string' ? matched.material : fallbackLayer.material,
      geometry: typeof matched.geometry === 'string' ? matched.geometry : fallbackLayer.geometry,
      connectionStyle: typeof matched.connectionStyle === 'string' ? matched.connectionStyle : fallbackLayer.connectionStyle,
      features: Array.isArray(matched.features) ? uniqueNonEmpty(matched.features.map((item) => typeof item === 'string' ? item : null)) : fallbackLayer.features,
      capabilityFlags: Array.isArray(matched.capabilityFlags) ? uniqueNonEmpty(matched.capabilityFlags.map((item) => typeof item === 'string' ? item : null)) as ProjectLayerSnapshot['capabilityFlags'] : fallbackLayer.capabilityFlags,
    };
  });

  const execution = Array.isArray(manifestPayload.execution)
    ? fallback.execution.map((fallbackEntry) => {
      const matched = (manifestPayload.execution as unknown[]).find((item) => isPlainObject(item) && item.key === fallbackEntry.key);
      if (!isPlainObject(matched)) return fallbackEntry;
      return {
        ...fallbackEntry,
        label: typeof matched.label === 'string' ? matched.label : fallbackEntry.label,
        enabled: typeof matched.enabled === 'boolean' ? matched.enabled : fallbackEntry.enabled,
        mode: typeof matched.mode === 'string' ? matched.mode : fallbackEntry.mode,
        renderClass: typeof matched.renderClass === 'string' ? matched.renderClass : fallbackEntry.renderClass,
        simulationClass: typeof matched.simulationClass === 'string' ? matched.simulationClass : fallbackEntry.simulationClass,
        requestedEngine: typeof matched.requestedEngine === 'string' ? matched.requestedEngine : fallbackEntry.requestedEngine,
        resolvedEngine: typeof matched.resolvedEngine === 'string' ? matched.resolvedEngine : fallbackEntry.resolvedEngine,
        path: typeof matched.path === 'string' ? matched.path : fallbackEntry.path,
        overrideId: typeof matched.overrideId === 'string' ? matched.overrideId : fallbackEntry.overrideId,
        proceduralSystemId: (typeof matched.proceduralSystemId === 'string' || matched.proceduralSystemId === null)
          ? matched.proceduralSystemId as string | null
          : fallbackEntry.proceduralSystemId,
        hybridKind: (typeof matched.hybridKind === 'string' || matched.hybridKind === null)
          ? matched.hybridKind as string | null
          : fallbackEntry.hybridKind,
        capabilityFlags: Array.isArray(matched.capabilityFlags) ? uniqueNonEmpty(matched.capabilityFlags.map((item) => typeof item === 'string' ? item : null)) as typeof fallbackEntry.capabilityFlags : fallbackEntry.capabilityFlags,
        reason: typeof matched.reason === 'string' ? matched.reason : fallbackEntry.reason,
        notes: Array.isArray(matched.notes) ? uniqueNonEmpty(matched.notes.map((item) => typeof item === 'string' ? item : null)) : fallbackEntry.notes,
        sceneBranches: Array.isArray(matched.sceneBranches) ? uniqueNonEmpty(matched.sceneBranches.map((item) => typeof item === 'string' ? item : null)) : fallbackEntry.sceneBranches,
      };
    })
    : fallback.execution;

  const coveragePayload = isPlainObject(manifestPayload.coverage) ? manifestPayload.coverage : {};
  const statsPayload = manifestPayload.stats as Record<string, unknown>;
  return {
    schemaVersion: typeof manifestPayload.schemaVersion === 'number' ? manifestPayload.schemaVersion : PROJECT_MANIFEST_SCHEMA_VERSION,
    serializationSchemaVersion: typeof manifestPayload.serializationSchemaVersion === 'number' ? manifestPayload.serializationSchemaVersion : PROJECT_SERIALIZATION_SCHEMA_VERSION,
    layers,
    execution,
    coverage: {
      depictionMethods: Array.isArray(coveragePayload.depictionMethods) ? uniqueNonEmpty(coveragePayload.depictionMethods.map((item) => typeof item === 'string' ? item : null)) : fallback.coverage.depictionMethods,
      motionFamilies: Array.isArray(coveragePayload.motionFamilies) ? uniqueNonEmpty(coveragePayload.motionFamilies.map((item) => typeof item === 'string' ? item : null)) : fallback.coverage.motionFamilies,
      computeBackends: Array.isArray(coveragePayload.computeBackends) ? uniqueNonEmpty(coveragePayload.computeBackends.map((item) => typeof item === 'string' ? item : null)) : fallback.coverage.computeBackends,
      sourceFamilies: Array.isArray(coveragePayload.sourceFamilies) ? uniqueNonEmpty(coveragePayload.sourceFamilies.map((item) => typeof item === 'string' ? item : null)) : fallback.coverage.sourceFamilies,
      renderFamilies: Array.isArray(coveragePayload.renderFamilies) ? uniqueNonEmpty(coveragePayload.renderFamilies.map((item) => typeof item === 'string' ? item : null)) : fallback.coverage.renderFamilies,
      postFamilies: Array.isArray(coveragePayload.postFamilies) ? uniqueNonEmpty(coveragePayload.postFamilies.map((item) => typeof item === 'string' ? item : null)) : fallback.coverage.postFamilies,
      solverFamilies: Array.isArray(coveragePayload.solverFamilies) ? uniqueNonEmpty(coveragePayload.solverFamilies.map((item) => typeof item === 'string' ? item : null)) : fallback.coverage.solverFamilies,
      specialistFamilies: Array.isArray(coveragePayload.specialistFamilies) ? uniqueNonEmpty(coveragePayload.specialistFamilies.map((item) => typeof item === 'string' ? item : null)) : fallback.coverage.specialistFamilies,
      physicalFamilies: Array.isArray(coveragePayload.physicalFamilies) ? uniqueNonEmpty(coveragePayload.physicalFamilies.map((item) => typeof item === 'string' ? item : null)) : fallback.coverage.physicalFamilies,
      geometryFamilies: Array.isArray(coveragePayload.geometryFamilies) ? uniqueNonEmpty(coveragePayload.geometryFamilies.map((item) => typeof item === 'string' ? item : null)) : fallback.coverage.geometryFamilies,
      temporalFamilies: Array.isArray(coveragePayload.temporalFamilies) ? uniqueNonEmpty(coveragePayload.temporalFamilies.map((item) => typeof item === 'string' ? item : null)) : fallback.coverage.temporalFamilies,
      productPackFamilies: Array.isArray(coveragePayload.productPackFamilies) ? uniqueNonEmpty(coveragePayload.productPackFamilies.map((item) => typeof item === 'string' ? item : null)) : fallback.coverage.productPackFamilies,
      productPacks: Array.isArray(coveragePayload.productPacks) ? uniqueNonEmpty(coveragePayload.productPacks.map((item) => typeof item === 'string' ? item : null)) : fallback.coverage.productPacks,
      postStackTemplates: Array.isArray(coveragePayload.postStackTemplates) ? uniqueNonEmpty(coveragePayload.postStackTemplates.map((item) => typeof item === 'string' ? item : null)) : fallback.coverage.postStackTemplates,
      activePostStackId: typeof coveragePayload.activePostStackId === 'string' ? coveragePayload.activePostStackId : fallback.coverage.activePostStackId,
      activeProductPackId: typeof coveragePayload.activeProductPackId === 'string' ? coveragePayload.activeProductPackId : fallback.coverage.activeProductPackId,
      gpgpuFeatures: Array.isArray(coveragePayload.gpgpuFeatures) ? uniqueNonEmpty(coveragePayload.gpgpuFeatures.map((item) => typeof item === 'string' ? item : null)) : fallback.coverage.gpgpuFeatures,
      gapTargets: Array.isArray(coveragePayload.gapTargets) ? uniqueNonEmpty(coveragePayload.gapTargets.map((item) => typeof item === 'string' ? item : null)) : fallback.coverage.gapTargets,
      productPackScorecards: Array.isArray(coveragePayload.productPackScorecards)
        ? coveragePayload.productPackScorecards
          .filter((item): item is Record<string, unknown> => isPlainObject(item))
          .map((item) => ({
            id: typeof item.id === 'string' ? item.id : '',
            label: typeof item.label === 'string' ? item.label : 'Unknown Pack',
            family: typeof item.family === 'string' ? item.family : 'unknown',
            coverageScore: typeof item.coverageScore === 'number' ? item.coverageScore : 0,
            targetHitCount: typeof item.targetHitCount === 'number' ? item.targetHitCount : 0,
            targetTotal: typeof item.targetTotal === 'number' ? item.targetTotal : 0,
            emphasis: Array.isArray(item.emphasis) ? uniqueNonEmpty(item.emphasis.map((value) => typeof value === 'string' ? value : null)) : [],
            solverFamilies: Array.isArray(item.solverFamilies) ? uniqueNonEmpty(item.solverFamilies.map((value) => typeof value === 'string' ? value : null)) : [],
            specialistFamilies: Array.isArray(item.specialistFamilies) ? uniqueNonEmpty(item.specialistFamilies.map((value) => typeof value === 'string' ? value : null)) : [],
            physicalFamilies: Array.isArray(item.physicalFamilies) ? uniqueNonEmpty(item.physicalFamilies.map((value) => typeof value === 'string' ? value : null)) : [],
            geometryFamilies: Array.isArray(item.geometryFamilies) ? uniqueNonEmpty(item.geometryFamilies.map((value) => typeof value === 'string' ? value : null)) : [],
            temporalFamilies: Array.isArray(item.temporalFamilies) ? uniqueNonEmpty(item.temporalFamilies.map((value) => typeof value === 'string' ? value : null)) : [],
            missingTargets: Array.isArray(item.missingTargets) ? uniqueNonEmpty(item.missingTargets.map((value) => typeof value === 'string' ? value : null)) : [],
          }))
          .filter((item) => item.id.length > 0)
        : fallback.coverage.productPackScorecards,
      coverageRollup: isPlainObject(coveragePayload.coverageRollup)
        ? {
          coverageScore: typeof coveragePayload.coverageRollup.coverageScore === 'number' ? coveragePayload.coverageRollup.coverageScore : fallback.coverage.coverageRollup.coverageScore,
          targetHitCount: typeof coveragePayload.coverageRollup.targetHitCount === 'number' ? coveragePayload.coverageRollup.targetHitCount : fallback.coverage.coverageRollup.targetHitCount,
          targetTotal: typeof coveragePayload.coverageRollup.targetTotal === 'number' ? coveragePayload.coverageRollup.targetTotal : fallback.coverage.coverageRollup.targetTotal,
          averagePackCoverageScore: typeof coveragePayload.coverageRollup.averagePackCoverageScore === 'number' ? coveragePayload.coverageRollup.averagePackCoverageScore : fallback.coverage.coverageRollup.averagePackCoverageScore,
          bestPackId: typeof coveragePayload.coverageRollup.bestPackId === 'string' ? coveragePayload.coverageRollup.bestPackId : fallback.coverage.coverageRollup.bestPackId,
          bestPackLabel: typeof coveragePayload.coverageRollup.bestPackLabel === 'string' ? coveragePayload.coverageRollup.bestPackLabel : fallback.coverage.coverageRollup.bestPackLabel,
          bestPackCoverageScore: typeof coveragePayload.coverageRollup.bestPackCoverageScore === 'number' ? coveragePayload.coverageRollup.bestPackCoverageScore : fallback.coverage.coverageRollup.bestPackCoverageScore,
          sourceAxis: isPlainObject(coveragePayload.coverageRollup.sourceAxis) ? {
            covered: Array.isArray(coveragePayload.coverageRollup.sourceAxis.covered) ? uniqueNonEmpty(coveragePayload.coverageRollup.sourceAxis.covered.map((value) => typeof value === 'string' ? value : null)) : fallback.coverage.coverageRollup.sourceAxis.covered,
            missing: Array.isArray(coveragePayload.coverageRollup.sourceAxis.missing) ? uniqueNonEmpty(coveragePayload.coverageRollup.sourceAxis.missing.map((value) => typeof value === 'string' ? value : null)) : fallback.coverage.coverageRollup.sourceAxis.missing,
            hitCount: typeof coveragePayload.coverageRollup.sourceAxis.hitCount === 'number' ? coveragePayload.coverageRollup.sourceAxis.hitCount : fallback.coverage.coverageRollup.sourceAxis.hitCount,
            targetCount: typeof coveragePayload.coverageRollup.sourceAxis.targetCount === 'number' ? coveragePayload.coverageRollup.sourceAxis.targetCount : fallback.coverage.coverageRollup.sourceAxis.targetCount,
            ratio: typeof coveragePayload.coverageRollup.sourceAxis.ratio === 'number' ? coveragePayload.coverageRollup.sourceAxis.ratio : fallback.coverage.coverageRollup.sourceAxis.ratio,
          } : fallback.coverage.coverageRollup.sourceAxis,
          renderAxis: isPlainObject(coveragePayload.coverageRollup.renderAxis) ? {
            covered: Array.isArray(coveragePayload.coverageRollup.renderAxis.covered) ? uniqueNonEmpty(coveragePayload.coverageRollup.renderAxis.covered.map((value) => typeof value === 'string' ? value : null)) : fallback.coverage.coverageRollup.renderAxis.covered,
            missing: Array.isArray(coveragePayload.coverageRollup.renderAxis.missing) ? uniqueNonEmpty(coveragePayload.coverageRollup.renderAxis.missing.map((value) => typeof value === 'string' ? value : null)) : fallback.coverage.coverageRollup.renderAxis.missing,
            hitCount: typeof coveragePayload.coverageRollup.renderAxis.hitCount === 'number' ? coveragePayload.coverageRollup.renderAxis.hitCount : fallback.coverage.coverageRollup.renderAxis.hitCount,
            targetCount: typeof coveragePayload.coverageRollup.renderAxis.targetCount === 'number' ? coveragePayload.coverageRollup.renderAxis.targetCount : fallback.coverage.coverageRollup.renderAxis.targetCount,
            ratio: typeof coveragePayload.coverageRollup.renderAxis.ratio === 'number' ? coveragePayload.coverageRollup.renderAxis.ratio : fallback.coverage.coverageRollup.renderAxis.ratio,
          } : fallback.coverage.coverageRollup.renderAxis,
          postAxis: isPlainObject(coveragePayload.coverageRollup.postAxis) ? {
            covered: Array.isArray(coveragePayload.coverageRollup.postAxis.covered) ? uniqueNonEmpty(coveragePayload.coverageRollup.postAxis.covered.map((value) => typeof value === 'string' ? value : null)) : fallback.coverage.coverageRollup.postAxis.covered,
            missing: Array.isArray(coveragePayload.coverageRollup.postAxis.missing) ? uniqueNonEmpty(coveragePayload.coverageRollup.postAxis.missing.map((value) => typeof value === 'string' ? value : null)) : fallback.coverage.coverageRollup.postAxis.missing,
            hitCount: typeof coveragePayload.coverageRollup.postAxis.hitCount === 'number' ? coveragePayload.coverageRollup.postAxis.hitCount : fallback.coverage.coverageRollup.postAxis.hitCount,
            targetCount: typeof coveragePayload.coverageRollup.postAxis.targetCount === 'number' ? coveragePayload.coverageRollup.postAxis.targetCount : fallback.coverage.coverageRollup.postAxis.targetCount,
            ratio: typeof coveragePayload.coverageRollup.postAxis.ratio === 'number' ? coveragePayload.coverageRollup.postAxis.ratio : fallback.coverage.coverageRollup.postAxis.ratio,
          } : fallback.coverage.coverageRollup.postAxis,
          computeAxis: isPlainObject(coveragePayload.coverageRollup.computeAxis) ? {
            covered: Array.isArray(coveragePayload.coverageRollup.computeAxis.covered) ? uniqueNonEmpty(coveragePayload.coverageRollup.computeAxis.covered.map((value) => typeof value === 'string' ? value : null)) : fallback.coverage.coverageRollup.computeAxis.covered,
            missing: Array.isArray(coveragePayload.coverageRollup.computeAxis.missing) ? uniqueNonEmpty(coveragePayload.coverageRollup.computeAxis.missing.map((value) => typeof value === 'string' ? value : null)) : fallback.coverage.coverageRollup.computeAxis.missing,
            hitCount: typeof coveragePayload.coverageRollup.computeAxis.hitCount === 'number' ? coveragePayload.coverageRollup.computeAxis.hitCount : fallback.coverage.coverageRollup.computeAxis.hitCount,
            targetCount: typeof coveragePayload.coverageRollup.computeAxis.targetCount === 'number' ? coveragePayload.coverageRollup.computeAxis.targetCount : fallback.coverage.coverageRollup.computeAxis.targetCount,
            ratio: typeof coveragePayload.coverageRollup.computeAxis.ratio === 'number' ? coveragePayload.coverageRollup.computeAxis.ratio : fallback.coverage.coverageRollup.computeAxis.ratio,
          } : fallback.coverage.coverageRollup.computeAxis,
          motionAxis: isPlainObject(coveragePayload.coverageRollup.motionAxis) ? {
            covered: Array.isArray(coveragePayload.coverageRollup.motionAxis.covered) ? uniqueNonEmpty(coveragePayload.coverageRollup.motionAxis.covered.map((value) => typeof value === 'string' ? value : null)) : fallback.coverage.coverageRollup.motionAxis.covered,
            missing: Array.isArray(coveragePayload.coverageRollup.motionAxis.missing) ? uniqueNonEmpty(coveragePayload.coverageRollup.motionAxis.missing.map((value) => typeof value === 'string' ? value : null)) : fallback.coverage.coverageRollup.motionAxis.missing,
            hitCount: typeof coveragePayload.coverageRollup.motionAxis.hitCount === 'number' ? coveragePayload.coverageRollup.motionAxis.hitCount : fallback.coverage.coverageRollup.motionAxis.hitCount,
            targetCount: typeof coveragePayload.coverageRollup.motionAxis.targetCount === 'number' ? coveragePayload.coverageRollup.motionAxis.targetCount : fallback.coverage.coverageRollup.motionAxis.targetCount,
            ratio: typeof coveragePayload.coverageRollup.motionAxis.ratio === 'number' ? coveragePayload.coverageRollup.motionAxis.ratio : fallback.coverage.coverageRollup.motionAxis.ratio,
          } : fallback.coverage.coverageRollup.motionAxis,
          solverAxis: isPlainObject(coveragePayload.coverageRollup.solverAxis) ? {
            covered: Array.isArray(coveragePayload.coverageRollup.solverAxis.covered) ? uniqueNonEmpty(coveragePayload.coverageRollup.solverAxis.covered.map((value) => typeof value === 'string' ? value : null)) : fallback.coverage.coverageRollup.solverAxis.covered,
            missing: Array.isArray(coveragePayload.coverageRollup.solverAxis.missing) ? uniqueNonEmpty(coveragePayload.coverageRollup.solverAxis.missing.map((value) => typeof value === 'string' ? value : null)) : fallback.coverage.coverageRollup.solverAxis.missing,
            hitCount: typeof coveragePayload.coverageRollup.solverAxis.hitCount === 'number' ? coveragePayload.coverageRollup.solverAxis.hitCount : fallback.coverage.coverageRollup.solverAxis.hitCount,
            targetCount: typeof coveragePayload.coverageRollup.solverAxis.targetCount === 'number' ? coveragePayload.coverageRollup.solverAxis.targetCount : fallback.coverage.coverageRollup.solverAxis.targetCount,
            ratio: typeof coveragePayload.coverageRollup.solverAxis.ratio === 'number' ? coveragePayload.coverageRollup.solverAxis.ratio : fallback.coverage.coverageRollup.solverAxis.ratio,
          } : fallback.coverage.coverageRollup.solverAxis,
          specialistAxis: isPlainObject(coveragePayload.coverageRollup.specialistAxis) ? {
            covered: Array.isArray(coveragePayload.coverageRollup.specialistAxis.covered) ? uniqueNonEmpty(coveragePayload.coverageRollup.specialistAxis.covered.map((value) => typeof value === 'string' ? value : null)) : fallback.coverage.coverageRollup.specialistAxis.covered,
            missing: Array.isArray(coveragePayload.coverageRollup.specialistAxis.missing) ? uniqueNonEmpty(coveragePayload.coverageRollup.specialistAxis.missing.map((value) => typeof value === 'string' ? value : null)) : fallback.coverage.coverageRollup.specialistAxis.missing,
            hitCount: typeof coveragePayload.coverageRollup.specialistAxis.hitCount === 'number' ? coveragePayload.coverageRollup.specialistAxis.hitCount : fallback.coverage.coverageRollup.specialistAxis.hitCount,
            targetCount: typeof coveragePayload.coverageRollup.specialistAxis.targetCount === 'number' ? coveragePayload.coverageRollup.specialistAxis.targetCount : fallback.coverage.coverageRollup.specialistAxis.targetCount,
            ratio: typeof coveragePayload.coverageRollup.specialistAxis.ratio === 'number' ? coveragePayload.coverageRollup.specialistAxis.ratio : fallback.coverage.coverageRollup.specialistAxis.ratio,
          } : fallback.coverage.coverageRollup.specialistAxis,
          physicalAxis: isPlainObject(coveragePayload.coverageRollup.physicalAxis) ? {
            covered: Array.isArray(coveragePayload.coverageRollup.physicalAxis.covered) ? uniqueNonEmpty(coveragePayload.coverageRollup.physicalAxis.covered.map((value) => typeof value === 'string' ? value : null)) : fallback.coverage.coverageRollup.physicalAxis.covered,
            missing: Array.isArray(coveragePayload.coverageRollup.physicalAxis.missing) ? uniqueNonEmpty(coveragePayload.coverageRollup.physicalAxis.missing.map((value) => typeof value === 'string' ? value : null)) : fallback.coverage.coverageRollup.physicalAxis.missing,
            hitCount: typeof coveragePayload.coverageRollup.physicalAxis.hitCount === 'number' ? coveragePayload.coverageRollup.physicalAxis.hitCount : fallback.coverage.coverageRollup.physicalAxis.hitCount,
            targetCount: typeof coveragePayload.coverageRollup.physicalAxis.targetCount === 'number' ? coveragePayload.coverageRollup.physicalAxis.targetCount : fallback.coverage.coverageRollup.physicalAxis.targetCount,
            ratio: typeof coveragePayload.coverageRollup.physicalAxis.ratio === 'number' ? coveragePayload.coverageRollup.physicalAxis.ratio : fallback.coverage.coverageRollup.physicalAxis.ratio,
          } : fallback.coverage.coverageRollup.physicalAxis,
          geometryAxis: isPlainObject(coveragePayload.coverageRollup.geometryAxis) ? {
            covered: Array.isArray(coveragePayload.coverageRollup.geometryAxis.covered) ? uniqueNonEmpty(coveragePayload.coverageRollup.geometryAxis.covered.map((value) => typeof value === 'string' ? value : null)) : fallback.coverage.coverageRollup.geometryAxis.covered,
            missing: Array.isArray(coveragePayload.coverageRollup.geometryAxis.missing) ? uniqueNonEmpty(coveragePayload.coverageRollup.geometryAxis.missing.map((value) => typeof value === 'string' ? value : null)) : fallback.coverage.coverageRollup.geometryAxis.missing,
            hitCount: typeof coveragePayload.coverageRollup.geometryAxis.hitCount === 'number' ? coveragePayload.coverageRollup.geometryAxis.hitCount : fallback.coverage.coverageRollup.geometryAxis.hitCount,
            targetCount: typeof coveragePayload.coverageRollup.geometryAxis.targetCount === 'number' ? coveragePayload.coverageRollup.geometryAxis.targetCount : fallback.coverage.coverageRollup.geometryAxis.targetCount,
            ratio: typeof coveragePayload.coverageRollup.geometryAxis.ratio === 'number' ? coveragePayload.coverageRollup.geometryAxis.ratio : fallback.coverage.coverageRollup.geometryAxis.ratio,
          } : fallback.coverage.coverageRollup.geometryAxis,
          temporalAxis: isPlainObject(coveragePayload.coverageRollup.temporalAxis) ? {
            covered: Array.isArray(coveragePayload.coverageRollup.temporalAxis.covered) ? uniqueNonEmpty(coveragePayload.coverageRollup.temporalAxis.covered.map((value) => typeof value === 'string' ? value : null)) : fallback.coverage.coverageRollup.temporalAxis.covered,
            missing: Array.isArray(coveragePayload.coverageRollup.temporalAxis.missing) ? uniqueNonEmpty(coveragePayload.coverageRollup.temporalAxis.missing.map((value) => typeof value === 'string' ? value : null)) : fallback.coverage.coverageRollup.temporalAxis.missing,
            hitCount: typeof coveragePayload.coverageRollup.temporalAxis.hitCount === 'number' ? coveragePayload.coverageRollup.temporalAxis.hitCount : fallback.coverage.coverageRollup.temporalAxis.hitCount,
            targetCount: typeof coveragePayload.coverageRollup.temporalAxis.targetCount === 'number' ? coveragePayload.coverageRollup.temporalAxis.targetCount : fallback.coverage.coverageRollup.temporalAxis.targetCount,
            ratio: typeof coveragePayload.coverageRollup.temporalAxis.ratio === 'number' ? coveragePayload.coverageRollup.temporalAxis.ratio : fallback.coverage.coverageRollup.temporalAxis.ratio,
          } : fallback.coverage.coverageRollup.temporalAxis,
          missingTargets: Array.isArray(coveragePayload.coverageRollup.missingTargets) ? uniqueNonEmpty(coveragePayload.coverageRollup.missingTargets.map((value) => typeof value === 'string' ? value : null)) : fallback.coverage.coverageRollup.missingTargets,
        }
        : fallback.coverage.coverageRollup,
      augmentationSuggestions: Array.isArray(coveragePayload.augmentationSuggestions)
        ? coveragePayload.augmentationSuggestions
          .filter((item): item is Record<string, unknown> => isPlainObject(item))
          .map((item) => ({
            id: typeof item.id === 'string' ? item.id : '',
            label: typeof item.label === 'string' ? item.label : 'Unknown Pack',
            family: typeof item.family === 'string' ? item.family : 'unknown',
            coverageGain: typeof item.coverageGain === 'number' ? item.coverageGain : 0,
            resultCoverageScore: typeof item.resultCoverageScore === 'number' ? item.resultCoverageScore : 0,
            resultTargetHitCount: typeof item.resultTargetHitCount === 'number' ? item.resultTargetHitCount : 0,
            coveredGapTargets: Array.isArray(item.coveredGapTargets) ? uniqueNonEmpty(item.coveredGapTargets.map((value) => typeof value === 'string' ? value : null)) : [],
          }))
          .filter((item) => item.id.length > 0)
        : fallback.coverage.augmentationSuggestions,
    },
    stats: {
      presetCount: typeof statsPayload.presetCount === 'number' ? statsPayload.presetCount : fallback.stats.presetCount,
      sequenceCount: typeof statsPayload.sequenceCount === 'number' ? statsPayload.sequenceCount : fallback.stats.sequenceCount,
      enabledLayerCount: typeof statsPayload.enabledLayerCount === 'number' ? statsPayload.enabledLayerCount : fallback.stats.enabledLayerCount,
      mediaSourceCount: typeof statsPayload.mediaSourceCount === 'number' ? statsPayload.mediaSourceCount : fallback.stats.mediaSourceCount,
      textSourceCount: typeof statsPayload.textSourceCount === 'number' ? statsPayload.textSourceCount : fallback.stats.textSourceCount,
      proceduralModeCount: typeof statsPayload.proceduralModeCount === 'number' ? statsPayload.proceduralModeCount : fallback.stats.proceduralModeCount,
      distinctMaterialCount: typeof statsPayload.distinctMaterialCount === 'number' ? statsPayload.distinctMaterialCount : fallback.stats.distinctMaterialCount,
      depictionMethodCount: typeof statsPayload.depictionMethodCount === 'number' ? statsPayload.depictionMethodCount : fallback.stats.depictionMethodCount,
      motionFamilyCount: typeof statsPayload.motionFamilyCount === 'number' ? statsPayload.motionFamilyCount : fallback.stats.motionFamilyCount,
      computeBackendCount: typeof statsPayload.computeBackendCount === 'number' ? statsPayload.computeBackendCount : fallback.stats.computeBackendCount,
      sourceFamilyCount: typeof statsPayload.sourceFamilyCount === 'number' ? statsPayload.sourceFamilyCount : fallback.stats.sourceFamilyCount,
      renderFamilyCount: typeof statsPayload.renderFamilyCount === 'number' ? statsPayload.renderFamilyCount : fallback.stats.renderFamilyCount,
      postFamilyCount: typeof statsPayload.postFamilyCount === 'number' ? statsPayload.postFamilyCount : fallback.stats.postFamilyCount,
      solverFamilyCount: typeof statsPayload.solverFamilyCount === 'number' ? statsPayload.solverFamilyCount : fallback.stats.solverFamilyCount,
      specialistFamilyCount: typeof statsPayload.specialistFamilyCount === 'number' ? statsPayload.specialistFamilyCount : fallback.stats.specialistFamilyCount,
      physicalFamilyCount: typeof statsPayload.physicalFamilyCount === 'number' ? statsPayload.physicalFamilyCount : fallback.stats.physicalFamilyCount,
      geometryFamilyCount: typeof statsPayload.geometryFamilyCount === 'number' ? statsPayload.geometryFamilyCount : fallback.stats.geometryFamilyCount,
      temporalFamilyCount: typeof statsPayload.temporalFamilyCount === 'number' ? statsPayload.temporalFamilyCount : fallback.stats.temporalFamilyCount,
      productPackFamilyCount: typeof statsPayload.productPackFamilyCount === 'number' ? statsPayload.productPackFamilyCount : fallback.stats.productPackFamilyCount,
      productPackCount: typeof statsPayload.productPackCount === 'number' ? statsPayload.productPackCount : fallback.stats.productPackCount,
      postStackTemplateCount: typeof statsPayload.postStackTemplateCount === 'number' ? statsPayload.postStackTemplateCount : fallback.stats.postStackTemplateCount,
      gpgpuFeatureCount: typeof statsPayload.gpgpuFeatureCount === 'number' ? statsPayload.gpgpuFeatureCount : fallback.stats.gpgpuFeatureCount,
      coverageGapCount: typeof statsPayload.coverageGapCount === 'number' ? statsPayload.coverageGapCount : fallback.stats.coverageGapCount,
      productPackScorecardCount: typeof statsPayload.productPackScorecardCount === 'number' ? statsPayload.productPackScorecardCount : fallback.stats.productPackScorecardCount,
      activeProductPackCoverageScore: typeof statsPayload.activeProductPackCoverageScore === 'number' ? statsPayload.activeProductPackCoverageScore : fallback.stats.activeProductPackCoverageScore,
      currentCoverageScore: typeof statsPayload.currentCoverageScore === 'number' ? statsPayload.currentCoverageScore : fallback.stats.currentCoverageScore,
      currentTargetHitCount: typeof statsPayload.currentTargetHitCount === 'number' ? statsPayload.currentTargetHitCount : fallback.stats.currentTargetHitCount,
      currentTargetTotal: typeof statsPayload.currentTargetTotal === 'number' ? statsPayload.currentTargetTotal : fallback.stats.currentTargetTotal,
      overallCoverageScore: typeof statsPayload.overallCoverageScore === 'number' ? statsPayload.overallCoverageScore : fallback.stats.overallCoverageScore,
      overallTargetHitCount: typeof statsPayload.overallTargetHitCount === 'number' ? statsPayload.overallTargetHitCount : fallback.stats.overallTargetHitCount,
      overallTargetTotal: typeof statsPayload.overallTargetTotal === 'number' ? statsPayload.overallTargetTotal : fallback.stats.overallTargetTotal,
      averagePackCoverageScore: typeof statsPayload.averagePackCoverageScore === 'number' ? statsPayload.averagePackCoverageScore : fallback.stats.averagePackCoverageScore,
      bestPackCoverageScore: typeof statsPayload.bestPackCoverageScore === 'number' ? statsPayload.bestPackCoverageScore : fallback.stats.bestPackCoverageScore,
      augmentationSuggestionCount: typeof statsPayload.augmentationSuggestionCount === 'number' ? statsPayload.augmentationSuggestionCount : fallback.stats.augmentationSuggestionCount,
    },
  };
}
