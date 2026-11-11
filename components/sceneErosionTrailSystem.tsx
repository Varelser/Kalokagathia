import React, { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import {
  buildErosionTrailLayout,
  getErosionTrailLayoutDeps,
  type ErosionTrailProps,
} from './sceneErosionTrailSystemShared';
import { ErosionTrailRender } from './sceneErosionTrailSystemRender';
import { useErosionTrailRuntime } from './sceneErosionTrailSystemRuntime';

export const ErosionTrailSystem: React.FC<ErosionTrailProps> = ({ config, layerIndex, audioRef, isPlaying }) => {
  const lineRef = useRef<THREE.LineSegments>(null);
  const geometryRef = useRef<THREE.BufferGeometry | null>(null);
  const materialRef = useRef<THREE.ShaderMaterial>(null);
  // eslint-disable-next-line react-hooks/use-memo, react-hooks/exhaustive-deps -- deps come from a get*Deps() helper listing the exact config fields this layout reads; a literal [config] dep would rebuild the geometry on every config change.
  const layout = useMemo(() => buildErosionTrailLayout(config, layerIndex), getErosionTrailLayoutDeps(config, layerIndex));

  useEffect(() => {
    geometryRef.current?.dispose();
    geometryRef.current = null;
  }, [layout?.trailCount, layout?.segmentsPerTrail]);

  useEffect(() => () => {
    geometryRef.current?.dispose();
    geometryRef.current = null;
  }, []);

  useErosionTrailRuntime({
    config,
    layerIndex,
    audioRef,
    isPlaying,
    lineRef,
    geometryRef,
    materialRef,
    layout,
  });

  if (!layout) return null;

  return <ErosionTrailRender lineRef={lineRef} materialRef={materialRef} />;
};
