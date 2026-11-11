import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useMemo, useRef, useState } from 'react';
import type { LineSystemProps } from './sceneLineSystemShared';
import { buildLineData } from './sceneLineSystemBuilder';
import { getLineRefreshInterval, getResolvedLineProfile } from './sceneLineSystemProfile';
import { updateLineMaterial } from './sceneLineSystemMaterial';
import { getLayerRuntimeConnectionStyle } from '../lib/sceneRenderRouting';

export function useLineSystemRuntime(props: LineSystemProps, lineRef: React.RefObject<THREE.LineSegments | null>, brushRef: React.RefObject<THREE.Mesh | null>) {
  const { config, layerIndex, particleData, uniforms, globalRadius, connectionDistance, connectionOpacity, contactAmount, isPlaying } = props;
  const layerConnectionStyle = getLayerRuntimeConnectionStyle(config, layerIndex);
  const lineProfile = useMemo(() => getResolvedLineProfile(config, layerIndex), [config, layerIndex]);
  const refreshAccumulatorRef = useRef(0);
  const sampleTimeRef = useRef(0);
  const [lineRefreshTick, setLineRefreshTick] = useState(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- lineRefreshTick is a deliberate force-rebuild dep: useFrame bumps it to rebuild line data from live particle positions.
  const lineData = useMemo(() => buildLineData(config, layerIndex, particleData, globalRadius, connectionDistance, sampleTimeRef.current), [config, layerIndex, particleData, globalRadius, connectionDistance, lineRefreshTick]);
  useFrame((_state, delta) => {
    if (isPlaying) {
      refreshAccumulatorRef.current += delta;
      if (refreshAccumulatorRef.current >= getLineRefreshInterval(config.renderQuality, particleData.count)) {
        refreshAccumulatorRef.current = 0;
        sampleTimeRef.current = uniforms.uTime.value;
        setLineRefreshTick((value) => value + 1);
      }
    }
    updateLineMaterial(lineRef.current?.material as THREE.ShaderMaterial | undefined, config, layerIndex, uniforms, connectionDistance, connectionOpacity, contactAmount, lineProfile);
    updateLineMaterial(brushRef.current?.material as THREE.ShaderMaterial | undefined, config, layerIndex, uniforms, connectionDistance, connectionOpacity, contactAmount, lineProfile);
  });
  return { lineData, layerConnectionStyle };
}
