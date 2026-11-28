import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useThree } from "@react-three/fiber";
import type { ParticleConfig } from "../types";
import { buildGeomFrag, buildGeomVert, buildVolumetricFrag, buildVolumetricVert } from "./gpgpuShaders";
import { ageFreeRotationVariantOn, orientChannelVariantOn, shadowMapVariantOn, spinChannelVariantOn, vellumCrackVariantOn } from "./useGpgpuDrawAssets";
import { buildObjGeomBaseData } from "../lib/objMesh";
import { SHADOW_CASTER_GEOM_USERDATA } from "../lib/lightShadowMap";
import { compileCheckShader } from "../lib/glslInjection";
import {
  GEOM_CUSTOM_CHECK_FRAGMENT,
  GEOM_CUSTOM_CHECK_VERTEX,
  buildGeomCustomFragmentHarness,
  buildGeomCustomVertexHarness,
  resolveGeomCustomFragmentSnippet,
  resolveGeomCustomVertexSnippet,
  setGeomCustomFragmentGlslStatus,
  setGeomCustomVertexGlslStatus,
  validateGeomCustomFragmentGlslCode,
  validateGeomCustomVertexGlslCode,
} from "../lib/geomCustomGlsl";
import { resolveGlslSharedSnippetDefs } from "../lib/glslSharedSnippets";
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

/** Resolved OBJ source of species zone k (0-based), the source
 *  twin of resolveSpeciesGeomMode (limit plan stage 4, slice
 *  S1): zone 0 always reads the single gpgpuMorphObjSource;
 *  zones 1..3 read their per-zone gpgpuGeomSpecies{2,3,4}ObjSource
 *  and fall back to gpgpuMorphObjSource while that key is empty
 *  (a whitespace-only document carries no model — the same
 *  emptiness buildObjGeomBaseData itself applies — so it falls
 *  back too). At the defaults (all three keys '') every zone
 *  resolves to exactly the legacy single source, so the built
 *  base geometry is byte-identical to before this slice. Only
 *  consulted when the zone's resolved mode is 'obj'. */
export function resolveSpeciesObjSource(config: ParticleConfig, zone: number): string {
  if (zone === 1) return config.gpgpuGeomSpecies2ObjSource.trim() !== '' ? config.gpgpuGeomSpecies2ObjSource : config.gpgpuMorphObjSource;
  if (zone === 2) return config.gpgpuGeomSpecies3ObjSource.trim() !== '' ? config.gpgpuGeomSpecies3ObjSource : config.gpgpuMorphObjSource;
  if (zone === 3) return config.gpgpuGeomSpecies4ObjSource.trim() !== '' ? config.gpgpuGeomSpecies4ObjSource : config.gpgpuMorphObjSource;
  return config.gpgpuMorphObjSource;
}

export function useGpgpuMeshAssets(config: ParticleConfig, texSize: number) {
  // ── GEOM custom GLSL (Phase 16 stage 4): validate → harness
  // compile check against the live GL context → swap the built
  // shader strings. On any failure the previously working shader
  // stays active and the error is reported through the point's
  // status store (the shared injection fallback rule). Disabled /
  // empty keeps the stock strings, byte-identical.
  const gl = useThree((state) => state.gl);
  // Phase 19 gate fix: the GEOM string variants (Vellum crack,
  // and Phase 24's shadow-map receiving) ride the same swap
  // path as the custom GLSL — the applied ref tracks code +
  // variants, the initial state already carries the initial
  // config's variants, and an empty snippet resolves to the
  // variant base string (default = v2.00 GEOM_VERT).
  const [geomVertShader, setGeomVertShader] = useState(() => buildGeomVert('', { vellumCrack: vellumCrackVariantOn(config), shadowMap: shadowMapVariantOn(config), spinChannel: spinChannelVariantOn(config), orientChannel: orientChannelVariantOn(config), ageFreeRotation: ageFreeRotationVariantOn(config) }));
  const [geomFragShader, setGeomFragShader] = useState(() => buildGeomFrag('', { vellumCrack: vellumCrackVariantOn(config), shadowMap: shadowMapVariantOn(config) }));
  const appliedGeomVertCodeRef = useRef<string | null>(null);
  const appliedGeomFragCodeRef = useRef<string | null>(null);
  useEffect(() => {
    const rawCode = config.gpgpuGeomCustomVertexEnabled ? config.gpgpuGeomCustomVertexCode : '';
    // Layer 1 WP11 phase C: shared snippet definitions resolve
    // before this point's validation / compile check; without
    // authored definitions or directives the resolution is the
    // identical string (byte-identical shaders).
    const resolution = resolveGeomCustomVertexSnippet(rawCode, resolveGlslSharedSnippetDefs(config.glslSharedSnippets));
    if (!resolution.ok) {
      setGeomCustomVertexGlslStatus({ state: 'error', message: resolution.error ?? 'invalid code' });
      return;
    }
    const code = resolution.code as string;
    const crack = vellumCrackVariantOn(config);
    const smap = shadowMapVariantOn(config);
    const spin = spinChannelVariantOn(config);
    const orient = orientChannelVariantOn(config);
    const ageFreeRotation = ageFreeRotationVariantOn(config);
    const appliedKey = `${code}\n${crack ? 1 : 0}\n${smap ? 1 : 0}\n${spin ? 1 : 0}\n${orient ? 1 : 0}\n${ageFreeRotation ? 1 : 0}`;
    if (!code.trim()) {
      if (appliedGeomVertCodeRef.current !== appliedKey) {
        setGeomVertShader(buildGeomVert('', { vellumCrack: crack, shadowMap: smap, spinChannel: spin, orientChannel: orient, ageFreeRotation }));
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
    setGeomVertShader(buildGeomVert(code, { vellumCrack: crack, shadowMap: smap, spinChannel: spin, orientChannel: orient, ageFreeRotation }));
    appliedGeomVertCodeRef.current = appliedKey;
    setGeomCustomVertexGlslStatus({ state: 'active' });
  }, [config.gpgpuGeomCustomVertexEnabled, config.gpgpuGeomCustomVertexCode, config.glslSharedSnippets, config.gpgpuVellumEnabled, config.gpgpuVellumTearGap, config.gpgpuVellumTear, config.gpgpuShadowMapStrength, config.gpgpuSpinEnabled, config.gpgpuOrientEnabled, config.gpgpuAgeCurveRotationEnabled, config.gpgpuAgeCurveRotationFreeEnabled, gl]);
  useEffect(() => {
    const rawCode = config.gpgpuGeomCustomFragmentEnabled ? config.gpgpuGeomCustomFragmentCode : '';
    // Layer 1 WP11 phase C: shared snippet definitions resolve
    // before this point's validation / compile check; without
    // authored definitions or directives the resolution is the
    // identical string (byte-identical shaders).
    const resolution = resolveGeomCustomFragmentSnippet(rawCode, resolveGlslSharedSnippetDefs(config.glslSharedSnippets));
    if (!resolution.ok) {
      setGeomCustomFragmentGlslStatus({ state: 'error', message: resolution.error ?? 'invalid code' });
      return;
    }
    const code = resolution.code as string;
    const crack = vellumCrackVariantOn(config);
    const smap = shadowMapVariantOn(config);
    const appliedKey = `${code}\n${crack ? 1 : 0}\n${smap ? 1 : 0}`;
    if (!code.trim()) {
      if (appliedGeomFragCodeRef.current !== appliedKey) {
        setGeomFragShader(buildGeomFrag('', { vellumCrack: crack, shadowMap: smap }));
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
    setGeomFragShader(buildGeomFrag(code, { vellumCrack: crack, shadowMap: smap }));
    appliedGeomFragCodeRef.current = appliedKey;
    setGeomCustomFragmentGlslStatus({ state: 'active' });
  }, [config.gpgpuGeomCustomFragmentEnabled, config.gpgpuGeomCustomFragmentCode, config.glslSharedSnippets, config.gpgpuVellumEnabled, config.gpgpuVellumTearGap, config.gpgpuVellumTear, config.gpgpuShadowMapStrength, gl]);

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
      // Spin channel (Grammar 2.0 stage 2, B3): declared in
      // the shader only in the spin variant string; the entry
      // is inert otherwise. syncVisualUniforms binds the spin
      // pass's latest texture per frame.
      uSpinTex:      { value: null },
      // Orientation channel (Limit plan stage 4, S2): same
      // arrangement — declared in the shader only in the
      // orient variant string; inert otherwise.
      // syncVisualUniforms binds the orient pass's texture.
      uOrientTex:    { value: null },
      // Rotation over Lifetime (Phase AC): legacy neutrals.
      uAgeEnabled:   { value: false },
      uAgeMax:       { value: 6 },
      uAgeCurveRotationEnabled: { value: false },
      uAgeCurveRotation: { value: [1, 1, 1, 1, 1] },
      // Age free curve (Grammar 2.0 stage 2, B4): declared in
      // the shader only in the age-free variant string; the
      // entries hold the padded identity asset otherwise.
      uAgeCurveRotationFreeT: { value: [0, 1, 1, 1, 1, 1, 1, 1] },
      uAgeCurveRotationFreeV: { value: [1, 1, 1, 1, 1, 1, 1, 1] },
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
      // True shadow map (Phase 24, wiring stage 3): same names
      // and inert defaults as the points draw (Phase 23 stage
      // 2) — texture null, ready 0, bias 0.001 / softness 1
      // mirroring the key defaults. These uniforms exist on
      // the material from creation so the per-frame sync never
      // has to add them; the shader variant that declares
      // them is only assembled while gpgpuShadowMapStrength
      // > 0 (the string swap above rebuilds this material,
      // and the sync re-supplies every value after a rebuild).
      uShadowMapTex:      { value: null },
      uLightViewProj:     { value: new THREE.Matrix4() },
      uShadowMapBias:     { value: 0.001 },
      uShadowMapSoftness: { value: 1 },
      uShadowMapReady:    { value: 0 },
      uShadowMapStrength: { value: 0 },
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
    const mesh = new THREE.Mesh(instGeo, geomMat);
    // Particle self-shadow (limit plan stage 4, S4): mark the
    // mesh as a shadow caster candidate. The mark is inert —
    // LightShadowCapture reads it only while
    // gpgpuShadowMapCastParticles is on; at the default the
    // capture never looks at userData.
    mesh.userData[SHADOW_CASTER_GEOM_USERDATA] = true;
    return mesh;
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
      const baseGeo = buildGeomBaseGeometry(mode as GeomBaseMode, resolveSpeciesObjSource(config, k));
      fillInstancedFromBase(geo, baseGeo, coords);
      baseGeo.dispose();
      geos.push(geo);
      keptTotals.push(list.length);
      const mesh = new THREE.Mesh(geo, geomMat);
      mesh.frustumCulled = false;
      // Shadow caster candidate mark (stage 4, S4) — see the
      // single-mesh path above; inert at the default.
      mesh.userData[SHADOW_CASTER_GEOM_USERDATA] = true;
      meshes.push(mesh);
    }
    if (meshes.length === 0) return null;
    return { geos, meshes, totals: keptTotals };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bakedSpecies, texSize, config.gpgpuGeomMode, config.gpgpuMorphTarget, config.gpgpuMorphScatterEnabled, config.gpgpuGeomSpecies2Mode, config.gpgpuGeomSpecies3Mode, config.gpgpuGeomSpecies4Mode, config.gpgpuGeomSpecies2ObjSource, config.gpgpuGeomSpecies3ObjSource, config.gpgpuGeomSpecies4ObjSource, config.gpgpuMorphObjSource, geomMat]);

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
      // True shadow map (Phase 30 stage 3): entries always exist
      // (the stock shaders declare none of them); synced from
      // the shared store with guarded writes, strings swapped
      // when the strength's sign flips — the receivers' contract.
      uShadowMapTex: { value: null },
      uLightViewProj: { value: new THREE.Matrix4() },
      uShadowMapBias: { value: 0.001 },
      uShadowMapSoftness: { value: 1 },
      uShadowMapReady: { value: 0 },
      uShadowMapStrength: { value: 0 },
    },
    vertexShader: buildVolumetricVert({ shadowMap: shadowMapVariantOn(config) }), fragmentShader: buildVolumetricFrag({ shadowMap: shadowMapVariantOn(config) }),
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);

  // Phase 30 stage 3: swap the volumetric strings when the
  // shadow-map variant condition flips (creation already used
  // the initial config's variant).
  const volumetricVariantRef = useRef({ shadowMap: shadowMapVariantOn(config) });
  useEffect(() => {
    const shadowMap = shadowMapVariantOn(config);
    if (volumetricVariantRef.current.shadowMap === shadowMap) return;
    volumetricVariantRef.current = { shadowMap };
    volumetricMat.vertexShader = buildVolumetricVert({ shadowMap });
    volumetricMat.fragmentShader = buildVolumetricFrag({ shadowMap });
    volumetricMat.needsUpdate = true;
  }, [config.gpgpuShadowMapStrength, volumetricMat]);

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
