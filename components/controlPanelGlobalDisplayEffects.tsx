import React from 'react';

import type { GlobalDisplayScreenFxSectionProps } from './controlPanelGlobalDisplayEffectsShared';
import { GlobalDisplayGpgpuSection } from './controlPanelGlobalDisplayGpgpu';
import { GlobalDisplayPostFxSection } from './controlPanelGlobalDisplayPostFx';
import { GlobalDisplayScreenFxSection } from './controlPanelGlobalDisplayScreenFx';

export const GlobalDisplayEffectsSection: React.FC<GlobalDisplayScreenFxSectionProps> = ({
  applyScreenFxPreset,
  config,
  updateConfig,
}) => (
  <>
    <GlobalDisplayPostFxSection config={config} updateConfig={updateConfig} />
    <GlobalDisplayGpgpuSection config={config} updateConfig={updateConfig} />
    <GlobalDisplayScreenFxSection
      applyScreenFxPreset={applyScreenFxPreset}
      config={config}
      updateConfig={updateConfig}
    />
  </>
);
