import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useThree } from "@react-three/fiber";
import type { ParticleConfig } from "../types";
import { VOLUMETRIC_FRAG, VOLUMETRIC_VERT, buildGeomFrag, buildGeomVert } from "./gpgpuShaders";
import { vellumCrackVariantOn } from "./useGpgpuDrawAssets";
import { buildObjGeomBaseData } from "../lib/objMesh";
import { compileCheckShader } from "../lib/glslInjection";
import {
  GEOM_CUSTOM_CHECK_FRAGMENT,
  GEOM_CUSTOM_CHECK_VERTEX,
  buildGeomCustomFragmentHarness,
  buildGeomCustomVertexHarness,
  setGeomCustomFragmentGlslStatus,
  setGeomCustomVertexGlslStatus,
  validateGeomCustomFragmentGlslCode,
  validateGeomCustomVertexGlslCode,
} from "../lib/geomCustomGlsl";
import { useBakedSpeciesData } from "../lib/speciesAllocation";

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

type GeomBaseMode = 'cube' | 'tetra' | 'octa' | 'icosa' | 'torus' | 'cone' | 'obj';

function buildGeomBaseGeometry(mode: GeomBaseMode, objSource: string): THREE.BufferGeometry {
  if      (mode === 'cube')  return new THREE.BoxGeometry(1, 1, 1);
  else if (mode === 'tetra') return new THREE.TetrahedronGeometry(0.8);
  else if (mode === 'icosa') return new THREE.IcosahedronGeometry(0.82);
  else if (mode === 'torus') return new THREE.TorusGeometry(0.68, 0.27, 10, 20);
  else if (mode === 'cone')  return new THREE.ConeGeometry(0.6, 1.05, 20);
  else if (mode === 'obj')   return buildObjParticleBaseGeometry(objSource);
  else                       return new THREE.OctahedronGeometry(0.7);
}

function fillInstancedFromBase(geo: THREE.InstancedBufferGeometry, baseGeo: THREE.BufferGeometry, texCoords: Float32Array): void {
  if (baseGeo.index) geo.setIndex(baseGeo.index);
  geo.setAttribute('position', baseGeo.attributes.position);
  if (baseGeo.attributes.normal) geo.setAttribute('normal', baseGeo.attributes.normal);
  geo.setAttribute('aTexCoord', new THREE.InstancedBufferAttribute(texCoords, 2));
  geo.instanceCount = texCoords.length / 2;
}

/** Resolved geometry mode of species zone k (0-based): zone 0 is
 *  always gpgpuGeomMode; zones 1..3 read the species keys, whose
 *  'follow' value resolves back to gpgpuGeomMode. */
export function resolveSpeciesGeomMode(config: ParticleConfig, zone: number): string {
  if (zone === 1) return config.gpgpuGeomSpecies2Mode === 'follow' ? config.gpgpuGeomMode : config.gpgpuGeomSpecies2Mode;
  if (zone === 2) return config.gpgpuGeomSpecies3Mode === 'follow' ? config.gpgpuGeomMode : config.gpgpuGeomSpecies3Mode;
  if (zone === 3) return config.gpgpuGeomSpecies4Mode === 'follow' ? config.gpgpuGeomMode : config.gpgpuGeomSpecies4Mode;
  return config.gpgpuGeomMode;
}

export function useGpgpuMeshAssets(config: ParticleConfig, texSize: number) {
  // ── GEOM custom GLSL (Phase 16 stage 4): validate → harness
  // compile check against the live GL context → swap the built
  // shader strings. On any failure the previously working shader
  // stays active and the error is reported through the point's
  // status store (the shared injection fallback rule). Disabled /
  // empty keeps the stock strings, byte-identical.
  const gl = useThree((state) => state.gl);
  // Phase 19 gate fix: the GEOM string variant (Vellum crack)
  // rides the same swap path as the custom GLSL — the applied
  // ref tracks code + variant, the initial state already carries
  // the initial config's variant, and an empty snippet resolves
  // to the variant base string (default = v2.00 GEOM_VERT).
  const [geomVertShader, setGeomVertShader] = useState(() => buildGeomVert('', { vellumCrack: vellumCrackVariantOn(config) }));
  const [geomFragShader, setGeomFragShader] = useState(() => buildGeomFrag('', { vellumCrack: vellumCrackVariantOn(config) }));
  const appliedGeomVertCodeRef = useRef<string | null>(null);
  const appliedGeomFragCodeRef = useRef<string | null>(null);
  useEffect(() => {
    const code = config.gpgpuGeomCustomVertexEnabled ? config.gpgpuGeomCustomVertexCode : '';
    const crack = vellumCrackVariantOn(config);
    const appliedKey = `${code}\n${crack ? 1 : 0}`;
    if (!code.trim()) {
      if (appliedGeomVertCodeRef.current !== appliedKey) {
        setGeomVertShader(buildGeomVert('', { vellumCrack: crack }));
        appliedGeomVertCodeRef.current = appliedKey;
      }
      setGeomCustomVertexGlslStatus({ state: 'inactive' });
      return;
    }
    if (appliedGeomVertCodeRef.current === appliedKey) return;
    const validation = validateGeomCustomVertexGlslCode(code);
    if (!validation.ok) {
      setGeomCustomVertexGlslStatus({ state: 'error', message: validation.error ?? 'invalid code' });
      return;
    }
    const check = compileCheckShader(
      gl.getContext() as WebGL2RenderingContext,
      buildGeomCustomVertexHarness(code),
      GEOM_CUSTOM_CHECK_FRAGMENT,
    );
    if (!check.ok) {
      setGeomCustomVertexGlslStatus({ state: 'error', message: check.error ?? 'compile failed' });
      return;
    }
    setGeomVertShader(buildGeomVert(code, { vellumCrack: crack }));
    appliedGeomVertCodeRef.current = appliedKey;
    setGeomCustomVertexGlslStatus({ state: 'active' });
  }, [config.gpgpuGeomCustomVertexEnabled, config.gpgpuGeomCustomVertexCode, config.gpgpuVellumEnabled, config.gpgpuVellumTearGap, config.gpgpuVellumTear, gl]);
  useEffect(() => {
    const code = config.gpgpuGeomCustomFragmentEnabled ? config.gpgpuGeomCustomFragmentCode : '';
    const crack = vellumCrackVariantOn(config);
    const appliedKey = `${code}\n${crack ? 1 : 0}`;
    if (!code.trim()) {
      if (appliedGeomFragCodeRef.current !== appliedKey) {
        setGeomFragShader(buildGeomFrag('', { vellumCrack: crack }));
        appliedGeomFragCodeRef.current = appliedKey;
      }
      setGeomCustomFragmentGlslStatus({ state: 'inactive' });
      return;
    }
    if (appliedGeomFragCodeRef.current === appliedKey) return;
    const validation = validateGeomCustomFragmentGlslCode(code);
    if (!validation.ok) {
      setGeomCustomFragmentGlslStatus({ state: 'error', message: validation.error ?? 'invalid code' });
      return;
    }
    const check = compileCheckShader(
      gl.getContext() as WebGL2RenderingContext,
      GEOM_CUSTOM_CHECK_VERTEX,
      buildGeomCustomFragmentHarness(code),
    );
    if (!check.ok) {
      setGeomCustomFragmentGlslStatus({ state: 'error', message: check.error ?? 'compile failed' });
      return;
    }
    setGeomFragShader(buildGeomFrag(code, { vellumCrack: crack }));
    appliedGeomFragCodeRef.current = appliedKey;
    setGeomCustomFragmentGlslStatus({ state: 'active' });
  }, [config.gpgpuGeomCustomFragmentEnabled, config.gpgpuGeomCustomFragmentCode, config.gpgpuVellumEnabled, config.gpgpuVellumTearGap, config.gpgpuVellumTear, gl]);

  const instGeo = useMemo(() => {
    if (config.gpgpuGeomMode === 'point') return null;
    const count = texSize * texSize;
    const geo = new THREE.InstancedBufferGeometry();
    const baseGeo = buildGeomBaseGeometry(config.gpgpuGeomMode as GeomBaseMode, config.gpgpuMorphObjSource);
    const coords = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      coords[i * 2]     = ((i % texSize) + 0.5) / texSize;
      coords[i * 2 + 1] = (Math.floor(i / texSize) + 0.5) / texSize;
    }
    fillInstancedFromBase(geo, baseGeo, coords);
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
      // PBR grammar (Phase 16 stage 2): legacy-neutral defaults.
      uMetalness:    { value: 0 },
      uRoughness:    { value: 1 },
      // Density compensation (Phase DN): same inert defaults as
      // the points draw; the per-frame sync supplies real values.
      uDensityCompEnabled: { value: false },
      uDensityTarget:      { value: 0.5 },
      uDensityCount:       { value: texSize * texSize },
      uViewportSizePx:     { value: new THREE.Vector2(1, 1) },
      uRingOffsetZ:        { value: 0 },
      // Vellum crack (Phase 19 stage 3): inert defaults; the
      // per-frame sync supplies the state texture when on.
      uVellumCrackEnabled: { value: false },
      uVellumStateTex:     { value: null },
      uVellumMode:         { value: 0 },
      uTexSizeF:           { value: texSize },
    },
    vertexShader: geomVertShader, fragmentShader: geomFragShader,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  // Rebuilt only when a custom GLSL swap changes a shader string
  // (Phase 16 stage 4); the per-frame uniform sync re-supplies
  // every value after a rebuild.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [geomVertShader, geomFragShader]);

  const geomMeshObj = useMemo(() => {
    if (!instGeo) return null;
    return new THREE.Mesh(instGeo, geomMat);
  }, [instGeo, geomMat]);

  // ── Foliage split (Phase 16 stage 5): one InstancedBufferGeometry
  // + Mesh per species zone, sharing geomMat, built ONLY when the
  // bake published a species channel for this pool size with >= 2
  // species and at least one texel above zone 0. Every other state
  // (species 1, scatter off, non-terrain target, point mode, bake
  // not yet published) leaves speciesMeshes null and the legacy
  // single-mesh path untouched.
  const bakedSpecies = useBakedSpeciesData();
  const speciesSplit = useMemo(() => {
    if (config.gpgpuGeomMode === 'point') return null;
    if (config.gpgpuMorphTarget !== 'terrain' || !config.gpgpuMorphScatterEnabled) return null;
    if (!bakedSpecies || bakedSpecies.texSize !== texSize || bakedSpecies.species < 2) return null;
    const speciesData = bakedSpecies.data;
    if (speciesData.length !== texSize * texSize) return null;
    const species = bakedSpecies.species;
    const totals = new Array<number>(species).fill(0);
    let hasSplit = false;
    for (let i = 0; i < speciesData.length; i++) {
      const z = Math.min(species - 1, speciesData[i]);
      totals[z] += 1;
      if (z > 0) hasSplit = true;
    }
    if (!hasSplit) return null;
    // Texel indices per zone, in texel order (the subset concept
    // the premise audit found missing).
    const indices: number[][] = Array.from({ length: species }, () => []);
    for (let i = 0; i < speciesData.length; i++) {
      indices[Math.min(species - 1, speciesData[i])].push(i);
    }
    const geos: THREE.InstancedBufferGeometry[] = [];
    const meshes: THREE.Mesh[] = [];
    const keptTotals: number[] = [];
    for (let k = 0; k < species; k++) {
      const mode = resolveSpeciesGeomMode(config, k);
      if (mode === 'point') continue;
      const list = indices[k];
      const coords = new Float32Array(list.length * 2);
      for (let j = 0; j < list.length; j++) {
        const i = list[j];
        coords[j * 2] = ((i % texSize) + 0.5) / texSize;
        coords[j * 2 + 1] = (Math.floor(i / texSize) + 0.5) / texSize;
      }
      const geo = new THREE.InstancedBufferGeometry();
      const baseGeo = buildGeomBaseGeometry(mode as GeomBaseMode, config.gpgpuMorphObjSource);
      fillInstancedFromBase(geo, baseGeo, coords);
      baseGeo.dispose();
      geos.push(geo);
      keptTotals.push(list.length);
      const mesh = new THREE.Mesh(geo, geomMat);
      mesh.frustumCulled = false;
      meshes.push(mesh);
    }
    if (meshes.length === 0) return null;
    return { geos, meshes, totals: keptTotals };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bakedSpecies, texSize, config.gpgpuGeomMode, config.gpgpuMorphTarget, config.gpgpuMorphScatterEnabled, config.gpgpuGeomSpecies2Mode, config.gpgpuGeomSpecies3Mode, config.gpgpuGeomSpecies4Mode, config.gpgpuMorphObjSource, geomMat]);

  useEffect(() => () => {
    speciesSplit?.geos.forEach((g) => g.dispose());
  }, [speciesSplit]);

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
      uRingOffsetZ: { value: 0 },
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
    // Foliage split (Phase 16 stage 5): null unless the split is
    // active; consumers fall back to instGeo / geomMeshObj.
    speciesGeos: speciesSplit ? speciesSplit.geos : null,
    speciesMeshes: speciesSplit ? speciesSplit.meshes : null,
    speciesTotals: speciesSplit ? speciesSplit.totals : null,
    volumetricGeo,
    volumetricMat,
    volumetricMeshObj,
  };
}
