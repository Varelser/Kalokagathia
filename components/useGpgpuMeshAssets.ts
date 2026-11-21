import { useEffect, useMemo } from "react";
import * as THREE from "three";
import type { ParticleConfig } from "../types";
import { GEOM_FRAG, GEOM_VERT, VOLUMETRIC_FRAG, VOLUMETRIC_VERT } from "./gpgpuShaders";
import { buildObjGeomBaseData } from "../lib/objMesh";

/**
 * Base geometry for the 'obj' particle geometry mode (Phase AO):
 * the imported OBJ (gpgpuMorphObjSource, the same document the
 * morph sampler and the mesh display read) as the per-particle
 * shape. Empty / unparseable / over-budget sources fall back to
 * the octahedron base — the panel note states the fallback and
 * the reason instead of switching silently.
 */
function buildObjParticleBaseGeometry(source: string): THREE.BufferGeometry {
  const data = buildObjGeomBaseData(source);
  if (!data) return new THREE.OctahedronGeometry(0.7);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
  geo.setIndex(new THREE.BufferAttribute(data.indices, 1));
  return geo;
}

export function useGpgpuMeshAssets(config: ParticleConfig, texSize: number) {
  const instGeo = useMemo(() => {
    if (config.gpgpuGeomMode === 'point') return null;
    const count = texSize * texSize;
    const geo = new THREE.InstancedBufferGeometry();
    let baseGeo: THREE.BufferGeometry;
    if      (config.gpgpuGeomMode === 'cube')  baseGeo = new THREE.BoxGeometry(1, 1, 1);
    else if (config.gpgpuGeomMode === 'tetra') baseGeo = new THREE.TetrahedronGeometry(0.8);
    else if (config.gpgpuGeomMode === 'icosa') baseGeo = new THREE.IcosahedronGeometry(0.82);
    else if (config.gpgpuGeomMode === 'torus') baseGeo = new THREE.TorusGeometry(0.68, 0.27, 10, 20);
    else if (config.gpgpuGeomMode === 'cone')  baseGeo = new THREE.ConeGeometry(0.6, 1.05, 20);
    else if (config.gpgpuGeomMode === 'obj')   baseGeo = buildObjParticleBaseGeometry(config.gpgpuMorphObjSource);
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
  }, [texSize, config.gpgpuGeomMode, config.gpgpuMorphObjSource]);

  const geomMat = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      uPosTex:       { value: null },
      uVelTex:       { value: null },
      uColor:        { value: new THREE.Color(config.gpgpuColor) },
      uOpacity:      { value: config.gpgpuOpacity },
      uGeomScale:    { value: config.gpgpuBounceRadius * 0.02 },
      uVelocityAlign:{ value: 0 },
      uTime:         { value: 0 },
      uSpinSpeed:    { value: 0 },
      uSpinRandom:   { value: 0 },
      // Rotation over Lifetime (Phase AC): legacy neutrals.
      uAgeEnabled:   { value: false },
      uAgeMax:       { value: 6 },
      uAgeCurveRotationEnabled: { value: false },
      uAgeCurveRotation: { value: [1, 1, 1, 1, 1] },
      uMeshStretch:  { value: 0 },
      uEnvReflect:   { value: 0 },
      // Image-based lighting (Phase AL): no map bound and zero
      // intensity while off, so the fragment branch never runs.
      uIblMap:       { value: null },
      uIblIntensity: { value: 0 },
      uIblYaw:       { value: 0 },
      // Density compensation (Phase DN): same inert defaults as
      // the points draw; the per-frame sync supplies real values.
      uDensityCompEnabled: { value: false },
      uDensityTarget:      { value: 0.5 },
      uDensityCount:       { value: texSize * texSize },
      uViewportSizePx:     { value: new THREE.Vector2(1, 1) },
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
      // Fog self-shadow (Phase Z): strength 0 = legacy identity.
      uFogSelfShadow:  { value: 0 },
      uFogShadowSteps: { value: 4 },
      uLightPos:       { value: new THREE.Vector3(0, 0, 0) },
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
