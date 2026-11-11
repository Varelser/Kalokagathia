import type { ParticleConfig, RenderQuality } from '../types';

export type PerformanceTier = 'light' | 'medium' | 'heavy';

function clampTier(score: number): PerformanceTier {
  if (score >= 7) return 'heavy';
  if (score >= 4) return 'medium';
  return 'light';
}

export function getRenderQualityDescription(quality: RenderQuality) {
  if (quality === 'draft') return 'Lower DPR and lighter line refresh for heavy exploration.';
  if (quality === 'cinematic') return 'Higher DPR and denser line refresh for preview/export checks.';
  return 'Balanced runtime quality for general editing.';
}

export function getConfigPerformanceScore(config: ParticleConfig) {
  let score = 0;
  const layer1Budget = config.layer1Enabled ? config.layer1Count / 9000 : 0;
  const layer2Budget = config.layer2Enabled ? config.layer2Count / 18000 : 0;
  const layer3Budget = config.layer3Enabled ? config.layer3Count / 5000 : 0;
  const ambientBudget = config.ambientEnabled ? config.ambientCount / 8000 : 0;

  score += layer1Budget + layer2Budget + layer3Budget + ambientBudget;
  score += config.layer2ConnectionEnabled ? 1.4 : 0;
  score += config.layer3ConnectionEnabled ? 1.4 : 0;
  score += config.layer2AuxEnabled ? config.layer2AuxCount / 22000 : 0;
  score += config.layer3AuxEnabled ? config.layer3AuxCount / 22000 : 0;
  score += config.layer2SparkEnabled ? config.layer2SparkCount / 16000 : 0;
  score += config.layer3SparkEnabled ? config.layer3SparkCount / 16000 : 0;
  score += (config.layer2Fidelity + config.layer3Fidelity) * 0.18;
  score += config.screenPersistenceIntensity * config.screenPersistenceLayers * 0.9;
  score += config.screenNoiseIntensity * 0.6 + config.screenInterferenceIntensity * 0.5;
  score += config.interLayerCollisionEnabled ? 0.9 : 0;

  if (config.renderQuality === 'cinematic') score += 1.2;
  if (config.renderQuality === 'draft') score -= 0.8;

  return Math.max(0, score);
}

export function getConfigPerformanceTier(config: ParticleConfig): PerformanceTier {
  return clampTier(getConfigPerformanceScore(config));
}

export function getLayerPerformanceSummary(config: ParticleConfig, layerIndex: 2 | 3) {
  const isLayer2 = layerIndex === 2;
  const count = isLayer2 ? config.layer2Count : config.layer3Count;
  const fidelity = isLayer2 ? config.layer2Fidelity : config.layer3Fidelity;
  const linesEnabled = isLayer2 ? config.layer2ConnectionEnabled : config.layer3ConnectionEnabled;
  const auxEnabled = isLayer2 ? config.layer2AuxEnabled : config.layer3AuxEnabled;
  const sparkEnabled = isLayer2 ? config.layer2SparkEnabled : config.layer3SparkEnabled;
  const tier = clampTier(
    count / (isLayer2 ? 24000 : 7000) +
    fidelity * 0.24 +
    (linesEnabled ? 1.4 : 0) +
    (auxEnabled ? 0.9 : 0) +
    (sparkEnabled ? 1.0 : 0),
  );

  const suggestions = [
    count > (isLayer2 ? 90000 : 18000) ? 'Reduce particle count for iteration.' : null,
    fidelity > 4 ? 'Lower fidelity while designing.' : null,
    linesEnabled ? 'Plexus lines are one of the bigger CPU-side costs.' : null,
    sparkEnabled || auxEnabled ? 'Secondary emitters add a noticeable fill-rate cost.' : null,
  ].filter(Boolean) as string[];

  return {
    tier,
    suggestions,
  };
}
