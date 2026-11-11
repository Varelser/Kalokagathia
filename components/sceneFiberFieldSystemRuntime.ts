import { useEffect, useMemo } from 'react';
import type { MutableRefObject, RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import {
  buildFiberLayout,
  ensureFiberGeometry,
  FiberFieldSystemProps,
  getFiberBlending,
  getLayerFiberSettings,
  getLayoutDeps,
  resolveFiberProfile,
  updateFiberGeometry,
  updateFiberMaterial,
} from './sceneFiberFieldSystemShared';

export function useFiberFieldRuntime(
  props: FiberFieldSystemProps,
  lineRef: RefObject<THREE.LineSegments | null>,
  geometryRef: MutableRefObject<THREE.BufferGeometry | null>,
  materialRef: RefObject<THREE.ShaderMaterial | null>,
) {
  const { config, layerIndex, audioRef, isPlaying } = props;
  // eslint-disable-next-line react-hooks/use-memo, react-hooks/exhaustive-deps -- deps come from a get*Deps() helper listing the exact config fields this layout reads; a literal [config] dep would rebuild the geometry on every config change.
  const layout = useMemo(() => buildFiberLayout(config, layerIndex), getLayoutDeps(config, layerIndex));
  const { layerMode, fiberProfile } = useMemo(() => resolveFiberProfile(config, layerIndex), [config, layerIndex]);
  const blending = getFiberBlending(layerMode);

  useEffect(() => {
    geometryRef.current?.dispose();
    geometryRef.current = null;
  }, [layout?.strandCount, geometryRef]);

  useEffect(() => () => {
    geometryRef.current?.dispose();
    geometryRef.current = null;
  }, [geometryRef]);

  useFrame(({ clock }) => {
    const line = lineRef.current;
    const material = materialRef.current;
    if (!line || !material || !layout) return;

    const settings = getLayerFiberSettings(config, layerIndex);
    const { layerMode: mode, fiberProfile: profile } = resolveFiberProfile(config, layerIndex);
    const globalRadius = config.sphereRadius * settings.radiusScale;
    const pulse = config.audioEnabled ? audioRef.current.pulse * config.audioBurstScale : 0;
    const bass = config.audioEnabled ? audioRef.current.bass * config.audioBeatScale : 0;
    const audioBoost = isPlaying ? (pulse + bass * 0.5) * settings.audioReactive : 0;
    const time = clock.getElapsedTime();

    const geometry = ensureFiberGeometry(line, geometryRef, layout.strandCount);
    updateFiberGeometry({ geometry, layout, config, layerIndex, settings, mode, profile, globalRadius, audioBoost, time });
    updateFiberMaterial(material, settings, profile, pulse, bass);
  });

  return { layout, fiberProfile, blending };
}
