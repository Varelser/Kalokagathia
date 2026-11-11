import { useEffect, useRef } from 'react';
import type { ParticleConfig } from '../types';
import { warnFeatureAboveTier } from './gpuTierWarnings';

/**
 * GPU tier warning (a): fires when a layer's type transitions INTO
 * 'raymarch' while the visitor's tier is below 'high'. Watched at the
 * App root (always mounted) rather than inside the layer settings,
 * whose sections remount when the type changes category. The initial
 * config does not fire (the ref starts at the mounted values), and
 * pushGpuTierWarning dedupes per feature, so preset morphs/sequences
 * cannot spam it.
 */
export function useGpuTierFeatureWarnings(config: ParticleConfig): void {
  const previousRef = useRef({ layer2: config.layer2Type, layer3: config.layer3Type });
  useEffect(() => {
    const previous = previousRef.current;
    previousRef.current = { layer2: config.layer2Type, layer3: config.layer3Type };
    const enteredRaymarch =
      (config.layer2Type === 'raymarch' && previous.layer2 !== 'raymarch')
      || (config.layer3Type === 'raymarch' && previous.layer3 !== 'raymarch');
    if (enteredRaymarch) {
      warnFeatureAboveTier('raymarch-layer', 'レイマーチングSDF', 'high');
    }
  }, [config.layer2Type, config.layer3Type]);
}
