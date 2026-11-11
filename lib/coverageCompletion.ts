// Coverage completion generator: builds presets for source × motion pairs
// that no library preset covers yet (the Expression Map's Source × Motion
// grid counts a pair when an enabled layer 2/3 combines that source with
// that motion type; only ~292 of 16 × 197 theoretical pairs are covered).
//
// Each generated preset is a donor clone: a preset that already runs the
// target motion keeps its tuned parameters and only has its layer 2
// source swapped (or, failing that, a preset using the target source has
// its motion swapped). The other layer is switched off so the preset is a
// focused, single-pair study. Pure and deterministic — donor choice
// rotates across donors in library order so a batch does not clone the
// same base look repeatedly.

import type { ParticleConfig, PresetRecord } from '../types';
import { GRAPH_SOURCE_OPTIONS } from './graphModel';
import { MOTION_GROUPS } from './motionGrouping';

export const COVERAGE_SOURCES: readonly string[] = GRAPH_SOURCE_OPTIONS.map((option) => option.value);
export const COVERAGE_MOTIONS: readonly string[] = MOTION_GROUPS.flatMap((group) => group.ids as readonly string[]);

export const COVERAGE_BATCH_LIMIT = 24;

export function sourceMotionPairKey(source: string, motion: string): string {
  return `${source}×${motion}`;
}

// Mirrors the Expression Map's pair accounting exactly: enabled layers
// only, both particle layers, presets plus (optionally) the live config.
export function getCoveredSourceMotionPairs(
  presets: readonly PresetRecord[],
  currentConfig?: ParticleConfig,
): Set<string> {
  const pairs = new Set<string>();
  const absorb = (cfg: ParticleConfig) => {
    const layers = [
      { enabled: cfg.layer2Enabled, source: cfg.layer2Source as string, type: cfg.layer2Type as string },
      { enabled: cfg.layer3Enabled, source: cfg.layer3Source as string, type: cfg.layer3Type as string },
    ];
    layers.forEach(({ enabled, source, type }) => {
      if (!enabled || !source || !type) return;
      pairs.add(sourceMotionPairKey(source, type));
    });
  };
  presets.forEach((preset) => absorb(preset.config));
  if (currentConfig) absorb(currentConfig);
  return pairs;
}

export interface CoverageGenerationRequest {
  axis: 'motion' | 'source';
  value: string;
}

export interface CoverageCandidate {
  source: string;
  motion: string;
  name: string;
  config: ParticleConfig;
}

function cloneForPair(donor: ParticleConfig, source: string, motion: string): ParticleConfig {
  const config = structuredClone(donor);
  config.layer2Enabled = true;
  config.layer2Source = source as ParticleConfig['layer2Source'];
  config.layer2Type = motion as ParticleConfig['layer2Type'];
  config.layer3Enabled = false;
  return config;
}

export function listUncoveredPairs(
  covered: ReadonlySet<string>,
  request: CoverageGenerationRequest,
): Array<{ source: string; motion: string }> {
  const pairs: Array<{ source: string; motion: string }> = [];
  if (request.axis === 'motion') {
    for (const source of COVERAGE_SOURCES) {
      if (!covered.has(sourceMotionPairKey(source, request.value))) {
        pairs.push({ source, motion: request.value });
      }
    }
  } else {
    for (const motion of COVERAGE_MOTIONS) {
      if (!covered.has(sourceMotionPairKey(request.value, motion))) {
        pairs.push({ source: request.value, motion });
      }
    }
  }
  return pairs;
}

export function generateCoverageCandidates(
  presets: readonly PresetRecord[],
  currentConfig: ParticleConfig,
  request: CoverageGenerationRequest,
  limit: number = COVERAGE_BATCH_LIMIT,
): CoverageCandidate[] {
  const covered = getCoveredSourceMotionPairs(presets, currentConfig);
  const uncovered = listUncoveredPairs(covered, request).slice(0, Math.max(0, limit));
  if (uncovered.length === 0 || presets.length === 0) return [];

  const motionDonors = (motion: string) =>
    presets.filter((preset) => preset.config.layer2Enabled && preset.config.layer2Type === motion);
  const sourceDonors = (source: string) =>
    presets.filter((preset) => preset.config.layer2Enabled && preset.config.layer2Source === source);
  const anyDonors = presets.filter((preset) => preset.config.layer2Enabled);
  const fallbackDonors = anyDonors.length > 0 ? anyDonors : [...presets];

  const rotation = new Map<string, number>();
  const pickDonor = (pool: PresetRecord[], key: string): PresetRecord => {
    const index = rotation.get(key) ?? 0;
    rotation.set(key, index + 1);
    return pool[index % pool.length];
  };

  return uncovered.map(({ source, motion }) => {
    const byMotion = motionDonors(motion);
    const bySource = sourceDonors(source);
    const donor =
      byMotion.length > 0
        ? pickDonor(byMotion, `m:${motion}`)
        : bySource.length > 0
          ? pickDonor(bySource, `s:${source}`)
          : pickDonor(fallbackDonors, 'any');
    return {
      source,
      motion,
      name: `Coverage · ${source} × ${motion}`,
      config: cloneForPair(donor.config, source, motion),
    };
  });
}
