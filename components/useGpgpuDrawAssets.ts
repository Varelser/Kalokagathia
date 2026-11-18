import { useEffect, useMemo } from "react";
import * as THREE from "three";
import type { ParticleConfig } from "../types";
import { createGradientLutTextureResolved } from "../lib/kinetixGradients";
import { DRAW_FRAG, DRAW_VERT, STREAK_FRAG, STREAK_VERT } from "./gpgpuShaders";
import { AUX_DRAW_FRAG, AUX_DRAW_VERT, AUX_TEX_SIZE } from "./gpgpuShaderAux";
import { WW_DRAW_FRAG, WW_DRAW_VERT, WW_TEX_SIZE } from "./gpgpuShaderWhitewater";

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
      // Phase X: per-property map textures / displacement / mask.
      // All defaults are the inactive configuration (nothing ready,
      // amount 0, mask off), so the legacy draw is bit-identical.
      uMapSizeTex:             { value: null },
      uMapSizeReady:           { value: false },
      uMapOpacityTex:          { value: null },
      uMapOpacityReady:        { value: false },
      uMapDisplaceTex:         { value: null },
      uMapDisplaceReady:       { value: false },
      uMapDisplaceAmount:      { value: 0 },
      uMapDisplaceRadius:      { value: 1 },
      // Noise field map (Phase AY): amounts 0 — both consumers
      // skip the field evaluation and the legacy draw is
      // bit-identical; scale / evolve are inert while they are 0.
      uNoiseMapScale:          { value: 0.01 },
      uNoiseMapEvolve:         { value: 0 },
      uNoiseMapTime:           { value: 0 },
      uNoiseMapSizeAmount:     { value: 0 },
      uNoiseMapDisplaceAmount: { value: 0 },
      uMaskTex:                { value: null },
      uMaskReady:              { value: false },
      uMaskMode:               { value: 0 },
      uMaskThreshold:          { value: 0.5 },
      uMaskInvert:             { value: false },
      uSpriteImageTex:         { value: null },
      uSpriteImageReady:       { value: false },
      // Sprite sheet (Phase AD): 1x1 / age / 12fps / loop — the
      // frame is always 0 and the UV remap is the exact identity,
      // so single-image sprites stay bit-identical.
      uSpriteSheetCols:        { value: 1 },
      uSpriteSheetRows:        { value: 1 },
      uSpriteSheetMode:        { value: 0 },
      uSpriteSheetFps:         { value: 12 },
      uSpriteSheetLoop:        { value: true },
      // Sprite rotation (Phase AX): 0s — the fragment skips the
      // rotation and samples verbatim.
      uSpriteRotInitial:       { value: 0 },
      uSpriteRotSpeed:         { value: 0 },
      uSpriteRotDamping:       { value: 0 },
      uSpriteRotRandom:        { value: 0 },
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
      // Occlusion-map shadow (Phase Z): no bake, strength 0 — the
      // vertex sample yields exactly 1.0, bit-identical legacy.
      uShadowEnabled:     { value: false },
      uShadowStrength:    { value: 0 },
      uShadowMap:         { value: null },
      uShadowReady:       { value: false },
      uShadowExtent:      { value: 1 },
      uShadowHeightScale: { value: 1 },
      uPointShape:        { value: 0 },
      uGradEnabled:       { value: false },
      uGradDriver:        { value: 0 },
      uGradLut:           { value: createGradientLutTextureResolved(config.gpgpuGradStart, config.gpgpuGradMid, config.gpgpuGradEnd, config.gpgpuGradQuarter, config.gpgpuGradThreeQuarter, config.gpgpuGradQuarterPos, config.gpgpuGradThreeQuarterPos, config.gpgpuGradStopPositions, config.gpgpuGradStopColors) },
      uGradSpatialScale:  { value: config.gpgpuGradSpatialScale },
      uGradTime:          { value: 0 },
      uGradImageTex:      { value: null },
      uGradImageReady:    { value: false },
      uGradImageScale:    { value: 1 / 300 },
      uSortTex:           { value: null },
      uSortEnabled:       { value: false },
      // Named attributes (Phase AK): no texture / drives off is
      // the identity configuration (vAttrBright exactly 1.0), so
      // the legacy draw is bit-identical.
      uAttrTex:           { value: null },
      uAttrEnabled:       { value: false },
      uAttrSizeSlot:      { value: -1 },
      uAttrSizeAmount:    { value: 1 },
      uAttrBrightSlot:    { value: -1 },
      uAttrBrightAmount:  { value: 1 },
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

  // Whitewater draw (Phase BC): fixed 64x64 grid, foam white by
  // definition (a near-white with a hint of the water's grey-blue;
  // not a key — whitewater's colour is its identity, its amount /
  // life / size are the keys). Uniforms are pointed at the foam
  // ping-pong outputs by the scene loop each frame the foam
  // passes run.
  const wwDrawMat = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      uWwPosTex: { value: null },
      uWwVelTex: { value: null },
      uColor:    { value: new THREE.Color('#eef4f5') },
      uOpacity:  { value: config.gpgpuOpacity },
      uWwSize:   { value: config.gpgpuWhitewaterSize },
    },
    vertexShader: WW_DRAW_VERT, fragmentShader: WW_DRAW_FRAG,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);

  const wwDrawGeo = useMemo(() => {
    const count = WW_TEX_SIZE * WW_TEX_SIZE;
    const geo = new THREE.BufferGeometry();
    const coords = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      coords[i * 2]     = ((i % WW_TEX_SIZE) + 0.5) / WW_TEX_SIZE;
      coords[i * 2 + 1] = (Math.floor(i / WW_TEX_SIZE) + 0.5) / WW_TEX_SIZE;
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
  useEffect(() => () => {
    wwDrawGeo.dispose();
  }, [wwDrawGeo]);

  return {
    drawMat,
    drawGeo,
    streakGeo,
    streakMat,
    auxDrawMat,
    aux2DrawMat,
    aux3DrawMat,
    auxDrawGeo,
    wwDrawMat,
    wwDrawGeo,
  };
}
