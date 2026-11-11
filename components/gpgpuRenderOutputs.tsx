import React from 'react';
import type { FC } from 'react';
import type { ParticleConfig } from '../types';
import { getGpgpuRenderOutputPlan } from '../lib/sceneRenderRouting';
import { MAX_TRAIL } from './gpgpuShaderConstants';
import type { GpgpuAssetBundle } from './useGpgpuAssets';

// syncVisualUniforms assigns uAlpha = 0 to every trail segment at or past
// the configured trail length (tubes/ribbons: i >= trailLength - 1, trail
// points: i >= trailLength). Those draws cost full vertex processing and
// rasterisation for a zero contribution (tube/ribbon fragments discard on
// vAlpha, trail points blend with alpha 0), so render only the segments
// that can be visible. Pixel-identical output.
function visibleTrailPoints(config: ParticleConfig): number {
  return Math.min(MAX_TRAIL, Math.max(2, config.gpgpuTrailLength));
}
function visibleTrailSegments(config: ParticleConfig): number {
  return Math.min(MAX_TRAIL - 1, Math.max(2, config.gpgpuTrailLength)) - 1;
}

type GpgpuRenderOutputsProps = {
  config: ParticleConfig;
  assets: GpgpuAssetBundle;
};

export const GpgpuRenderOutputs: FC<GpgpuRenderOutputsProps> = React.memo(({ config, assets }) => {
  const {
    drawGeo,
    drawMat,
    geomMeshObj,
    trailMats,
    ribbonGeo,
    ribbonMats,
    tubeGeo,
    tubeMats,
    streakGeo,
    streakMat,
    volumetricMeshObj,
  } = assets;
  const plan = getGpgpuRenderOutputPlan(config);

  return (
    <>
      {plan.pointSprites && (
        <points geometry={drawGeo} material={drawMat} />
      )}
      {plan.instancedSolids && geomMeshObj && (
        <primitive object={geomMeshObj} />
      )}
      {plan.trailPoints && trailMats.slice(0, visibleTrailPoints(config)).map((mat, i) => (
        <points key={i} geometry={drawGeo} material={mat} />
      ))}
      {plan.ribbons && ribbonMats.slice(0, visibleTrailSegments(config)).map((mat, i) => (
        <mesh key={i} geometry={ribbonGeo} material={mat} />
      ))}
      {plan.tubes && tubeMats.slice(0, visibleTrailSegments(config)).map((mat, i) => (
        <mesh key={i} geometry={tubeGeo} material={mat} />
      ))}
      {plan.streakLines && (
        <lineSegments geometry={streakGeo} material={streakMat} />
      )}
      {plan.volumetric && volumetricMeshObj && (
        <primitive object={volumetricMeshObj} />
      )}
    </>
  );
});

GpgpuRenderOutputs.displayName = 'GpgpuRenderOutputs';
