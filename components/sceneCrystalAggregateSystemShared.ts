import * as THREE from 'three';
import type { ParticleConfig } from '../types';
import { getLayerParticleLayoutDeps, getLayerRuntimeCrystalSnapshot, getLayerRuntimeMode } from '../lib/sceneRenderRouting';
import { generateParticleData, type ParticleData } from './particleData';

export type CrystalSettings = {
  opacity: number;
  scale: number;
  density: number;
  spread: number;
  audioReactive: number;
  wireframe: boolean;
  color: string;
  materialStyle: ParticleConfig['layer2MaterialStyle'];
  source: ParticleConfig['layer2Source'];
  radiusScale: number;
};

export type CrystalMode = ParticleConfig['layer2Type'];
export type GeometryKind = 'tetra' | 'octa' | 'icosa';

export type CrystalProfile = {
  geometry: GeometryKind;
  anchorMul: number;
  perAnchorMul: number;
  radiusMul: number;
  verticalLift: number;
  ringFlatten: number;
  orbitBias: number;
  bloomBias: number;
  gustBias: number;
  spin: number;
  directionJitter: number;
  scaleX: number;
  scaleY: number;
  scaleZ: number;
  opacityMul: number;
  opacityAdd: number;
  roughness: number;
  metalness: number;
  hueShift: number;
  lightnessShift: number;
  chainAmount: number;
  sheetAmount: number;
  settleAmount: number;
  tumbleAmount: number;
  basinBias: number;
  haloAmount: number;
};

export type ClusterLayout = {
  particleData: ParticleData;
  anchorIndices: Uint32Array;
  instanceCount: number;
  perAnchor: number;
};

const DEFAULT_CRYSTAL_PROFILE: CrystalProfile = {
  geometry: 'octa', anchorMul: 1, perAnchorMul: 1, radiusMul: 1, verticalLift: 0, ringFlatten: 0, orbitBias: 0, bloomBias: 0, gustBias: 0, spin: 0.18, directionJitter: 0.34, scaleX: 1, scaleY: 1.42, scaleZ: 1, opacityMul: 1, opacityAdd: 0, roughness: 0.42, metalness: 0.18, hueShift: 0, lightnessShift: 0, chainAmount: 0, sheetAmount: 0, settleAmount: 0, tumbleAmount: 0, basinBias: 0, haloAmount: 0,
};

const CRYSTAL_PROFILES: Partial<Record<CrystalMode, Partial<CrystalProfile>>> = {
  crystal_aggregate: { geometry: 'octa', anchorMul: 1, perAnchorMul: 1, radiusMul: 1, spin: 0.18, directionJitter: 0.28, scaleX: 1, scaleY: 1.55, scaleZ: 1, roughness: 0.38, metalness: 0.22, chainAmount: 0.08 },
  shard_debris: { geometry: 'tetra', anchorMul: 1.18, perAnchorMul: 1.2, radiusMul: 1.34, verticalLift: 0.08, bloomBias: 0.1, gustBias: 0.1, spin: 0.72, directionJitter: 0.92, scaleX: 0.34, scaleY: 2.36, scaleZ: 0.2, opacityMul: 0.92, roughness: 0.28, metalness: 0.46, lightnessShift: -0.03, tumbleAmount: 0.56 },
  fracture_pollen: { geometry: 'tetra', anchorMul: 0.92, perAnchorMul: 1.44, radiusMul: 1.08, verticalLift: 0.18, bloomBias: 0.14, spin: 0.36, directionJitter: 0.52, scaleX: 0.28, scaleY: 0.94, scaleZ: 0.28, opacityMul: 0.86, roughness: 0.48, metalness: 0.1, hueShift: -0.02, lightnessShift: 0.08, haloAmount: 0.14 },
  bloom_spores: { geometry: 'icosa', anchorMul: 0.86, perAnchorMul: 1.56, radiusMul: 1.1, verticalLift: 0.26, bloomBias: 0.32, spin: 0.22, directionJitter: 0.3, scaleX: 0.58, scaleY: 0.8, scaleZ: 0.58, opacityMul: 1.06, opacityAdd: 0.02, roughness: 0.24, metalness: 0.1, hueShift: 0.02, lightnessShift: 0.12, haloAmount: 0.42 },
  pollen_storm: { geometry: 'icosa', anchorMul: 1.32, perAnchorMul: 1.34, radiusMul: 1.48, verticalLift: 0.1, bloomBias: 0.12, gustBias: 0.42, spin: 0.54, directionJitter: 0.72, scaleX: 0.42, scaleY: 0.58, scaleZ: 0.42, opacityMul: 0.9, roughness: 0.34, metalness: 0.08, hueShift: 0.03, lightnessShift: 0.14, haloAmount: 0.24, tumbleAmount: 0.18 },
  orbit_fracture: { geometry: 'tetra', anchorMul: 1.08, perAnchorMul: 1.12, radiusMul: 1.22, ringFlatten: 0.72, orbitBias: 0.52, spin: 0.84, directionJitter: 0.22, scaleX: 0.34, scaleY: 1.78, scaleZ: 0.26, opacityMul: 0.96, roughness: 0.26, metalness: 0.54, hueShift: -0.01, chainAmount: 0.22, tumbleAmount: 0.32 },
  fracture_bloom: { geometry: 'octa', anchorMul: 1.12, perAnchorMul: 1.26, radiusMul: 1.18, verticalLift: 0.22, bloomBias: 0.42, spin: 0.48, directionJitter: 0.48, scaleX: 0.62, scaleY: 1.88, scaleZ: 0.42, opacityMul: 1.04, opacityAdd: 0.02, roughness: 0.22, metalness: 0.34, hueShift: 0.04, lightnessShift: 0.08, haloAmount: 0.18, tumbleAmount: 0.16 },
  sediment_stack: { geometry: 'octa', anchorMul: 1.12, perAnchorMul: 1.44, radiusMul: 0.82, verticalLift: -0.04, ringFlatten: 0.18, orbitBias: 0.0, bloomBias: 0.0, gustBias: 0.0, spin: 0.08, directionJitter: 0.08, scaleX: 0.86, scaleY: 0.44, scaleZ: 1.24, opacityMul: 0.92, roughness: 0.78, metalness: 0.08, hueShift: 0.02, lightnessShift: -0.08, sheetAmount: 0.42, settleAmount: 0.34, basinBias: 0.22 },
  granular_fall: { geometry: 'icosa', anchorMul: 1.48, perAnchorMul: 1.92, radiusMul: 1.36, verticalLift: -0.18, gustBias: -0.08, spin: 0.16, directionJitter: 0.94, scaleX: 0.16, scaleY: 0.2, scaleZ: 0.16, opacityMul: 0.84, roughness: 0.72, metalness: 0.02, hueShift: -0.03, lightnessShift: 0.02, settleAmount: 0.42, tumbleAmount: 0.24 },
  talus_heap: { geometry: 'octa', anchorMul: 1.24, perAnchorMul: 1.86, radiusMul: 1.02, verticalLift: -0.22, ringFlatten: 0.08, orbitBias: 0.0, bloomBias: 0.0, gustBias: -0.14, spin: 0.1, directionJitter: 0.68, scaleX: 0.26, scaleY: 0.18, scaleZ: 0.32, opacityMul: 0.82, roughness: 0.84, metalness: 0.02, hueShift: 0.01, lightnessShift: -0.06, settleAmount: 0.68, basinBias: 0.36, tumbleAmount: 0.08 },
  avalanche_field: { geometry: 'tetra', anchorMul: 1.42, perAnchorMul: 2.1, radiusMul: 1.26, verticalLift: -0.34, ringFlatten: 0.02, orbitBias: 0.0, bloomBias: 0.0, gustBias: -0.22, spin: 0.22, directionJitter: 0.98, scaleX: 0.18, scaleY: 0.14, scaleZ: 0.28, opacityMul: 0.8, roughness: 0.88, metalness: 0.01, hueShift: 0.0, lightnessShift: -0.08, settleAmount: 0.94, basinBias: 0.48, tumbleAmount: 0.34 },
  jammed_pack: { geometry: 'octa', anchorMul: 1.06, perAnchorMul: 2.46, radiusMul: 0.72, verticalLift: -0.06, ringFlatten: 0.14, orbitBias: 0.0, bloomBias: 0.0, gustBias: -0.02, spin: 0.06, directionJitter: 0.12, scaleX: 0.42, scaleY: 0.34, scaleZ: 0.44, opacityMul: 0.9, roughness: 0.92, metalness: 0.02, hueShift: -0.01, lightnessShift: -0.1, sheetAmount: 0.32, basinBias: 0.18, chainAmount: 0.12 },
};

function getLayerMode(config: ParticleConfig, layerIndex: 2 | 3) {
  return getLayerRuntimeMode(config, layerIndex);
}

export function getCrystalSettings(config: ParticleConfig, layerIndex: 2 | 3): CrystalSettings {
  const runtime = getLayerRuntimeCrystalSnapshot(config, layerIndex);
  return { opacity: runtime.opacity, scale: runtime.scale, density: runtime.density, spread: runtime.spread, audioReactive: runtime.audioReactive, wireframe: runtime.wireframe, color: runtime.color, materialStyle: runtime.materialStyle, source: runtime.source, radiusScale: runtime.radiusScale };
}

function getCrystalSourceAdjustments(source: ParticleConfig['layer2Source'], style: CrystalSettings['materialStyle']): Partial<CrystalProfile> {
  const profile: Partial<CrystalProfile> = {};
  if (source === 'text') Object.assign(profile, { chainAmount: 0.2, sheetAmount: 0.22, basinBias: 0.16, directionJitter: -0.08, scaleX: 0.08 });
  else if (source === 'image' || source === 'video') Object.assign(profile, { haloAmount: 0.14, bloomBias: 0.12, gustBias: 0.08, radiusMul: 0.04, lightnessShift: 0.04 });
  else if (source === 'ring' || source === 'disc' || source === 'torus') Object.assign(profile, { ringFlatten: 0.22, orbitBias: 0.26, haloAmount: 0.16, radiusMul: 0.08, directionJitter: -0.06 });
  else if (source === 'spiral' || source === 'galaxy') Object.assign(profile, { chainAmount: 0.18, tumbleAmount: 0.18, orbitBias: 0.18, gustBias: 0.12, spin: 0.12 });
  else if (source === 'grid' || source === 'plane') Object.assign(profile, { sheetAmount: 0.2, basinBias: 0.1, chainAmount: 0.08, ringFlatten: 0.08, scaleZ: 0.08 });
  else if (source === 'cube' || source === 'cylinder' || source === 'cone') Object.assign(profile, { settleAmount: 0.18, basinBias: 0.14, tumbleAmount: 0.1, scaleY: 0.08, scaleX: -0.04, scaleZ: -0.04 });
  else if (source === 'center' || source === 'random') Object.assign(profile, { bloomBias: 0.06, haloAmount: 0.08, radiusMul: -0.04 });

  if (style === 'glass') { profile.haloAmount = (profile.haloAmount ?? 0) + 0.08; profile.lightnessShift = (profile.lightnessShift ?? 0) + 0.04; }
  else if (style === 'chrome') { profile.chainAmount = (profile.chainAmount ?? 0) + 0.08; profile.tumbleAmount = (profile.tumbleAmount ?? 0) + 0.08; }
  else if (style === 'hologram') { profile.orbitBias = (profile.orbitBias ?? 0) + 0.1; profile.haloAmount = (profile.haloAmount ?? 0) + 0.12; profile.gustBias = (profile.gustBias ?? 0) + 0.08; }
  else if (style === 'halftone') { profile.sheetAmount = (profile.sheetAmount ?? 0) + 0.1; profile.basinBias = (profile.basinBias ?? 0) + 0.08; }
  return profile;
}

export function getCrystalProfile(mode: CrystalMode, source: ParticleConfig['layer2Source'], style: CrystalSettings['materialStyle']): CrystalProfile {
  const sourceAdjustments = getCrystalSourceAdjustments(source, style);
  return { ...DEFAULT_CRYSTAL_PROFILE, ...(CRYSTAL_PROFILES[mode] ?? {}), ...sourceAdjustments };
}

export function buildCrystalLayout(config: ParticleConfig, layerIndex: 2 | 3): ClusterLayout | null {
  const mode = getLayerMode(config, layerIndex);
  const settings = getCrystalSettings(config, layerIndex);
  const profile = getCrystalProfile(mode, settings.source, settings.materialStyle);
  const particleData = generateParticleData(config, layerIndex, false, 'aux');
  if (!particleData || particleData.count < 4) return null;
  const anchorBase = mode === 'shard_debris' ? particleData.count / 8 : particleData.count / 10;
  const anchorCount = Math.max(8, Math.min(112, Math.floor(anchorBase * profile.anchorMul)));
  const perAnchorBase = Math.max(2, Math.floor(settings.density));
  const perAnchor = Math.max(2, Math.min(11, Math.floor(perAnchorBase * profile.perAnchorMul + (mode === 'fracture_bloom' ? 1 : 0))));
  const anchorIndices = new Uint32Array(anchorCount);
  for (let i = 0; i < anchorCount; i += 1) anchorIndices[i] = Math.min(particleData.count - 1, Math.floor((i / Math.max(1, anchorCount - 1)) * Math.max(0, particleData.count - 1)));
  return { particleData, anchorIndices, perAnchor, instanceCount: anchorCount * perAnchor };
}

export function getCrystalLayoutDeps(config: ParticleConfig, layerIndex: 2 | 3) {
  const runtime = getLayerRuntimeCrystalSnapshot(config, layerIndex);
  return getLayerParticleLayoutDeps(config, layerIndex, [runtime.density]);
}

export function applyCrystalMaterialStyle(baseColor: THREE.Color, style: CrystalSettings['materialStyle'], pulse: number) {
  const c = baseColor.clone();
  let emissive = c.clone().multiplyScalar(0.25 + pulse * 0.15);
  let opacity = 1;
  if (style === 'glass') { c.lerp(new THREE.Color('#f1fbff'), 0.28); emissive = c.clone().multiplyScalar(0.15 + pulse * 0.1); opacity = 0.78; }
  else if (style === 'hologram') { c.lerp(new THREE.Color('#4afff0'), 0.42); emissive = new THREE.Color('#39f9ff').multiplyScalar(0.4 + pulse * 0.35); opacity = 0.9; }
  else if (style === 'chrome') { const band = 0.6 + 0.4 * Math.sin(baseColor.r * 12 + pulse * 8); c.setScalar(0.15 + band * 0.85).lerp(baseColor, 0.3); emissive = new THREE.Color('#ffffff').multiplyScalar(0.05 + pulse * 0.06); opacity = 0.94; }
  else if (style === 'halftone') { c.multiplyScalar(0.72); emissive = c.clone().multiplyScalar(0.08 + pulse * 0.04); opacity = 0.86; }
  return { color: c, emissive, opacity };
}

export function createCrystalGeometry(kind: GeometryKind) {
  if (kind === 'tetra') return new THREE.TetrahedronGeometry(1, 0);
  if (kind === 'icosa') return new THREE.IcosahedronGeometry(1, 0);
  return new THREE.OctahedronGeometry(1, 0);
}
