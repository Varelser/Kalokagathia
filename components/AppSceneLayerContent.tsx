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
const LightVolume = lazySystem(() => import('./LightVolume'), 'LightVolume');
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
  gpgpuSceneNeedsTubeLights,
} from '../lib/sceneRenderRouting';
import { ParallaxGroup } from './sceneParallaxGroup';
import { resolveParallaxFactors } from '../lib/parallax';
import type { SceneAudioRef } from './AppSceneTypes';
import type { PointCloudCaptureState } from '../lib/pointCloudExport';
import type { PyroGridFogFeed } from '../lib/pyroGrid';

type LayerContentProps = {
  audioRef: SceneAudioRef;
  config: ParticleConfig;
  interLayerContactAmount: number;
  isPlaying: boolean;
  metaballPosRef: React.MutableRefObject<Float32Array | null>;
  pointCloudCaptureRef?: React.RefObject<PointCloudCaptureState>;
  pyroFeedRef?: React.MutableRefObject<PyroGridFogFeed>;
};

export const AppSceneLayerContent: React.FC<LayerContentProps> = ({
  audioRef,
  config,
  interLayerContactAmount,
  isPlaying,
  metaballPosRef,
  pointCloudCaptureRef,
  pyroFeedRef,
}) => {
  const layer2Plan = getLayerSceneRenderPlan(config, 2);
  const layer3Plan = getLayerSceneRenderPlan(config, 3);
  const gpgpuPlan = getGpgpuRenderOutputPlan(config);
  // Parallax (Phase AZ): the five families below are wrapped in
  // ParallaxGroups. Every factor defaults to 0, where the wrapper
  // sits at the identity and the render is the legacy one exactly.
  const parallaxFactors = resolveParallaxFactors(config);

  React.useEffect(() => {
    noteSceneComposition(getSceneGeneration(), gpgpuPlan.core);
  }, [gpgpuPlan.core]);

  return (
    <SceneGroup config={config} isPlaying={isPlaying}>
      <React.Suspense fallback={null}>
      <ParallaxGroup config={config} factor={parallaxFactors.layer1}>
      {config.layer1Enabled && (
        <ParticleSystem config={config} layerIndex={1} audioRef={audioRef} isPlaying={isPlaying} contactAmount={interLayerContactAmount} />
      )}
      </ParallaxGroup>
      <ParallaxGroup config={config} factor={parallaxFactors.layer2}>
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
        <VolumeFogSystem config={config} layerIndex={2} audioRef={audioRef} isPlaying={isPlaying} pyroFeedRef={pyroFeedRef} />
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
      </ParallaxGroup>
      <ParallaxGroup config={config} factor={parallaxFactors.layer3}>
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
        <VolumeFogSystem config={config} layerIndex={3} audioRef={audioRef} isPlaying={isPlaying} pyroFeedRef={pyroFeedRef} />
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
      </ParallaxGroup>
      <ParallaxGroup config={config} factor={parallaxFactors.ambient}>
      {config.ambientEnabled && (
        <ParticleSystem config={config} layerIndex={4} audioRef={audioRef} isPlaying={isPlaying} contactAmount={interLayerContactAmount} />
      )}
      </ParallaxGroup>
      <ParallaxGroup config={config} factor={parallaxFactors.gpgpu}>
      {/* Lit-material fallback lights (Phase BR): the Smooth
          Tube / Metaball MeshStandardMaterials shade black in
          a scene with no lights, and only TerrainMesh /
          ObjMesh bring lights. When neither is mounted, supply
          TerrainMesh's light set so the tubes / metaballs read;
          configs with terrain / obj keep exactly their own
          lighting (helper in lib/sceneRenderRoutingPlans.ts). */}
      {gpgpuSceneNeedsTubeLights(config, gpgpuPlan) && (
        <>
          <ambientLight intensity={0.65} />
          <directionalLight position={[90, 160, 70]} intensity={1.7} />
          <directionalLight position={[-110, 40, -90]} intensity={0.35} />
        </>
      )}
      {gpgpuPlan.core && (
        <GpgpuSystem config={config} audioRef={audioRef} isPlaying={isPlaying} posReadbackRef={metaballPosRef} pointCloudCaptureRef={pointCloudCaptureRef} pyroFeedRef={pyroFeedRef} />
      )}
      {gpgpuPlan.smoothTubes && (
        <GpgpuSmoothTube config={config} posReadbackRef={metaballPosRef} isPlaying={isPlaying} />
      )}
      {(config.gpgpuLightVolumeEnabled || config.gpgpuLightTrailEnabled) && (
        <LightVolume config={config} />
      )}
      {gpgpuPlan.metaballs && (
        <MetaballSystem
          config={config}
          posReadbackRef={metaballPosRef}
          isPlaying={isPlaying}
        />
      )}
      </ParallaxGroup>
      </React.Suspense>
    </SceneGroup>
  );
};
