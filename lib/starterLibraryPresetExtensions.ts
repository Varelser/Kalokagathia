import type { PresetRecord } from '../types';
import { STARTER_PRESET_EXTENSION_CHUNK_01 } from './starterLibraryPresetExtensionChunk01';
import { STARTER_PRESET_EXTENSION_CHUNK_02 } from './starterLibraryPresetExtensionChunk02';
import { STARTER_PRESET_EXTENSION_CHUNK_03 } from './starterLibraryPresetExtensionChunk03';
import { STARTER_PRESET_EXTENSION_CHUNK_04 } from './starterLibraryPresetExtensionChunk04';
import { STARTER_PRESET_EXTENSION_CHUNK_05 } from './starterLibraryPresetExtensionChunk05';

export const STARTER_PRESET_EXTENSIONS: PresetRecord[] = [
  ...STARTER_PRESET_EXTENSION_CHUNK_01,
  ...STARTER_PRESET_EXTENSION_CHUNK_02,
  ...STARTER_PRESET_EXTENSION_CHUNK_03,
  ...STARTER_PRESET_EXTENSION_CHUNK_04,
  ...STARTER_PRESET_EXTENSION_CHUNK_05,
]
