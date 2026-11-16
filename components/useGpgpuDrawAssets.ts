import { useEffect, useMemo } from "react";
import * as THREE from "three";
import type { ParticleConfig } from "../types";
import { createGradientLutTexture } from "../lib/kinetixGradients";
import { DRAW_FRAG, DRAW_VERT, STREAK_FRAG, STREAK_VERT } from "./gpgpuShaders";
import { AUX_DRAW_FRAG, AUX_DRAW_VERT, AUX_TEX_SIZE } from "./gpgpuShaderAux";

export function useGpgpuDrawAssets(config: ParticleConfig, texSize: number) {
  const drawMat = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      uPosTex:            { value: null },
      uVelTex:            { value: null },
      uColor:             { value: new THREE.Color(config.gpgpuColor) },
      uSize:              { value: config.gpgpuSize },
      uKuramotoEnabled:   { value: config.gpgpuKuramotoEnabled },
      uKuramotoInfluence: { value: config.gpgpuKuramotoInfluence },
      uParticleLifeEnabled: { value: false },
      uParticleLifeSpecies: { value: 4 },
      uTexSizeF:          { value: texSize },
      uOpacity:           { value: config.gpgpuOpacity },
      uVelColorEnabled:   { value: false },
      uVelColorHueMin:    { value: 200 },
      uVelColorHueMax:    { value: 360 },
      uVelColorSaturation:{ value: 0.9 },
      uAgeEnabled:        { value: false },
      uAgeMax:            { value: 8.0 },
      uAgeFadeIn:         { value: 0.1 },
      uAgeFadeOut:        { value: 0.2 },
      uAgeColorEnabled:   { value: false },
      uAgeColorYoung:     { value: new THREE.Color('#00aaff') },
      uAgeColorOld:       { value: new THREE.Color('#ff4400') },
      uAgeSizeEnabled:    { value: false },
      uAgeSizeStart:      { value: 2.0 },
      uAgeSizeEnd:        { value: 0.2 },
      uAgeSizeCurve:      { value: 0 },
      // Phase U: age curves / Layer Maps / sprite image. Defaults are
      // the identity configuration (curves disabled, flat points,
      // amounts 0, no sprite), so the legacy draw is bit-identical.
      uAgeCurveSizeEnabled:    { value: false },
      uAgeCurveSize:           { value: [1, 1, 1, 1, 1] },
      uAgeCurveOpacityEnabled: { value: false },
      uAgeCurveOpacity:        { value: [1, 1, 1, 1, 1] },
      uMapSizeAmount:          { value: 0 },
      uMapOpacityAmount:       { value: 0 },
      uSpriteImageTex:         { value: null },
      uSpriteImageReady:       { value: false },
      // 3D light (Phase T): disabled by default; the vertex shader
      // then yields exactly 1.0 and the fragment multiply is the
      // identity, so the legacy draw is bit-identical.
      uLightEnabled:      { value: false },
      uLightPos:          { value: new THREE.Vector3(0, 0, 0) },
      uLightIntensity:    { value: 1 },
      uLightRadius:       { value: 3 },
      uLightConeEnabled:  { value: false },
      uLightConeAngleDeg: { value: 30 },
      uLightConeDir:      { value: new THREE.Vector3(0, -1, 0) },
      uPointShape:        { value: 0 },
      uGradEnabled:       { value: false },
      uGradDriver:        { value: 0 },
      uGradLut:           { value: createGradientLutTexture(config.gpgpuGradStart, config.gpgpuGradMid, config.gpgpuGradEnd) },
      uGradSpatialScale:  { value: config.gpgpuGradSpatialScale },
      uGradTime:          { value: 0 },
      uGradImageTex:      { value: null },
      uGradImageReady:    { value: false },
      uGradImageScale:    { value: 1 / 300 },
      uSortTex:           { value: null },
      uSortEnabled:       { value: false },
    },
    vertexShader: DRAW_VERT, fragmentShader: DRAW_FRAG,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);

  const drawGeo = useMemo(() => {
    const count = texSize * texSize;
    const geo = new THREE.BufferGeometry();
    const coords = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      coords[i * 2]     = ((i % texSize) + 0.5) / texSize;
      coords[i * 2 + 1] = (Math.floor(i / texSize) + 0.5) / texSize;
    }
    geo.setAttribute('position',  new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    geo.setAttribute('aTexCoord', new THREE.BufferAttribute(coords, 2));
    return geo;
  }, [texSize]);

  const streakGeo = useMemo(() => {
    const count = texSize * texSize;
    const geo   = new THREE.BufferGeometry();
    const coords = new Float32Array(count * 4);
    const ends   = new Float32Array(count * 2);
    const pos    = new Float32Array(count * 6);
    for (let i = 0; i < count; i++) {
      const u = ((i % texSize) + 0.5) / texSize;
      const v = (Math.floor(i / texSize) + 0.5) / texSize;
      coords[i*4+0] = u; coords[i*4+1] = v;
      coords[i*4+2] = u; coords[i*4+3] = v;
      ends[i*2+0] = 0; ends[i*2+1] = 1;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aTexCoord', new THREE.BufferAttribute(coords, 2));
    geo.setAttribute('aIsEnd',    new THREE.BufferAttribute(ends, 1));
    return geo;
  }, [texSize]);

  const streakMat = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      uPosTex:       { value: null },
      uVelTex:       { value: null },
      uColor:        { value: new THREE.Color(config.gpgpuColor) },
      uOpacity:      { value: 0.6 },
      uStreakLength: { value: 15.0 },
      uAgeEnabled:   { value: false },
      uAgeMax:       { value: 8.0 },
      uAgeFadeIn:    { value: 0.1 },
      uAgeFadeOut:   { value: 0.2 },
    },
    vertexShader: STREAK_VERT, fragmentShader: STREAK_FRAG,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);

  // Aux event pool draw (B3): fixed 128x128 grid, independent of the
  // main texSize. Uniforms are pointed at the aux ping-pong outputs by
  // the scene loop each frame the aux passes run.
  const auxDrawMat = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      uAuxPosTex: { value: null },
      uAuxVelTex: { value: null },
      uColor:     { value: new THREE.Color(config.gpgpuColor) },
      uOpacity:   { value: config.gpgpuOpacity },
      uAuxSize:   { value: config.gpgpuAuxSize },
    },
    vertexShader: AUX_DRAW_VERT, fragmentShader: AUX_DRAW_FRAG,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);

  // Aux chain draw (Phase W1): levels 2 and 3 share the level-1
  // draw shaders and geometry; each level gets its own material so
  // its colour / size / textures resolve independently. Uniforms are
  // pointed at the chain ping-pong outputs by the scene loop on the
  // frames the chain passes run.
  const aux2DrawMat = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      uAuxPosTex: { value: null },
      uAuxVelTex: { value: null },
      uColor:     { value: new THREE.Color(config.gpgpuColor) },
      uOpacity:   { value: config.gpgpuOpacity },
      uAuxSize:   { value: config.gpgpuAux2Size },
    },
    vertexShader: AUX_DRAW_VERT, fragmentShader: AUX_DRAW_FRAG,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);

  const aux3DrawMat = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      uAuxPosTex: { value: null },
      uAuxVelTex: { value: null },
      uColor:     { value: new THREE.Color(config.gpgpuColor) },
      uOpacity:   { value: config.gpgpuOpacity },
      uAuxSize:   { value: config.gpgpuAux2Size },
    },
    vertexShader: AUX_DRAW_VERT, fragmentShader: AUX_DRAW_FRAG,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);

  const auxDrawGeo = useMemo(() => {
    const count = AUX_TEX_SIZE * AUX_TEX_SIZE;
    const geo = new THREE.BufferGeometry();
    const coords = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      coords[i * 2]     = ((i % AUX_TEX_SIZE) + 0.5) / AUX_TEX_SIZE;
      coords[i * 2 + 1] = (Math.floor(i / AUX_TEX_SIZE) + 0.5) / AUX_TEX_SIZE;
    }
    geo.setAttribute('position',  new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    geo.setAttribute('aTexCoord', new THREE.BufferAttribute(coords, 2));
    return geo;
  }, []);

  // Same disposal contract as useGpgpuTrailAssets: texSize-sized
  // geometries must not outlive the generation that created them.
  useEffect(() => () => {
    drawGeo.dispose();
  }, [drawGeo]);
  useEffect(() => () => {
    streakGeo.dispose();
  }, [streakGeo]);
  useEffect(() => () => {
    auxDrawGeo.dispose();
  }, [auxDrawGeo]);

  return {
    drawMat,
    drawGeo,
    streakGeo,
    streakMat,
    auxDrawMat,
    aux2DrawMat,
    aux3DrawMat,
    auxDrawGeo,
  };
}
