import type { Layer2Type } from '../types';
import { isProceduralLayerMode } from './depictionArchitecture';

export type ControlSectionId =
  | 'source-layout'
  | 'motion-selector'
  | 'layer-load'
  | 'legacy-particle-controls'
  | 'procedural-controls';

export interface ModeParameterSchema {
  compactHiddenSections: ControlSectionId[];
  focusSections: ControlSectionId[];
}

const DEFAULT_SCHEMA: ModeParameterSchema = {
  compactHiddenSections: [],
  focusSections: ['source-layout', 'motion-selector', 'layer-load', 'legacy-particle-controls'],
};

const PROCEDURAL_SCHEMA: ModeParameterSchema = {
  compactHiddenSections: ['source-layout', 'motion-selector', 'layer-load'],
  focusSections: ['procedural-controls', 'legacy-particle-controls'],
};

export function getModeParameterSchema(mode: Layer2Type): ModeParameterSchema {
  return isProceduralLayerMode(mode) ? PROCEDURAL_SCHEMA : DEFAULT_SCHEMA;
}

export function shouldShowModeSection(mode: Layer2Type, compactProceduralUi: boolean, section: ControlSectionId) {
  const schema = getModeParameterSchema(mode);
  if (!compactProceduralUi) return true;
  return !schema.compactHiddenSections.includes(section);
}
