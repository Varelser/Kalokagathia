import type { PresetRecord } from '../types';
import { STARTER_PRESET_EXTENSION_CHUNK_03_EXPRESSION } from './starterLibraryPresetExtensionChunk03Expression.ts';
import { STARTER_PRESET_EXTENSION_CHUNK_03_SOURCE_CONTRAST } from './starterLibraryPresetExtensionChunk03SourceContrast.ts';
import { STARTER_PRESET_EXTENSION_CHUNK_03_REVIEW_SPLIT } from './starterLibraryPresetExtensionChunk03ReviewSplit.ts';

export const STARTER_PRESET_EXTENSION_CHUNK_03: PresetRecord[] = [
  ...STARTER_PRESET_EXTENSION_CHUNK_03_EXPRESSION,
  ...STARTER_PRESET_EXTENSION_CHUNK_03_SOURCE_CONTRAST,
  ...STARTER_PRESET_EXTENSION_CHUNK_03_REVIEW_SPLIT,
];
