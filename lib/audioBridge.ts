import type { ParticleConfig } from '../types';
import type { Notice } from './audioControllerTypes';

export const AUDIO_BRIDGE_MODE_PARAM = 'appMode';
export const AUDIO_BRIDGE_MODE_VALUE = 'standalone-synth';
export const AUDIO_BRIDGE_SESSION_PARAM = 'bridgeSession';

export type AudioBridgeWindowMessage =
  | { type: 'audio-bridge-connect'; sessionId: string; config: ParticleConfig; autoStart?: boolean }
  | { type: 'audio-bridge-config'; sessionId: string; config: ParticleConfig }
  | { type: 'audio-bridge-start'; sessionId: string; config?: ParticleConfig }
  | { type: 'audio-bridge-stop'; sessionId: string };

export type AudioBridgeHostMessage =
  | { type: 'audio-bridge-ready'; sessionId: string }
  | { type: 'audio-bridge-status'; sessionId: string; active: boolean; notice?: Notice }
  | { type: 'audio-bridge-levels'; sessionId: string; bass: number; treble: number; pulse: number }
  | { type: 'audio-bridge-error'; sessionId: string; message: string }
  | { type: 'audio-bridge-closed'; sessionId: string };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isAudioBridgeWindowMessage(value: unknown): value is AudioBridgeWindowMessage {
  return isObject(value) && typeof value.type === 'string' && typeof value.sessionId === 'string' && value.type.startsWith('audio-bridge-');
}

export function isAudioBridgeHostMessage(value: unknown): value is AudioBridgeHostMessage {
  return isObject(value) && typeof value.type === 'string' && typeof value.sessionId === 'string' && value.type.startsWith('audio-bridge-');
}

export function createAudioBridgeSessionId() {
  return `audio-bridge-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function buildStandaloneSynthUrl(baseHref: string, sessionId: string) {
  const url = new URL(baseHref);
  url.searchParams.set(AUDIO_BRIDGE_MODE_PARAM, AUDIO_BRIDGE_MODE_VALUE);
  url.searchParams.set(AUDIO_BRIDGE_SESSION_PARAM, sessionId);
  return url.toString();
}
