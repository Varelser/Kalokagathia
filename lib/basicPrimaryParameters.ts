// Basic (simple) mode allowlist: the primary parameters that stay visible
// in the deck when Basic mode is on. Everything else is hidden by the DOM
// pass in controlPanelTabs.tsx — nothing is removed, and switching to Pro
// restores the full UI untouched. Keys are config keys (never labels:
// labels repeat heavily across the catalog). Layer 3 mirrors Layer 2 by
// prefix swap, mirroring the descriptions resolver.

import type { ControlPanelTab } from '../components/controlPanelParts';

const GLOBAL_PRIMARY = [
  'opacity', 'contrast', 'particleGlow', 'particleSoftness',
  'rotationSpeedY', 'perspective',
  'postBloomIntensity', 'postBrightness', 'postContrastAmount',
  'screenVignetteIntensity',
  'gpgpuCount', 'gpgpuSize', 'gpgpuSpeed', 'gpgpuOpacity', 'gpgpuGravity',
  'gpgpuTrailLength',
] as const;

const LAYER1_PRIMARY = [
  'sphereRadius', 'baseSize', 'layer1Count', 'layer1SourceSpread',
  'pulseAmplitude', 'pulseSpeed', 'jitter', 'layer1Volume',
] as const;

const LAYER2_PRIMARY = [
  'layer2Count', 'layer2BaseSize',
  'layer2FlowSpeed', 'layer2FlowAmplitude', 'layer2FlowFrequency',
  'layer2Complexity', 'layer2Gravity', 'layer2Trail', 'layer2Life',
  'layer2SourceSpread', 'layer2WarpAmount', 'layer2ConnectionOpacity',
] as const;

const AUDIO_PRIMARY = [
  'audioBassMotionScale', 'audioTrebleMotionScale', 'audioPulseScale',
  'audioBurstScale', 'audioBeatScale', 'audioGateThreshold',
  'synthVolume', 'synthTempo',
] as const;

export const BASIC_PRIMARY_KEYS: Partial<Record<ControlPanelTab, ReadonlySet<string>>> = {
  global: new Set<string>(GLOBAL_PRIMARY),
  layer1: new Set<string>(LAYER1_PRIMARY),
  layer2: new Set<string>(LAYER2_PRIMARY),
  layer3: new Set<string>(LAYER2_PRIMARY.map((k) => k.replace(/^layer2/, 'layer3'))),
  audio: new Set<string>(AUDIO_PRIMARY),
  // play / ambient / ai have no catalog rows to filter — they are already
  // the simple surfaces and stay untouched in Basic.
};

/** Tabs where Basic filtering applies at all. */
export function basicAppliesTo(tab: ControlPanelTab): boolean {
  return tab in BASIC_PRIMARY_KEYS;
}
