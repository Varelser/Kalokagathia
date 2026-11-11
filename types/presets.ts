import type { ParticleConfig } from './config';
import type { PresetSequenceItem } from './sequence';

export interface PresetRecord {
  id: string;
  name: string;
  config: ParticleConfig;
  createdAt: string;
  updatedAt: string;
}

export interface PresetLibraryData {
  version: number;
  exportedAt: string;
  currentConfig: ParticleConfig;
  activePresetId: string | null;
  presetBlendDuration: number;
  sequenceLoopEnabled: boolean;
  presets: PresetRecord[];
  presetSequence: PresetSequenceItem[];
}
