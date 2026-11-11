import { useEffect, useMemo } from "react";
import * as THREE from "three";
import type { ParticleConfig } from "../types";
import { DRAW_FRAG, DRAW_VERT, STREAK_FRAG, STREAK_VERT } from "./gpgpuShaders";

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

  // Same disposal contract as useGpgpuTrailAssets: texSize-sized
  // geometries must not outlive the generation that created them.
  useEffect(() => () => {
    drawGeo.dispose();
  }, [drawGeo]);
  useEffect(() => () => {
    streakGeo.dispose();
  }, [streakGeo]);

  return {
    drawMat,
    drawGeo,
    streakGeo,
    streakMat,
  };
}
