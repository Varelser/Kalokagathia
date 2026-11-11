import type {
  ParticleConfig,
  ProjectLayerSerializationBlocks,
  ProjectLayerSerializationSnapshot,
  ProjectSerializationBlock,
  ProjectSerializationSnapshot,
  ProjectLayerSnapshotKey,
} from '../types';
import { buildProjectExecutionRoutingMap } from './projectExecutionRouting';
import { getDepictionArchitecture } from './depictionArchitecture';
import { inferPostFxStackBundleId } from './postFxLibrary';
import { getProceduralSystemId } from './proceduralModeRegistry';
import { isPlainObject } from './projectStateShared';

function clean(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)));
}

function createBlock(id: string, label: string, values: Array<string | null | undefined>): ProjectSerializationBlock {
  return {
    id,
    label,
    values: clean(values),
  };
}

function buildExecutionSerializationValues(execution: ReturnType<typeof buildProjectExecutionRoutingMap>[ProjectLayerSnapshotKey] | undefined, fallbackEngine: string, fallbackPath: string) {
  if (!execution) return [fallbackEngine, fallbackPath];
  return clean([
    execution.resolvedEngine || fallbackEngine,
    execution.path || fallbackPath,
    execution.simulationClass,
    `requested:${execution.requestedEngine}`,
    `resolved:${execution.resolvedEngine}`,
    `path:${execution.path}`,
    execution.renderClass ? `render:${execution.renderClass}` : null,
    execution.simulationClass ? `simulation:${execution.simulationClass}` : null,
    execution.overrideId ? `override:${execution.overrideId}` : null,
    execution.proceduralSystemId ? `procedural:${execution.proceduralSystemId}` : null,
    execution.hybridKind ? `hybrid:${execution.hybridKind}` : null,
    ...(execution.capabilityFlags ?? []),
    ...((execution.sceneBranches ?? []).map((branch) => `branch:${branch}`)),
    ...((execution.notes ?? []).map((note) => `note:${note}`)),
  ]);
}

function buildLayerBlocks(config: ParticleConfig, key: ProjectLayerSnapshotKey, routingMap: ReturnType<typeof buildProjectExecutionRoutingMap>): ProjectLayerSerializationBlocks {
  const execution = routingMap[key];
  const postStackId = inferPostFxStackBundleId(config) ?? 'manual';

  if (key === 'layer1') {
    return {
      source: createBlock('source', 'Source', ['builtin', config.layer1SourceCount > 1 ? 'multi-source' : 'single-source']),
      simulation: createBlock('simulation', 'Simulation', ['spheres', 'cpu-noise-field', config.pulseAmplitude > 0.05 ? 'pulse-drive' : 'steady']),
      primitive: createBlock('primitive', 'Primitive', ['sphere-cloud', config.layer1SdfEnabled ? 'sdf-shape' : 'sprite']),
      shading: createBlock('shading', 'Shading', [config.sdfShapeEnabled ? 'global-sdf-lighting' : 'classic-particle', config.particleColor, config.backgroundColor]),
      postfx: createBlock('postfx', 'Post FX', [postStackId, config.postBloomEnabled ? 'bloom' : null, config.postNoiseEnabled ? 'noise' : null, config.postVignetteEnabled ? 'vignette' : null]),
      execution: createBlock('execution', 'Execution', buildExecutionSerializationValues(execution, 'cpu-geometry', 'points')),
    };
  }

  if (key === 'layer2' || key === 'layer3') {
    const layerIndex = key === 'layer2' ? 2 : 3;
    const mode = layerIndex === 2 ? config.layer2Type : config.layer3Type;
    const source = layerIndex === 2 ? config.layer2Source : config.layer3Source;
    const material = layerIndex === 2 ? config.layer2MaterialStyle : config.layer3MaterialStyle;
    const geometry = layerIndex === 2 ? config.layer2GeomMode3D : config.layer3GeomMode3D;
    const connectionEnabled = layerIndex === 2 ? config.layer2ConnectionEnabled : config.layer3ConnectionEnabled;
    const connectionStyle = layerIndex === 2 ? config.layer2ConnectionStyle : config.layer3ConnectionStyle;
    const ghostTrailEnabled = layerIndex === 2 ? config.layer2GhostTrailEnabled : config.layer3GhostTrailEnabled;
    const glyphOutlineEnabled = layerIndex === 2 ? config.layer2GlyphOutlineEnabled : config.layer3GlyphOutlineEnabled;
    const sdfEnabled = layerIndex === 2 ? config.layer2SdfEnabled : config.layer3SdfEnabled;
    const temporalProfile = layerIndex === 2 ? config.layer2TemporalProfile : config.layer3TemporalProfile;
    const proceduralSystemId = getProceduralSystemId(mode);
    const depiction = getDepictionArchitecture(mode);

    return {
      source: createBlock('source', 'Source', [source, source === 'text' ? 'glyph-map' : null, source === 'image' || source === 'video' ? 'luminance-map' : null]),
      simulation: createBlock('simulation', 'Simulation', [mode, proceduralSystemId ?? 'particle-field', temporalProfile]),
      primitive: createBlock('primitive', 'Primitive', [geometry, depiction.renderPrimitive, connectionEnabled ? `connections:${connectionStyle}` : null, ghostTrailEnabled ? 'ghost-trail' : null, glyphOutlineEnabled ? 'glyph-outline' : null]),
      shading: createBlock('shading', 'Shading', [material, sdfEnabled ? 'sdf-lighting' : null, proceduralSystemId ? `procedural:${proceduralSystemId}` : null]),
      postfx: createBlock('postfx', 'Post FX', [postStackId, config.interLayerContactFxEnabled ? 'contact-fx' : null, config.postBloomEnabled ? 'bloom' : null, config.postDofEnabled ? 'dof' : null]),
      execution: createBlock('execution', 'Execution', buildExecutionSerializationValues(execution, 'webgl-particle', 'points')),
    };
  }

  return {
    source: createBlock('source', 'Source', [config.gpgpuEmitShape, 'gpu-emitter']),
    simulation: createBlock('simulation', 'Simulation', [config.gpgpuFluidEnabled ? 'fluid-field' : null, config.gpgpuSphEnabled ? 'sph' : null, config.gpgpuBoidsEnabled ? 'boids' : null, config.gpgpuAttractorEnabled ? 'attractor' : null, config.gpgpuVortexEnabled ? 'vortex' : null, config.gpgpuCurlEnabled ? 'curl' : null, 'gpu-particles']),
    primitive: createBlock('primitive', 'Primitive', [config.gpgpuGeomMode, config.gpgpuMetaballEnabled ? 'metaball' : null, config.gpgpuVolumetricEnabled ? 'volumetric' : null, config.gpgpuRibbonEnabled ? 'ribbon' : null, config.gpgpuTubeEnabled ? 'tube' : null, config.gpgpuSmoothTubeEnabled ? 'smooth-tube' : null]),
    shading: createBlock('shading', 'Shading', [config.gpgpuMetaballEnabled ? config.gpgpuMetaballStyle : 'particle-color', config.gpgpuVelColorEnabled ? 'velocity-color' : null, config.gpgpuAgeColorEnabled ? 'age-color' : null]),
    postfx: createBlock('postfx', 'Post FX', [postStackId, config.postBloomEnabled ? 'bloom' : null, config.postChromaticAberrationEnabled ? 'chromatic-aberration' : null]),
    execution: createBlock('execution', 'Execution', buildExecutionSerializationValues(execution, 'webgl-gpgpu', 'points')),
  };
}

function buildLayerSerializationSnapshot(config: ParticleConfig, key: ProjectLayerSnapshotKey, routingMap: ReturnType<typeof buildProjectExecutionRoutingMap>): ProjectLayerSerializationSnapshot {
  const labelMap: Record<ProjectLayerSnapshotKey, string> = {
    layer1: 'Layer 1',
    layer2: 'Layer 2',
    layer3: 'Layer 3',
    gpgpu: 'GPGPU',
  };
  const modeId = key === 'layer1'
    ? 'spheres'
    : key === 'layer2'
      ? config.layer2Type
      : key === 'layer3'
        ? config.layer3Type
        : (config.gpgpuMetaballEnabled ? 'metaball' : config.gpgpuVolumetricEnabled ? 'volumetric' : 'particles');

  return {
    key,
    label: labelMap[key],
    modeId,
    blocks: buildLayerBlocks(config, key, routingMap),
  };
}

export function buildProjectSerializationSnapshot(config: ParticleConfig, schemaVersion: number): ProjectSerializationSnapshot {
  const routingMap = buildProjectExecutionRoutingMap(config);
  return {
    schemaVersion,
    layers: [
      buildLayerSerializationSnapshot(config, 'layer1', routingMap),
      buildLayerSerializationSnapshot(config, 'layer2', routingMap),
      buildLayerSerializationSnapshot(config, 'layer3', routingMap),
      buildLayerSerializationSnapshot(config, 'gpgpu', routingMap),
    ],
  };
}

function normalizeProjectSerializationBlock(payload: unknown, fallback: ProjectSerializationBlock): ProjectSerializationBlock {
  if (!isPlainObject(payload)) return fallback;
  const values = Array.isArray(payload.values)
    ? payload.values.filter((item): item is string => typeof item === 'string')
    : [];
  return {
    id: typeof payload.id === 'string' ? payload.id : fallback.id,
    label: typeof payload.label === 'string' ? payload.label : fallback.label,
    values: clean([...values, ...fallback.values]),
  };
}

export function normalizeProjectSerializationSnapshot(
  payload: unknown,
  config: ParticleConfig,
  schemaVersion: number,
): ProjectSerializationSnapshot {
  const fallback = buildProjectSerializationSnapshot(config, schemaVersion);
  if (!isPlainObject(payload) || !Array.isArray(payload.layers)) {
    return fallback;
  }

  const serializedLayers = payload.layers as unknown[];
  return {
    schemaVersion,
    layers: fallback.layers.map((fallbackLayer) => {
      const matched = serializedLayers.find((item): item is Record<string, unknown> => isPlainObject(item) && item.key === fallbackLayer.key);
      if (!matched) return fallbackLayer;
      const blocks = isPlainObject(matched.blocks) ? matched.blocks : {};
      return {
        ...fallbackLayer,
        label: typeof matched.label === 'string' ? matched.label : fallbackLayer.label,
        modeId: typeof matched.modeId === 'string' ? matched.modeId : fallbackLayer.modeId,
        blocks: {
          source: normalizeProjectSerializationBlock(blocks.source, fallbackLayer.blocks.source),
          simulation: normalizeProjectSerializationBlock(blocks.simulation, fallbackLayer.blocks.simulation),
          primitive: normalizeProjectSerializationBlock(blocks.primitive, fallbackLayer.blocks.primitive),
          shading: normalizeProjectSerializationBlock(blocks.shading, fallbackLayer.blocks.shading),
          postfx: normalizeProjectSerializationBlock(blocks.postfx, fallbackLayer.blocks.postfx),
          execution: normalizeProjectSerializationBlock(blocks.execution, fallbackLayer.blocks.execution),
        },
      };
    }),
  };
}
