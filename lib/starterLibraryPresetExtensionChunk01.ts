import type { PresetRecord } from '../types';
import { STARTER_PRESET_EXTENSION_CHUNK_01_ATMOSPHERIC } from './starterLibraryPresetExtensionChunk01Atmospheric';
import { STARTER_PRESET_EXTENSION_CHUNK_01_ATLAS } from './starterLibraryPresetExtensionChunk01Atlas';
import { STARTER_PRESET_EXTENSION_CHUNK_01_OUTLINE_BIOLOGIC } from './starterLibraryPresetExtensionChunk01OutlineBiologic';

export const STARTER_PRESET_EXTENSION_CHUNK_01: PresetRecord[] = [
  ...STARTER_PRESET_EXTENSION_CHUNK_01_ATMOSPHERIC,
  ...STARTER_PRESET_EXTENSION_CHUNK_01_ATLAS,
  ...STARTER_PRESET_EXTENSION_CHUNK_01_OUTLINE_BIOLOGIC,
];
