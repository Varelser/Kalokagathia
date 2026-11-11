import type { ParticleConfig } from '../types/config';
import { RENDER_MODE_GPGPU_MODES } from './renderModeRegistryGpgpuModes';
import { RENDER_MODE_LAYER_MODES } from './renderModeRegistryLayerModes';
import { RENDER_MODE_POST_FX_MODES } from './renderModeRegistryPostFxModes';
import {
  type ActiveRenderModeInfo,
  type RenderModeCategory,
  type RenderModeSupport,
  RENDER_CATEGORY_ORDER,
} from './renderModeRegistryShared';

export type { ActiveRenderModeInfo, RenderModeCategory, RenderModeDefinition, RenderModeSupport } from './renderModeRegistryShared';
export { RENDER_CATEGORY_ORDER } from './renderModeRegistryShared';

export const RENDER_MODE_REGISTRY = [
  ...RENDER_MODE_LAYER_MODES,
  ...RENDER_MODE_GPGPU_MODES,
  ...RENDER_MODE_POST_FX_MODES,
];

export function getRenderModes(config: ParticleConfig): ActiveRenderModeInfo[] {
  return RENDER_MODE_REGISTRY.map((mode) => ({
    ...mode,
    active: mode.activeWhen(config),
  }));
}

export function getActiveRenderModes(config: ParticleConfig): ActiveRenderModeInfo[] {
  return getRenderModes(config).filter((mode) => mode.active);
}

export function getRenderCategorySummary(config: ParticleConfig): Array<{
  category: RenderModeCategory;
  activeCount: number;
  totalCount: number;
}> {
  const modes = getRenderModes(config);
  return RENDER_CATEGORY_ORDER.map((category) => {
    const categoryModes = modes.filter((mode) => mode.category === category);
    return {
      category,
      activeCount: categoryModes.filter((mode) => mode.active).length,
      totalCount: categoryModes.length,
    };
  }).filter((entry) => entry.totalCount > 0);
}

export function getRenderSupportSummary(config: ParticleConfig): Record<RenderModeSupport, number> {
  const counts: Record<RenderModeSupport, number> = {
    stable: 0,
    experimental: 0,
    heavy: 0,
  };

  for (const mode of getActiveRenderModes(config)) {
    counts[mode.support] += 1;
  }

  return counts;
}
