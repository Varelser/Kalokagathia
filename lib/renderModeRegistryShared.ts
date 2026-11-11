import type { ParticleConfig } from '../types/config';
import type { ProceduralSystemId } from './proceduralModeRegistry';
import {
  doesGpgpuRouteRenderCore,
  doesLayerUseProceduralSystem,
  getGpgpuRenderOutputPlan,
  getGpgpuRoute,
  getLayerRuntimeMode,
} from './sceneRenderRouting';

export type RenderModeCategory =
  | 'particles'
  | 'lines'
  | 'surfaces'
  | 'ribbons'
  | 'tubes'
  | 'metaballs'
  | 'volumetric'
  | 'instanced solids'
  | 'sdf shading'
  | 'post fx';

export type RenderModeSupport = 'stable' | 'experimental' | 'heavy';

export interface RenderModeDefinition {
  id: string;
  label: string;
  category: RenderModeCategory;
  support: RenderModeSupport;
  description: string;
  activeWhen: (config: ParticleConfig) => boolean;
}

export interface ActiveRenderModeInfo extends RenderModeDefinition {
  active: boolean;
}

export function layerUsesProceduralSystem(config: ParticleConfig, system: ProceduralSystemId) {
  return doesLayerUseProceduralSystem(config, system);
}

export function anyLayer(_config: ParticleConfig, predicate: (layerIndex: 2 | 3) => boolean) {
  return predicate(2) || predicate(3);
}

export function anyLayerMode(config: ParticleConfig, modes: ParticleConfig['layer2Type'][]) {
  return anyLayer(config, (layerIndex) => modes.includes(getLayerRuntimeMode(config, layerIndex)));
}

export function hasGpgpuCore(config: ParticleConfig) {
  return doesGpgpuRouteRenderCore(getGpgpuRoute(config));
}

export function getGpgpuPlan(config: ParticleConfig) {
  return getGpgpuRenderOutputPlan(config, getGpgpuRoute(config));
}

export const RENDER_CATEGORY_ORDER: RenderModeCategory[] = [
  'particles',
  'lines',
  'surfaces',
  'ribbons',
  'tubes',
  'instanced solids',
  'metaballs',
  'volumetric',
  'sdf shading',
  'post fx',
];
