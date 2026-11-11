import React, { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import {
  buildGrowthLayout,
  getLayoutDeps,
  type GrowthFieldProps,
} from './sceneGrowthFieldSystemShared';
import { GrowthFieldRender } from './sceneGrowthFieldSystemRender';
import { useGrowthFieldRuntime } from './sceneGrowthFieldSystemRuntime';

export const GrowthFieldSystem: React.FC<GrowthFieldProps> = ({ config, layerIndex, audioRef, isPlaying }) => {
  const lineRef = useRef<THREE.LineSegments>(null);
  const geometryRef = useRef<THREE.BufferGeometry | null>(null);
  const materialRef = useRef<THREE.ShaderMaterial>(null);
  // eslint-disable-next-line react-hooks/use-memo, react-hooks/exhaustive-deps -- deps come from a get*Deps() helper listing the exact config fields this layout reads; a literal [config] dep would rebuild the geometry on every config change.
  const layout = useMemo(() => buildGrowthLayout(config, layerIndex), getLayoutDeps(config, layerIndex));

  useEffect(() => {
    geometryRef.current?.dispose();
    geometryRef.current = null;
  }, [layout?.maxStrandCount]);

  useEffect(() => () => {
    geometryRef.current?.dispose();
    geometryRef.current = null;
  }, []);

  useGrowthFieldRuntime({
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

  return <GrowthFieldRender lineRef={lineRef} materialRef={materialRef} />;
};
