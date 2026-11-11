import { PROCEDURAL_SYSTEM_MODE_IDS } from '../lib/proceduralModeRegistry';
import type { ProceduralMode } from './proceduralModeSettingsTypes';

const PROCEDURAL_MODE_IDS = Object.values(PROCEDURAL_SYSTEM_MODE_IDS).flatMap((ids) => ids) as ProceduralMode[];

export const PROCEDURAL_MODES = new Set<ProceduralMode>(PROCEDURAL_MODE_IDS);
