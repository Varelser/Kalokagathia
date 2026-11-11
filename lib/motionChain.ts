import type { Layer2Type, ParticleConfig } from '../types';
import { MOTION_MAP } from '../components/sceneMotionMap';
import { getMotionArchitecture } from './motionArchitecture';

/**
 * Serial motion chains (free-wiring stage 1).
 *
 * A layer's motion evaluation becomes a short pipeline: stage 1 is the
 * layer's own motion (layerNType, or the per-emitter layerNMotions entry
 * when Motion Mix is on); stages 2 and 3 come from layerNMotionChain and
 * are applied to the previous stage's output position. Both evaluation
 * paths (the GLSL applyMotion chain in the vertex shader and the CPU
 * estimateLayerPositionApprox) resolve the chain through here so the
 * rules live in exactly one place:
 *
 * - the chain is empty unless layerNMotionChainEnabled is set;
 * - entries must be known motion types (unknown values are dropped,
 *   mirroring how particleData tolerates unknown motions);
 * - at most MOTION_CHAIN_MAX_EXTRA_STAGES extra stages are honoured.
 */
export const MOTION_CHAIN_MAX_EXTRA_STAGES = 2;

export function resolveMotionChainTypes(
  config: ParticleConfig,
  layerIndex: 2 | 3,
): Layer2Type[] {
  const enabled = layerIndex === 2 ? config.layer2MotionChainEnabled : config.layer3MotionChainEnabled;
  if (!enabled) return [];
  const chain = layerIndex === 2 ? config.layer2MotionChain : config.layer3MotionChain;
  if (!Array.isArray(chain)) return [];
  return chain
    .filter((entry): entry is Layer2Type => typeof entry === 'string' && entry in MOTION_MAP)
    .slice(0, MOTION_CHAIN_MAX_EXTRA_STAGES);
}

/** Numeric MOTION_MAP codes for stages 2 and 3; -1 marks an absent stage. */
export function resolveMotionChainCodes(
  config: ParticleConfig,
  layerIndex: 2 | 3,
): [number, number] {
  const types = resolveMotionChainTypes(config, layerIndex);
  return [types[0] !== undefined ? MOTION_MAP[types[0]] : -1, types[1] !== undefined ? MOTION_MAP[types[1]] : -1];
}

/**
 * Placement-class motions (orbit / structural drivers) recompute an
 * absolute placement instead of displacing their input, so as a later
 * chain stage they re-place the shape the earlier stages built. Allowed,
 * but the UI notes the semantics (design decision, 2026-11-10).
 */
export function isPlacementMotionType(type: Layer2Type): boolean {
  const driver = getMotionArchitecture(type).driver;
  return driver === 'orbit' || driver === 'structural';
}

/**
 * Motions routed to a dedicated runtime (deposition / growth incl.
 * reaction-diffusion / volumetric) do not pass through the shared
 * position evaluation, so chains are not offered when one of them is a
 * layer's stage 1 (v1 scope boundary).
 */
export function isDedicatedSystemMotionType(type: Layer2Type): boolean {
  const driver = getMotionArchitecture(type).driver;
  return driver === 'deposition' || driver === 'growth' || driver === 'volumetric';
}
