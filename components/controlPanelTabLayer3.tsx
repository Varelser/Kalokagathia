import React from 'react';
import { SharedLayerTabContent } from './controlPanelLayerTabShared';
import type { ControlPanelContentProps } from './controlPanelTabsShared';

export const Layer3TabContent: React.FC<ControlPanelContentProps> = (props) => <SharedLayerTabContent {...props} layerIndex={3} />;
