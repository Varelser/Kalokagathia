import type { Layer2Type, ParticleConfig } from '../types';
import { MOTION_MAP } from '../components/sceneMotionMap';
import { isDedicatedSystemMotionType, resolveMotionChainCodes } from './motionChain';

/**
 * Cross-layer routing (free-wiring stage 2).
 *
 * Method A (motion routing): before its own motion stack runs, a layer runs
 * the OTHER layer's full motion stack — its stage 1 plus its serial chain —
 * with the source layer's parameters. Only function + parameters cross the
 * layer boundary, never computed positions, so mutual routing (L2->L3 and
 * L3->L2 at once) has no data cycle. The source layer's stage 1 is its
 * layerNType; when the source uses Motion Mix, its per-emitter codes are
 * baked into its own particle data and cannot transfer, so the primary
 * type is what routes (the UI notes this).
 *
 * Method B (source routing): a layer's particles are generated from the
 * other layer's source shape. Resolution here returns just the source
 * layer index; particleData applies the substitution.
 *
 * Both resolvers are defensive: routing applies only when it is enabled,
 * names the other existing layer (2 or 3 — Layer 1 has no motion stack),
 * and, for method A, the source layer's stage 1 is a generic motion (a
 * dedicated-system stage 1 has no shared stack to borrow).
 */
export type RouteLayerIndex = 2 | 3;

function resolveRouteSource(
  enabled: boolean,
  from: 'layer2' | 'layer3' | null,
  layerIndex: RouteLayerIndex,
): RouteLayerIndex | null {
  if (!enabled) return null;
  if (from !== 'layer2' && from !== 'layer3') return null;
  const source = from === 'layer2' ? 2 : 3;
  return source === layerIndex ? null : (source as RouteLayerIndex);
}

export interface MotionRouteResolution {
  sourceLayer: RouteLayerIndex;
  sourceType: Layer2Type;
  /** [stage1, chainStage2, chainStage3] MOTION_MAP codes; chain entries -1 when absent. */
  codes: [number, number, number];
}

export function resolveMotionRoute(
  config: ParticleConfig,
  layerIndex: RouteLayerIndex,
): MotionRouteResolution | null {
  const enabled = layerIndex === 2 ? config.layer2MotionRouteEnabled : config.layer3MotionRouteEnabled;
  const from = layerIndex === 2 ? config.layer2MotionRouteFrom : config.layer3MotionRouteFrom;
  const sourceLayer = resolveRouteSource(enabled, from, layerIndex);
  if (sourceLayer === null) return null;
  const sourceType = sourceLayer === 2 ? config.layer2Type : config.layer3Type;
  if (typeof sourceType !== 'string' || !(sourceType in MOTION_MAP)) return null;
  if (isDedicatedSystemMotionType(sourceType)) return null;
  const [chain2, chain3] = resolveMotionChainCodes(config, sourceLayer);
  return { sourceLayer, sourceType, codes: [MOTION_MAP[sourceType], chain2, chain3] };
}

export function resolveSourceRoute(
  config: ParticleConfig,
  layerIndex: RouteLayerIndex,
): RouteLayerIndex | null {
  const enabled = layerIndex === 2 ? config.layer2SourceRouteEnabled : config.layer3SourceRouteEnabled;
  const from = layerIndex === 2 ? config.layer2SourceRouteFrom : config.layer3SourceRouteFrom;
  return resolveRouteSource(enabled, from, layerIndex);
}
