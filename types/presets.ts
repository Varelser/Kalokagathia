import type { ParticleConfig } from './config';
import type { PresetSequenceItem } from './sequence';
import type { UserParameterDeclaration } from '../lib/userParameters';

export interface PresetRecord {
  id: string;
  name: string;
  config: ParticleConfig;
  createdAt: string;
  updatedAt: string;
  /**
   * Phase 21 stage 1 (#p= propagation): User Parameter declarations
   * bundled with this preset. Optional and absent on every legacy
   * record — a record without declarations applies exactly as
   * before. When a #p= share link resolves a record that carries
   * declarations, they become the session-only overlay (the same
   * discipline as #c= bundles in lib/shareLink.ts).
   */
  userParameters?: UserParameterDeclaration[];
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
