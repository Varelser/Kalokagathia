import React from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { useFBO } from '@react-three/drei';
import type { ReactionDiffusionSystemProps } from './sceneReactionDiffusionSystemShared';
import {
  buildResolvedReactionProfile,
  buildSeedTexture,
  displayFragment,
  displayVertex,
  getLayerSource,
  getReactionMode,
  resolveReactionParams,
  simFragment,
  simVertex,
} from './sceneReactionDiffusionSystemShared';
import { buildLeniaKernelTexture } from './sceneReactionDiffusionLeniaKernel';

export function useReactionDiffusionRuntime({ config, layerIndex, audioRef, isPlaying }: ReactionDiffusionSystemProps) {
  const size = 256;
  const { gl } = useThree();
  const rtA = useFBO(size, size, { type: THREE.FloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, stencilBuffer: false });
  const rtB = useFBO(size, size, { type: THREE.FloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, stencilBuffer: false });
  const mode = getReactionMode(config, layerIndex);
  const source = getLayerSource(config, layerIndex);
  const profile = React.useMemo(() => buildResolvedReactionProfile(mode, source), [mode, source]);
  const reactionModel = layerIndex === 2 ? config.layer2ReactionModel : config.layer3ReactionModel;
  const seedTexture = React.useMemo(() => buildSeedTexture(size, mode, source, profile, reactionModel), [mode, profile, source, reactionModel]);
  const leniaKernelPreset = layerIndex === 2 ? (config.layer2ReactionLeniaKernel ?? 'ring') : (config.layer3ReactionLeniaKernel ?? 'ring');
  const leniaRadius = layerIndex === 2 ? (config.layer2ReactionLeniaRadius ?? 13) : (config.layer3ReactionLeniaRadius ?? 13);
  const leniaKernelTexture = React.useMemo(() => buildLeniaKernelTexture(leniaKernelPreset, leniaRadius), [leniaKernelPreset, leniaRadius]);
  const simScene = React.useMemo(() => new THREE.Scene(), []);
  const simCamera = React.useMemo(() => new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), []);
  const simMaterial = React.useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      previousTexture: { value: seedTexture },
      texel: { value: new THREE.Vector2(1 / size, 1 / size) },
      feed: { value: 0.037 },
      kill: { value: 0.062 },
      dA: { value: 1.0 },
      dB: { value: 0.5 },
      dt: { value: 1.0 },
      time: { value: 0 },
      warp: { value: 0.3 },
      pulse: { value: 0 },
      flowAniso: { value: 1 },
      reactionBoost: { value: 1 },
      model: { value: 0 },
      fhnEpsilon: { value: 0.08 },
      fhnA: { value: 0.7 },
      fhnB: { value: 0.8 },
      leniaKernel: { value: leniaKernelTexture },
      leniaMu: { value: 0.15 },
      leniaSigma: { value: 0.016 },
      leniaDt: { value: 0.1 },
    },
    vertexShader: simVertex,
    fragmentShader: simFragment,
  }), [seedTexture, leniaKernelTexture]);
  const displayMaterial = React.useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      reactionTexture: { value: rtA.texture },
      baseColor: { value: new THREE.Color('#ffffff') },
      opacity: { value: 0.8 },
      time: { value: 0 },
      audioReactive: { value: 0.35 },
      pulse: { value: 0 },
      poolMix: { value: 0.28 },
      colonyBands: { value: 0.34 },
      cellScale: { value: 1 },
      contourTightness: { value: 1 },
      hueShift: { value: 0 },
      lightnessShift: { value: 0 },
      heightGain: { value: 0.22 },
      ridgeGain: { value: 0.42 },
      pitGain: { value: 0.18 },
      wetness: { value: 0.18 },
      scarStrength: { value: 0.12 },
      bulge: { value: 0.18 },
      rimPinch: { value: 0.12 },
      shear: { value: 0.04 },
      tiltX: { value: 0 },
      tiltY: { value: 0 },
      curl: { value: 0.08 },
      depthBands: { value: 0.18 },
      frontBias: { value: 0.08 },
      sourceOrbit: { value: 0 },
      sourceLedger: { value: 0 },
      sourceCanopy: { value: 0 },
      sourceColumn: { value: 0 },
      model: { value: 0 },
      fhnGain: { value: 1 },
      leniaGain: { value: 1 },
    },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexShader: displayVertex,
    fragmentShader: displayFragment,
  }), [rtA.texture]);
  const simQuad = React.useMemo(() => {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), simMaterial);
    simScene.add(mesh);
    return mesh;
  }, [simMaterial, simScene]);
  const seededRef = React.useRef(false);
  const targetsRef = React.useRef({ current: rtA, next: rtB });
  const params = resolveReactionParams(config, layerIndex);

  React.useEffect(() => {
    seededRef.current = false;
  }, [seedTexture, mode, source, leniaKernelTexture]);

  React.useEffect(() => {
    if (seededRef.current) return;
    const prev = gl.getRenderTarget();
    gl.setRenderTarget(rtA);
    gl.clear();
    simMaterial.uniforms.previousTexture.value = seedTexture;
    gl.render(simScene, simCamera);
    gl.setRenderTarget(rtB);
    gl.clear();
    simMaterial.uniforms.previousTexture.value = rtA.texture;
    gl.render(simScene, simCamera);
    gl.setRenderTarget(prev);
    targetsRef.current = { current: rtA, next: rtB };
    seededRef.current = true;
  }, [gl, mode, rtA, rtB, seedTexture, simCamera, simMaterial, simScene, source]);

  React.useEffect(() => {
    // FHN gets its own display profile: crisper wavefront contours and
    // much less of the Gray-Scott-oriented pool/band wash that made FHN
    // renders look bright and diffuse.
    const fhn = reactionModel === 'fhn';
    displayMaterial.uniforms.baseColor.value.set(params.color);
    displayMaterial.uniforms.opacity.value = params.opacity * profile.opacityMul;
    displayMaterial.uniforms.audioReactive.value = params.audioReactive;
    displayMaterial.uniforms.poolMix.value = fhn ? profile.poolMix * 0.35 : profile.poolMix;
    displayMaterial.uniforms.colonyBands.value = fhn ? profile.colonyBands * 0.6 : profile.colonyBands;
    displayMaterial.uniforms.cellScale.value = profile.cellScale;
    displayMaterial.uniforms.contourTightness.value = fhn ? profile.contourTightness * 1.35 : profile.contourTightness;
    displayMaterial.uniforms.hueShift.value = profile.hueShift;
    displayMaterial.uniforms.lightnessShift.value = profile.lightnessShift;
    displayMaterial.uniforms.heightGain.value = profile.heightGain;
    displayMaterial.uniforms.ridgeGain.value = profile.ridgeGain;
    displayMaterial.uniforms.pitGain.value = profile.pitGain;
    displayMaterial.uniforms.wetness.value = profile.wetness;
    displayMaterial.uniforms.scarStrength.value = profile.scarStrength;
    displayMaterial.uniforms.bulge.value = profile.bulge;
    displayMaterial.uniforms.rimPinch.value = profile.rimPinch;
    displayMaterial.uniforms.shear.value = profile.shear;
    displayMaterial.uniforms.tiltX.value = profile.tiltX;
    displayMaterial.uniforms.tiltY.value = profile.tiltY;
    displayMaterial.uniforms.curl.value = profile.curl;
    displayMaterial.uniforms.depthBands.value = profile.depthBands;
    displayMaterial.uniforms.frontBias.value = profile.frontBias;
    displayMaterial.uniforms.sourceOrbit.value = THREE.MathUtils.clamp(profile.seedRing * 0.72 + profile.seedSweep * 0.34, 0, 1);
    displayMaterial.uniforms.sourceLedger.value = THREE.MathUtils.clamp(profile.seedLedger, 0, 1);
    displayMaterial.uniforms.sourceCanopy.value = THREE.MathUtils.clamp(profile.seedCanopy * 0.86 + profile.seedBlob * 0.24, 0, 1);
    displayMaterial.uniforms.sourceColumn.value = THREE.MathUtils.clamp(profile.seedColumn * 0.92 + profile.seedTerrace * 0.18, 0, 1);
  }, [displayMaterial, params.audioReactive, params.color, params.opacity, profile, reactionModel]);

  useFrame(({ clock }) => {
    if (!seededRef.current) return;
    const pulse = config.audioEnabled ? (audioRef.current.pulse * config.audioBurstScale + audioRef.current.bass * config.audioBeatScale * 0.5) : 0;
    simMaterial.uniforms.feed.value = params.feed + profile.feedAdd;
    simMaterial.uniforms.kill.value = params.kill + profile.killAdd;
    simMaterial.uniforms.dA.value = profile.diffusionA;
    simMaterial.uniforms.dB.value = profile.diffusionB;
    simMaterial.uniforms.dt.value = profile.dtMul;
    simMaterial.uniforms.model.value = params.model === 'fhn' ? 1 : params.model === 'lenia' ? 2 : 0;
    simMaterial.uniforms.fhnEpsilon.value = params.fhnEpsilon;
    simMaterial.uniforms.fhnA.value = params.fhnA;
    simMaterial.uniforms.fhnB.value = params.fhnB;
    if (simMaterial.uniforms.leniaKernel) simMaterial.uniforms.leniaKernel.value = leniaKernelTexture;
    if (simMaterial.uniforms.leniaMu) simMaterial.uniforms.leniaMu.value = params.leniaMu;
    if (simMaterial.uniforms.leniaSigma) simMaterial.uniforms.leniaSigma.value = params.leniaSigma;
    if (simMaterial.uniforms.leniaDt) simMaterial.uniforms.leniaDt.value = params.leniaDt;
    simMaterial.uniforms.warp.value = params.warp * profile.warpMul;
    simMaterial.uniforms.flowAniso.value = profile.flowAniso;
    simMaterial.uniforms.reactionBoost.value = profile.reactionBoost;
    simMaterial.uniforms.time.value = clock.elapsedTime;
    simMaterial.uniforms.pulse.value = pulse * params.audioReactive;
    displayMaterial.uniforms.time.value = clock.elapsedTime;
    displayMaterial.uniforms.pulse.value = pulse;
    displayMaterial.uniforms.model.value = params.model === 'fhn' ? 1 : params.model === 'lenia' ? 2 : 0;
    displayMaterial.uniforms.fhnGain.value = params.model === 'fhn' ? params.fhnGain : 1;
    if (displayMaterial.uniforms.leniaGain) displayMaterial.uniforms.leniaGain.value = params.model === 'lenia' ? params.leniaGain : 1;

    const iterations = params.model === 'lenia' ? 1 : isPlaying ? 2 : 1;
    const prev = gl.getRenderTarget();
    for (let i = 0; i < iterations; i += 1) {
      const targets = targetsRef.current;
      simMaterial.uniforms.previousTexture.value = targets.current.texture;
      gl.setRenderTarget(targets.next);
      gl.render(simScene, simCamera);
      targetsRef.current = { current: targets.next, next: targets.current };
    }
    gl.setRenderTarget(prev);
    displayMaterial.uniforms.reactionTexture.value = targetsRef.current.current.texture;
  });

  React.useEffect(() => () => {
    simScene.remove(simQuad);
    simQuad.geometry.dispose();
    simMaterial.dispose();
    displayMaterial.dispose();
    seedTexture.dispose();
    leniaKernelTexture.dispose();
  }, [displayMaterial, leniaKernelTexture, seedTexture, simMaterial, simQuad, simScene]);

  const planeSize = Math.max(config.sphereRadius * 1.55, params.spread * 1.45, 180) * Math.max(0.6, params.scale);
  const zOffset = config.sphereRadius * (layerIndex === 2 ? -0.58 : 0.58);

  return { displayMaterial, planeSize, zOffset, mode, source };
}
