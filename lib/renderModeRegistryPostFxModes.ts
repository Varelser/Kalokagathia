import type { RenderModeDefinition } from './renderModeRegistryShared';

export const RENDER_MODE_POST_FX_MODES: RenderModeDefinition[] = [
  {
      id: 'post-bloom',
      label: 'Bloom',
      category: 'post fx',
      support: 'stable',
      description: 'Luminance bloom post-processing.',
      activeWhen: (config) => Boolean(config.postBloomEnabled),
    },
  {
      id: 'post-ca',
      label: 'Chromatic Aberration',
      category: 'post fx',
      support: 'stable',
      description: 'RGB separation in post-processing.',
      activeWhen: (config) => Boolean(config.postChromaticAberrationEnabled),
    },
  {
      id: 'post-dof',
      label: 'Depth of Field',
      category: 'post fx',
      support: 'heavy',
      description: 'Depth-based focus blur.',
      activeWhen: (config) => Boolean(config.postDofEnabled),
    },
  {
      id: 'post-noise',
      label: 'Noise Grain',
      category: 'post fx',
      support: 'stable',
      description: 'Additive luminance grain for texture and feedback feel.',
      activeWhen: (config) => Boolean(config.postNoiseEnabled),
    },
  {
      id: 'post-vignette',
      label: 'Vignette',
      category: 'post fx',
      support: 'stable',
      description: 'Edge darkening for lens or CRT-like framing.',
      activeWhen: (config) => Boolean(config.postVignetteEnabled),
    },
  {
      id: 'post-brightness-contrast',
      label: 'Brightness / Contrast',
      category: 'post fx',
      support: 'stable',
      description: 'Global tonal remap before or after other post passes depending on stack profile.',
      activeWhen: (config) => Boolean(config.postBrightnessContrastEnabled),
    },
];
