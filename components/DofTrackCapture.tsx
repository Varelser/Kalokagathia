import React from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import type { ParticleConfig } from '../types';
import { SHADOW_CASTER_POINTS_USERDATA } from '../lib/lightShadowMap';
import { useBakedSpeciesData } from '../lib/speciesAllocation';
import {
  DOF_TRACK_REDUCTION_FRAG,
  DOF_TRACK_REDUCTION_VERT,
  resolveDofTrackZone,
  setDofFocusSource,
  viewDepthOfPoint,
} from '../lib/dofTracking';

// DOF track capture (limit plan stage 4, slice S5): while
// DOF particle tracking is on, reduce the tracked zone's
// centroid on the GPU and publish its view depth through
// lib/dofTracking.ts for the DOF stage's focus supply.
//
// How: the main pool's points (the S4 caster mark; the draw
// geometry is borrowed, never disposed) are drawn into a
// 1x1 float target with additive blending — every point
// lands on the single pixel and contributes
// (worldPos * zoneWeight, zoneWeight), the GPU twin of
// particleZoneCentroid. The species channel comes from the
// baked species data (lib/speciesAllocation.ts) uploaded as
// a data texture; with no baked channel every texel weighs
// as zone 0, exactly the geometry split's own rule. The
// single pixel is read back (4 floats) and the centroid's
// view depth along the live camera is published.
//
// Mount discipline is the identity guarantee: AppScene
// mounts this component ONLY while dofTrackOn(config). At
// the defaults it never mounts, the store stays null and
// the DOF stage keeps the config focusDistance verbatim.
//
// Recorded limits: (1) the reduction needs float-target
// additive blending (EXT_float_blend in WebGL2); where the
// accumulated pixel reads back non-finite or empty the
// capture publishes nothing and the supply falls back to
// the config value. (2) The 1x1 readback is a small
// per-frame stall, accepted for an opt-in tracking mode.
// (3) Parked-form texels are not special-cased: the main
// pool's positions are live positions by construction.

export const DofTrackCapture: React.FC<{ config: ParticleConfig }> = ({ config }) => {
  const gl = useThree((state) => state.gl);
  const bakedSpecies = useBakedSpeciesData();
  const rtRef = React.useRef<THREE.WebGLRenderTarget | null>(null);
  const sceneRef = React.useRef<THREE.Scene | null>(null);
  const pointsRef = React.useRef<THREE.Points | null>(null);
  const matRef = React.useRef<THREE.ShaderMaterial | null>(null);
  const speciesTexRef = React.useRef<THREE.DataTexture | null>(null);
  const speciesSigRef = React.useRef('');
  const readBufRef = React.useRef<Float32Array | null>(null);
  const clearColorRef = React.useRef<THREE.Color | null>(null);

  const zone = resolveDofTrackZone(config.postDofTrackZone);

  useFrame(({ scene, camera }) => {
    let pointsObj: THREE.Object3D | null = null;
    scene.traverse((obj) => {
      if (!pointsObj && obj.userData[SHADOW_CASTER_POINTS_USERDATA]) pointsObj = obj;
    });
    if (!pointsObj) return;
    const mat = (pointsObj as THREE.Points).material as unknown as
      { uniforms?: Record<string, { value: unknown }> } | undefined;
    const posTex = (mat?.uniforms?.uPosTex?.value ?? null) as THREE.Texture | null;
    if (!posTex) return;

    // Species channel texture: rebuilt only when the baked
    // data version changes (setBakedSpeciesData bumps it on
    // every publish, so a stale bake is never consumed).
    const texSize = bakedSpecies ? bakedSpecies.texSize : 0;
    const hasSpecies = !!(bakedSpecies && texSize > 0 && texSize * texSize === bakedSpecies.data.length);
    const sig = hasSpecies ? `v${bakedSpecies!.version}:${texSize}:${bakedSpecies!.species}` : '';
    if (sig !== speciesSigRef.current) {
      speciesSigRef.current = sig;
      speciesTexRef.current?.dispose();
      speciesTexRef.current = null;
      if (hasSpecies) {
        const bytes = new Uint8Array(texSize * texSize * 4);
        for (let i = 0; i < texSize * texSize; i++) {
          bytes[i * 4] = Math.min(255, Math.max(0, bakedSpecies!.data[i]));
        }
        const tex = new THREE.DataTexture(bytes, texSize, texSize, THREE.RGBAFormat);
        tex.minFilter = THREE.NearestFilter;
        tex.magFilter = THREE.NearestFilter;
        tex.needsUpdate = true;
        speciesTexRef.current = tex;
      }
    }

    if (!rtRef.current) {
      rtRef.current = new THREE.WebGLRenderTarget(1, 1, {
        minFilter: THREE.NearestFilter,
        magFilter: THREE.NearestFilter,
        depthBuffer: false,
        type: THREE.FloatType,
      });
    }
    const rt = rtRef.current;

    if (!matRef.current) {
      matRef.current = new THREE.ShaderMaterial({
        uniforms: {
          uPosTex: { value: null },
          uSpeciesTex: { value: null },
          uZone: { value: 0 },
          uHasSpecies: { value: 0 },
        },
        vertexShader: DOF_TRACK_REDUCTION_VERT,
        fragmentShader: DOF_TRACK_REDUCTION_FRAG,
        depthTest: false,
        depthWrite: false,
        transparent: true,
        blending: THREE.AdditiveBlending,
      });
    }
    matRef.current.uniforms.uPosTex.value = posTex;
    matRef.current.uniforms.uSpeciesTex.value = speciesTexRef.current;
    matRef.current.uniforms.uZone.value = zone;
    matRef.current.uniforms.uHasSpecies.value = hasSpecies && speciesTexRef.current ? 1 : 0;

    if (!sceneRef.current) sceneRef.current = new THREE.Scene();
    const reductionScene = sceneRef.current;
    reductionScene.clear();
    const geo = (pointsObj as THREE.Points).geometry;
    if (!pointsRef.current) {
      pointsRef.current = new THREE.Points(geo, matRef.current);
      pointsRef.current.frustumCulled = false;
    } else {
      if (pointsRef.current.geometry !== geo) pointsRef.current.geometry = geo;
      pointsRef.current.material = matRef.current;
    }
    reductionScene.add(pointsRef.current);

    if (!clearColorRef.current) clearColorRef.current = new THREE.Color(0, 0, 0);
    const prevTarget = gl.getRenderTarget();
    const prevClearAlpha = gl.getClearAlpha();
    gl.setRenderTarget(rt);
    gl.setClearColor(clearColorRef.current, 0);
    gl.clear(true, false, false);
    gl.render(reductionScene, camera);
    if (!readBufRef.current) readBufRef.current = new Float32Array(4);
    const buf = readBufRef.current;
    gl.readRenderTargetPixels(rt, 0, 0, 1, 1, buf);
    gl.setRenderTarget(prevTarget);
    gl.setClearAlpha(prevClearAlpha);

    const count = buf[3];
    if (!(count > 0) || !Number.isFinite(count) || !Number.isFinite(buf[0]) || !Number.isFinite(buf[1]) || !Number.isFinite(buf[2])) {
      setDofFocusSource(null);
      return;
    }
    const centroid: [number, number, number] = [buf[0] / count, buf[1] / count, buf[2] / count];
    const camPos = camera.position;
    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    const viewDepth = viewDepthOfPoint(
      centroid,
      [camPos.x, camPos.y, camPos.z],
      [forward.x, forward.y, forward.z],
    );
    setDofFocusSource(Number.isFinite(viewDepth) ? { viewDepth } : null);
  });

  React.useEffect(() => () => {
    setDofFocusSource(null);
    rtRef.current?.dispose();
    rtRef.current = null;
    matRef.current?.dispose();
    matRef.current = null;
    speciesTexRef.current?.dispose();
    speciesTexRef.current = null;
    pointsRef.current = null;
    sceneRef.current = null;
  }, []);

  return null;
};
