import type { PresetSequenceItem } from '../types';
import { STARTER_PRESET_SEQUENCE_EXTENSION_CHUNK_01 } from './starterLibrarySequenceExtensionChunk01';
import { STARTER_PRESET_SEQUENCE_EXTENSION_CHUNK_02 } from './starterLibrarySequenceExtensionChunk02';
import { STARTER_PRESET_SEQUENCE_EXTENSION_CHUNK_03 } from './starterLibrarySequenceExtensionChunk03';
import { STARTER_PRESET_SEQUENCE_EXTENSION_CHUNK_04 } from './starterLibrarySequenceExtensionChunk04';

export const STARTER_PRESET_SEQUENCE_EXTENSIONS: PresetSequenceItem[] = [
  ...STARTER_PRESET_SEQUENCE_EXTENSION_CHUNK_01,
  ...STARTER_PRESET_SEQUENCE_EXTENSION_CHUNK_02,
  ...STARTER_PRESET_SEQUENCE_EXTENSION_CHUNK_03,
  ...STARTER_PRESET_SEQUENCE_EXTENSION_CHUNK_04,
];
