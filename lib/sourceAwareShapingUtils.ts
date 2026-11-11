import type { Layer3Source } from '../types/scene';
import type { SourceAwareLayerConfig } from './sourceAwareShapingTypes';

export function getLayerSource(config: SourceAwareLayerConfig, layerIndex: 2 | 3): Layer3Source {
  return layerIndex === 2 ? config.layer2Source : config.layer3Source;
}

export function clampZero(value: number) {
  return Math.max(0, value);
}

export function clampUnit(value: number) {
  return Math.min(1, Math.max(0, value));
}
