import type { PresetRecord } from '../types';
import { buildPostFxStackPatch } from './postFxLibrary';
import { createStarterPreset } from './starterLibraryCore';

export const STARTER_PRESET_EXTENSION_CHUNK_05_POST_FX: PresetRecord[] = [
  createStarterPreset('starter-post-touch-smear-stack', 'Post Touch Smear Stack', {
        layer1Enabled: true,
        layer2Enabled: true,
        layer2Type: 'signal_braid',
        layer2ConnectionEnabled: true,
        layer2ConnectionStyle: 'filament',
        screenPersistenceIntensity: 0.08,
        ...buildPostFxStackPatch('post-stack-touch-smear'),
      }),
  createStarterPreset('starter-post-particular-glow-stack', 'Post Particular Glow Stack', {
        layer1Enabled: true,
        layer2Enabled: true,
        layer2Type: 'bloom_spores',
        layer2AuxEnabled: true,
        gpgpuEnabled: true,
        gpgpuRibbonEnabled: true,
        ...buildPostFxStackPatch('post-stack-particular-glow'),
      }),
  createStarterPreset('starter-post-retro-feedback-stack', 'Post Retro Feedback Stack', {
        layer1Enabled: true,
        layer2Enabled: true,
        layer2Type: 'contour_echo',
        layer2ConnectionEnabled: true,
        screenPersistenceIntensity: 0.12,
        screenPersistenceLayers: 3,
        screenScanlineIntensity: 0.18,
        screenInterferenceIntensity: 0.12,
        screenSplitIntensity: 0.1,
        ...buildPostFxStackPatch('post-stack-retro-feedback'),
      }),
  createStarterPreset('starter-post-dream-smear-stack', 'Post Dream Smear Stack', {
        layer1Enabled: true,
        layer2Enabled: true,
        layer2Type: 'charge_veil',
        layer3Enabled: true,
        layer3Type: 'prism_smoke',
        screenPersistenceIntensity: 0.06,
        ...buildPostFxStackPatch('post-stack-dream-smear'),
      }),
];
