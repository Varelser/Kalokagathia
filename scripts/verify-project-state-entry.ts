import { buildProjectData, parseProjectData } from '../lib/projectState';
import { normalizeConfig } from '../lib/appStateConfig';
import { buildProjectExecutionRoutingMap } from '../lib/projectExecutionRouting';
import { buildProjectSerializationSnapshot } from '../lib/projectSerializationSnapshot';
import type { ParticleConfig, ProjectLayerSnapshotKey, ProjectExecutionRoutingSnapshot } from '../types';

interface VerificationResult {
  id: string;
  name: string;
  checks: string[];
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function verifyExecutionBlock(entry: ProjectExecutionRoutingSnapshot, values: string[], scenarioId: string, key: ProjectLayerSnapshotKey) {
  const requiredValues = [
    entry.resolvedEngine,
    entry.path,
    `requested:${entry.requestedEngine}`,
    `resolved:${entry.resolvedEngine}`,
    `path:${entry.path}`,
    entry.renderClass ? `render:${entry.renderClass}` : null,
    entry.simulationClass ? `simulation:${entry.simulationClass}` : null,
    entry.overrideId ? `override:${entry.overrideId}` : null,
    entry.proceduralSystemId ? `procedural:${entry.proceduralSystemId}` : null,
    entry.hybridKind ? `hybrid:${entry.hybridKind}` : null,
    ...(entry.capabilityFlags ?? []),
    ...((entry.sceneBranches ?? []).map((branch) => `branch:${branch}`)),
    ...((entry.notes ?? []).map((note) => `note:${note}`)),
  ].filter((value): value is string => typeof value === 'string' && value.length > 0);

  for (const value of requiredValues) {
    assert(
      values.includes(value),
      `[${scenarioId}:${key}] execution block missing "${value}"`,
    );
  }
}

function createProject(config: ParticleConfig, name: string) {
  return buildProjectData({
    name,
    config,
    activePresetId: null,
    presetBlendDuration: 1.5,
    sequenceLoopEnabled: true,
    presets: [],
    presetSequence: [],
    ui: {
      isPlaying: false,
      isPanelOpen: true,
      videoExportMode: 'current',
      videoDurationSeconds: 8,
      videoFps: 30,
    },
  });
}

function verifyScenario(id: string, name: string, config: ParticleConfig): VerificationResult {
  const project = createProject(config, name);
  const routingMap = buildProjectExecutionRoutingMap(config);
  const serialization = buildProjectSerializationSnapshot(config, project.schema.serializationSchemaVersion);
  const checks: string[] = [];

  assert(project.manifest.execution.length === 4, `[${id}] manifest.execution length mismatch`);
  assert(serialization.layers.length === 4, `[${id}] serialization.layers length mismatch`);
  checks.push('layer-counts');

  for (const key of ['layer1', 'layer2', 'layer3', 'gpgpu'] as const) {
    const manifestEntry = project.manifest.execution.find((entry) => entry.key === key);
    const routingEntry = routingMap[key];
    const layerSerialization = serialization.layers.find((layer) => layer.key === key);

    assert(manifestEntry, `[${id}:${key}] missing manifest execution entry`);
    assert(layerSerialization, `[${id}:${key}] missing serialization layer`);

    assert(manifestEntry.resolvedEngine === routingEntry.resolvedEngine, `[${id}:${key}] resolved engine drift`);
    assert(manifestEntry.requestedEngine === routingEntry.requestedEngine, `[${id}:${key}] requested engine drift`);
    assert(manifestEntry.path === routingEntry.path, `[${id}:${key}] path drift`);
    assert(manifestEntry.renderClass === routingEntry.renderClass, `[${id}:${key}] render class drift`);
    assert(manifestEntry.simulationClass === routingEntry.simulationClass, `[${id}:${key}] simulation class drift`);
    assert(JSON.stringify(manifestEntry.capabilityFlags) === JSON.stringify(routingEntry.capabilityFlags), `[${id}:${key}] capability flags drift`);
    assert(JSON.stringify(manifestEntry.sceneBranches ?? []) === JSON.stringify(routingEntry.sceneBranches ?? []), `[${id}:${key}] scene branches drift`);

    verifyExecutionBlock(routingEntry, layerSerialization.blocks.execution.values, id, key);
    checks.push(`${key}:execution-sync`);
  }

  const parsed = parseProjectData(JSON.parse(JSON.stringify(project)));
  assert(parsed, `[${id}] parseProjectData returned null`);
  assert(parsed.schema.serializationSchemaVersion === project.schema.serializationSchemaVersion, `[${id}] serialization schema changed on parse`);
  assert(parsed.manifest.execution.length === project.manifest.execution.length, `[${id}] manifest execution length changed on parse`);
  assert(parsed.serialization.layers.length === project.serialization.layers.length, `[${id}] serialization layer length changed on parse`);
  for (const entry of project.manifest.execution) {
    const parsedEntry = parsed.manifest.execution.find((candidate) => candidate.key === entry.key);
    assert(parsedEntry, `[${id}:${entry.key}] parsed manifest entry missing after roundtrip`);
    assert(JSON.stringify(parsedEntry.sceneBranches ?? []) === JSON.stringify(entry.sceneBranches ?? []), `[${id}:${entry.key}] scene branches changed on parse`);
  }
  checks.push('roundtrip-parse');

  const migratedPayload = JSON.parse(JSON.stringify(project)) as Record<string, unknown>;
  delete migratedPayload.schema;
  delete migratedPayload.serialization;
  migratedPayload.version = 24;
  const migrated = parseProjectData(migratedPayload);
  assert(migrated, `[${id}] migrated payload could not be parsed`);
  assert(migrated.schema.migrationState === 'migrated', `[${id}] migrated payload did not mark migrationState`);
  assert(migrated.schema.migratedFromProjectDataVersion === 24, `[${id}] migrated payload did not preserve migratedFromProjectDataVersion`);
  assert(migrated.serialization.layers.length === 4, `[${id}] migrated payload serialization rebuild failed`);
  checks.push('legacy-migration');

  return {
    id,
    name,
    checks,
  };
}

export async function main() {
  const scenarios: Array<{ id: string; name: string; config: ParticleConfig }> = [
    {
      id: 'baseline',
      name: 'Baseline project snapshot',
      config: normalizeConfig({}),
    },
    {
      id: 'hybrid-video',
      name: 'Hybrid + video + post FX snapshot',
      config: normalizeConfig({
        layer2Enabled: true,
        layer2Type: 'surface_shell',
        layer2Source: 'video',
        layer2ExecutionEngineOverride: 'auto',
        layer2ConnectionEnabled: true,
        layer2ConnectionStyle: 'filament',
        layer2GhostTrailEnabled: true,
        layer2GlyphOutlineEnabled: true,
        layer2MaterialStyle: 'glass',
        layer2GeomMode3D: 'icosa',
        layer2TemporalProfile: 'inhale',
        layer2SourceCount: 3,
        layer2SourceSpread: 2200,
        postFxStackProfile: 'dream-smear',
        postBloomEnabled: true,
        postDofEnabled: true,
      }),
    },
    {
      id: 'text-fiber-webgpu',
      name: 'Text/fiber layer + WebGPU-preferred GPGPU snapshot',
      config: normalizeConfig({
        layer3Enabled: true,
        layer3Type: 'fiber_field',
        layer3Source: 'text',
        layer3MaterialStyle: 'hologram',
        layer3ExecutionEngineOverride: 'hybrid-runtime',
        layer3SourceCount: 2,
        layer3SourceSpread: 1800,
        layer3TemporalProfile: 'recur',
        gpgpuEnabled: true,
        gpgpuExecutionPreference: 'webgpu',
        gpgpuWebGPUEnabled: true,
        gpgpuCount: 196608,
        gpgpuRibbonEnabled: true,
        gpgpuMetaballEnabled: true,
        gpgpuMetaballResolution: 56,
      }),
    },
  ];

  const results = scenarios.map((scenario) => verifyScenario(scenario.id, scenario.name, scenario.config));
  console.log(JSON.stringify({
    verifiedScenarioCount: results.length,
    scenarios: results,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
