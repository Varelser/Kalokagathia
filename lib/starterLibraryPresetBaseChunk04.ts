import type { PresetRecord } from '../types';
import { STARTER_PRESET_BASE_CHUNK_04_CORE_RELICS } from './starterLibraryPresetBaseChunk04CoreRelics';
import { STARTER_PRESET_BASE_CHUNK_04_RITUAL_RELICS } from './starterLibraryPresetBaseChunk04RitualRelics';
import { STARTER_PRESET_BASE_CHUNK_04_WEATHER_RELICS } from './starterLibraryPresetBaseChunk04WeatherRelics';

export const STARTER_PRESET_BASE_CHUNK_04: PresetRecord[] = [
  ...STARTER_PRESET_BASE_CHUNK_04_CORE_RELICS,
  ...STARTER_PRESET_BASE_CHUNK_04_WEATHER_RELICS,
  ...STARTER_PRESET_BASE_CHUNK_04_RITUAL_RELICS,
];
