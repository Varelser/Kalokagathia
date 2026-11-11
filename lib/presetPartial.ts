// Partial preset application + two-preset blending.
//
// Groups are defined over full config keys (not just the numeric catalog):
// pattern groups (colour / motion / shape / post) cut across layers, and
// layer groups take a whole layer prefix. Applying a group copies only
// the matching keys from the source preset onto the current config —
// everything else stays exactly as it is.

import type { ParticleConfig } from '../types';
import { normalizeConfig } from './appStateConfig';

export interface PartialGroup {
  id: string;
  label: string;
  description: string;
  matches: (key: string) => boolean;
}

const has = (re: RegExp) => (key: string) => re.test(key);
const prefix = (p: string) => (key: string) => key.startsWith(p);

export const PARTIAL_GROUPS: PartialGroup[] = [
  {
    id: 'color',
    label: '色・質感',
    description: '色、不透明度、グロー、コントラストなど見た目の質感だけ',
    matches: has(/color|hue|saturation|brightness|contrast|opacity|glow|softness|lightness/i),
  },
  {
    id: 'motion',
    label: '動き',
    description: '流れ、速度、渦、重力、アトラクタなど運動だけ',
    matches: has(/flow|motion|speed|velocity|spin|wind|vortex|curl|turbulence|gravity|attractor|levy|orbit|drift|pulse/i),
  },
  {
    id: 'shape',
    label: '形・配置',
    description: '発生源、半径、広がり、粒子数、サイズなど形だけ',
    matches: has(/source|shape|radius|spread|count|size|scale|sphere|geometry|volume|emitter/i),
  },
  {
    id: 'post',
    label: 'ポストFX・画面',
    description: 'ブルーム、ビネット、ノイズ、走査線など画面効果だけ',
    matches: has(/^(post|screen)|bloom|vignette|scanline|grain|chromatic|feedback|kaleidoscope/i),
  },
  {
    id: 'layer1',
    label: 'Layer 1 全体',
    description: 'Layer 1 の全パラメータ（共有の球半径・基本サイズ含む）',
    matches: (key) => key.startsWith('layer1') || ['sphereRadius', 'baseSize', 'pulseAmplitude', 'pulseSpeed', 'jitter'].includes(key),
  },
  { id: 'layer2', label: 'Layer 2 全体', description: 'Layer 2 の全パラメータ', matches: prefix('layer2') },
  { id: 'layer3', label: 'Layer 3 全体', description: 'Layer 3 の全パラメータ', matches: prefix('layer3') },
  { id: 'gpgpu', label: 'GPGPU 全体', description: 'GPGPU システムの全パラメータ', matches: prefix('gpgpu') },
  {
    id: 'audio',
    label: '音反応',
    description: 'オーディオ反応とシンセの設定',
    matches: (key) => key.startsWith('audio') || key.startsWith('ambient') || key.startsWith('synth'),
  },
];

export function groupKeyCount(source: ParticleConfig, groupIds: ReadonlySet<string>): number {
  const groups = PARTIAL_GROUPS.filter((g) => groupIds.has(g.id));
  return Object.keys(source).filter((key) => groups.some((g) => g.matches(key))).length;
}

/** Copy only the selected groups' keys from `source` onto `current`. */
export function applyPartialConfig(
  current: ParticleConfig,
  source: ParticleConfig,
  groupIds: ReadonlySet<string>,
): ParticleConfig {
  const groups = PARTIAL_GROUPS.filter((g) => groupIds.has(g.id));
  const src = normalizeConfig(source) as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = { ...(current as unknown as Record<string, unknown>) };
  Object.keys(src).forEach((key) => {
    if (groups.some((g) => g.matches(key))) out[key] = src[key];
  });
  return normalizeConfig(out);
}

/**
 * Deterministic blend of two configs: numeric keys lerp by t, everything
 * else takes A's value while t < 0.5 and B's from 0.5 up (same convention
 * as the breeding crossover, but without randomness).
 */
export function blendConfigs(a: ParticleConfig, b: ParticleConfig, t: number): ParticleConfig {
  const na = normalizeConfig(a) as unknown as Record<string, unknown>;
  const nb = normalizeConfig(b) as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  const keys = new Set([...Object.keys(na), ...Object.keys(nb)]);
  keys.forEach((key) => {
    const va = na[key];
    const vb = nb[key];
    if (typeof va === 'number' && typeof vb === 'number') {
      out[key] = va + (vb - va) * t;
    } else if (va === undefined) {
      out[key] = vb;
    } else if (vb === undefined) {
      out[key] = va;
    } else {
      out[key] = t < 0.5 ? va : vb;
    }
  });
  return normalizeConfig(out);
}
