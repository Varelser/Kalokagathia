import type { ParticleConfig } from '../types';
import { getDepictionArchitecture } from './depictionArchitecture';
import { getMotionArchitecture } from './motionArchitecture';

export function uniqueNonEmpty(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)));
}

function normalizeMotionFamily(family: string) {
  return family.trim().toLowerCase();
}

export function normalizeSourceFamily(source: string | null | undefined) {
  if (!source) return null;

  switch (source) {
    case 'sphere':
    case 'center':
    case 'ring':
    case 'disc':
    case 'cone':
      return 'radial-primitives';
    case 'cube':
    case 'box':
      return 'box-volume';
    case 'cylinder':
    case 'torus':
    case 'spiral':
      return 'curve-solids';
    case 'galaxy':
      return 'procedural-galaxy';
    case 'grid':
    case 'plane':
      return 'planar-field';
    case 'image':
      return 'image-map';
    case 'video':
      return 'video-map';
    case 'text':
      return 'text-glyph';
    case 'random':
      return 'random-scatter';
    case 'shell':
      return 'shell-volume';
    default:
      return source;
  }
}

function getPrimitiveRenderFamily(primitive: string) {
  switch (primitive) {
    case 'points':
      return 'point-sprite';
    case 'lines':
      return 'linework';
    case 'surface mesh':
      return 'surface-mesh';
    case 'instanced solids':
      return 'instanced-solids';
    case 'fog slices':
      return 'volumetric-slices';
    default:
      return primitive;
  }
}

export function getLayerDepictionMethod(config: ParticleConfig, key: 'layer1' | 'layer2' | 'layer3') {
  if (key === 'layer1') {
    return config.layer1Enabled ? 'cpu-point-cloud' : null;
  }

  const enabled = key === 'layer2' ? config.layer2Enabled : config.layer3Enabled;
  if (!enabled) return null;

  const mode = key === 'layer2' ? config.layer2Type : config.layer3Type;
  const depiction = getDepictionArchitecture(mode);
  return `${depiction.depictionClass}:${depiction.renderPrimitive}`;
}

function normalizeMotionDriver(driver: string) {
  switch (driver.trim().toLowerCase()) {
    case 'structural':
      return 'structure';
    default:
      return driver.trim().toLowerCase();
  }
}

function getTemporalMotionFamily(temporalBehavior: string) {
  switch (temporalBehavior.trim().toLowerCase()) {
    case 'oscillatory':
    case 'pulsed':
      return 'oscillation';
    default:
      return null;
  }
}

export function getLayerMotionFamilies(config: ParticleConfig, key: 'layer2' | 'layer3') {
  const enabled = key === 'layer2' ? config.layer2Enabled : config.layer3Enabled;
  if (!enabled) return [];

  const mode = key === 'layer2' ? config.layer2Type : config.layer3Type;
  const architecture = getMotionArchitecture(mode);
  return uniqueNonEmpty([
    normalizeMotionFamily(architecture.family),
    normalizeMotionDriver(architecture.driver),
    getTemporalMotionFamily(architecture.temporalBehavior),
  ]);
}

function getModeDrivenSourceFamilies(mode: ParticleConfig['layer2Type'], source: string | null | undefined) {
  const depiction = getDepictionArchitecture(mode);
  return uniqueNonEmpty([
    ['ring', 'spiral', 'torus', 'cylinder'].includes(source ?? '') ? 'curve-path' : null,
    ['plane', 'grid', 'image', 'video', 'text'].includes(source ?? '') ? 'surface-map' : null,
    source === 'text' ? 'glyph-mask' : null,
    depiction.depictionClass === 'brush-sheet' ? 'brush-field' : null,
    (depiction.depictionClass === 'surface' || depiction.depictionClass === 'shell' || depiction.depictionClass === 'halo') ? 'surface-map' : null,
    ((depiction.depictionClass === 'line-field' || depiction.depictionClass === 'mesh' || depiction.depictionClass === 'ribbon') && ['plane', 'text'].includes(source ?? '')) ? 'curve-path' : null,
  ]);
}

export function getLayerSourceFamilies(config: ParticleConfig, key: 'layer1' | 'layer2' | 'layer3') {
  if (key === 'layer1') {
    return config.layer1Enabled ? ['builtin-sphere-cloud'] : [];
  }

  const isLayer2 = key === 'layer2';
  const enabled = isLayer2 ? config.layer2Enabled : config.layer3Enabled;
  if (!enabled) return [];

  const source = isLayer2 ? config.layer2Source : config.layer3Source;
  const mode = isLayer2 ? config.layer2Type : config.layer3Type;

  return uniqueNonEmpty([
    normalizeSourceFamily(source),
    ...getModeDrivenSourceFamilies(mode, source),
  ]);
}

function getModeDrivenRenderFamilies(mode: ParticleConfig['layer2Type'], source: string | null | undefined, instanced: boolean, sdfEnabled: boolean) {
  const depiction = getDepictionArchitecture(mode);
  return uniqueNonEmpty([
    depiction.depictionClass === 'brush-sheet' ? 'brush-sheet' : null,
    (['surface', 'shell', 'brush-sheet', 'halo'].includes(depiction.depictionClass) && ['image', 'video', 'text'].includes(source ?? '')) ? 'mapped-surface' : null,
    depiction.depictionClass === 'ribbon' ? 'curve-ribbons' : null,
    ((depiction.depictionClass === 'line-field' || depiction.depictionClass === 'mesh') && ['ring', 'spiral', 'torus', 'cylinder', 'text', 'plane'].includes(source ?? '')) ? 'path-lines' : null,
    instanced ? 'instanced-object-swarm' : null,
    sdfEnabled ? 'sdf-lighting' : null,
  ]);
}

export function getLayerRenderFamilies(config: ParticleConfig, key: 'layer1' | 'layer2' | 'layer3') {
  if (key === 'layer1') {
    if (!config.layer1Enabled) return [];
    return uniqueNonEmpty([
      'point-sprite',
      config.layer1SdfEnabled ? 'sdf-lighting' : null,
    ]);
  }

  const isLayer2 = key === 'layer2';
  const enabled = isLayer2 ? config.layer2Enabled : config.layer3Enabled;
  if (!enabled) return [];

  const mode = isLayer2 ? config.layer2Type : config.layer3Type;
  const source = isLayer2 ? config.layer2Source : config.layer3Source;
  const depiction = getDepictionArchitecture(mode);
  const instanced = (isLayer2 ? config.layer2GeomMode3D : config.layer3GeomMode3D) !== 'billboard';
  const sdfEnabled = isLayer2 ? config.layer2SdfEnabled : config.layer3SdfEnabled;

  return uniqueNonEmpty([
    depiction.depictionClass,
    getPrimitiveRenderFamily(depiction.renderPrimitive),
    (isLayer2 ? config.layer2ConnectionEnabled : config.layer3ConnectionEnabled) ? 'connections' : null,
    (isLayer2 ? config.layer2GhostTrailEnabled : config.layer3GhostTrailEnabled) ? 'ghost-trails' : null,
    (isLayer2 ? config.layer2GlyphOutlineEnabled : config.layer3GlyphOutlineEnabled) ? 'glyph-outline' : null,
    (isLayer2 ? config.layer2AuxEnabled : config.layer3AuxEnabled) ? 'aux-particles' : null,
    (isLayer2 ? config.layer2SparkEnabled : config.layer3SparkEnabled) ? 'spark-emission' : null,
    sdfEnabled ? 'sdf-lighting' : null,
    instanced ? 'instanced-geometry' : null,
    (isLayer2 ? config.layer2MaterialStyle : config.layer3MaterialStyle) === 'halftone' ? 'halftone-material' : null,
    ...getModeDrivenRenderFamilies(mode, source, instanced, sdfEnabled),
  ]);
}
