import type { Layer2Type, PresetRecord } from '../types';
import { getMotionGroupName } from '../components/motionCatalog';
import { getConfigPerformanceTier } from './performanceHints';

export const PRESET_CATEGORY_OPTIONS = ['All', 'Fluid', 'Chaos', 'Orbit', 'Pattern', 'Structure', 'Pulse', 'Transform', 'Audio', 'Plexus', 'Burst', 'Heavy'] as const;

function getMotionIds(preset: PresetRecord): Layer2Type[] {
  const motions = new Set<Layer2Type>();
  motions.add(preset.config.layer2Type);
  motions.add(preset.config.layer3Type);
  preset.config.layer2Motions.forEach((motion) => motions.add(motion));
  preset.config.layer3Motions.forEach((motion) => motions.add(motion));
  return [...motions];
}

export function getPresetCategories(preset: PresetRecord) {
  const categories = new Set<string>();

  getMotionIds(preset).forEach((motion) => {
    categories.add(getMotionGroupName(motion));
  });

  if (preset.config.audioEnabled) categories.add('Audio');
  if (preset.config.layer2ConnectionEnabled || preset.config.layer3ConnectionEnabled) categories.add('Plexus');
  if (
    preset.config.layer2Burst > 0.4 ||
    preset.config.layer3Burst > 0.4 ||
    preset.config.layer2SparkEnabled ||
    preset.config.layer3SparkEnabled
  ) {
    categories.add('Burst');
  }
  if (getConfigPerformanceTier(preset.config) === 'heavy') categories.add('Heavy');

  return [...categories];
}

export function getPresetPerformanceTier(preset: PresetRecord) {
  return getConfigPerformanceTier(preset.config);
}

export function getPresetSearchText(preset: PresetRecord) {
  return [
    preset.name,
    preset.config.layer2Type,
    preset.config.layer3Type,
    ...preset.config.layer2Motions,
    ...preset.config.layer3Motions,
    ...getPresetCategories(preset),
  ].join(' ').toLowerCase();
}
