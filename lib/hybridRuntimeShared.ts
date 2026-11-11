import type { ParticleConfig } from '../types';

export type HybridSourceInfluence = {
  ring: number;
  sweep: number;
  column: number;
  canopy: number;
  fracture: number;
  blob: number;
  veil: number;
  tiltX: number;
  tiltY: number;
};

export function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

export function getHybridAudioDrive(
  audioRef: React.MutableRefObject<{ bass: number; treble: number; pulse: number; bandA: number; bandB: number }>,
  isPlaying: boolean,
  weights: { bass?: number; treble?: number; pulse?: number } = {},
) {
  if (!isPlaying) return 0;
  const bass = audioRef.current?.bass ?? 0;
  const treble = audioRef.current?.treble ?? 0;
  const pulse = audioRef.current?.pulse ?? 0;
  return bass * (weights.bass ?? 0.52) + treble * (weights.treble ?? 0.24) + pulse * (weights.pulse ?? 0.24);
}

export function getHybridSourceInfluence(source: ParticleConfig['layer2Source']): HybridSourceInfluence {
  switch (source) {
    case 'text':
      return { ring: 0.02, sweep: 0.04, column: 0.12, canopy: 0.04, fracture: 0.16, blob: 0.02, veil: 0.04, tiltX: -0.08, tiltY: 0.06 };
    case 'grid':
      return { ring: 0.04, sweep: 0.02, column: 0.1, canopy: 0.02, fracture: 0.12, blob: 0.04, veil: 0.02, tiltX: -0.02, tiltY: 0.02 };
    case 'ring':
    case 'disc':
    case 'torus':
      return { ring: 0.26, sweep: 0.08, column: 0.02, canopy: 0.02, fracture: 0.02, blob: 0.04, veil: 0.02, tiltX: 0.0, tiltY: 0.08 };
    case 'spiral':
    case 'galaxy':
      return { ring: 0.1, sweep: 0.28, column: 0.02, canopy: 0.04, fracture: 0.04, blob: 0.02, veil: 0.08, tiltX: 0.14, tiltY: 0.1 };
    case 'image':
    case 'video':
      return { ring: 0.04, sweep: 0.06, column: 0.04, canopy: 0.16, fracture: 0.04, blob: 0.18, veil: 0.16, tiltX: -0.12, tiltY: 0.02 };
    case 'cube':
    case 'cylinder':
    case 'cone':
      return { ring: 0.02, sweep: 0.06, column: 0.2, canopy: 0.04, fracture: 0.12, blob: 0.04, veil: 0.04, tiltX: -0.16, tiltY: 0.12 };
    case 'plane':
      return { ring: 0.04, sweep: 0.1, column: 0.04, canopy: 0.12, fracture: 0.06, blob: 0.12, veil: 0.14, tiltX: -0.18, tiltY: 0.0 };
    default:
      return { ring: 0.0, sweep: 0.0, column: 0.0, canopy: 0.0, fracture: 0.0, blob: 0.0, veil: 0.0, tiltX: 0.0, tiltY: 0.0 };
  }
}
