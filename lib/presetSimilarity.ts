// Preset similarity: every preset becomes a feature vector — the catalogued
// numeric parameters normalized into 0..1, plus weighted one-hot blocks for
// the categorical identity of each layer (motion type and source). Cosine
// similarity over those vectors answers "what is close to this look", and a
// deterministic PCA projection lays the whole library out as a 2D map.
// Everything is pure and derived from the preset records; nothing is stored.

import type { ParticleConfig, PresetRecord } from '../types';
import { normalizeConfig } from './appState';
import { PARAMETER_CATALOG } from './parameterCatalog';
import { MOTION_GROUPS } from './motionGrouping';

const CATEGORY_WEIGHT = 0.6;

const MOTION_TYPES: string[] = MOTION_GROUPS.flatMap((group) => group.ids as unknown as string[]);

const SOURCE_TYPES: string[] = [
  'sphere',
  'center',
  'ring',
  'disc',
  'cube',
  'cylinder',
  'random',
  'cone',
  'torus',
  'spiral',
  'galaxy',
  'grid',
  'plane',
  'image',
  'video',
  'text',
];

function readNumber(config: ParticleConfig, key: string): number | undefined {
  const value = (config as unknown as Record<string, unknown>)[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function oneHot(value: string, options: string[], target: number[]) {
  const index = options.indexOf(value);
  for (let i = 0; i < options.length; i += 1) {
    target.push(i === index ? CATEGORY_WEIGHT : 0);
  }
}

export function buildPresetVector(rawConfig: ParticleConfig): number[] {
  const config = normalizeConfig(rawConfig);
  const vector: number[] = [];
  for (const entry of PARAMETER_CATALOG) {
    const value = readNumber(config, entry.key) ?? entry.min;
    const span = entry.max - entry.min;
    const normalized = span > 0 ? (value - entry.min) / span : 0;
    vector.push(Math.min(1, Math.max(0, normalized)));
  }
  oneHot(config.layer2Type, MOTION_TYPES, vector);
  oneHot(config.layer3Type, MOTION_TYPES, vector);
  oneHot(config.layer2Source, SOURCE_TYPES, vector);
  oneHot(config.layer3Source, SOURCE_TYPES, vector);
  return vector;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export interface SimilarPreset {
  preset: PresetRecord;
  similarity: number;
}

export function findSimilarPresets(
  presets: PresetRecord[],
  targetId: string,
  limit = 8,
): SimilarPreset[] {
  const target = presets.find((preset) => preset.id === targetId);
  if (!target) return [];
  const targetVector = buildPresetVector(target.config);
  return presets
    .filter((preset) => preset.id !== targetId)
    .map((preset) => ({
      preset,
      similarity: cosineSimilarity(targetVector, buildPresetVector(preset.config)),
    }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);
}

export interface PresetMapPoint {
  id: string;
  x: number;
  y: number;
}

function topEigenvector(covariance: number[][], dimension: number): number[] {
  // Deterministic power iteration: start from a fixed non-uniform vector so
  // repeated runs (and machines) produce the identical map.
  let vector = Array.from({ length: dimension }, (_, i) => 1 + ((i * 7) % 5) * 0.13);
  const normalize = (v: number[]) => {
    const norm = Math.sqrt(v.reduce((sum, x) => sum + x * x, 0)) || 1;
    return v.map((x) => x / norm);
  };
  vector = normalize(vector);
  for (let iteration = 0; iteration < 120; iteration += 1) {
    const next = new Array<number>(dimension).fill(0);
    for (let row = 0; row < dimension; row += 1) {
      const covRow = covariance[row];
      let sum = 0;
      for (let col = 0; col < dimension; col += 1) {
        sum += covRow[col] * vector[col];
      }
      next[row] = sum;
    }
    vector = normalize(next);
  }
  return vector;
}

function buildNumericVector(rawConfig: ParticleConfig): number[] {
  const config = normalizeConfig(rawConfig);
  return PARAMETER_CATALOG.map((entry) => {
    const value = readNumber(config, entry.key) ?? entry.min;
    const span = entry.max - entry.min;
    const normalized = span > 0 ? (value - entry.min) / span : 0;
    return Math.min(1, Math.max(0, normalized));
  });
}

export function projectPresetsTo2D(presets: PresetRecord[]): PresetMapPoint[] {
  if (presets.length === 0) return [];
  // The map projects the numeric parameter shape (355 dims). The one-hot
  // identity blocks stay in the similarity vectors, where they belong;
  // including them here would also make the covariance pass needlessly big.
  const vectors = presets.map((preset) => buildNumericVector(preset.config));
  const dimension = vectors[0].length;
  const means = new Array<number>(dimension).fill(0);
  for (const vector of vectors) {
    for (let i = 0; i < dimension; i += 1) means[i] += vector[i] / vectors.length;
  }
  const centered = vectors.map((vector) => vector.map((value, i) => value - means[i]));

  const covariance: number[][] = Array.from({ length: dimension }, () =>
    new Array<number>(dimension).fill(0),
  );
  for (const row of centered) {
    for (let i = 0; i < dimension; i += 1) {
      if (row[i] === 0) continue;
      for (let j = i; j < dimension; j += 1) {
        covariance[i][j] += (row[i] * row[j]) / centered.length;
      }
    }
  }
  for (let i = 0; i < dimension; i += 1) {
    for (let j = i + 1; j < dimension; j += 1) {
      covariance[j][i] = covariance[i][j];
    }
  }

  const pc1 = topEigenvector(covariance, dimension);
  // Deflate and extract the second component.
  const lambda1 = pc1.reduce(
    (sum, value, i) => sum + value * covariance[i].reduce((inner, cov, j) => inner + cov * pc1[j], 0),
    0,
  );
  for (let i = 0; i < dimension; i += 1) {
    for (let j = 0; j < dimension; j += 1) {
      covariance[i][j] -= lambda1 * pc1[i] * pc1[j];
    }
  }
  const pc2 = topEigenvector(covariance, dimension);

  const project = (vector: number[], axis: number[]) =>
    vector.reduce((sum, value, i) => sum + value * axis[i], 0);
  const xs = centered.map((vector) => project(vector, pc1));
  const ys = centered.map((vector) => project(vector, pc2));
  const normalizeRange = (values: number[]) => {
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    return values.map((value) => (value - min) / span);
  };
  const nx = normalizeRange(xs);
  const ny = normalizeRange(ys);
  return presets.map((preset, index) => ({ id: preset.id, x: nx[index], y: ny[index] }));
}
