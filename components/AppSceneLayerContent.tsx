import React from 'react';
import type { ParticleConfig } from '../types';
import { SceneGroup, ParticleSystem } from './scenePrimitives';
import { getSceneGeneration, noteSceneComposition } from '../lib/sceneGeneration';
// Perf (2026-11-14): the procedural / hybrid scene systems below are only
// ever mounted when the active layer plan selects them, so they load on
// demand instead of in the startup bundle. Layer 1 (ParticleSystem from
// scenePrimitives) stays eager — it is the first thing on screen. While a
// system chunk loads, its layer simply renders nothing for a few frames
// (Suspense fallback below), mirroring the lazy starter library pattern.
function lazySystem<K extends string, C extends React.ComponentType<any>>(
  load: () => Promise<Record<K, C>>,
  name: K,
): React.LazyExoticComponent<C> {
  return React.lazy(() => load().then((m) => ({ default: m[name] })));
}

const GpgpuSystem = lazySystem(() => import('./sceneGpgpuSystem'), 'GpgpuSystem');
const GpgpuSmoothTube = lazySystem(() => import('./sceneGpgpuSmoothTube'), 'GpgpuSmoothTube');
const MembraneSystem = lazySystem(() => import('./sceneMembraneSystem'), 'MembraneSystem');
const SurfaceShellSystem = lazySystem(() => import('./sceneSurfaceShellSystem'), 'SurfaceShellSystem');
const SdfSurfaceShellSystem = lazySystem(() => import('./sceneSdfSurfaceShellSystem'), 'SdfSurfaceShellSystem');
const SurfacePatchSystem = lazySystem(() => import('./sceneSurfacePatchSystem'), 'SurfacePatchSystem');
const HybridSurfacePatchSystem = lazySystem(() => import('./sceneHybridSurfacePatchSystem'), 'HybridSurfacePatchSystem');
const BrushSurfaceSystem = lazySystem(() => import('./sceneBrushSurfaceSystem'), 'BrushSurfaceSystem');
const FiberFieldSystem = lazySystem(() => import('./sceneFiberFieldSystem'), 'FiberFieldSystem');
const HybridFiberFieldSystem = lazySystem(() => import('./sceneHybridFiberFieldSystem'), 'HybridFiberFieldSystem');
const HybridGranularFieldSystem = lazySystem(() => import('./sceneHybridGranularFieldSystem'), 'HybridGranularFieldSystem');
const HybridMembraneSystem = lazySystem(() => import('./sceneHybridMembraneSystem'), 'HybridMembraneSystem');
const GrowthFieldSystem = lazySystem(() => import('./sceneGrowthFieldSystem'), 'GrowthFieldSystem');
const DepositionFieldSystem = lazySystem(() => import('./sceneDepositionFieldSystem'), 'DepositionFieldSystem');
const CrystalAggregateSystem = lazySystem(() => import('./sceneCrystalAggregateSystem'), 'CrystalAggregateSystem');
const ErosionTrailSystem = lazySystem(() => import('./sceneErosionTrailSystem'), 'ErosionTrailSystem');
const VoxelLatticeSystem = lazySystem(() => import('./sceneVoxelLatticeSystem'), 'VoxelLatticeSystem');
const CrystalDepositionSystem = lazySystem(() => import('./sceneCrystalDepositionSystem'), 'CrystalDepositionSystem');
const ReactionDiffusionSystem = lazySystem(() => import('./sceneReactionDiffusionSystem'), 'ReactionDiffusionSystem');
const PhysarumSystem = lazySystem(() => import('./scenePhysarumSystem'), 'PhysarumSystem');
const DlaSystem = lazySystem(() => import('./sceneDlaSystem'), 'DlaSystem');
const LSystem = lazySystem(() => import('./sceneLSystem'), 'LSystem');
const RaymarchSystem = lazySystem(() => import('./sceneRaymarchSystem'), 'RaymarchSystem');
const VolumeFogSystem = lazySystem(() => import('./sceneVolumeFogSystem'), 'VolumeFogSystem');
const VolumetricFieldSystem = lazySystem(() => import('./sceneVolumetricFieldSystem'), 'VolumetricFieldSystem');
const GlyphOutlineSystem = lazySystem(() => import('./sceneGlyphOutlineSystem'), 'GlyphOutlineSystem');
// MetaballSystem also needs texSize derived from the config; the wrapper
// computes it inside the lazy module so getTexSizeForCount (and its WebGL
// cap probe) stays out of the startup bundle too.
const MetaballSystem = React.lazy(() =>
  import('./sceneMetaballSystem').then((m) => ({
    default: (props: Omit<React.ComponentProps<typeof m.MetaballSystem>, 'texSize'>) => (
      <m.MetaballSystem {...props} texSize={m.getTexSizeForCount(props.config.gpgpuCount)} />
    ),
  })),
);
import {
  getGpgpuRenderOutputPlan,
  getLayerSceneRenderPlan,
} from '../lib/sceneRenderRouting';
import type { SceneAudioRef } from './AppSceneTypes';
import type { PointCloudCaptureState } from '../lib/pointCloudExport';

type LayerContentProps = {
  audioRef: SceneAudioRef;
  config: ParticleConfig;
  interLayerContactAmount: number;
  isPlaying: boolean;
  metaballPosRef: React.MutableRefObject<Float32Array | null>;
  pointCloudCaptureRef?: React.RefObject<PointCloudCaptureState>;
};

export const AppSceneLayerContent: React.FC<LayerContentProps> = ({
  audioRef,
  config,
  interLayerContactAmount,
  isPlaying,
  metaballPosRef,
  pointCloudCaptureRef,
}) => {
  const layer2Plan = getLayerSceneRenderPlan(config, 2);
  const layer3Plan = getLayerSceneRenderPlan(config, 3);
  const gpgpuPlan = getGpgpuRenderOutputPlan(config);

  React.useEffect(() => {
    noteSceneComposition(getSceneGeneration(), gpgpuPlan.core);
  }, [gpgpuPlan.core]);

  return (
    <SceneGroup config={config} isPlaying={isPlaying}>
      <React.Suspense fallback={null}>
      {config.layer1Enabled && (
        <ParticleSystem config={config} layerIndex={1} audioRef={audioRef} isPlaying={isPlaying} contactAmount={interLayerContactAmount} />
      )}
      {layer2Plan.particleCore && (
        <ParticleSystem config={config} layerIndex={2} audioRef={audioRef} isPlaying={isPlaying} contactAmount={interLayerContactAmount} />
      )}
      {layer2Plan.proceduralSystemId === 'membrane' && (
        <MembraneSystem config={config} layerIndex={2} audioRef={audioRef} isPlaying={isPlaying} />
      )}
      {layer2Plan.hybridSystemId === 'membrane' && (
        <HybridMembraneSystem config={config} layerIndex={2} audioRef={audioRef} isPlaying={isPlaying} />
      )}
      {layer2Plan.proceduralSystemId === 'surface-shell' && (
        <SurfaceShellSystem config={config} layerIndex={2} audioRef={audioRef} isPlaying={isPlaying} />
      )}
      {layer2Plan.hybridSystemId === 'surface-shell' && (
        <SdfSurfaceShellSystem config={config} layerIndex={2} audioRef={audioRef} isPlaying={isPlaying} />
      )}
      {layer2Plan.proceduralSystemId === 'surface-patch' && (
        <SurfacePatchSystem config={config} layerIndex={2} audioRef={audioRef} isPlaying={isPlaying} />
      )}
      {layer2Plan.hybridSystemId === 'surface-patch' && (
        <HybridSurfacePatchSystem config={config} layerIndex={2} audioRef={audioRef} isPlaying={isPlaying} />
      )}
      {layer2Plan.proceduralSystemId === 'brush-surface' && (
        <BrushSurfaceSystem config={config} layerIndex={2} audioRef={audioRef} isPlaying={isPlaying} />
      )}
      {layer2Plan.proceduralSystemId === 'fiber-field' && (
        <FiberFieldSystem config={config} layerIndex={2} audioRef={audioRef} isPlaying={isPlaying} />
      )}
      {layer2Plan.hybridSystemId === 'fiber-field' && (
        <HybridFiberFieldSystem config={config} layerIndex={2} audioRef={audioRef} isPlaying={isPlaying} />
      )}
      {layer2Plan.proceduralSystemId === 'growth-field' && (
        <GrowthFieldSystem config={config} layerIndex={2} audioRef={audioRef} isPlaying={isPlaying} />
      )}
      {layer2Plan.proceduralSystemId === 'deposition-field' && (
        <DepositionFieldSystem config={config} layerIndex={2} audioRef={audioRef} isPlaying={isPlaying} />
      )}
      {layer2Plan.proceduralSystemId === 'crystal-aggregate' && (
        <CrystalAggregateSystem config={config} layerIndex={2} audioRef={audioRef} isPlaying={isPlaying} />
      )}
      {layer2Plan.hybridSystemId === 'crystal-aggregate' && (
        <HybridGranularFieldSystem config={config} layerIndex={2} audioRef={audioRef} isPlaying={isPlaying} />
      )}
      {layer2Plan.proceduralSystemId === 'erosion-trail' && (
        <ErosionTrailSystem config={config} layerIndex={2} audioRef={audioRef} isPlaying={isPlaying} />
      )}
      {layer2Plan.proceduralSystemId === 'voxel-lattice' && (
        <VoxelLatticeSystem config={config} layerIndex={2} audioRef={audioRef} isPlaying={isPlaying} />
      )}
      {layer2Plan.proceduralSystemId === 'crystal-deposition' && (
        <CrystalDepositionSystem config={config} layerIndex={2} audioRef={audioRef} isPlaying={isPlaying} />
      )}
      {layer2Plan.proceduralSystemId === 'reaction-diffusion' && (
        <ReactionDiffusionSystem config={config} layerIndex={2} audioRef={audioRef} isPlaying={isPlaying} />
      )}
      {layer2Plan.proceduralSystemId === 'physarum' && (
        <PhysarumSystem config={config} layerIndex={2} audioRef={audioRef} isPlaying={isPlaying} />
      )}
      {layer2Plan.proceduralSystemId === 'dla' && (
        <DlaSystem config={config} layerIndex={2} audioRef={audioRef} isPlaying={isPlaying} />
      )}
      {layer2Plan.proceduralSystemId === 'l-system' && (
        <LSystem config={config} layerIndex={2} audioRef={audioRef} isPlaying={isPlaying} />
      )}
      {layer2Plan.proceduralSystemId === 'raymarch' && (
        <RaymarchSystem config={config} layerIndex={2} audioRef={audioRef} isPlaying={isPlaying} />
      )}
      {layer2Plan.proceduralSystemId === 'volume-fog' && (
        <VolumeFogSystem config={config} layerIndex={2} audioRef={audioRef} isPlaying={isPlaying} />
      )}
      {layer2Plan.hybridSystemId === 'volume-fog' && (
        <VolumetricFieldSystem config={config} layerIndex={2} audioRef={audioRef} isPlaying={isPlaying} />
      )}
      {layer2Plan.glyphOutline && (
        <GlyphOutlineSystem config={config} layerIndex={2} audioRef={audioRef} />
      )}
      {layer2Plan.auxParticles && (
        <ParticleSystem config={config} layerIndex={2} isAux={true} audioRef={audioRef} isPlaying={isPlaying} contactAmount={interLayerContactAmount} />
      )}
      {layer2Plan.sparkParticles && (
        <ParticleSystem config={config} layerIndex={2} isAux={true} auxMode="spark" audioRef={audioRef} isPlaying={isPlaying} contactAmount={interLayerContactAmount} />
      )}
      {layer3Plan.particleCore && (
        <ParticleSystem config={config} layerIndex={3} audioRef={audioRef} isPlaying={isPlaying} contactAmount={interLayerContactAmount} />
      )}
      {layer3Plan.proceduralSystemId === 'membrane' && (
        <MembraneSystem config={config} layerIndex={3} audioRef={audioRef} isPlaying={isPlaying} />
      )}
      {layer3Plan.hybridSystemId === 'membrane' && (
        <HybridMembraneSystem config={config} layerIndex={3} audioRef={audioRef} isPlaying={isPlaying} />
      )}
      {layer3Plan.proceduralSystemId === 'surface-shell' && (
        <SurfaceShellSystem config={config} layerIndex={3} audioRef={audioRef} isPlaying={isPlaying} />
      )}
      {layer3Plan.hybridSystemId === 'surface-shell' && (
        <SdfSurfaceShellSystem config={config} layerIndex={3} audioRef={audioRef} isPlaying={isPlaying} />
      )}
      {layer3Plan.proceduralSystemId === 'surface-patch' && (
        <SurfacePatchSystem config={config} layerIndex={3} audioRef={audioRef} isPlaying={isPlaying} />
      )}
      {layer3Plan.hybridSystemId === 'surface-patch' && (
        <HybridSurfacePatchSystem config={config} layerIndex={3} audioRef={audioRef} isPlaying={isPlaying} />
      )}
      {layer3Plan.proceduralSystemId === 'brush-surface' && (
        <BrushSurfaceSystem config={config} layerIndex={3} audioRef={audioRef} isPlaying={isPlaying} />
      )}
      {layer3Plan.proceduralSystemId === 'fiber-field' && (
        <FiberFieldSystem config={config} layerIndex={3} audioRef={audioRef} isPlaying={isPlaying} />
      )}
      {layer3Plan.hybridSystemId === 'fiber-field' && (
        <HybridFiberFieldSystem config={config} layerIndex={3} audioRef={audioRef} isPlaying={isPlaying} />
      )}
      {layer3Plan.proceduralSystemId === 'growth-field' && (
        <GrowthFieldSystem config={config} layerIndex={3} audioRef={audioRef} isPlaying={isPlaying} />
      )}
      {layer3Plan.proceduralSystemId === 'deposition-field' && (
        <DepositionFieldSystem config={config} layerIndex={3} audioRef={audioRef} isPlaying={isPlaying} />
      )}
      {layer3Plan.proceduralSystemId === 'crystal-aggregate' && (
        <CrystalAggregateSystem config={config} layerIndex={3} audioRef={audioRef} isPlaying={isPlaying} />
      )}
      {layer3Plan.hybridSystemId === 'crystal-aggregate' && (
        <HybridGranularFieldSystem config={config} layerIndex={3} audioRef={audioRef} isPlaying={isPlaying} />
      )}
      {layer3Plan.proceduralSystemId === 'erosion-trail' && (
        <ErosionTrailSystem config={config} layerIndex={3} audioRef={audioRef} isPlaying={isPlaying} />
      )}
      {layer3Plan.proceduralSystemId === 'voxel-lattice' && (
        <VoxelLatticeSystem config={config} layerIndex={3} audioRef={audioRef} isPlaying={isPlaying} />
      )}
      {layer3Plan.proceduralSystemId === 'crystal-deposition' && (
        <CrystalDepositionSystem config={config} layerIndex={3} audioRef={audioRef} isPlaying={isPlaying} />
      )}
      {layer3Plan.proceduralSystemId === 'reaction-diffusion' && (
        <ReactionDiffusionSystem config={config} layerIndex={3} audioRef={audioRef} isPlaying={isPlaying} />
      )}
      {layer3Plan.proceduralSystemId === 'physarum' && (
        <PhysarumSystem config={config} layerIndex={3} audioRef={audioRef} isPlaying={isPlaying} />
      )}
      {layer3Plan.proceduralSystemId === 'dla' && (
        <DlaSystem config={config} layerIndex={3} audioRef={audioRef} isPlaying={isPlaying} />
      )}
      {layer3Plan.proceduralSystemId === 'l-system' && (
        <LSystem config={config} layerIndex={3} audioRef={audioRef} isPlaying={isPlaying} />
      )}
      {layer3Plan.proceduralSystemId === 'raymarch' && (
        <RaymarchSystem config={config} layerIndex={3} audioRef={audioRef} isPlaying={isPlaying} />
      )}
      {layer3Plan.proceduralSystemId === 'volume-fog' && (
        <VolumeFogSystem config={config} layerIndex={3} audioRef={audioRef} isPlaying={isPlaying} />
      )}
      {layer3Plan.hybridSystemId === 'volume-fog' && (
        <VolumetricFieldSystem config={config} layerIndex={3} audioRef={audioRef} isPlaying={isPlaying} />
      )}
      {layer3Plan.glyphOutline && (
        <GlyphOutlineSystem config={config} layerIndex={3} audioRef={audioRef} />
      )}
      {layer3Plan.auxParticles && (
        <ParticleSystem config={config} layerIndex={3} isAux={true} audioRef={audioRef} isPlaying={isPlaying} contactAmount={interLayerContactAmount} />
      )}
      {layer3Plan.sparkParticles && (
        <ParticleSystem config={config} layerIndex={3} isAux={true} auxMode="spark" audioRef={audioRef} isPlaying={isPlaying} contactAmount={interLayerContactAmount} />
      )}
      {config.ambientEnabled && (
        <ParticleSystem config={config} layerIndex={4} audioRef={audioRef} isPlaying={isPlaying} contactAmount={interLayerContactAmount} />
      )}
      {gpgpuPlan.core && (
        <GpgpuSystem config={config} audioRef={audioRef} isPlaying={isPlaying} posReadbackRef={metaballPosRef} pointCloudCaptureRef={pointCloudCaptureRef} />
      )}
      {gpgpuPlan.smoothTubes && (
        <GpgpuSmoothTube config={config} posReadbackRef={metaballPosRef} isPlaying={isPlaying} />
      )}
      {gpgpuPlan.metaballs && (
        <MetaballSystem
          config={config}
          posReadbackRef={metaballPosRef}
          isPlaying={isPlaying}
        />
      )}
      </React.Suspense>
    </SceneGroup>
  );
};
