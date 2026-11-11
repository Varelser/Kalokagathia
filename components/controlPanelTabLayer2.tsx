import React from 'react';
import { SharedLayerTabContent } from './controlPanelLayerTabShared';
import type { ControlPanelContentProps } from './controlPanelTabsShared';

export const Layer2TabContent: React.FC<ControlPanelContentProps> = (props) => <SharedLayerTabContent {...props} layerIndex={2} />;
