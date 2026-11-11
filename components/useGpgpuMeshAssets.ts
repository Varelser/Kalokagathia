import { useEffect, useMemo } from "react";
import * as THREE from "three";
import type { ParticleConfig } from "../types";
import { GEOM_FRAG, GEOM_VERT, VOLUMETRIC_FRAG, VOLUMETRIC_VERT } from "./gpgpuShaders";

export function useGpgpuMeshAssets(config: ParticleConfig, texSize: number) {
  const instGeo = useMemo(() => {
    if (config.gpgpuGeomMode === 'point') return null;
    const count = texSize * texSize;
    const geo = new THREE.InstancedBufferGeometry();
    let baseGeo: THREE.BufferGeometry;
    if      (config.gpgpuGeomMode === 'cube')  baseGeo = new THREE.BoxGeometry(1, 1, 1);
    else if (config.gpgpuGeomMode === 'tetra') baseGeo = new THREE.TetrahedronGeometry(0.8);
    else if (config.gpgpuGeomMode === 'icosa') baseGeo = new THREE.IcosahedronGeometry(0.82);
    else                                        baseGeo = new THREE.OctahedronGeometry(0.7);
    if (baseGeo.index) geo.setIndex(baseGeo.index);
    geo.setAttribute('position', baseGeo.attributes.position);
    if (baseGeo.attributes.normal) geo.setAttribute('normal', baseGeo.attributes.normal);
    const coords = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      coords[i * 2]     = ((i % texSize) + 0.5) / texSize;
      coords[i * 2 + 1] = (Math.floor(i / texSize) + 0.5) / texSize;
    }
    geo.setAttribute('aTexCoord', new THREE.InstancedBufferAttribute(coords, 2));
    geo.instanceCount = count;
    baseGeo.dispose();
    return geo;
  }, [texSize, config.gpgpuGeomMode]);

  const geomMat = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      uPosTex:       { value: null },
      uVelTex:       { value: null },
      uColor:        { value: new THREE.Color(config.gpgpuColor) },
      uOpacity:      { value: config.gpgpuOpacity },
      uGeomScale:    { value: config.gpgpuBounceRadius * 0.02 },
      uVelocityAlign:{ value: 0 },
    },
    vertexShader: GEOM_VERT, fragmentShader: GEOM_FRAG,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);

  const geomMeshObj = useMemo(() => {
    if (!instGeo) return null;
    return new THREE.Mesh(instGeo, geomMat);
  }, [instGeo, geomMat]);

  const volumetricGeo = useMemo(() => {
    const N = texSize * texSize;
    const geo = new THREE.InstancedBufferGeometry();
    const base = new THREE.PlaneGeometry(2, 2);
    if (base.index) geo.setIndex(base.index);
    geo.setAttribute('position', base.attributes.position);
    const coords = new Float32Array(N * 2);
    for (let i = 0; i < N; i++) {
      coords[i * 2]     = ((i % texSize) + 0.5) / texSize;
      coords[i * 2 + 1] = (Math.floor(i / texSize) + 0.5) / texSize;
    }
    geo.setAttribute('aTexCoord', new THREE.InstancedBufferAttribute(coords, 2));
    geo.instanceCount = N;
    base.dispose();
    return geo;
   
  }, [texSize]);

  const volumetricMat = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      uPosTex:  { value: null },
      uColor:   { value: new THREE.Color(config.gpgpuVolumetricColor) },
      uRadius:  { value: config.gpgpuVolumetricRadius },
      uDensity: { value: config.gpgpuVolumetricDensity },
      uOpacity: { value: config.gpgpuVolumetricOpacity },
      uSteps:   { value: config.gpgpuVolumetricSteps },
    },
    vertexShader: VOLUMETRIC_VERT, fragmentShader: VOLUMETRIC_FRAG,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);

  const volumetricMeshObj = useMemo(() => {
    const mesh = new THREE.Mesh(volumetricGeo, volumetricMat);
    mesh.frustumCulled = false;
    return mesh;
  }, [volumetricGeo, volumetricMat]);

  // Same disposal contract as useGpgpuTrailAssets: texSize-sized
  // geometries must not outlive the generation that created them.
  useEffect(() => () => {
    instGeo?.dispose();
  }, [instGeo]);
  useEffect(() => () => {
    volumetricGeo.dispose();
  }, [volumetricGeo]);

  return {
    instGeo,
    geomMat,
    geomMeshObj,
    volumetricGeo,
    volumetricMat,
    volumetricMeshObj,
  };
}
