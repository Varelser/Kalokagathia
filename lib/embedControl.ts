import type { ParticleConfig } from '../types';
import { AI_CONTROL_CATALOG_VERSION, validateAiPatch } from './aiControlCatalog';
import {
  findUserParameterByName,
  getUserParameters,
  resolveUserParameterTarget,
  validateUserParameterValue,
} from './userParameters';

/**
 * Embed script API (Phase AO): the postMessage control protocol
 * for the embed player (PUBLIC_API.md is the public spec).
 *
 * The embed player is pasted into arbitrary host pages, so there
 * is no origin allowlist. The safety boundary is structural
 * instead:
 * - messages must carry the protocol namespace + version, or
 *   they are ignored entirely;
 * - setParam values pass through the AI control catalog
 *   validation unchanged (unknown keys, wrong types, out-of-range
 *   numbers and illegal enum values are dropped);
 * - applyPreset takes a preset / starter ID only — arbitrary
 *   config injection is not part of the protocol;
 * - setUserParam writes only through a declared User Parameter
 *   name, validated against the declaration's catalog shape;
 * - every state change goes through the normal config update
 *   path supplied by the host component.
 *
 * The listener is mounted only by the embed player; the main app
 * never registers it. With no messages arriving, nothing here
 * runs and the embed behaves exactly as before.
 */

export const EMBED_CONTROL_NS = 'kalokagathia';
export const EMBED_CONTROL_VERSION = 1;

export type EmbedControlCommand =
  | { type: 'setParam'; key: string; value: unknown }
  | { type: 'applyPreset'; id: string }
  | { type: 'setUserParam'; name: string; value: unknown }
  | { type: 'getState' };

/** Parse an unknown message payload; null = not a protocol message. */
export function parseEmbedControlMessage(data: unknown): EmbedControlCommand | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const message = data as Record<string, unknown>;
  if (message.ns !== EMBED_CONTROL_NS || message.v !== EMBED_CONTROL_VERSION) return null;
  switch (message.type) {
    case 'setParam':
      return typeof message.key === 'string' && message.key.length > 0 && 'value' in message
        ? { type: 'setParam', key: message.key, value: message.value }
        : null;
    case 'applyPreset':
      return typeof message.id === 'string' && message.id.length > 0
        ? { type: 'applyPreset', id: message.id }
        : null;
    case 'setUserParam':
      return typeof message.name === 'string' && message.name.length > 0 && 'value' in message
        ? { type: 'setUserParam', name: message.name, value: message.value }
        : null;
    case 'getState':
      return { type: 'getState' };
    default:
      return null;
  }
}

export interface EmbedControlHandlers {
  /** Current config (validation baseline). */
  config: ParticleConfig;
  /** Apply one validated change through the normal config path. */
  applyValue: (key: keyof ParticleConfig, value: number | boolean | string) => void;
  /** Apply a preset / starter by ID only. Returns success. */
  applyPresetById: (id: string) => boolean;
  /** Snapshot for getState replies. */
  getState: () => { presetId: string | null; isPlaying: boolean };
}

export interface EmbedStateMessage {
  ns: typeof EMBED_CONTROL_NS;
  v: typeof EMBED_CONTROL_VERSION;
  type: 'state';
  presetId: string | null;
  isPlaying: boolean;
  catalogVersion: number;
  userParameters: { name: string; value: number | boolean | string }[];
}

export function buildEmbedStateMessage(
  config: ParticleConfig,
  state: { presetId: string | null; isPlaying: boolean },
): EmbedStateMessage {
  return {
    ns: EMBED_CONTROL_NS,
    v: EMBED_CONTROL_VERSION,
    type: 'state',
    presetId: state.presetId,
    isPlaying: state.isPlaying,
    catalogVersion: AI_CONTROL_CATALOG_VERSION,
    userParameters: getUserParameters().map((declaration) => ({
      name: declaration.label,
      value: config[declaration.key] as number | boolean | string,
    })),
  };
}

export type EmbedControlOutcome =
  | { handled: true; reply?: EmbedStateMessage }
  | { handled: false; reason: string };

/**
 * Handle one message payload against the handlers. Pure with
 * respect to the DOM (the caller owns the listener and the reply
 * transport), so the whole protocol is unit-testable.
 */
export function handleEmbedControlMessage(data: unknown, handlers: EmbedControlHandlers): EmbedControlOutcome {
  const command = parseEmbedControlMessage(data);
  if (!command) return { handled: false, reason: 'not-a-protocol-message' };
  switch (command.type) {
    case 'setParam': {
      const { applied, rejected } = validateAiPatch({ [command.key]: command.value }, handlers.config);
      if (applied.length === 0) return { handled: false, reason: `setParam rejected: ${rejected.join('; ') || 'no change'}` };
      for (const change of applied) handlers.applyValue(change.key, change.to);
      return { handled: true };
    }
    case 'applyPreset': {
      return handlers.applyPresetById(command.id)
        ? { handled: true }
        : { handled: false, reason: 'applyPreset: unknown id' };
    }
    case 'setUserParam': {
      const declaration = findUserParameterByName(getUserParameters(), command.name);
      if (!declaration) return { handled: false, reason: 'setUserParam: undeclared name' };
      const target = resolveUserParameterTarget(declaration.key as string);
      if (!target) return { handled: false, reason: 'setUserParam: undeclared name' };
      const validated = validateUserParameterValue(target, command.value);
      if (validated === null) return { handled: false, reason: 'setUserParam: invalid value' };
      handlers.applyValue(declaration.key, validated);
      return { handled: true };
    }
    case 'getState': {
      return { handled: true, reply: buildEmbedStateMessage(handlers.config, handlers.getState()) };
    }
  }
}
