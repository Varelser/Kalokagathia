import type { PresetRecord } from '../types';
import { STARTER_PRESET_BASE_CHUNK_01_CINEMATIC } from './starterLibraryPresetBaseChunk01Cinematic';
import { STARTER_PRESET_BASE_CHUNK_01_FOUNDATIONAL } from './starterLibraryPresetBaseChunk01Foundational';
import { STARTER_PRESET_BASE_CHUNK_01_STRUCTURAL } from './starterLibraryPresetBaseChunk01Structural';

export const STARTER_PRESET_BASE_CHUNK_01: PresetRecord[] = [
  ...STARTER_PRESET_BASE_CHUNK_01_FOUNDATIONAL,
  ...STARTER_PRESET_BASE_CHUNK_01_STRUCTURAL,
  ...STARTER_PRESET_BASE_CHUNK_01_CINEMATIC,
];
