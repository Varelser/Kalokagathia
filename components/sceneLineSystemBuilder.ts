import type { ParticleConfig } from '../types';
import { ParticleData, getSpatialCellKey } from './particleData';
import { estimateLayerPositionApprox } from './sceneMotionEstimator';
import type { LineData, LineProfile } from './sceneLineSystemShared';
import { getLineBudget, getLineNeighborLimit, getLineSampleLimit, getResolvedLineProfile } from './sceneLineSystemProfile';

function getPairHash(a: number, b: number, seed: number) {
  const value = Math.sin(a * 12.9898 + b * 78.233 + seed * 37.719) * 43758.5453123;
  return value - Math.floor(value);
}

function getCandidateScore(profile: LineProfile, point: { x: number; y: number; z: number }, candidate: { x: number; y: number; z: number }, distSq: number, searchDistance: number, globalRadius: number) {
  const dist = Math.sqrt(distSq);
  const planeDelta = Math.abs(point.y - candidate.y) / Math.max(searchDistance, 1e-3);
  const radialA = Math.hypot(point.x, point.z);
  const radialB = Math.hypot(candidate.x, candidate.z);
  const radialDelta = Math.abs(radialA - radialB) / Math.max(globalRadius, 1e-3);
  const midX = (point.x + candidate.x) * 0.5;
  const midY = (point.y + candidate.y) * 0.5;
  const midZ = (point.z + candidate.z) * 0.5;
  const gate = Math.abs(Math.sin(midX * (0.035 + profile.gateFreq * 0.05) + midY * (0.028 + profile.gateFreq * 0.03) + midZ * (0.041 + profile.gateFreq * 0.04)));
  return { gate, score: dist * (1 + planeDelta * profile.planarBias + radialDelta * profile.radialBias) + (1 - gate) * searchDistance * (0.12 + profile.gateFreq * 0.36) };
}

export function buildLineData(config: ParticleConfig, layerIndex: 2 | 3, particleData: ParticleData, globalRadius: number, connectionDistance: number, sampleTime: number): LineData | null {
  if (!particleData || particleData.count === 0) return null;
  const lineProfile = getResolvedLineProfile(config, layerIndex);
  const getEstimatedLinePosition = (index: number) => estimateLayerPositionApprox({ config, layerIndex, particleData, index, globalRadius, time: sampleTime });
  const maxLines = Math.max(40, Math.floor(getLineBudget(config.renderQuality, particleData.count) * lineProfile.budgetMul));
  const searchDistance = Math.max(1, connectionDistance * lineProfile.searchMul);
  const cellSize = Math.max(searchDistance, 1);
  const cells = new Map<string, number[]>();
  const sampleLimit = Math.max(180, Math.floor(getLineSampleLimit(config.renderQuality) * lineProfile.sampleMul));
  const sampleStep = Math.max(1, Math.ceil(particleData.count / sampleLimit));
  const maxNeighborsPerParticle = Math.max(1, getLineNeighborLimit(config.renderQuality) + lineProfile.neighborBonus);
  const sampledPoints: Array<{ particleIndex: number; point: ReturnType<typeof getEstimatedLinePosition> }> = [];
  for (let particleIndex = 0; particleIndex < particleData.count; particleIndex += sampleStep) {
    const point = getEstimatedLinePosition(particleIndex);
    const key = getSpatialCellKey(point.x, point.y, point.z, cellSize);
    const bucket = cells.get(key) || [];
    bucket.push(sampledPoints.length);
    cells.set(key, bucket);
    sampledPoints.push({ particleIndex, point });
  }
  if (sampledPoints.length < 2) return null;
  const points = sampledPoints.map(({ point }) => point);
  const pairs: Array<[number, number]> = [];
  const seen = new Set<string>();
  for (let index = 0; index < sampledPoints.length && pairs.length < maxLines; index += 1) {
    const point = points[index];
    if (!point) continue;
    const sourceParticleIndex = sampledPoints[index]?.particleIndex;
    if (sourceParticleIndex === undefined) continue;
    const baseCellX = Math.floor(point.x / cellSize);
    const baseCellY = Math.floor(point.y / cellSize);
    const baseCellZ = Math.floor(point.z / cellSize);
    const candidates: Array<{ index: number; distSq: number; score: number }> = [];
    for (let dx = -1; dx <= 1; dx += 1) for (let dy = -1; dy <= 1; dy += 1) for (let dz = -1; dz <= 1; dz += 1) {
      const bucket = cells.get(`${baseCellX + dx}:${baseCellY + dy}:${baseCellZ + dz}`);
      if (!bucket) continue;
      for (const candidateIndex of bucket) {
        if (candidateIndex <= index) continue;
        const candidate = points[candidateIndex];
        if (!candidate) continue;
        const distSq = (point.x - candidate.x) ** 2 + (point.y - candidate.y) ** 2 + (point.z - candidate.z) ** 2;
        if (distSq > searchDistance * searchDistance) continue;
        const targetParticleIndex = sampledPoints[candidateIndex]?.particleIndex;
        if (targetParticleIndex === undefined) continue;
        const hash = getPairHash(sourceParticleIndex, targetParticleIndex, lineProfile.gateFreq + lineProfile.dropout);
        if (hash < lineProfile.dropout) continue;
        const scored = getCandidateScore(lineProfile, point, candidate, distSq, searchDistance, globalRadius);
        if (scored.gate < lineProfile.gateThreshold) continue;
        candidates.push({ index: candidateIndex, distSq, score: scored.score });
      }
    }
    candidates.sort((left, right) => left.score - right.score).slice(0, maxNeighborsPerParticle).forEach((candidate) => {
      if (pairs.length >= maxLines) return;
      const targetParticleIndex = sampledPoints[candidate.index]?.particleIndex;
      if (targetParticleIndex === undefined) return;
      const pairKey = `${sourceParticleIndex}:${targetParticleIndex}`;
      if (seen.has(pairKey)) return;
      seen.add(pairKey);
      pairs.push([sourceParticleIndex, targetParticleIndex]);
    });
  }
  const lineCount = pairs.length;
  if (lineCount === 0) return null;
  const aPosA = new Float32Array(lineCount * 2 * 3);
  const aOffA = new Float32Array(lineCount * 2 * 3);
  const aData1A = new Float32Array(lineCount * 2 * 4);
  const aData2A = new Float32Array(lineCount * 2 * 4);
  const aData3A = new Float32Array(lineCount * 2 * 4);
  const aPosB = new Float32Array(lineCount * 2 * 3);
  const aOffB = new Float32Array(lineCount * 2 * 3);
  const aData1B = new Float32Array(lineCount * 2 * 4);
  const aData2B = new Float32Array(lineCount * 2 * 4);
  const aData3B = new Float32Array(lineCount * 2 * 4);
  const aMix = new Float32Array(lineCount * 2);
  const brushVertexCount = lineCount * 6;
  const bPosA = new Float32Array(brushVertexCount * 3);
  const bOffA = new Float32Array(brushVertexCount * 3);
  const bData1A = new Float32Array(brushVertexCount * 4);
  const bData2A = new Float32Array(brushVertexCount * 4);
  const bData3A = new Float32Array(brushVertexCount * 4);
  const bPosB = new Float32Array(brushVertexCount * 3);
  const bOffB = new Float32Array(brushVertexCount * 3);
  const bData1B = new Float32Array(brushVertexCount * 4);
  const bData2B = new Float32Array(brushVertexCount * 4);
  const bData3B = new Float32Array(brushVertexCount * 4);
  const bLineCoord = new Float32Array(brushVertexCount * 2);
  const brushTemplate: Array<[number, number]> = [[0, -1], [0, 1], [1, 1], [0, -1], [1, 1], [1, -1]];
  for (let index = 0; index < lineCount; index += 1) {
    const pair = pairs[index];
    if (!pair) continue;
    const [idxA, idxB] = pair;
    aMix[index * 2 + 0] = 0.0;
    aMix[index * 2 + 1] = 1.0;
    for (let v = 0; v < 2; v += 1) {
      const vi = index * 2 + v;
      aPosA.set(particleData.pos.subarray(idxA * 3, idxA * 3 + 3), vi * 3);
      aOffA.set(particleData.off.subarray(idxA * 3, idxA * 3 + 3), vi * 3);
      aData1A.set(particleData.d1.subarray(idxA * 4, idxA * 4 + 4), vi * 4);
      aData2A.set(particleData.d2.subarray(idxA * 4, idxA * 4 + 4), vi * 4);
      aData3A.set(particleData.d3.subarray(idxA * 4, idxA * 4 + 4), vi * 4);
      aPosB.set(particleData.pos.subarray(idxB * 3, idxB * 3 + 3), vi * 3);
      aOffB.set(particleData.off.subarray(idxB * 3, idxB * 3 + 3), vi * 3);
      aData1B.set(particleData.d1.subarray(idxB * 4, idxB * 4 + 4), vi * 4);
      aData2B.set(particleData.d2.subarray(idxB * 4, idxB * 4 + 4), vi * 4);
      aData3B.set(particleData.d3.subarray(idxB * 4, idxB * 4 + 4), vi * 4);
    }
    for (let v = 0; v < 6; v += 1) {
      const vi = index * 6 + v;
      bPosA.set(particleData.pos.subarray(idxA * 3, idxA * 3 + 3), vi * 3);
      bOffA.set(particleData.off.subarray(idxA * 3, idxA * 3 + 3), vi * 3);
      bData1A.set(particleData.d1.subarray(idxA * 4, idxA * 4 + 4), vi * 4);
      bData2A.set(particleData.d2.subarray(idxA * 4, idxA * 4 + 4), vi * 4);
      bData3A.set(particleData.d3.subarray(idxA * 4, idxA * 4 + 4), vi * 4);
      bPosB.set(particleData.pos.subarray(idxB * 3, idxB * 3 + 3), vi * 3);
      bOffB.set(particleData.off.subarray(idxB * 3, idxB * 3 + 3), vi * 3);
      bData1B.set(particleData.d1.subarray(idxB * 4, idxB * 4 + 4), vi * 4);
      bData2B.set(particleData.d2.subarray(idxB * 4, idxB * 4 + 4), vi * 4);
      bData3B.set(particleData.d3.subarray(idxB * 4, idxB * 4 + 4), vi * 4);
      const tpl = brushTemplate[v]!;
      bLineCoord[vi * 2 + 0] = tpl[0];
      bLineCoord[vi * 2 + 1] = tpl[1];
    }
  }
  return {
    classic: { aPosA, aOffA, aData1A, aData2A, aData3A, aPosB, aOffB, aData1B, aData2B, aData3B, aMix, count: lineCount },
    brush: { aPosA: bPosA, aOffA: bOffA, aData1A: bData1A, aData2A: bData2A, aData3A: bData3A, aPosB: bPosB, aOffB: bOffB, aData1B: bData1B, aData2B: bData2B, aData3B: bData3B, aLineCoord: bLineCoord, count: brushVertexCount },
  };
}
