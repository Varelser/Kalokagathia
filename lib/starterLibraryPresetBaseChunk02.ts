import type { PresetRecord } from '../types';
import { STARTER_PRESET_BASE_CHUNK_02_PROCEDURAL } from './starterLibraryPresetBaseChunk02Procedural.ts';
import { STARTER_PRESET_BASE_CHUNK_02_MOTION } from './starterLibraryPresetBaseChunk02Motion.ts';
import { STARTER_PRESET_BASE_CHUNK_02_HYBRID } from './starterLibraryPresetBaseChunk02Hybrid.ts';

export const STARTER_PRESET_BASE_CHUNK_02: PresetRecord[] = [
  ...STARTER_PRESET_BASE_CHUNK_02_PROCEDURAL,
  ...STARTER_PRESET_BASE_CHUNK_02_MOTION,
  ...STARTER_PRESET_BASE_CHUNK_02_HYBRID,
];
