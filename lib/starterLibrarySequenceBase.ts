import type { PresetSequenceItem } from '../types';
import { STARTER_PRESET_SEQUENCE_CHUNK_01 } from './starterLibrarySequenceChunk01';
import { STARTER_PRESET_SEQUENCE_CHUNK_02 } from './starterLibrarySequenceChunk02';
import { STARTER_PRESET_SEQUENCE_CHUNK_03 } from './starterLibrarySequenceChunk03';
import { STARTER_PRESET_SEQUENCE_CHUNK_04 } from './starterLibrarySequenceChunk04';

export const STARTER_PRESET_SEQUENCE_BASE: PresetSequenceItem[] = [
  ...STARTER_PRESET_SEQUENCE_CHUNK_01,
  ...STARTER_PRESET_SEQUENCE_CHUNK_02,
  ...STARTER_PRESET_SEQUENCE_CHUNK_03,
  ...STARTER_PRESET_SEQUENCE_CHUNK_04,
]
