import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { BLIT_FRAG, FLUID_ADVECT_FRAG, SIM_POS_FRAG, SIM_VERT, SIM_VEL_FRAG, SORT_BITONIC_FRAG, SORT_DEPTH_FRAG, buildVelocityFragment } from "./gpgpuShaders";
import { useThree } from "@react-three/fiber";
import { buildCustomForceHarness, compileCheckShader, setCustomForceStatus, validateCustomForceCode } from "../lib/gpgpuCustomForce";
import type { UseGpgpuAssetsArgs } from "./gpgpuAssetShared";

export function useGpgpuSimulationAssets({ config, texSize, simScene, simGeo }: UseGpgpuAssetsArgs) {
  const velSimMat = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      uPosTex:         { value: null },
      uVelTex:         { value: null },
      uDelta:          { value: 0.016 },
      uTime:           { value: 0 },
      uGravity:        { value: config.gpgpuGravity },
      uTurbulence:     { value: config.gpgpuTurbulence },
      uBounceRadius:   { value: config.gpgpuBounceRadius },
      uBounce:         { value: config.gpgpuBounce },
      uAudioBlast:     { value: 0 },
      uNBodyEnabled:   { value: false },
      uNBodyStrength:  { value: 1.0 },
      uNBodySoftening: { value: 2.0 },
      uNBodyRepulsion: { value: 5.0 },
      uNBodySamples:   { value: 16 },
      uTexSizeF:       { value: texSize },
      uCurlEnabled:       { value: false },
      uCurlStrength:      { value: 1.0 },
      uCurlScale:         { value: 0.008 },
      uBoidsEnabled:      { value: false },
      uBoidsSeparation:   { value: 1.0 },
      uBoidsAlignment:    { value: 0.5 },
      uBoidsCohesion:     { value: 0.3 },
      uBoidsRadius:       { value: 30.0 },
      uAttractorEnabled:  { value: false },
      uAttractorType:     { value: 0 },
      uAttractorStrength: { value: 1.0 },
      uAttractorScale:    { value: 8.0 },
      uLevyEnabled:       { value: false },
      uLevyStrength:      { value: 2.0 },
      uLevyRate:          { value: 6.0 },
      uKuramotoEnabled:   { value: false },
      uKuramotoCoupling:  { value: 2.0 },
      uKuramotoSpread:    { value: 1.0 },
      uKuramotoRadius:    { value: 60.0 },
      uParticleLifeEnabled:  { value: false },
      uParticleLifeStrength: { value: 1.0 },
      uParticleLifeRadius:   { value: 60.0 },
      uParticleLifeFriction: { value: 0.85 },
      uParticleLifeSpecies:  { value: 4 },
      uParticleLifeMatrix:   { value: new Float32Array(36) },
      uVortexEnabled:    { value: false },
      uVortexStrength:   { value: 1.0 },
      uVortexTilt:       { value: 0.0 },
      uWindEnabled:      { value: false },
      uWindStrength:     { value: 1.0 },
      uWindX:            { value: 1.0 },
      uWindY:            { value: 0.0 },
      uWindZ:            { value: 0.0 },
      uWindGust:         { value: 0.3 },
      uWellEnabled:      { value: false },
      uWellStrength:     { value: 1.0 },
      uWellSoftening:    { value: 10.0 },
      uWellOrbit:        { value: 0.5 },
      uElasticEnabled:   { value: false },
      uElasticStrength:  { value: 0.5 },
      uMagneticEnabled:  { value: false },
      uMagneticStrength: { value: 1.0 },
      uMagneticBX:       { value: 0.0 },
      uMagneticBY:       { value: 1.0 },
      uMagneticBZ:       { value: 0.0 },
      uSphEnabled:      { value: false },
      uSphPressure:     { value: 3.0 },
      uSphViscosity:    { value: 0.5 },
      uSphRadius:       { value: 40.0 },
      uSphRestDensity:  { value: 2.0 },
      uVFieldEnabled:   { value: false },
      uVFieldType:      { value: 2 },
      uVFieldStrength:  { value: 1.0 },
      uVFieldScale:     { value: 0.005 },
      uSpringEnabled:   { value: false },
      uSpringStrength:  { value: 1.0 },
      uInitPosTex:      { value: null },
      uSdfEnabled:      { value: false },
      uSdfShape:        { value: 0 },
      uSdfX:            { value: 0.0 },
      uSdfY:            { value: 0.0 },
      uSdfZ:            { value: 0.0 },
      uSdfSize:         { value: 80.0 },
      uSdfBounce:       { value: 0.5 },
      uMouseEnabled:    { value: false },
      uMousePos:        { value: new THREE.Vector3(0, 0, 0) },
      uMouseStrength:   { value: 2.0 },
      uMouseRadius:     { value: 150.0 },
      uMouseMode:       { value: 0 },
      uFluidEnabled:    { value: false },
      uFluidTex:        { value: null },
      uFluidInfluence:  { value: 0.8 },
      uFluidScale:      { value: 1.5 },
    },
    vertexShader: SIM_VERT, fragmentShader: SIM_VEL_FRAG,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);

  const posSimMat = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      uPosTex:        { value: null },
      uVelTex:        { value: null },
      uDelta:         { value: 0.016 },
      uSpeed:         { value: config.gpgpuSpeed },
      uBounceRadius:  { value: config.gpgpuBounceRadius },
      uAgeEnabled:    { value: false },
      uAgeMax:        { value: 8.0 },
      uVerletEnabled: { value: false },
      uPrevPosTex:    { value: null },
      uSdfEnabled:    { value: false },
      uSdfShape:      { value: 0 },
      uSdfX:          { value: 0.0 },
      uSdfY:          { value: 0.0 },
      uSdfZ:          { value: 0.0 },
      uSdfSize:       { value: 80.0 },
      uSdfBounce:     { value: 0.5 },
    },
    vertexShader: SIM_VERT, fragmentShader: SIM_POS_FRAG,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);

  const blitMat = useMemo(() => new THREE.ShaderMaterial({
    uniforms: { uTex: { value: null } },
    vertexShader: SIM_VERT, fragmentShader: BLIT_FRAG,
  }), []);

  const sortDepthMat = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      uPosTex:     { value: null },
      uViewMatrix: { value: new THREE.Matrix4() },
    },
    vertexShader: SIM_VERT, fragmentShader: SORT_DEPTH_FRAG,
  }), []);

  const bitonicMat = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      uSortIn:   { value: null },
      uTexSizeF: { value: 64.0 },
      uStep:     { value: 0.0 },
      uStage:    { value: 0.0 },
    },
    vertexShader: SIM_VERT, fragmentShader: SORT_BITONIC_FRAG,
  }), []);

  const fluidAdvectMat = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      uFluidIn:       { value: null },
      uDelta:         { value: 0.016 },
      uFluidDiffuse:  { value: 0.02 },
      uFluidDecay:    { value: 0.01 },
      uFluidStrength: { value: 1.0 },
      uTime:          { value: 0.0 },
      uFluidExtForce: { value: false },
    },
    vertexShader: SIM_VERT, fragmentShader: FLUID_ADVECT_FRAG,
  }), []);

  const simMeshRef = useRef<THREE.Mesh | null>(null);
  useEffect(() => {
    const mesh = new THREE.Mesh(simGeo, velSimMat);
    simScene.add(mesh);
    simMeshRef.current = mesh;
    return () => { simScene.remove(mesh); simMeshRef.current = null; };
  }, [simGeo, velSimMat, simScene]);

  // Custom GLSL force: validate + compile-check the assembled shader
  // against the live GL context, and only then swap it into the velocity
  // material. On any failure the previously working shader stays active
  // and the panel shows the error via the custom-force status store.
  const gl = useThree((state) => state.gl);
  const appliedForceCodeRef = useRef<string | null>(null);
  useEffect(() => {
    const enabled = config.gpgpuCustomForceEnabled;
    const code = enabled ? config.gpgpuCustomForceCode : '';
    if (!code.trim()) {
      if (appliedForceCodeRef.current !== null) {
        velSimMat.fragmentShader = SIM_VEL_FRAG;
        velSimMat.needsUpdate = true;
        appliedForceCodeRef.current = null;
      }
      setCustomForceStatus({ state: 'inactive' });
      return;
    }
    if (appliedForceCodeRef.current === code) return;
    const validation = validateCustomForceCode(code);
    if (!validation.ok) {
      setCustomForceStatus({ state: 'error', message: validation.error ?? 'invalid code' });
      return;
    }
    const built = buildVelocityFragment(code);
    const check = compileCheckShader(gl.getContext() as WebGL2RenderingContext, SIM_VERT, buildCustomForceHarness(code));
    if (!check.ok) {
      setCustomForceStatus({ state: 'error', message: check.error ?? 'compile failed' });
      return;
    }
    velSimMat.fragmentShader = built;
    velSimMat.needsUpdate = true;
    appliedForceCodeRef.current = code;
    setCustomForceStatus({ state: 'active' });
  }, [config.gpgpuCustomForceEnabled, config.gpgpuCustomForceCode, gl, velSimMat]);

  return {
    simMeshRef,
    velSimMat,
    posSimMat,
    blitMat,
    sortDepthMat,
    bitonicMat,
    fluidAdvectMat,
  };
}
