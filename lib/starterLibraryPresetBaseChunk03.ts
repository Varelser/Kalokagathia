import type { PresetRecord } from '../types';
import { STARTER_PRESET_BASE_CHUNK_03_EVENT_STUDIES } from './starterLibraryPresetBaseChunk03EventStudies';
import { STARTER_PRESET_BASE_CHUNK_03_FIELD_STUDIES } from './starterLibraryPresetBaseChunk03FieldStudies';
import { STARTER_PRESET_BASE_CHUNK_03_HYBRID_STUDIES } from './starterLibraryPresetBaseChunk03HybridStudies';

export const STARTER_PRESET_BASE_CHUNK_03: PresetRecord[] = [
  ...STARTER_PRESET_BASE_CHUNK_03_HYBRID_STUDIES,
  ...STARTER_PRESET_BASE_CHUNK_03_FIELD_STUDIES,
  ...STARTER_PRESET_BASE_CHUNK_03_EVENT_STUDIES,
];
