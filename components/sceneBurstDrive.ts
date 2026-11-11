import type { ParticleBurstWaveform, ParticleConfig } from '../types';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const smoothstep = (edge0: number, edge1: number, value: number) => {
  const t = clamp((value - edge0) / Math.max(0.0001, edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};

const getWaveformEnvelope = (lifeProgress: number, waveform: ParticleBurstWaveform) => {
  if (waveform === 'loop') {
    return (1 - smoothstep(0, 0.32, lifeProgress)) * (0.85 + Math.sin(lifeProgress * Math.PI * 2) * 0.15);
  }
  if (waveform === 'stutter') {
    const pulseA = 1 - smoothstep(0, 0.09, Math.abs(lifeProgress - 0.12));
    const pulseB = 1 - smoothstep(0, 0.09, Math.abs(lifeProgress - 0.26));
    const pulseC = 1 - smoothstep(0, 0.09, Math.abs(lifeProgress - 0.41));
    return Math.max(pulseA, pulseB, pulseC);
  }
  if (waveform === 'heartbeat') {
    const beatA = 1 - smoothstep(0, 0.1, Math.abs(lifeProgress - 0.16));
    const beatB = 1 - smoothstep(0, 0.1, Math.abs(lifeProgress - 0.31));
    return Math.max(beatA, beatB * 0.82);
  }
  return 1 - smoothstep(0, 0.32, lifeProgress);
};

const getLayerBurstEnergy = (
  enabled: boolean,
  burst: number,
  life: number,
  lifeSpread: number,
  phase: number,
  waveform: ParticleBurstWaveform,
  sparkEnabled: boolean,
  sparkBurst: number,
  timeSeconds: number,
) => {
  if (!enabled || burst <= 0) return 0;
  const particleLife = Math.max(4, life * (1 + lifeSpread * 0.25));
  const lifeProgress = ((timeSeconds * 60) / particleLife + phase) % 1;
  const burstEnvelope = getWaveformEnvelope(lifeProgress, waveform);
  const sparkBoost = sparkEnabled ? sparkBurst * 0.12 : 0;
  return clamp((burst + sparkBoost) * burstEnvelope, 0, 2);
};

export const getBurstDriveEnergy = (
  config: ParticleConfig,
  timeSeconds: number,
  isPlaying: boolean,
  audioBass = 0,
) => {
  const playScale = isPlaying ? 1 : 0.2;
  const layer2Energy = getLayerBurstEnergy(
    config.layer2Enabled,
    config.layer2Burst,
    config.layer2Life,
    config.layer2LifeSpread,
    config.layer2BurstPhase,
    config.layer2BurstWaveform,
    config.layer2SparkEnabled,
    config.layer2SparkBurst,
    timeSeconds,
  );
  const layer3Energy = getLayerBurstEnergy(
    config.layer3Enabled,
    config.layer3Burst,
    config.layer3Life,
    config.layer3LifeSpread,
    config.layer3BurstPhase,
    config.layer3BurstWaveform,
    config.layer3SparkEnabled,
    config.layer3SparkBurst,
    timeSeconds * 1.07 + 0.13,
  );
  return clamp((layer2Energy * 0.85 + layer3Energy) * playScale * (1 + audioBass * 0.3), 0, 2);
};
