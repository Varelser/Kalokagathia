import React from 'react';
import { DEFAULT_CONFIG } from '../lib/appStateConfig';
import { getDepictionArchitecture } from '../lib/depictionArchitecture';
import type { ParticleConfig } from '../types';
import { PROCEDURAL_GUIDES, PROCEDURAL_LABELS, PROCEDURAL_MODES, PROCEDURAL_QUICK_PRESETS, proceduralLayerPatch } from './proceduralModeSettingsCatalog';
import { ProceduralModeOverview } from './proceduralModeSettingsOverview';
import { ProceduralModeSpecificControls } from './proceduralModeSpecificControls';
import type { UpdateConfig } from './controlPanelTabsShared';

export { PROCEDURAL_MODES } from './proceduralModeSettingsCatalog';

type ProceduralModeSettingsProps = {
  config: ParticleConfig;
  layerIndex: 2 | 3;
  updateConfig: UpdateConfig;
};

export const ProceduralModeSettings: React.FC<ProceduralModeSettingsProps> = ({ config, layerIndex, updateConfig }) => {
  const mode = layerIndex === 2 ? config.layer2Type : config.layer3Type;
  if (!PROCEDURAL_MODES.has(mode)) {
    return null;
  }

  const guide = PROCEDURAL_GUIDES[mode];
  const quickPresets = PROCEDURAL_QUICK_PRESETS[mode] ?? [];
  const depictionArchitecture = getDepictionArchitecture(mode);
  const resetSource = guide?.bestSources[0] ?? 'sphere';

  const applyQuickPreset = (patch: Partial<ParticleConfig>) => {
    Object.entries(patch).forEach(([patchKey, patchValue]) => {
      updateConfig(patchKey as keyof ParticleConfig, patchValue as never);
    });
  };

  const resetModeDefaults = () => {
    const patch: Partial<ParticleConfig> = {
      ...proceduralLayerPatch(layerIndex, {
        Type: mode,
        Count: DEFAULT_CONFIG.layer2Count,
        BaseSize: DEFAULT_CONFIG.layer2BaseSize,
        RadiusScale: DEFAULT_CONFIG.layer2RadiusScale,
        ConnectionEnabled: false,
        Trail: 0,
        Source: resetSource,
        MaterialStyle: 'classic',
        TemporalProfile: 'steady',
        TemporalStrength: DEFAULT_CONFIG.layer2TemporalStrength,
        TemporalSpeed: DEFAULT_CONFIG.layer2TemporalSpeed,
      }),
    };
    applyQuickPreset(patch);
  };

  return (
    <div className="mt-4 rounded border border-white/10 bg-white/5 p-3">
      <ProceduralModeOverview
        config={config}
        layerIndex={layerIndex}
        updateConfig={updateConfig}
        label={PROCEDURAL_LABELS[mode] ?? 'Procedural'}
        guide={guide}
        depictionArchitecture={depictionArchitecture}
        quickPresets={quickPresets}
        applyQuickPreset={applyQuickPreset}
        resetModeDefaults={resetModeDefaults}
      />
      <ProceduralModeSpecificControls
        config={config}
        layerIndex={layerIndex}
        updateConfig={updateConfig}
        mode={mode}
      />
    </div>
  );
};
