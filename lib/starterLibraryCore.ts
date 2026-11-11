import type { ParticleConfig, PresetRecord } from '../types';
import { DEFAULT_CONFIG, normalizeConfig } from './appStateConfig';

export const STARTER_TIMESTAMP = '2026-03-14T00:00:00.000Z';

export function optimizeStarterConfig(config: Partial<ParticleConfig>): Partial<ParticleConfig> {
  const next = { ...config };
  next.layer1Count = Math.min(next.layer1Count ?? DEFAULT_CONFIG.layer1Count, 9000);
  next.layer2Count = Math.min(next.layer2Count ?? DEFAULT_CONFIG.layer2Count, 14000);
  next.layer3Count = Math.min(next.layer3Count ?? DEFAULT_CONFIG.layer3Count, 4500);
  next.ambientCount = Math.min(next.ambientCount ?? DEFAULT_CONFIG.ambientCount, 1500);
  next.layer2AuxCount = Math.min(next.layer2AuxCount ?? DEFAULT_CONFIG.layer2AuxCount, 2800);
  next.layer3AuxCount = Math.min(next.layer3AuxCount ?? DEFAULT_CONFIG.layer3AuxCount, 1600);
  next.layer2SparkCount = Math.min(next.layer2SparkCount ?? DEFAULT_CONFIG.layer2SparkCount, 2600);
  next.layer3SparkCount = Math.min(next.layer3SparkCount ?? DEFAULT_CONFIG.layer3SparkCount, 1400);
  next.layer2Fidelity = Math.min(next.layer2Fidelity ?? DEFAULT_CONFIG.layer2Fidelity, 2);
  next.layer3Fidelity = Math.min(next.layer3Fidelity ?? DEFAULT_CONFIG.layer3Fidelity, 2);
  next.screenPersistenceIntensity = Math.min(next.screenPersistenceIntensity ?? DEFAULT_CONFIG.screenPersistenceIntensity, 0.12);
  next.screenPersistenceLayers = Math.min(next.screenPersistenceLayers ?? DEFAULT_CONFIG.screenPersistenceLayers, 2);
  next.screenInterferenceIntensity = Math.min(next.screenInterferenceIntensity ?? DEFAULT_CONFIG.screenInterferenceIntensity, 0.12);
  next.screenNoiseIntensity = Math.min(next.screenNoiseIntensity ?? DEFAULT_CONFIG.screenNoiseIntensity, 0.14);

  if ((next.layer2Count ?? 0) > 16000 && next.renderQuality === 'cinematic') {
    next.renderQuality = 'balanced';
  }
  if ((next.layer2Count ?? 0) > 16000) {
    next.layer2ConnectionOpacity = Math.min(next.layer2ConnectionOpacity ?? DEFAULT_CONFIG.layer2ConnectionOpacity, 0.14);
  }
  if ((next.layer3Count ?? 0) > 6000) {
    next.layer3ConnectionOpacity = Math.min(next.layer3ConnectionOpacity ?? DEFAULT_CONFIG.layer3ConnectionOpacity, 0.14);
  }

  return next;
}

export function createStarterPreset(
  id: string,
  name: string,
  config: Partial<ParticleConfig>,
): PresetRecord {
  return {
    id,
    name,
    config: normalizeConfig({ ...DEFAULT_CONFIG, ...optimizeStarterConfig(config) }),
    createdAt: STARTER_TIMESTAMP,
    updatedAt: STARTER_TIMESTAMP,
  };
}
