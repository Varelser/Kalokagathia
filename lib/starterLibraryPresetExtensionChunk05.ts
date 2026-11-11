import type { PresetRecord } from '../types';
import { STARTER_PRESET_EXTENSION_CHUNK_05_PHASE_CHANGE } from './starterLibraryPresetExtensionChunk05PhaseChange.ts';
import { STARTER_PRESET_EXTENSION_CHUNK_05_GPGPU } from './starterLibraryPresetExtensionChunk05Gpgpu.ts';
import { STARTER_PRESET_EXTENSION_CHUNK_05_REFERENCE } from './starterLibraryPresetExtensionChunk05Reference.ts';
import { STARTER_PRESET_EXTENSION_CHUNK_05_PHASE42 } from './starterLibraryPresetExtensionChunk05Phase42.ts';
import { STARTER_PRESET_EXTENSION_CHUNK_05_POST_FX } from './starterLibraryPresetExtensionChunk05PostFx.ts';

export const STARTER_PRESET_EXTENSION_CHUNK_05: PresetRecord[] = [
  ...STARTER_PRESET_EXTENSION_CHUNK_05_PHASE_CHANGE,
  ...STARTER_PRESET_EXTENSION_CHUNK_05_GPGPU,
  ...STARTER_PRESET_EXTENSION_CHUNK_05_REFERENCE,
  ...STARTER_PRESET_EXTENSION_CHUNK_05_PHASE42,
  ...STARTER_PRESET_EXTENSION_CHUNK_05_POST_FX,
];
