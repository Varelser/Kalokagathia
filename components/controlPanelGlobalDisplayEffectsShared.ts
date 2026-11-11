import type { ParticleConfig } from '../types';
import type { ControlPanelContentProps } from './controlPanelTabsShared';

export type UpdateConfig = ControlPanelContentProps['updateConfig'];
export type ApplyScreenFxPreset = ControlPanelContentProps['applyScreenFxPreset'];

export interface GlobalDisplayEffectsSharedProps {
  config: ParticleConfig;
  updateConfig: UpdateConfig;
}

export interface GlobalDisplayScreenFxSectionProps extends GlobalDisplayEffectsSharedProps {
  applyScreenFxPreset: ApplyScreenFxPreset;
}
