import React from 'react';
import type { ParticleConfig } from '../types';
import { SceneGroup, ParticleSystem } from './scenePrimitives';
import { GpgpuSystem } from './sceneGpgpuSystem';
import { getSceneGeneration, noteSceneComposition } from '../lib/sceneGeneration';
import { MetaballSystem, getTexSizeForCount } from './sceneMetaballSystem';
import { GpgpuSmoothTube } from './sceneGpgpuSmoothTube';
import { MembraneSystem } from './sceneMembraneSystem';
import { SurfaceShellSystem } from './sceneSurfaceShellSystem';
import { SdfSurfaceShellSystem } from './sceneSdfSurfaceShellSystem';
import { SurfacePatchSystem } from './sceneSurfacePatchSystem';
import { HybridSurfacePatchSystem } from './sceneHybridSurfacePatchSystem';
import { BrushSurfaceSystem } from './sceneBrushSurfaceSystem';
import { FiberFieldSystem } from './sceneFiberFieldSystem';
import { HybridFiberFieldSystem } from './sceneHybridFiberFieldSystem';
import { HybridGranularFieldSystem } from './sceneHybridGranularFieldSystem';
import { HybridMembraneSystem } from './sceneHybridMembraneSystem';
import { GrowthFieldSystem } from './sceneGrowthFieldSystem';
import { DepositionFieldSystem } from './sceneDepositionFieldSystem';
import { CrystalAggregateSystem } from './sceneCrystalAggregateSystem';
import { ErosionTrailSystem } from './sceneErosionTrailSystem';
import { VoxelLatticeSystem } from './sceneVoxelLatticeSystem';
import { CrystalDepositionSystem } from './sceneCrystalDepositionSystem';
import { ReactionDiffusionSystem } from './sceneReactionDiffusionSystem';
import { PhysarumSystem } from './scenePhysarumSystem';
import { DlaSystem } from './sceneDlaSystem';
import { LSystem } from './sceneLSystem';
import { RaymarchSystem } from './sceneRaymarchSystem';
import { VolumeFogSystem } from './sceneVolumeFogSystem';
import { VolumetricFieldSystem } from './sceneVolumetricFieldSystem';
import { GlyphOutlineSystem } from './sceneGlyphOutlineSystem';
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
          texSize={getTexSizeForCount(config.gpgpuCount)}
          isPlaying={isPlaying}
        />
      )}
    </SceneGroup>
  );
};
