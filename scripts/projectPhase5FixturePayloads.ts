import type { Phase5FixtureDefinition } from './projectPhase5FixturesShared';
import {
  FIXTURE_EXPORTED_AT,
  PROJECT_DATA_VERSION,
  PROJECT_MANIFEST_SCHEMA_VERSION,
  PROJECT_SERIALIZATION_SCHEMA_VERSION,
} from './projectPhase5FixturesShared';

function createBasePresets() {
  return [
    {
      id: 'preset-alpha',
      name: 'Alpha',
      config: {
        layer2Enabled: true,
        layer2Type: 'surface_shell',
        layer2Source: 'image',
      },
      createdAt: FIXTURE_EXPORTED_AT,
      updatedAt: FIXTURE_EXPORTED_AT,
    },
    {
      id: 'preset-beta',
      name: 'Beta',
      config: {
        layer3Enabled: true,
        layer3Type: 'fiber_field',
        layer3Source: 'text',
      },
      createdAt: FIXTURE_EXPORTED_AT,
      updatedAt: FIXTURE_EXPORTED_AT,
    },
  ];
}

function createBaseSequence() {
  return [
    {
      id: 'seq-1',
      presetId: 'preset-alpha',
      label: 'Open',
      holdSeconds: 2,
      transitionSeconds: 1.2,
      transitionEasing: 'ease-in-out',
      screenSequenceDriveMode: 'inherit',
      screenSequenceDriveStrengthMode: 'inherit',
      screenSequenceDriveStrengthOverride: 1,
      screenSequenceDriveMultiplier: 1,
      keyframeConfig: null,
    },
    {
      id: 'seq-2',
      presetId: 'preset-beta',
      label: 'Close',
      holdSeconds: 2.4,
      transitionSeconds: 1.4,
      transitionEasing: 'linear',
      screenSequenceDriveMode: 'on',
      screenSequenceDriveStrengthMode: 'override',
      screenSequenceDriveStrengthOverride: 1.3,
      screenSequenceDriveMultiplier: 0.85,
      keyframeConfig: {
        layer2Enabled: true,
        layer2Type: 'reaction_diffusion',
      },
    },
  ];
}

function createBaseProject(name: string, currentConfig: Record<string, unknown>): Record<string, unknown> {
  return {
    version: PROJECT_DATA_VERSION,
    schema: {
      format: 'monosphere-project',
      projectDataVersion: PROJECT_DATA_VERSION,
      manifestSchemaVersion: PROJECT_MANIFEST_SCHEMA_VERSION,
      serializationSchemaVersion: PROJECT_SERIALIZATION_SCHEMA_VERSION,
      migrationState: 'native',
      migratedFromProjectDataVersion: null,
    },
    exportedAt: FIXTURE_EXPORTED_AT,
    name,
    currentConfig,
    activePresetId: 'preset-alpha',
    presetBlendDuration: 1.8,
    sequenceLoopEnabled: true,
    presets: createBasePresets(),
    presetSequence: createBaseSequence(),
    ui: {
      isPlaying: false,
      isPanelOpen: true,
      videoExportMode: 'sequence',
      videoDurationSeconds: 9,
      videoFps: 30,
    },
  };
}

function createNativeSerializationLayers() {
  return [
    {
      key: 'layer1',
      label: 'Layer 1',
      modeId: 'spheres',
      blocks: {
        source: { id: 'source', label: 'Source', values: ['builtin', 'single-source'] },
        simulation: { id: 'simulation', label: 'Simulation', values: ['spheres', 'cpu-noise-field', 'pulse-drive'] },
        primitive: { id: 'primitive', label: 'Primitive', values: ['sphere-cloud', 'sprite'] },
        shading: { id: 'shading', label: 'Shading', values: ['classic-particle', 'white', 'black'] },
        postfx: { id: 'postfx', label: 'Post FX', values: ['dream-smear', 'bloom'] },
        execution: { id: 'execution', label: 'Execution', values: ['cpu-geometry', 'points', 'cpu-noise-field', 'requested:cpu-geometry', 'resolved:cpu-geometry', 'path:points', 'render:point-cloud', 'simulation:cpu-noise-field', 'override:baseline', 'webgl-stable', 'mobile-risky', 'branch:particle-core', 'note:classic sprite path'] },
      },
    },
    {
      key: 'layer2',
      label: 'Layer 2',
      modeId: 'surface_shell',
      blocks: {
        source: { id: 'source', label: 'Source', values: ['video', 'luminance-map'] },
        simulation: { id: 'simulation', label: 'Simulation', values: ['surface_shell', 'surface-shell', 'steady'] },
        primitive: { id: 'primitive', label: 'Primitive', values: ['icosa', 'ghost-trail', 'glyph-outline', 'connections:filament'] },
        shading: { id: 'shading', label: 'Shading', values: ['classic', 'procedural:surface-shell'] },
        postfx: { id: 'postfx', label: 'Post FX', values: ['dream-smear', 'bloom'] },
        execution: { id: 'execution', label: 'Execution', values: ['webgl-procedural-surface', 'surface', 'webgl-procedural-family', 'requested:webgl-procedural-surface', 'resolved:webgl-procedural-surface', 'path:surface', 'render:shell', 'simulation:webgl-procedural-family', 'override:auto', 'procedural:surface-shell', 'webgl-stable', 'mobile-risky', 'branch:procedural:surface-shell', 'note:source-field:unified-field', 'note:distance-field ready', 'note:flow-sampling ready'] },
      },
    },
    {
      key: 'layer3',
      label: 'Layer 3',
      modeId: 'fiber_field',
      blocks: {
        source: { id: 'source', label: 'Source', values: ['text', 'glyph-map'] },
        simulation: { id: 'simulation', label: 'Simulation', values: ['fiber_field', 'fiber-field', 'steady'] },
        primitive: { id: 'primitive', label: 'Primitive', values: ['tube'] },
        shading: { id: 'shading', label: 'Shading', values: ['classic', 'procedural:fiber-field'] },
        postfx: { id: 'postfx', label: 'Post FX', values: ['dream-smear', 'bloom'] },
        execution: { id: 'execution', label: 'Execution', values: ['webgl-procedural-surface', 'surface', 'webgl-procedural-family', 'requested:webgl-procedural-surface', 'resolved:webgl-procedural-surface', 'path:surface', 'render:line-field', 'simulation:webgl-procedural-family', 'override:auto', 'procedural:fiber-field', 'webgl-stable', 'branch:procedural:fiber-field', 'note:source-field:unified-field', 'note:distance-field ready', 'note:flow-sampling ready'] },
      },
    },
    {
      key: 'gpgpu',
      label: 'GPGPU',
      modeId: 'metaball',
      blocks: {
        source: { id: 'source', label: 'Source', values: ['sphere', 'gpu-emitter'] },
        simulation: { id: 'simulation', label: 'Simulation', values: ['fluid-field', 'gpu-particles'] },
        primitive: { id: 'primitive', label: 'Primitive', values: ['sphere', 'metaball', 'volumetric'] },
        shading: { id: 'shading', label: 'Shading', values: ['particle-color'] },
        postfx: { id: 'postfx', label: 'Post FX', values: ['dream-smear', 'bloom'] },
        execution: { id: 'execution', label: 'Execution', values: ['webgl-gpgpu', 'points', 'webgl-gpgpu + fluid-field', 'requested:webgl-gpgpu', 'resolved:webgl-gpgpu', 'path:points', 'render:gpu-particles', 'simulation:webgl-gpgpu + fluid-field', 'override:auto', 'webgl-stable', 'branch:gpgpu-core', 'note:supported:particles', 'note:unsupported:fluid-field'] },
      },
    },
  ];
}

function createNativeManifest() {
  return {
    schemaVersion: PROJECT_MANIFEST_SCHEMA_VERSION,
    serializationSchemaVersion: PROJECT_SERIALIZATION_SCHEMA_VERSION,
    layers: [
      { key: 'layer1', label: 'Layer 1', enabled: true, mode: 'spheres', source: 'builtin', material: 'particle-color', geometry: 'sphere-cloud', features: ['core'] },
      { key: 'layer2', label: 'Layer 2', enabled: true, mode: 'surface_shell', source: 'video', material: 'glass', geometry: 'icosa', connectionStyle: 'filament', features: ['ghost-trail', 'glyph-outline'] },
      { key: 'layer3', label: 'Layer 3', enabled: true, mode: 'fiber_field', source: 'text', material: 'glass', geometry: 'tube', features: ['fiber'] },
      { key: 'gpgpu', label: 'GPGPU', enabled: true, mode: 'metaball', source: 'sphere', material: 'particle-color', geometry: 'sphere', features: ['metaball', 'volumetric'], capabilityFlags: ['webgpu-preferred'] },
    ],
    execution: [
      { key: 'layer1', label: 'Layer 1', enabled: true, mode: 'spheres', renderClass: 'particles', simulationClass: 'cpu-field', requestedEngine: 'cpu-geometry', resolvedEngine: 'cpu-geometry', path: 'points', overrideId: '', proceduralSystemId: null as string | null, hybridKind: null as string | null, capabilityFlags: ['webgl-stable'], reason: 'baseline', notes: [] as string[], sceneBranches: ['particle-core'] },
      { key: 'layer2', label: 'Layer 2', enabled: true, mode: 'surface_shell', renderClass: 'surfaces', simulationClass: 'particle-field', requestedEngine: 'webgl-particle', resolvedEngine: 'webgl-particle', path: 'points', overrideId: '', proceduralSystemId: null, hybridKind: null, capabilityFlags: ['webgl-stable'], reason: 'baseline', notes: [], sceneBranches: ['hybrid-surface'] },
      { key: 'layer3', label: 'Layer 3', enabled: true, mode: 'fiber_field', renderClass: 'lines', simulationClass: 'particle-field', requestedEngine: 'webgl-particle', resolvedEngine: 'webgl-particle', path: 'points', overrideId: '', proceduralSystemId: null, hybridKind: null, capabilityFlags: ['webgl-stable'], reason: 'baseline', notes: [], sceneBranches: ['fiber'] },
      { key: 'gpgpu', label: 'GPGPU', enabled: true, mode: 'metaball', renderClass: 'metaballs', simulationClass: 'gpu-particles', requestedEngine: 'webgpu', resolvedEngine: 'webgpu', path: 'points', overrideId: '', proceduralSystemId: null, hybridKind: null, capabilityFlags: ['webgpu-preferred'], reason: 'preferred', notes: [], sceneBranches: ['gpgpu'] },
    ],
    coverage: {
      depictionMethods: ['particle', 'surface', 'fiber'],
      motionFamilies: ['rewrite', 'recur'],
      computeBackends: ['webgl', 'webgpu'],
      sourceFamilies: ['video', 'text', 'gpgpu'],
      renderFamilies: ['particles', 'surfaces', 'lines', 'metaballs'],
      postFamilies: ['bloom'],
      solverFamilies: ['particle-field', 'gpu-particles'],
      specialistFamilies: [] as string[],
      physicalFamilies: [] as string[],
      geometryFamilies: ['icosa', 'tube', 'sphere'],
      temporalFamilies: ['rewrite', 'recur'],
      productPackFamilies: [] as string[],
      depictionMethodCount: 3,
      motionFamilyCount: 2,
      computeBackendCount: 2,
      sourceFamilyCount: 3,
      renderFamilyCount: 4,
      postFamilyCount: 1,
      solverFamilyCount: 2,
      specialistFamilyCount: 0,
      physicalFamilyCount: 0,
      geometryFamilyCount: 3,
      temporalFamilyCount: 2,
      productPackFamilyCount: 0,
      productPackCount: 0,
      postStackTemplateCount: 1,
      gpgpuFeatureCount: 2,
      coverageGapCount: 0,
      productPackScorecardCount: 0,
      activeProductPackCoverageScore: 0,
      currentCoverageScore: 0,
      currentTargetHitCount: 0,
      currentTargetTotal: 0,
      overallCoverageScore: 0,
      overallTargetHitCount: 0,
      overallTargetTotal: 0,
      averagePackCoverageScore: 0,
      bestPackCoverageScore: 0,
      augmentationSuggestionCount: 0,
    },
    stats: {
      presetCount: 2,
      sequenceCount: 2,
      sequenceLoopEnabled: true,
    },
  };
}

export function createNativeRichFixturePayload(): Record<string, unknown> {
  return {
    ...createBaseProject('Phase 5 Native Rich Fixture', {
      layer2Enabled: true,
      layer2Type: 'surface_shell',
      layer2Source: 'video',
      layer3Enabled: true,
      layer3Type: 'fiber_field',
      layer3Source: 'text',
      gpgpuEnabled: true,
      gpgpuFluidEnabled: true,
      postFxStackProfile: 'dream-smear',
      postBloomEnabled: true,
    }),
    serialization: {
      schemaVersion: PROJECT_SERIALIZATION_SCHEMA_VERSION,
      layers: createNativeSerializationLayers(),
    },
    manifest: createNativeManifest(),
  };
}

export function createSparseLayer2FixturePayload(): Record<string, unknown> {
  const project = createNativeRichFixturePayload();
  const layers = (project.serialization as { schemaVersion: number; layers: Array<Record<string, unknown>> }).layers.map((layer) => {
    if (layer.key !== 'layer2') return layer;
    return {
      ...layer,
      label: 'Layer 2 Custom',
      modeId: 'custom-mode-id',
      blocks: {
        source: { id: 'source-custom', label: 'Source Custom', values: ['custom-source-token'] },
        simulation: { id: 'simulation-custom', label: 'Simulation Custom', values: [] },
        primitive: { id: 'primitive-custom', label: 'Primitive Custom', values: ['custom-primitive-token'] },
        shading: { id: 'shading-custom', label: 'Shading Custom', values: [] },
        postfx: { id: 'postfx-custom', label: 'Post FX Custom', values: ['custom-postfx-token'] },
        execution: { id: 'execution-custom', label: 'Execution Custom', values: ['custom-execution-token'] },
      },
    };
  });
  return {
    ...project,
    name: 'Phase 5 Sparse Layer2 Fixture',
    serialization: {
      schemaVersion: 1,
      layers,
    },
  };
}

export function createLegacyV24FixturePayload(): Record<string, unknown> {
  const project = createBaseProject('Phase 5 Legacy v24 Fixture', {
    layer2Enabled: true,
    layer2Type: 'reaction_diffusion',
    layer2Source: 'image',
    layer3Enabled: true,
    layer3Type: 'surface_shell',
    layer3Source: 'video',
    gpgpuEnabled: true,
    gpgpuFluidEnabled: true,
    postFxStackProfile: 'dream-smear',
    postBloomEnabled: true,
  });
  delete (project as Record<string, unknown>).schema;
  delete (project as Record<string, unknown>).serialization;
  delete (project as Record<string, unknown>).manifest;
  return {
    ...project,
    version: 24,
  };
}

export function createDuplicateIdsInvalidActiveFixturePayload(): Record<string, unknown> {
  const native = createNativeRichFixturePayload();
  return {
    ...native,
    name: 'Phase 5 Duplicate IDs + Invalid Active Fixture',
    activePresetId: 'preset-missing',
    presets: [
      {
        ...(native.presets as Array<Record<string, unknown>>)[0],
        id: 'preset-duplicate',
        name: 'Duplicate A',
      },
      {
        ...(native.presets as Array<Record<string, unknown>>)[1],
        id: 'preset-duplicate',
        name: 'Duplicate B',
      },
    ],
    presetSequence: [
      {
        ...(native.presetSequence as Array<Record<string, unknown>>)[0],
        id: 'seq-duplicate',
        presetId: 'preset-duplicate',
        label: 'Duplicate Start',
      },
      {
        ...(native.presetSequence as Array<Record<string, unknown>>)[1],
        id: 'seq-duplicate',
        presetId: 'preset-duplicate',
        label: 'Duplicate End',
      },
    ],
  };
}

export function createOrphanSequenceFixturePayload(): Record<string, unknown> {
  const native = createNativeRichFixturePayload();
  return {
    ...native,
    name: 'Phase 5 Orphan Sequence Fixture',
    activePresetId: 'preset-alpha',
    presetSequence: [
      {
        ...(native.presetSequence as Array<Record<string, unknown>>)[0],
        id: 'seq-valid',
        presetId: 'preset-alpha',
        label: 'Valid Step',
      },
      {
        ...(native.presetSequence as Array<Record<string, unknown>>)[1],
        id: 'seq-orphan',
        presetId: 'preset-gone',
        label: 'Orphan Step',
      },
    ],
  };
}

export const PHASE5_FIXTURE_DEFINITIONS: Phase5FixtureDefinition[] = [
  {
    id: 'native-rich',
    fileName: 'phase5-native-rich.json',
    description: 'Current-schema native project export with routing-aware serialization blocks enabled.',
    buildPayload: createNativeRichFixturePayload,
  },
  {
    id: 'sparse-layer2-custom',
    fileName: 'phase5-sparse-layer2-custom.json',
    description: 'Sparse custom layer2 serialization payload that must preserve custom tokens while backfilling fallback routing blocks.',
    buildPayload: createSparseLayer2FixturePayload,
  },
  {
    id: 'legacy-v24',
    fileName: 'phase5-legacy-v24.json',
    description: 'Pre-schema project payload that relies on migration to rebuild manifest and serialization snapshots.',
    buildPayload: createLegacyV24FixturePayload,
  },
  {
    id: 'duplicate-ids-invalid-active',
    fileName: 'phase5-duplicate-ids-invalid-active.json',
    description: 'Current-schema payload with duplicate preset IDs, duplicate sequence IDs, and an invalid active preset that import preparation must repair.',
    buildPayload: createDuplicateIdsInvalidActiveFixturePayload,
  },
  {
    id: 'orphan-sequence',
    fileName: 'phase5-orphan-sequence.json',
    description: 'Current-schema payload with an orphan sequence step that references a missing preset and must be dropped during import preparation.',
    buildPayload: createOrphanSequenceFixturePayload,
  },
];
