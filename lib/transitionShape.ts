// Preset transition shapes (Phase AW): how a preset morph
// distributes its progress across the config keys. The legacy
// morph ('crossfade') advances every key with the same progress;
// the shaped morphs give each key its own window of the global
// progress — key k starts at rank(k) * (1 - w) and completes w
// later (w = SHAPE_WINDOW) — so keys change in a structured
// order instead of all at once:
//
//   crossfade — every key together (the legacy morph verbatim)
//   wipe      — groups in pipeline order: layer1 → layer2 →
//               layer3 → gpgpu → sequence/screen → post → rest
//   dissolve  — keys in a deterministic hash order (a dissolve
//               of the parameter space, not of pixels)
//   circle    — centre-out: the subject (gpgpu) first, then the
//               layers around it, then the frame (post) last
//
// Guarantees (pinned by the unit tests): at progress 0 every
// key's local progress is 0 and at progress 1 it is 1, for every
// shape and every key; local progress is monotonic
// non-decreasing in the global progress; ranks are a pure
// function of the key name (no state, no RNG), so a shaped morph
// is deterministic and resumable frame by frame.
//
// Honest scope: the shapes order the PARAMETER transition. They
// are not pixel-space wipes/dissolves of the rendered frame.

export type PresetTransitionShape = 'crossfade' | 'wipe' | 'dissolve' | 'circle';

export const PRESET_TRANSITION_SHAPES: readonly PresetTransitionShape[] = [
  'crossfade',
  'wipe',
  'dissolve',
  'circle',
];

export function resolveTransitionShape(value: string | undefined): PresetTransitionShape {
  return value === 'wipe' || value === 'dissolve' || value === 'circle' ? value : 'crossfade';
}

/** Width of each key's transition window, in global progress. */
export const TRANSITION_SHAPE_WINDOW = 0.35;

/** Deterministic hash of a key name into [0, 1). */
export function transitionKeyHash(key: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return (h >>> 0) / 4294967296;
}

const WIPE_GROUPS: readonly { start: number; prefixes: readonly string[] }[] = [
  { start: 0.0, prefixes: ['layer1'] },
  { start: 0.15, prefixes: ['layer2'] },
  { start: 0.3, prefixes: ['layer3'] },
  { start: 0.45, prefixes: ['gpgpu'] },
  { start: 0.6, prefixes: ['sequence', 'screen'] },
  { start: 0.75, prefixes: ['post'] },
];

const CIRCLE_GROUPS: readonly { start: number; prefixes: readonly string[] }[] = [
  { start: 0.0, prefixes: ['gpgpu'] },
  { start: 0.2, prefixes: ['layer1'] },
  { start: 0.4, prefixes: ['layer2'] },
  { start: 0.55, prefixes: ['layer3'] },
  { start: 0.7, prefixes: ['sequence', 'screen'] },
  { start: 0.85, prefixes: ['post'] },
];

function groupedRank(key: string, groups: readonly { start: number; prefixes: readonly string[] }[]): number {
  for (const g of groups) {
    if (g.prefixes.some((p) => key.startsWith(p))) {
      return g.start + transitionKeyHash(key) * 0.12;
    }
  }
  return 0.9 + transitionKeyHash(key) * 0.08;
}

/** The onset rank of one key under a shape, in [0, 1]. */
export function transitionKeyRank(shape: PresetTransitionShape, key: string): number {
  switch (shape) {
    case 'wipe':
      return groupedRank(key, WIPE_GROUPS);
    case 'circle':
      return groupedRank(key, CIRCLE_GROUPS);
    case 'dissolve':
      return transitionKeyHash(key);
    default:
      return 0;
  }
}

/**
 * The local progress of one key at global progress `progress`:
 * 0 until the key's window opens, then linear across the
 * window, then 1. For 'crossfade' this is the progress itself.
 */
export function shapedKeyProgress(shape: PresetTransitionShape, key: string, progress: number): number {
  const p = Math.min(1, Math.max(0, progress));
  if (shape === 'crossfade') return p;
  const w = TRANSITION_SHAPE_WINDOW;
  const start = transitionKeyRank(shape, key) * (1 - w);
  return Math.min(1, Math.max(0, (p - start) / w));
}
