import type { ParticleConfig } from '../types';
import { APP_STATE_DEFAULT_VIEW_DISPLAY } from './appStateDefaultViewDisplay';
import { APP_STATE_DEFAULT_ENVIRONMENT } from './appStateDefaultEnvironment';
import { APP_STATE_DEFAULT_AUDIO_SYNTH } from './appStateDefaultAudioSynth';
import { APP_STATE_DEFAULT_LAYER_1 } from './appStateDefaultLayer1';
import { APP_STATE_DEFAULT_LAYER_2 } from './appStateDefaultLayer2';
import { APP_STATE_DEFAULT_LAYER_3 } from './appStateDefaultLayer3';
import { APP_STATE_DEFAULT_GPGPU } from './appStateDefaultGpgpu';
import { APP_STATE_DEFAULT_POST_AMBIENT } from './appStateDefaultPostAmbient';

export const DEFAULT_CONFIG: ParticleConfig = {
  ...APP_STATE_DEFAULT_VIEW_DISPLAY,
  ...APP_STATE_DEFAULT_ENVIRONMENT,
  ...APP_STATE_DEFAULT_AUDIO_SYNTH,
  ...APP_STATE_DEFAULT_LAYER_1,
  ...APP_STATE_DEFAULT_LAYER_2,
  ...APP_STATE_DEFAULT_LAYER_3,
  ...APP_STATE_DEFAULT_GPGPU,
  ...APP_STATE_DEFAULT_POST_AMBIENT,
} as ParticleConfig;
