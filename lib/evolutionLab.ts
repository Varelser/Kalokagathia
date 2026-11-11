// Evolution lab helpers: a cheap config-space fitness estimate for bred
// children, used to rank them before (and alongside) the real canvas
// screening that lives in the Breeding section. The estimate only reads
// the config — it never touches the renderer.

import type { ParticleConfig } from '../types';

export interface ChildFitness {
  /** 0..100 heuristic score. */
  score: number;
  /** Estimated emitted-particle load (arbitrary units, for display). */
  load: number;
  /** Estimated visible presence 0..1 (counts x size x opacity). */
  presence: number;
  /** Estimated motion energy (arbitrary units). */
  motion: number;
}

const num = (config: ParticleConfig, key: keyof ParticleConfig): number => {
  const v = (config as unknown as Record<string, unknown>)[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
};

export function scoreChild(config: ParticleConfig): ChildFitness {
  const count =
    num(config, 'layer1Count') +
    num(config, 'layer2Count') +
    num(config, 'layer3Count') +
    num(config, 'gpgpuCount') / 64;
  const size = Math.max(0.1, num(config, 'baseSize') + num(config, 'layer2BaseSize') * 0.5);
  const opacity = Math.min(1, Math.max(0, num(config, 'opacity')));
  const presence = Math.min(1, (count / 6000) * size * (0.25 + opacity));
  const load = count * size;
  const motion =
    Math.abs(num(config, 'layer2FlowSpeed')) * 20 +
    Math.abs(num(config, 'layer3FlowSpeed')) * 20 +
    Math.abs(num(config, 'rotationSpeedY')) * 40 +
    Math.abs(num(config, 'layer2FlowAmplitude')) * 0.4;
  // Score: presence in a healthy band scores best; extreme load (heavy)
  // and near-invisibility score poorly; some motion is rewarded.
  const presenceScore = presence <= 0.02 ? presence * 500 : Math.max(0, 100 - Math.abs(presence - 0.45) * 90);
  const loadPenalty = load > 30000 ? Math.min(35, (load - 30000) / 4000) : 0;
  const motionScore = Math.min(20, motion * 0.35);
  const score = Math.max(0, Math.min(100, presenceScore * 0.75 + motionScore - loadPenalty));
  return { score: Math.round(score * 10) / 10, load: Math.round(load), presence: Math.round(presence * 100) / 100, motion: Math.round(motion) };
}

export interface ScreenMetrics {
  litPct: number;
  meanLum: number;
}

/** Sample the live WebGL canvas (preserveDrawingBuffer is on for export). */
export function sampleCanvasMetrics(): ScreenMetrics | null {
  const canvas = document.querySelector('canvas');
  if (!canvas) return null;
  try {
    const g = document.createElement('canvas');
    g.width = 160;
    g.height = 100;
    const ctx = g.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(canvas as HTMLCanvasElement, 0, 0, 160, 100);
    const d = ctx.getImageData(0, 0, 160, 100).data;
    let lit = 0;
    let sum = 0;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) {
      const l = (d[i] + d[i + 1] + d[i + 2]) / 3;
      sum += l;
      if (l > 26) lit += 1;
      n += 1;
    }
    return { litPct: Math.round((100 * lit * 10) / n) / 10, meanLum: Math.round((sum * 10) / n) / 10 };
  } catch {
    return null;
  }
}
