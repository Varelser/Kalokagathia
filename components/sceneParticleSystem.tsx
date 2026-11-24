import React, { useMemo, useRef, useState, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
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
import { buildParticleVertexShader, PARTICLE_VERTEX_SHADER } from './sceneShaderParticlePointVertex';
import { buildParticleFragmentShader, FRAGMENT_SHADER } from './sceneShaderParticlePointFragment';
import { compileCheckShader } from '../lib/glslInjection';
import {
  buildParticlePointsVertexHarness,
  PARTICLE_POINTS_VERTEX_CHECK_FRAGMENT,
  setParticlePointsVertexGlslStatus,
  validateParticlePointsVertexGlslCode,
} from '../lib/particlePointsVertexGlsl';
import {
  buildParticlePointsFragmentHarness,
  PARTICLE_POINTS_FRAGMENT_CHECK_VERTEX,
  setParticlePointsFragmentGlslStatus,
  validateParticlePointsFragmentGlslCode,
} from '../lib/particlePointsFragmentGlsl';

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

  // Particle points vertex GLSL (Phase CD): validate +
  // compile-check the snippet against the live GL context, and
  // only then swap the built vertex shader into this system's
  // materials. On any failure the previously working shader
  // stays active and the panel shows the error via the point's
  // status store — the shared injection fallback rule. While
  // disabled / empty the stock shader string is used as-is.
  const gl = useThree((state) => state.gl);
  // IBL (Phase 22 stage 3): this layer's shader pair switches
  // to the IBL variant while its intensity key is positive
  // (layers 2/3 only; layer 1 and aux keep the stock pair).
  const iblActive = (layerIndex === 2 && config.layer2IblIntensity > 0.001)
    || (layerIndex === 3 && config.layer3IblIntensity > 0.001);
  const [vertexShader, setVertexShader] = useState(PARTICLE_VERTEX_SHADER);
  const appliedVertexCodeRef = useRef<string | null>(null);
  useEffect(() => {
    const code = config.particlePointsVertexGlslEnabled ? config.particlePointsVertexGlslCode : '';
    const applyKey = `${iblActive ? 'ibl' : 'stock'}|${code}`;
    if (!code.trim() && !iblActive) {
      if (appliedVertexCodeRef.current !== null) {
        setVertexShader(PARTICLE_VERTEX_SHADER);
        appliedVertexCodeRef.current = null;
      }
      setParticlePointsVertexGlslStatus({ state: 'inactive' });
      return;
    }
    if (appliedVertexCodeRef.current === applyKey) return;
    if (!code.trim()) {
      setVertexShader(buildParticleVertexShader('', true));
      appliedVertexCodeRef.current = applyKey;
      setParticlePointsVertexGlslStatus({ state: 'inactive' });
      return;
    }
    const validation = validateParticlePointsVertexGlslCode(code);
    if (!validation.ok) {
      setParticlePointsVertexGlslStatus({ state: 'error', message: validation.error ?? 'invalid code' });
      return;
    }
    const check = compileCheckShader(
      gl.getContext() as WebGL2RenderingContext,
      buildParticlePointsVertexHarness(code),
      PARTICLE_POINTS_VERTEX_CHECK_FRAGMENT,
    );
    if (!check.ok) {
      setParticlePointsVertexGlslStatus({ state: 'error', message: check.error ?? 'compile failed' });
      return;
    }
    setVertexShader(buildParticleVertexShader(code, iblActive));
    appliedVertexCodeRef.current = applyKey;
    setParticlePointsVertexGlslStatus({ state: 'active' });
  }, [config.particlePointsVertexGlslEnabled, config.particlePointsVertexGlslCode, gl, iblActive]);

  // Particle points fragment GLSL (Phase CE): the same
  // validate + compile-check + swap flow as the vertex point
  // above, for the fragment shader. The harness is a fragment
  // harness paired with a minimal vertex; the built shader
  // splices the snippet at both seams of the stock fragment
  // (the Kinetix mask branch and the final write). On any
  // failure the previously working shader stays active.
  const [fragmentShader, setFragmentShader] = useState(FRAGMENT_SHADER);
  const appliedFragmentCodeRef = useRef<string | null>(null);
  useEffect(() => {
    const code = config.particlePointsFragmentGlslEnabled ? config.particlePointsFragmentGlslCode : '';
    const applyKey = `${iblActive ? 'ibl' : 'stock'}|${code}`;
    if (!code.trim() && !iblActive) {
      if (appliedFragmentCodeRef.current !== null) {
        setFragmentShader(FRAGMENT_SHADER);
        appliedFragmentCodeRef.current = null;
      }
      setParticlePointsFragmentGlslStatus({ state: 'inactive' });
      return;
    }
    if (appliedFragmentCodeRef.current === applyKey) return;
    if (!code.trim()) {
      setFragmentShader(buildParticleFragmentShader('', true));
      appliedFragmentCodeRef.current = applyKey;
      setParticlePointsFragmentGlslStatus({ state: 'inactive' });
      return;
    }
    const validation = validateParticlePointsFragmentGlslCode(code);
    if (!validation.ok) {
      setParticlePointsFragmentGlslStatus({ state: 'error', message: validation.error ?? 'invalid code' });
      return;
    }
    const check = compileCheckShader(
      gl.getContext() as WebGL2RenderingContext,
      PARTICLE_POINTS_FRAGMENT_CHECK_VERTEX,
      buildParticlePointsFragmentHarness(code),
    );
    if (!check.ok) {
      setParticlePointsFragmentGlslStatus({ state: 'error', message: check.error ?? 'compile failed' });
      return;
    }
    setFragmentShader(buildParticleFragmentShader(code, iblActive));
    appliedFragmentCodeRef.current = applyKey;
    setParticlePointsFragmentGlslStatus({ state: 'active' });
  }, [config.particlePointsFragmentGlslEnabled, config.particlePointsFragmentGlslCode, gl, iblActive]);

  const maxGhost = 8;
  const ghostMats = useMemo(
    () => createParticleGhostMaterials({ config, layerIndex, isAux, uniforms, maxGhost, vertexShader, fragmentShader }),
    [config, layerIndex, isAux, uniforms, vertexShader, fragmentShader],
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
    vertexShader,
    fragmentShader,
  });
});
ParticleSystem.displayName = 'ParticleSystem';
