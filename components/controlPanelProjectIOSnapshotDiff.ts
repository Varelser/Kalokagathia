import type { ParticleConfig } from '../types';

const DIFF_FIELDS: Array<{ key: keyof ParticleConfig; label: string }> = [
  { key: 'layer1Enabled', label: 'Layer 1 on/off' },
  { key: 'layer2Enabled', label: 'Layer 2 on/off' },
  { key: 'layer3Enabled', label: 'Layer 3 on/off' },
  { key: 'layer2Type', label: 'Layer 2 mode' },
  { key: 'layer3Type', label: 'Layer 3 mode' },
  { key: 'layer2Source', label: 'Layer 2 source' },
  { key: 'layer3Source', label: 'Layer 3 source' },
  { key: 'layer2MaterialStyle', label: 'Layer 2 material' },
  { key: 'layer3MaterialStyle', label: 'Layer 3 material' },
  { key: 'layer1Count', label: 'Layer 1 count' },
  { key: 'layer2Count', label: 'Layer 2 count' },
  { key: 'layer3Count', label: 'Layer 3 count' },
  { key: 'baseSize', label: 'Base size' },
  { key: 'layer2BaseSize', label: 'Layer 2 size' },
  { key: 'layer3BaseSize', label: 'Layer 3 size' },
  { key: 'postBloomIntensity', label: 'Bloom' },
  { key: 'cameraDistance', label: 'Camera distance' },
  { key: 'layer2Trail', label: 'Layer 2 trail' },
  { key: 'layer3Trail', label: 'Layer 3 trail' },
  { key: 'depthFogEnabled', label: 'Depth fog' },
  { key: 'backgroundColor', label: 'Background' },
];

function formatValue(value: unknown) {
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(2);
  if (typeof value === 'boolean') return value ? 'On' : 'Off';
  if (Array.isArray(value)) return `${value.length} items`;
  if (value == null) return 'None';
  return String(value);
}

export function getSnapshotDiff(currentConfig: ParticleConfig, compareConfig: ParticleConfig | null) {
  if (!compareConfig) {
    return { total: 0, highlights: [] as Array<{ label: string; current: string; compare: string }> };
  }
  const highlights = DIFF_FIELDS.flatMap(({ key, label }) => {
    const current = currentConfig[key];
    const compare = compareConfig[key];
    if (JSON.stringify(current) === JSON.stringify(compare)) return [];
    return [{ label, current: formatValue(current), compare: formatValue(compare) }];
  });
  return { total: highlights.length, highlights: highlights.slice(0, 6) };
}
