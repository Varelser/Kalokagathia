import type { PresetRecord } from '../types';
import { STARTER_PRESET_BASE_CHUNK_01 } from './starterLibraryPresetBaseChunk01';
import { STARTER_PRESET_BASE_CHUNK_02 } from './starterLibraryPresetBaseChunk02';
import { STARTER_PRESET_BASE_CHUNK_03 } from './starterLibraryPresetBaseChunk03';
import { STARTER_PRESET_BASE_CHUNK_04 } from './starterLibraryPresetBaseChunk04';

export const STARTER_PRESET_BASE: PresetRecord[] = [
  ...STARTER_PRESET_BASE_CHUNK_01,
  ...STARTER_PRESET_BASE_CHUNK_02,
  ...STARTER_PRESET_BASE_CHUNK_03,
  ...STARTER_PRESET_BASE_CHUNK_04,
]
