import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { ParticleConfig } from "../types";
import { MAX_TRAIL, RIBBON_FRAG, RIBBON_VERT, TRAIL_FRAG, TRAIL_VERT, TUBE_FRAG, TUBE_SIDES, TUBE_VERT } from "./gpgpuShaders";
import { makeRT } from "./gpgpuAssetShared";

export function useGpgpuTrailAssets(config: ParticleConfig, texSize: number) {
  const trailRTs = useMemo(() => Array.from({ length: MAX_TRAIL }, () => makeRT(texSize)), [texSize]);

  const trailMats = useMemo(() => Array.from({ length: MAX_TRAIL }, () => new THREE.ShaderMaterial({
    uniforms: {
      uPosTex:       { value: null },
      uVelTex:       { value: null },
      uColor:        { value: new THREE.Color(config.gpgpuColor) },
      uSize:         { value: config.gpgpuSize },
      uAlpha:        { value: 0 },
      uVelocityScale:{ value: config.gpgpuTrailVelocityScale },
      uKuramotoEnabled:   { value: config.gpgpuKuramotoEnabled },
      uKuramotoInfluence: { value: config.gpgpuKuramotoInfluence },
    },
    vertexShader: TRAIL_VERT, fragmentShader: TRAIL_FRAG,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  })), []);

  const trailHead = useRef(0);

  const ribbonGeo = useMemo(() => {
    const N = texSize * texSize;
    const geo = new THREE.BufferGeometry();
    const texCoords = new Float32Array(N * 4 * 2);
    const sides     = new Float32Array(N * 4);
    const isBArr    = new Float32Array(N * 4);
    for (let i = 0; i < N; i++) {
      const u = ((i % texSize) + 0.5) / texSize;
      const v = (Math.floor(i / texSize) + 0.5) / texSize;
      const b = i * 4;
      for (let j = 0; j < 4; j++) { texCoords[(b + j) * 2] = u; texCoords[(b + j) * 2 + 1] = v; }
      sides[b]   = -1; sides[b+1]   = 1; sides[b+2]   = -1; sides[b+3]   = 1;
      isBArr[b]  =  0; isBArr[b+1]  = 0; isBArr[b+2]  =  1; isBArr[b+3]  = 1;
    }
    const indices = new Uint32Array(N * 6);
    for (let i = 0; i < N; i++) {
      const b = i * 4, bi = i * 6;
      indices[bi]   = b;   indices[bi+1] = b+2; indices[bi+2] = b+1;
      indices[bi+3] = b+1; indices[bi+4] = b+2; indices[bi+5] = b+3;
    }
    geo.setAttribute('aTexCoord', new THREE.BufferAttribute(texCoords, 2));
    geo.setAttribute('aSide',     new THREE.BufferAttribute(sides, 1));
    geo.setAttribute('aIsB',      new THREE.BufferAttribute(isBArr, 1));
    geo.setIndex(new THREE.BufferAttribute(indices, 1));
    return geo;
   
  }, [texSize]);

  const ribbonMats = useMemo(() => Array.from({ length: MAX_TRAIL - 1 }, () => new THREE.ShaderMaterial({
    uniforms: {
      uPosTexA:   { value: null },
      uPosTexB:   { value: null },
      uVelTex:    { value: null },
      uKuramotoEnabled:   { value: config.gpgpuKuramotoEnabled },
      uKuramotoInfluence: { value: config.gpgpuKuramotoInfluence },
      uColor:     { value: new THREE.Color(config.gpgpuColor) },
      uWidth:     { value: config.gpgpuRibbonWidth },
      uAlpha:     { value: 0 },
      uTaper:     { value: config.gpgpuRibbonTaper },
      uMaxSegLen: { value: config.gpgpuRibbonMaxSegLen },
    },
    vertexShader: RIBBON_VERT, fragmentShader: RIBBON_FRAG,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  })), []);

  const tubeGeo = useMemo(() => {
    const N = texSize * texSize;
    const geo = new THREE.BufferGeometry();
    const vertsPerParticle = TUBE_SIDES * 2;
    const total = N * vertsPerParticle;
    const texCoords = new Float32Array(total * 2);
    const tubeSidesAttr = new Float32Array(total);
    const isBArr       = new Float32Array(total);
    for (let i = 0; i < N; i++) {
      const u = ((i % texSize) + 0.5) / texSize;
      const v = (Math.floor(i / texSize) + 0.5) / texSize;
      for (let s = 0; s < TUBE_SIDES; s++) {
        const ia = i * vertsPerParticle + s;
        const ib = i * vertsPerParticle + TUBE_SIDES + s;
        texCoords[ia * 2] = u; texCoords[ia * 2 + 1] = v;
        texCoords[ib * 2] = u; texCoords[ib * 2 + 1] = v;
        tubeSidesAttr[ia] = s; isBArr[ia] = 0;
        tubeSidesAttr[ib] = s; isBArr[ib] = 1;
      }
    }
    const indicesPerParticle = TUBE_SIDES * 6;
    const indices = new Uint32Array(N * indicesPerParticle);
    for (let i = 0; i < N; i++) {
      const base = i * vertsPerParticle;
      const bi   = i * indicesPerParticle;
      for (let s = 0; s < TUBE_SIDES; s++) {
        const s1 = (s + 1) % TUBE_SIDES;
        const ii = bi + s * 6;
        indices[ii]   = base + s;              indices[ii+1] = base + TUBE_SIDES + s;
        indices[ii+2] = base + s1;             indices[ii+3] = base + s1;
        indices[ii+4] = base + TUBE_SIDES + s; indices[ii+5] = base + TUBE_SIDES + s1;
      }
    }
    geo.setAttribute('aTexCoord',  new THREE.BufferAttribute(texCoords, 2));
    geo.setAttribute('aTubeSide',  new THREE.BufferAttribute(tubeSidesAttr, 1));
    geo.setAttribute('aIsB',       new THREE.BufferAttribute(isBArr, 1));
    geo.setIndex(new THREE.BufferAttribute(indices, 1));
    return geo;
   
  }, [texSize]);

  const tubeMats = useMemo(() => Array.from({ length: MAX_TRAIL - 1 }, () => new THREE.ShaderMaterial({
    uniforms: {
      uPosTexA:    { value: null },
      uPosTexB:    { value: null },
      uVelTex:     { value: null },
      uKuramotoEnabled:   { value: config.gpgpuKuramotoEnabled },
      uKuramotoInfluence: { value: config.gpgpuKuramotoInfluence },
      uColor:      { value: new THREE.Color(config.gpgpuColor) },
      uTubeRadius: { value: config.gpgpuTubeRadius },
      uAlpha:      { value: 0 },
      uTaper:      { value: 0.8 },
      uMaxSegLen:  { value: config.gpgpuRibbonMaxSegLen },
    },
    vertexShader: TUBE_VERT, fragmentShader: TUBE_FRAG,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  })), []);

  // Dispose the texSize-sized GPU resources when they are replaced (a
  // gpgpuCount change rebuilds them at a new texSize) or on unmount. The
  // runtime hook already disposed its simulation targets the same way;
  // without this, every generation stayed resident — at texSize 1024
  // (e.g. Coverage 456) that is 16 float render targets (~256MB) plus the
  // tube/ribbon geometries (~0.5GB of buffers) per generation, which is
  // what degraded long sessions and poisoned subsequent presets.
  useEffect(() => () => {
    trailRTs.forEach((rt) => rt.dispose());
  }, [trailRTs]);
  useEffect(() => () => {
    ribbonGeo.dispose();
  }, [ribbonGeo]);
  useEffect(() => () => {
    tubeGeo.dispose();
  }, [tubeGeo]);

  return {
    trailRTs,
    trailMats,
    trailHead,
    ribbonGeo,
    ribbonMats,
    tubeGeo,
    tubeMats,
  };
}
