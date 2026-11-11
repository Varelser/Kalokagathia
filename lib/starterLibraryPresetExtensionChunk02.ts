import type { PresetRecord } from '../types';
import { STARTER_PRESET_EXTENSION_CHUNK_02_CODEX_STUDIES } from './starterLibraryPresetExtensionChunk02CodexStudies';
import { STARTER_PRESET_EXTENSION_CHUNK_02_SOURCE_CONTRASTS } from './starterLibraryPresetExtensionChunk02SourceContrasts';
import { STARTER_PRESET_EXTENSION_CHUNK_02_SURFACE_STUDIES } from './starterLibraryPresetExtensionChunk02SurfaceStudies';
import { STARTER_PRESET_EXTENSION_CHUNK_02_TEXT_VIDEO_STUDIES } from './starterLibraryPresetExtensionChunk02TextVideoStudies';

export const STARTER_PRESET_EXTENSION_CHUNK_02: PresetRecord[] = [
  ...STARTER_PRESET_EXTENSION_CHUNK_02_SURFACE_STUDIES,
  ...STARTER_PRESET_EXTENSION_CHUNK_02_SOURCE_CONTRASTS,
  ...STARTER_PRESET_EXTENSION_CHUNK_02_TEXT_VIDEO_STUDIES,
  ...STARTER_PRESET_EXTENSION_CHUNK_02_CODEX_STUDIES,
];
