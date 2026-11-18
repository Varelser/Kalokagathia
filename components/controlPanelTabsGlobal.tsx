import React from 'react';
import { GlobalDisplaySection } from './controlPanelGlobalDisplay';
import { GlobalExportSection } from './controlPanelGlobalExport';
import { GlobalPresetsSection } from './controlPanelGlobalPresets';
import { GlobalProjectSection } from './controlPanelGlobalProject';
import { GlobalSequenceSection } from './controlPanelGlobalSequence';
import { UserParametersSection } from './controlPanelUserParameters';
import { ControlPanelContentProps } from './controlPanelTabsShared';

export const GlobalTabContent: React.FC<ControlPanelContentProps> = (props) => (
  <>
    <GlobalPresetsSection {...props} />
    <GlobalSequenceSection {...props} />
    <UserParametersSection config={props.config} isPublicLibrary={props.isPublicLibrary} updateConfig={props.updateConfig} />
    <GlobalProjectSection {...props} />
    <GlobalExportSection {...props} />
    <GlobalDisplaySection {...props} />
  </>
);
