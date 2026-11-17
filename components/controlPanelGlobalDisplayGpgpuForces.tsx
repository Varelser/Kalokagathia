import React from 'react';

import type { GlobalDisplayEffectsSharedProps } from './controlPanelGlobalDisplayEffectsShared';
import { GlobalDisplayGpgpuForcesCoreSection } from './controlPanelGlobalDisplayGpgpuForcesCore';
import { GlobalDisplayGpgpuForcesMorphSection } from './controlPanelGlobalDisplayGpgpuForcesMorph';
import { GlobalDisplayGpgpuForcesAuxColorSection } from './controlPanelGlobalDisplayGpgpuForcesAuxColor';
import { GlobalDisplayGpgpuForcesMapsSection } from './controlPanelGlobalDisplayGpgpuForcesMaps';

export const GlobalDisplayGpgpuForcesSection: React.FC<GlobalDisplayEffectsSharedProps> = ({
  config,
  updateConfig,
}) => (
  <>
    <GlobalDisplayGpgpuForcesCoreSection config={config} updateConfig={updateConfig} />
    <GlobalDisplayGpgpuForcesMorphSection config={config} updateConfig={updateConfig} />
    <GlobalDisplayGpgpuForcesAuxColorSection config={config} updateConfig={updateConfig} />
    <GlobalDisplayGpgpuForcesMapsSection config={config} updateConfig={updateConfig} />
  </>
);
