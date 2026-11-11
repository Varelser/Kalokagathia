import type { Layer2Type, ParticleConfig } from '../types';
import { getLayerRuntimeParticleFieldSnapshot, getLayerRuntimeSourceLayoutSnapshot } from '../lib/sceneRenderRouting';
import { MOTION_MAP } from './sceneShaders';
import { resolveSourceRoute } from '../lib/motionRoute';

export type ParticleData = {
  pos: Float32Array;
  off: Float32Array;
  d1: Float32Array;
  d2: Float32Array;
  d3: Float32Array;
  fidx: Float32Array;
  count: number;
};

export type AuxMode = 'aux' | 'spark';

function hash(n: number) {
  n = Math.imul(n ^ (n >>> 15), 0x5deb38b3);
  n = Math.imul(n ^ (n >>> 15), 0x4a4f9b17);
  return ((n ^ (n >>> 15)) >>> 0) / 4294967296;
}

const getSourceBudgets = (totalCount: number, sourceCount: number, explicitCounts?: number[]) => {
  if (sourceCount <= 1) return [Math.max(0, Math.floor(totalCount))];
  const raw = Array.from({ length: sourceCount }, (_, index) => {
    const value = explicitCounts?.[index];
    return Number.isFinite(value) ? Math.max(0, value as number) : 1;
  });
  const rawSum = raw.reduce((sum, value) => sum + value, 0);
  if (rawSum <= 0 || totalCount <= 0) {
    return Array.from({ length: sourceCount }, (_, index) => index === 0 ? Math.max(0, Math.floor(totalCount)) : 0);
  }
  const scaled = raw.map((value) => (value / rawSum) * totalCount);
  const budgets = scaled.map((value) => Math.floor(value));
  let remainder = Math.max(0, Math.floor(totalCount) - budgets.reduce((sum, value) => sum + value, 0));
  const rankedFractions = scaled
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((left, right) => right.fraction - left.fraction);
  for (let i = 0; i < rankedFractions.length && remainder > 0; i++) {
    budgets[rankedFractions[i].index] += 1;
    remainder -= 1;
  }
  return budgets;
};


const sampleFromMediaMap = (
  map: number[] | undefined,
  width: number,
  height: number,
  threshold: number,
  invert: boolean,
  seed: number,
) => {
  if (!map || width <= 0 || height <= 0 || map.length < width * height) return null;
  const attempts = 12;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const ru = hash(seed + attempt * 11 + 101);
    const rv = hash(seed + attempt * 11 + 102);
    const x = Math.min(width - 1, Math.floor(ru * width));
    const y = Math.min(height - 1, Math.floor(rv * height));
    const idx = y * width + x;
    const raw = map[idx] ?? 0;
    const luma = invert ? 1 - raw : raw;
    if (luma >= threshold) {
      return {
        x: width <= 1 ? 0 : (x / (width - 1)) * 2 - 1,
        y: height <= 1 ? 0 : 1 - (y / (height - 1)) * 2,
        luma,
      };
    }
  }
  return null;
};

const getSourceIndexForParticle = (particleIndex: number, budgets: number[]) => {
  let cumulative = 0;
  for (let index = 0; index < budgets.length; index++) {
    cumulative += budgets[index];
    if (particleIndex < cumulative) return index;
  }
  return Math.max(0, budgets.length - 1);
};

export const getRigidParticlePosition = (particleData: ParticleData, index: number, globalRadius: number) => ({
  x: particleData.pos[index * 3 + 0] * (particleData.d1[index * 4 + 3] ?? 1) * globalRadius + particleData.off[index * 3 + 0],
  y: particleData.pos[index * 3 + 1] * (particleData.d1[index * 4 + 3] ?? 1) * globalRadius + particleData.off[index * 3 + 1],
  z: particleData.pos[index * 3 + 2] * (particleData.d1[index * 4 + 3] ?? 1) * globalRadius + particleData.off[index * 3 + 2],
});

export const getSpatialCellKey = (x: number, y: number, z: number, cellSize: number) => `${Math.floor(x / cellSize)}:${Math.floor(y / cellSize)}:${Math.floor(z / cellSize)}`;

export const generateParticleData = (config: ParticleConfig, layerIndex: 1|2|3|4, isAux = false, auxMode: AuxMode = 'aux'): ParticleData | null => {
  const layerRuntime = layerIndex === 2 || layerIndex === 3 ? getLayerRuntimeParticleFieldSnapshot(config, layerIndex) : null;
  const layerLayout = layerRuntime ? getLayerRuntimeSourceLayoutSnapshot(config, layerRuntime.route.key === 'layer2' ? 2 : 3, layerRuntime.route) : null;

  // Source routing (free-wiring stage 2, method B): shape-defining inputs
  // come from the source layer's runtime/layout; counts, sizes and motions
  // stay this layer's own.
  const sourceRouteLayer = layerIndex === 2 || layerIndex === 3 ? resolveSourceRoute(config, layerIndex) : null;
  const shapeRuntime = sourceRouteLayer ? getLayerRuntimeParticleFieldSnapshot(config, sourceRouteLayer) : layerRuntime;
  const shapeLayout = sourceRouteLayer && shapeRuntime ? getLayerRuntimeSourceLayoutSnapshot(config, sourceRouteLayer, shapeRuntime.route) : layerLayout;

  let count: number;
  let parentCount = 0;
  if (layerIndex === 1) {
    count = config.layer1Count || 0;
    parentCount = config.layer1Count || 0;
  } else if (layerIndex === 2 || layerIndex === 3) {
    count = layerRuntime ? (isAux ? (auxMode === 'spark' ? (layerRuntime.sparkCount || 0) : (layerRuntime.auxCount || 0)) : (layerRuntime.count || 0)) : 0;
    parentCount = layerRuntime?.count || 0;
  } else {
    count = config.ambientCount || 0;
  }

  if (Number.isNaN(count) || count <= 0) return null;

  const sourceCount = layerIndex === 1 ? (config.layer1SourceCount || 1) : shapeLayout ? (shapeLayout.sourceCount || 1) : 1;
  const sourceShape = layerIndex === 1 ? 'sphere' : shapeRuntime ? (shapeRuntime.source || 'random') : 'random';
  const sourceCounts = layerIndex === 1 ? config.layer1Counts : shapeLayout?.counts ?? [];
  const sourceBudgets = getSourceBudgets(isAux ? parentCount : count, sourceCount, sourceCounts);
  const mediaMap = shapeRuntime?.mediaLumaMap ?? [];
  const mediaMapWidth = shapeLayout?.mediaMapWidth ?? 0;
  const mediaMapHeight = shapeLayout?.mediaMapHeight ?? 0;
  const mediaThreshold = shapeLayout?.mediaThreshold ?? 0.45;
  const mediaDepth = shapeLayout?.mediaDepth ?? 0.65;
  const mediaInvert = shapeLayout?.mediaInvert ?? false;
  const pos = new Float32Array(count * 3);
  const off = new Float32Array(count * 3);
  const d1 = new Float32Array(count * 4);
  const d2 = new Float32Array(count * 4);
  const d3 = new Float32Array(count * 4);

  for (let i = 0; i < count; i++) {
    let pIdx = i;
    if (isAux && parentCount > 0) pIdx = i % parentCount;
    const srcId = getSourceIndexForParticle(pIdx, sourceBudgets);
    const pSeed = layerIndex * 10000 + pIdx;
    const u = hash(pSeed), v = hash(pSeed + 1), w = hash(pSeed + 2);
    let px: number, py: number, pz: number;
    let mediaLuma = 0;

    if (sourceShape === 'sphere') {
      const theta = 2 * Math.PI * u, phi = Math.acos(2 * v - 1);
      px = Math.sin(phi) * Math.cos(theta); py = Math.sin(phi) * Math.sin(theta); pz = Math.cos(phi);
    } else if (sourceShape === 'cube') {
      px = u * 2 - 1; py = v * 2 - 1; pz = w * 2 - 1;
    } else if (sourceShape === 'ring') {
      const theta = 2 * Math.PI * u; px = Math.cos(theta); pz = Math.sin(theta); py = 0;
    } else if (sourceShape === 'center') {
      px = 0; py = 0; pz = 0;
    } else if (sourceShape === 'disc') {
      const theta = 2 * Math.PI * u; const rad = Math.sqrt(v);
      px = Math.cos(theta) * rad; pz = Math.sin(theta) * rad; py = 0;
    } else if (sourceShape === 'cylinder') {
      const theta = 2 * Math.PI * u; px = Math.cos(theta); pz = Math.sin(theta); py = v * 2 - 1;
    } else if (sourceShape === 'cone') {
      const theta = 2 * Math.PI * u; const rad = v; px = Math.cos(theta) * rad; pz = Math.sin(theta) * rad; py = v - 0.5;
    } else if (sourceShape === 'torus') {
      const theta = 2 * Math.PI * u, phi = 2 * Math.PI * v;
      const major = 1.0, minor = 0.3;
      px = (major + minor * Math.cos(phi)) * Math.cos(theta);
      pz = (major + minor * Math.cos(phi)) * Math.sin(theta);
      py = minor * Math.sin(phi);
    } else if (sourceShape === 'spiral') {
      const theta = u * Math.PI * 10.0;
      const r = v;
      px = Math.cos(theta) * r;
      pz = Math.sin(theta) * r;
      py = (u - 0.5) * 2.0;
    } else if (sourceShape === 'galaxy') {
      const theta = u * Math.PI * 10.0; const rad = v * 1.5;
      px = Math.cos(theta) * rad + (hash(pSeed + 15) - 0.5) * 0.1;
      pz = Math.sin(theta) * rad + (hash(pSeed + 16) - 0.5) * 0.1;
      py = (hash(pSeed + 17) - 0.5) * 0.05;
    } else if (sourceShape === 'grid') {
      const res = Math.floor(Math.pow(count / sourceCount, 1 / 3)) || 1;
      const xi = ((i % res) / res); const yi = (Math.floor(i / res) % res) / res; const zi = (Math.floor(i / (res * res)) % res) / res;
      px = xi * 2 - 1; py = yi * 2 - 1; pz = zi * 2 - 1;
    } else if (sourceShape === 'plane') {
      px = u * 2 - 1; pz = v * 2 - 1; py = 0;
    } else if (sourceShape === 'image' || sourceShape === 'video' || sourceShape === 'text') {
      const mediaSample = sampleFromMediaMap(mediaMap, mediaMapWidth, mediaMapHeight, mediaThreshold, mediaInvert, pSeed + srcId * 97);
      if (mediaSample) {
        px = mediaSample.x;
        pz = mediaSample.y;
        py = (mediaSample.luma - 0.5) * 2 * mediaDepth;
        mediaLuma = mediaSample.luma;
      } else {
        px = u * 2 - 1;
        pz = v * 2 - 1;
        py = 0;
        mediaLuma = 0;
      }
    } else {
      const theta = 2 * Math.PI * u, phi = Math.acos(2 * v - 1);
      const r = Math.pow(w, 1 / 3);
      px = r * Math.sin(phi) * Math.cos(theta);
      py = r * Math.sin(phi) * Math.sin(theta);
      pz = r * Math.cos(phi);
    }

    if (layerIndex === 1) {
      const vol = config.layer1Volumes?.[srcId] ?? config.layer1Volume;
      if (vol > 0 && sourceShape === 'sphere') {
        const rScale = 1.0 - (vol * (1.0 - Math.pow(hash(pSeed + 10), 1 / 3)));
        px *= rScale; py *= rScale; pz *= rScale;
      }
    }

    if (isAux) {
      const diff = layerRuntime ? ((auxMode === 'spark' ? layerRuntime.sparkDiffusion : layerRuntime.auxDiffusion) || 0) : 0;
      const auxSeed = pSeed + i * 1000;
      px += (hash(auxSeed) - 0.5) * diff * 0.5;
      py += (hash(auxSeed + 1) - 0.5) * diff * 0.5;
      pz += (hash(auxSeed + 2) - 0.5) * diff * 0.5;
    }

    pos[i * 3] = px; pos[i * 3 + 1] = py; pos[i * 3 + 2] = pz;
    let manual = null;
    if (layerIndex === 1) manual = config.layer1SourcePositions?.[srcId];
    else if (layerRuntime) manual = shapeLayout?.sourcePositions?.[srcId];

    let ox = manual?.x ?? 0, oy = manual?.y ?? 0, oz = manual?.z ?? 0;
    const spread = layerIndex === 1 ? (config.layer1SourceSpread || 0) : shapeLayout ? (shapeLayout.sourceSpread || 0) : (config.ambientSpread || 0);
    if (layerIndex < 4 && spread > 0 && sourceCount > 1) {
      const a = (srcId / sourceCount) * Math.PI * 2; ox += Math.cos(a) * spread; oz += Math.sin(a) * spread;
    } else if (layerIndex === 4) {
      ox = (hash(pSeed + 5) * 2 - 1) * spread;
      oy = (hash(pSeed + 6) * 2 - 1) * spread;
      oz = (hash(pSeed + 7) * 2 - 1) * spread;
    }

    off[i * 3] = ox; off[i * 3 + 1] = oy; off[i * 3 + 2] = oz;
    d1[i * 4 + 0] = hash(pSeed + 3) * Math.PI * 2;
    d1[i * 4 + 1] = hash(pSeed + 4);
    let mTypeString: Layer2Type = 'flow';
    if (layerIndex === 1) mTypeString = 'morph';
    else if (layerRuntime && layerLayout) mTypeString = layerLayout.motionMix ? (layerLayout.motions?.[srcId] || layerRuntime.mode || 'flow') : (layerRuntime.mode || 'flow');
    d1[i * 4 + 2] = MOTION_MAP[mTypeString] ?? 0;
    d1[i * 4 + 3] = layerIndex === 1 ? (config.layer1Radii?.[srcId] ?? 1.0) : layerLayout ? (layerLayout.radiusScales?.[srcId] ?? 1.0) : 1.0;
    d2[i * 4 + 0] = layerIndex === 1 ? (config.layer1PulseSpeeds?.[srcId] ?? 1.0) : layerLayout ? (layerLayout.flowSpeeds?.[srcId] ?? 1.0) : 1.0;
    d2[i * 4 + 1] = layerIndex === 1 ? (config.layer1PulseAmps?.[srcId] ?? 1.0) : layerLayout ? (layerLayout.flowAmps?.[srcId] ?? 1.0) : 1.0;
    d2[i * 4 + 2] = layerIndex === 1 ? (config.layer1Jitters?.[srcId] ?? 1.0) : layerLayout ? (layerLayout.flowFreqs?.[srcId] ?? 1.0) : 1.0;
    d2[i * 4 + 3] = layerIndex === 1 ? (config.layer1Sizes?.[srcId] ?? 1.0) : layerLayout ? (layerLayout.sizes?.[srcId] ?? 1.0) : 1.0;
    d3[i * 4 + 0] = (hash(pSeed + 20) + srcId * 0.173) % 1;
    d3[i * 4 + 1] = hash(pSeed + 21);
    d3[i * 4 + 2] = hash(pSeed + 22);
    d3[i * 4 + 3] = (sourceShape === 'image' || sourceShape === 'video' || sourceShape === 'text')
      ? mediaLuma
      : (sourceCount > 1 ? srcId / sourceCount : 0);
  }

  const fidx = new Float32Array(count);
  for (let i = 0; i < count; i++) fidx[i] = i;
  return { pos, off, d1, d2, d3, fidx, count };
};
