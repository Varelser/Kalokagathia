import type React from 'react';
import type { ControlPanelContentProps } from './controlPanelTabsShared';
import type { ParticleConfig } from '../types';
export type SharedLayerTabContentProps = Pick<ControlPanelContentProps, 'config' | 'lockedPanelClass' | 'updateConfig' | 'updateLayerArray' | 'updateMotionArray' | 'updatePositionArray'> & {
  layerIndex: 2 | 3;
};

export type LayerArrayKey =
  | 'layer2Counts'
  | 'layer2Sizes'
  | 'layer2RadiusScales'
  | 'layer2FlowSpeeds'
  | 'layer2FlowAmps'
  | 'layer2FlowFreqs'
  | 'layer3Counts'
  | 'layer3Sizes'
  | 'layer3RadiusScales'
  | 'layer3FlowSpeeds'
  | 'layer3FlowAmps'
  | 'layer3FlowFreqs';
export type LayerBaseCountKey = 'layer2Count' | 'layer3Count';
export type LayerMotionKey = 'layer2Motions' | 'layer3Motions';
export type LayerPositionKey = 'layer2SourcePositions' | 'layer3SourcePositions';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type LayerRead = <T = any>(suffix: string) => T;
export type LayerWrite = (suffix: string, value: unknown) => void;

export type LayerLoadSummary = {
  tier: string;
  suggestions: string[];
};

export type SharedLayerSectionBaseProps = Pick<
  SharedLayerTabContentProps,
  'config' | 'updateConfig' | 'updateLayerArray' | 'updateMotionArray' | 'updatePositionArray'
> & {
  layerIndex: 2 | 3;
  layerName: string;
  layerShortName: string;
  read: LayerRead;
  write: LayerWrite;
  baseCountKey: LayerBaseCountKey;
  sourcePositionsKey: LayerPositionKey;
  motionsKey: LayerMotionKey;
  countsKey: LayerArrayKey;
  sizesKey: LayerArrayKey;
  radiusScalesKey: LayerArrayKey;
  flowSpeedsKey: LayerArrayKey;
  flowAmpsKey: LayerArrayKey;
  flowFreqsKey: LayerArrayKey;
  layerLoad: LayerLoadSummary;
};

export type SharedLayerSourceSectionsProps = SharedLayerSectionBaseProps & {
  showSourceLayout: boolean;
};

export type SharedLayerParticleSectionsProps = SharedLayerSectionBaseProps & {
  isProceduralMode: boolean;
  compactProceduralUi: boolean;
  setCompactProceduralUi: React.Dispatch<React.SetStateAction<boolean>>;
  showLegacyDynamics: boolean;
  setShowLegacyDynamics: React.Dispatch<React.SetStateAction<boolean>>;
};

export const getLayerKey = (layerIndex: 2 | 3, suffix: string) => `layer${layerIndex}${suffix}` as keyof ParticleConfig;
