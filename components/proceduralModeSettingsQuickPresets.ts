import type { ProceduralMode, ProceduralQuickPreset } from './proceduralModeSettingsTypes';
import { PROCEDURAL_QUICK_PRESETS_BASE } from './proceduralModeSettingsQuickPresetsBase';
import { PROCEDURAL_QUICK_PRESETS_PHYSICAL } from './proceduralModeSettingsQuickPresetsPhysical';
import { PROCEDURAL_QUICK_PRESETS_FLOW } from './proceduralModeSettingsQuickPresetsFlow';

export const PROCEDURAL_QUICK_PRESETS: Partial<Record<ProceduralMode, ProceduralQuickPreset[]>> = {
  ...PROCEDURAL_QUICK_PRESETS_BASE,
  ...PROCEDURAL_QUICK_PRESETS_PHYSICAL,
  ...PROCEDURAL_QUICK_PRESETS_FLOW,
};
