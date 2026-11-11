import React, { useMemo, useRef, useState, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { ParticleConfig } from '../types';
import { getInterLayerCollidersForLayer, MAX_INTER_LAYER_COLLIDERS } from '../lib/appState';
import type { AuxMode, ParticleData } from './particleData';
import { getLayerRuntimeParticleVisualSnapshot } from '../lib/sceneRenderRouting';
import { generateParticleDataAsync } from './sceneParticleSystemWorker';
import { buildParticleGeometryKey } from './sceneParticleSystemShared';
import { createParticleUniforms } from './sceneParticleSystemUniforms';
import { renderParticleSystemContent } from './sceneParticleSystemRender';
import { createParticleGhostMaterials } from './sceneParticleSystemGhostMats';
import { updateParticleSystemFrame, type ParticleSystemCollider, type ParticleSystemAudioRef } from './sceneParticleSystemRuntime';
import { runLayerPositionFeedback, type LayerFeedbackState } from '../lib/positionFeedback';

export const ParticleSystem: React.FC<{
  config: ParticleConfig;
  layerIndex: 1 | 2 | 3 | 4;
  isAux?: boolean;
  auxMode?: AuxMode;
  audioRef: ParticleSystemAudioRef;
  isPlaying: boolean;
  contactAmount: number;
}> = React.memo(({ config, layerIndex, isAux = false, auxMode = 'aux', audioRef, isPlaying, contactAmount }) => {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const windRef = useRef(new THREE.Vector3());
  const spinRef = useRef(new THREE.Vector3());
  const prevAudioEnabledRef = useRef<boolean>(config.audioEnabled);
  const prevLayerKeyRef = useRef<string>('');
  const feedbackStateRef = useRef<LayerFeedbackState>({ sim: null, key: '', wasEnabled: false });
  useEffect(() => () => { feedbackStateRef.current.sim?.dispose(); feedbackStateRef.current.sim = null; }, []);

  const interLayerColliders = useMemo<ParticleSystemCollider[]>(() => {
    if (layerIndex === 4 || isAux) {
      return Array.from({ length: MAX_INTER_LAYER_COLLIDERS }, () => ({ center: new THREE.Vector3(), radius: 0 }));
    }
    const colliders = getInterLayerCollidersForLayer(config, layerIndex);
    return Array.from({ length: MAX_INTER_LAYER_COLLIDERS }, (_, index) => colliders[index] ?? { center: new THREE.Vector3(), radius: 0 });
  }, [config, isAux, layerIndex]);

  const activeInterLayerColliderCount = useMemo(
    () => interLayerColliders.reduce((count, collider) => count + (collider.radius > 0 ? 1 : 0), 0),
    [interLayerColliders],
  );

  const geometryKey = useMemo(
    () => buildParticleGeometryKey(config, layerIndex, isAux, auxMode),
    [config, layerIndex, isAux, auxMode],
  );

  const [data, setData] = useState<ParticleData | null>(null);
  useEffect(() => {
    setData(null);
    let cancelled = false;
    generateParticleDataAsync(config, layerIndex, isAux, auxMode).then((nextData) => {
      if (!cancelled) setData(nextData);
    });
    return () => {
      cancelled = true;
    };
  }, [config, layerIndex, isAux, auxMode, geometryKey]);

  const uniforms = useMemo(
    () => createParticleUniforms(config, isAux),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- field-grained deps are deliberate: the memo reads only the listed config fields, and a whole-config dep would recompute on every change.
    [config.contrast, config.opacity, config.particleGlow, config.particleSoftness, config.particleColor, isAux],
  );

  const maxGhost = 8;
  const ghostMats = useMemo(
    () => createParticleGhostMaterials({ config, layerIndex, isAux, uniforms, maxGhost }),
    [config, layerIndex, isAux, uniforms],
  );

  useFrame((state, delta) => {
    updateParticleSystemFrame({
      config,
      layerIndex,
      isAux,
      auxMode,
      audioRef,
      isPlaying,
      contactAmount,
      state,
      delta,
      meshRef,
      windRef,
      spinRef,
      prevAudioEnabledRef,
      prevLayerKeyRef,
      interLayerColliders,
      activeInterLayerColliderCount,
      ghostMats,
      maxGhost,
    });
    if (!isAux && (layerIndex === 2 || layerIndex === 3)) {
      runLayerPositionFeedback({
        gl: state.gl,
        config,
        layerIndex,
        data,
        geometryKey,
        uniforms: uniforms as Record<string, THREE.IUniform>,
        material: (meshRef.current?.material as THREE.ShaderMaterial | undefined) ?? undefined,
        ghostMaterials: ghostMats as unknown as THREE.ShaderMaterial[],
        state: feedbackStateRef.current,
      });
    }
  });

  if (!data) return null;

  const geomMode3D = layerIndex === 2 || layerIndex === 3
    ? getLayerRuntimeParticleVisualSnapshot(config, layerIndex).geomMode3D
    : 'billboard';

  return renderParticleSystemContent({
    config,
    layerIndex,
    isAux,
    auxMode,
    data,
    geometryKey,
    geomMode3D,
    meshRef,
    uniforms,
    ghostMats,
    contactAmount,
    isPlaying,
  });
});
ParticleSystem.displayName = 'ParticleSystem';
