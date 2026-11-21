import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { BLIT_FRAG, FLIP_CLEAR_FRAG, FLIP_COMPOSITE_FRAG, FLIP_JACOBI_FRAG, FLIP_SPLAT_FRAG, FLIP_SPLAT_VERT, FLIP_SUBTRACT_FRAG, FLIP_VORTICITY_CURL_FRAG, FLIP_VORTICITY_FORCE_FRAG, FLUID_ADVECT_FRAG, SIM_POS_FRAG, SIM_VERT, SIM_VEL_FRAG, SORT_BITONIC_FRAG, SORT_DEPTH_FRAG, buildVelocityFragment } from "./gpgpuShaders";
import { SIM_VELLUM_PROJ_FRAG, SIM_VELLUM_STATE_FRAG, SIM_VELLUM_VEL_FRAG } from "./gpgpuShaderSimulationVellum";
import { AUX_CHAIN_POS_FRAG, AUX_CHAIN_VEL_FRAG, AUX_POS_FRAG, AUX_VEL_FRAG } from "./gpgpuShaderAux";
import { WW_POS_FRAG, WW_VEL_FRAG } from "./gpgpuShaderWhitewater";
import {
  PYRO_GRID_ADVECT_SCALAR_FRAG,
  PYRO_GRID_ADVECT_VEL_FRAG,
  PYRO_GRID_CURL_FRAG,
  PYRO_GRID_DIVERGENCE_FRAG,
  PYRO_GRID_FORCES_VEL_FRAG,
  PYRO_GRID_JACOBI_FRAG,
  PYRO_GRID_SCALAR_UPDATE_FRAG,
  PYRO_GRID_SUBTRACT_FRAG,
  PYRO_GRID_VORTICITY_FORCE_FRAG,
} from "./gpgpuShaderPyroGrid";
import { useThree } from "@react-three/fiber";
import { buildCustomForceHarness, compileCheckShader, setCustomForceStatus, validateCustomForceCode } from "../lib/gpgpuCustomForce";
import type { UseGpgpuAssetsArgs } from "./gpgpuAssetShared";
import type { ParticleConfig } from "../types";

// Material factories (Phase W2): the per-replica simulation
// stacks need their own velocity/position materials with exactly
// the same shader + uniform structure as the shared pair; the
// runtime creates them through these factories (the shared pair
// below is built the same way). Note the factories always start
// from the base SIM_VEL_FRAG — a user custom force swapped into
// the shared material at runtime is not mirrored into stacks
// (documented Phase W2 limitation).
export function createVelSimMaterial(texSize: number, config: ParticleConfig): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
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
      uCurlSymmetry:      { value: 0 },
      uCurlMode:          { value: 0 },
      uCurlOctaves:       { value: 1 },
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
      uParticleLifePursue:   { value: 0 },
      uParticleLifeEvade:    { value: 0 },
      uParticleLifeVisionRange: { value: 120 },
      uParticleLifeVisionAngle: { value: 360 },
      uParticleLifeMaxSpeed: { value: 0 },
      uParticleLifeMeanderAmount: { value: 0 },
      uParticleLifeMeanderScale:  { value: 1 },
      uParticleLifeAvoid:         { value: 0 },
      // Lifecycle grammar (Phase AB): gate off / legacy drag at
      // the defaults; the passes fill them from config per frame.
      uSpawnRate:   { value: 1.0 },
      uSpawnBurst:  { value: 1.0 },
      uSpawnTime:   { value: 0 },
      uSpawnPulseInterval: { value: 0 },
      uSpawnPulseDuty:     { value: 0.3 },
      // Phase AX: cycles 0 / probability 1 = legacy pulse;
      // order mode 0 = legacy hash; event disabled.
      uSpawnPulseCycles:      { value: 0 },
      uSpawnPulseProbability: { value: 1 },
      uSpawnOrderTex:  { value: null },
      uSpawnOrderMode: { value: 0 },
      uSpawnEventEnabled: { value: false },
      uSpawnEventTime:    { value: 0 },
      uSpawnEventCount:   { value: 0 },
      uSpawnEventSpeed:   { value: 0 },
      uSpawnEventSpread:  { value: 0 },
      uDragRate:    { value: 1.1 },
      uMaxSpeed:    { value: 0 },
      uVortexEnabled:    { value: false },
      uVortexStrength:   { value: 1.0 },
      uVortexTilt:       { value: 0.0 },
      uWindEnabled:      { value: false },
      uWindStrength:     { value: 1.0 },
      uWindX:            { value: 1.0 },
      uWindY:            { value: 0.0 },
      uWindZ:            { value: 0.0 },
      uWindGust:         { value: 0.3 },
      // Wind volume (Phase AL): disabled is the legacy path.
      uWindVolumeEnabled:  { value: false },
      uWindVolumePos:      { value: new THREE.Vector3(0, 0, 0) },
      uWindVolumeRadius:   { value: 60.0 },
      uWindVolumeStrength: { value: 1.0 },
      // Terrain slope flow (Phase AE): disabled + no texture is
      // the exact legacy path.
      uSlopeForceEnabled:  { value: false },
      uSlopeForceStrength: { value: 1.0 },
      uSlopeTex:           { value: null },
      uSlopeExtent:        { value: 1.0 },
      // Terrain collider (Phase AI): disabled + no texture is
      // the exact legacy path.
      uTerrainColliderEnabled: { value: false },
      uTerrainColliderTex:     { value: null },
      uTerrainExtent:          { value: 1.0 },
      uTerrainHeightWorld:     { value: 0.0 },
      uTerrainGradScale:       { value: 0.0 },
      uTerrainTexSize:         { value: 129.0 },
      uTerrainBounce:          { value: 0.5 },
      uTerrainFriction:        { value: 0.25 },
      // Named attributes + group gate (Phase AK): no texture and
      // every switch off is the exact legacy path.
      uAttrTex:           { value: null },
      uAttrEnabled:       { value: false },
      uAttrForceEnabled:  { value: false },
      uAttrForceSlot:     { value: -1 },
      uAttrForceAmount:   { value: 1.0 },
      uGroupEnabled:      { value: false },
      uGroupSlot:         { value: 0 },
      uGroupMode:         { value: 1 },
      uGroupLow:          { value: 0.25 },
      uGroupHigh:         { value: 0.75 },
      uGroupTarget:       { value: 0 },
      uGroupInvert:       { value: false },
      uWellEnabled:      { value: false },
      uWellStrength:     { value: 1.0 },
      uWellSoftening:    { value: 10.0 },
      uWellOrbit:        { value: 0.5 },
      uWellCount:        { value: 1 },
      uWellSpread:       { value: 70.0 },
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
      uSphSurfaceTension: { value: 0 },
      // Grains (Phase AQ): disabled is the exact legacy path.
      uGrainsEnabled:     { value: false },
      uGrainsSize:        { value: 8.0 },
      uGrainsStiffness:   { value: 2.0 },
      uGrainsFriction:    { value: 0.6 },
      uGrainsCohesion:    { value: 0 },
      uGrainsRestitution: { value: 0 },
      uGrainsRestDamping: { value: 0.5 },
      // Vellum (Phase AR): disabled is the exact legacy path.
      uVellumEnabled:     { value: false },
      uVellumMode:        { value: 0 },
      uVellumPressure:    { value: 0 },
      uVellumDamping:     { value: 0 },
      // Rigid bodies (Phase AU): disabled is the exact legacy path.
      uRigidEnabled:      { value: false },
      uRigidCellTex:      { value: null },
      uRigidBodyTex:      { value: null },
      // Pyro (Phase AS): disabled is the exact legacy path.
      uPyroEnabled:       { value: false },
      uPyroTemperature:   { value: 1.0 },
      uPyroBuoyancy:      { value: 1.2 },
      uPyroCooling:       { value: 1.0 },
      uPyroDisturbance:   { value: 1.0 },
      uPyroDisturbanceHeat: { value: 1.0 },
      uVFieldEnabled:   { value: false },
      uVFieldType:      { value: 2 },
      uVFieldStrength:  { value: 1.0 },
      uVFieldScale:     { value: 0.005 },
      uSpringEnabled:   { value: false },
      uSpringStrength:  { value: 1.0 },
      uInitPosTex:      { value: null },
      uMorphEnabled:    { value: false },
      uMorphTex:        { value: null },
      uMorphNormalTex:  { value: null },
      uMorphObjNormalSpeed: { value: 0.0 },
      uMorphKickStart:  { value: 0.0 },
      uAgeEnabled:      { value: false },
      uAgeMax:          { value: 6.0 },
      // Signal & time grammar (Phase AC): curl evolution speed +
      // sim age curves. Defaults are the exact legacy neutrals.
      uCurlSpeed:       { value: 1.0 },
      uAgeCurveVelocityEnabled: { value: false },
      uAgeCurveVelocity: { value: [1, 1, 1, 1, 1] },
      uAgeCurveForceEnabled: { value: false },
      uAgeCurveForce: { value: [1, 1, 1, 1, 1] },
      uMorphStrength:   { value: 3.0 },
      uMorphOrbitSpeed: { value: 0.3 },
      uMorphReplicaPhaseGain: { value: 0.0 },
      // Replica independent simulation (Phase W2): per-stack
      // field seed / clock offsets and the global-layout remap.
      // All zero for the shared pair, where they are exact
      // neutrals; the stack runner sets them per stack.
      uReplicaSeedOffset:   { value: new THREE.Vector3(0, 0, 0) },
      uReplicaTimeOffset:   { value: 0.0 },
      uStackMode:           { value: 0.0 },
      uStackGlobalStart:    { value: 0.0 },
      uStackGlobalTexSizeF: { value: 0.0 },
      uSpeed:           { value: 1.0 },
      uSdfEnabled:      { value: false },
      uSdfShape:        { value: 0 },
      uSdfX:            { value: 0.0 },
      uSdfY:            { value: 0.0 },
      uSdfZ:            { value: 0.0 },
      uSdfSize:         { value: 80.0 },
      uSdfBounce:       { value: 0.5 },
      // Mesh SDF collider (Phase BY): disabled + no texture is
      // the exact legacy path.
      uMeshSdfEnabled:    { value: false },
      uMeshSdfTex:        { value: null },
      uMeshSdfOrigin:     { value: new THREE.Vector3(0, 0, 0) },
      uMeshSdfDomainWorld: { value: 1.0 },
      uMeshSdfScale:      { value: 0.0 },
      uMeshSdfVoxelWorld: { value: 0.0 },
      uMeshSdfBounce:     { value: 0.5 },
      uMeshSdfFriction:   { value: 0.25 },
      uFloorEnabled:    { value: false },
      uFloorY:          { value: -110.0 },
      uFloorBounce:     { value: 0.62 },
      uMouseEnabled:    { value: false },
      uMousePos:        { value: new THREE.Vector3(0, 0, 0) },
      uMouseStrength:   { value: 2.0 },
      uMouseRadius:     { value: 150.0 },
      uMouseMode:       { value: 0 },
      uMousePaintRate:  { value: 0.6 },
      // Multi-touch (Phase AO): count 0 = the multi block never
      // runs; positions are only written while the key is on.
      uMousePosMulti:   { value: [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 0)] },
      uMouseCount:      { value: 0 },
      uFluidEnabled:    { value: false },
      uFluidTex:        { value: null },
      uFluidInfluence:  { value: 0.8 },
      uFluidScale:      { value: 1.5 },
      // FLIP layer (Phase AT): set only by the FLIP field
      // pipeline in runFluidAdvectionPass; defaults keep the
      // G2P block inert and the legacy sample verbatim.
      uFlipEnabled:     { value: false },
      uFlipBaseTex:     { value: null },
      uFlipBlend:       { value: 0.95 },
      uFlipTransfer:    { value: 1.0 },
      // Pyro grid coupling (Phase CB): set only by
      // applyPyroGridCoupleUniforms on the main velocity
      // material; the defaults keep the G2P block inert (and
      // replica stacks, which never get them set, stay inert
      // like the FLIP layer above).
      uPyroGridCouple:  { value: false },
      uPyroGridVelTex:  { value: null },
      uPyroGridBaseTex: { value: null },
      uPyroGridBlend:   { value: 0 },
      uPyroGridTransfer: { value: 1.0 },
      uPyroGridVelScale: { value: 0 },
      uGridN:           { value: 1 },
      uAtlasSize:       { value: new THREE.Vector2(1, 1) },
      uAtlasTiles:      { value: new THREE.Vector2(1, 1) },
      uManualTrilinear: { value: false },
      uPyroGridBounds:  { value: new THREE.Vector4(0, 0, 0, 150) },
    },
    vertexShader: SIM_VERT, fragmentShader: SIM_VEL_FRAG,
  });
}

export function createPosSimMaterial(texSize: number, config: ParticleConfig): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uPosTex:        { value: null },
      uVelTex:        { value: null },
      uDelta:         { value: 0.016 },
      uSpeed:         { value: config.gpgpuSpeed },
      uBounceRadius:  { value: config.gpgpuBounceRadius },
      uAgeEnabled:    { value: false },
      uAgeMax:        { value: 8.0 },
      uAgeReplicaStep: { value: 0 },
      uAgeReplicaCount: { value: 1 },
      uReplicaAgeBase: { value: 0 },
      uTexSizeF:      { value: texSize },
      // Vellum (Phase AR): gates the pointer-paint teleport only.
      uVellumEnabled: { value: false },
      // Rigid bodies (Phase AU): disabled is the exact legacy path.
      uRigidEnabled:  { value: false },
      uRigidCellTex:  { value: null },
      uRigidBodyTex:  { value: null },
      uVerletEnabled: { value: false },
      uPrevPosTex:    { value: null },
      uSdfEnabled:    { value: false },
      uSdfShape:      { value: 0 },
      uSdfX:          { value: 0.0 },
      uSdfY:          { value: 0.0 },
      uSdfZ:          { value: 0.0 },
      uSdfSize:       { value: 80.0 },
      uSdfBounce:     { value: 0.5 },
      // Mesh SDF collider (Phase BY): disabled + no texture is
      // the exact legacy path.
      uMeshSdfEnabled:    { value: false },
      uMeshSdfTex:        { value: null },
      uMeshSdfOrigin:     { value: new THREE.Vector3(0, 0, 0) },
      uMeshSdfDomainWorld: { value: 1.0 },
      uMeshSdfScale:      { value: 0.0 },
      uMeshSdfVoxelWorld: { value: 0.0 },
      // Floor bounce + pointer paint (B3)
      uTime:          { value: 0 },
      uFloorEnabled:  { value: false },
      uFloorY:        { value: -110.0 },
      // Terrain collider (Phase AI): disabled + no texture is
      // the exact legacy path.
      uTerrainColliderEnabled: { value: false },
      uTerrainColliderTex:     { value: null },
      uTerrainExtent:          { value: 1.0 },
      uTerrainHeightWorld:     { value: 0.0 },
      uTerrainGradScale:       { value: 0.0 },
      uTerrainTexSize:         { value: 129.0 },
      uMouseEnabled:  { value: false },
      uMousePos:      { value: new THREE.Vector3(0, 0, 0) },
      uMouseRadius:   { value: 150.0 },
      uMouseMode:     { value: 0 },
      uMousePaintRate:{ value: 0.6 },
      // Multi-touch (Phase AO): same contract as the velocity pass.
      uMousePosMulti: { value: [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 0)] },
      uMouseCount:    { value: 0 },
      // Light emitter respawn (Phase T): off unless the emit shape
      // is 'light'; the position then mirrors the light keys.
      uEmitLight:     { value: false },
      uEmitLightPos:  { value: new THREE.Vector3(0, 0, 0) },
      // Lifecycle grammar (Phase AB): spawn gate + kill conditions.
      uSpawnRate:   { value: 1.0 },
      uSpawnBurst:  { value: 1.0 },
      uSpawnTime:   { value: 0 },
      uSpawnPulseInterval: { value: 0 },
      uSpawnPulseDuty:     { value: 0.3 },
      // Phase AX: cycles 0 / probability 1 = legacy pulse;
      // order mode 0 = legacy hash; event disabled.
      uSpawnPulseCycles:      { value: 0 },
      uSpawnPulseProbability: { value: 1 },
      uSpawnOrderTex:  { value: null },
      uSpawnOrderMode: { value: 0 },
      uSpawnEventEnabled: { value: false },
      uSpawnEventTime:    { value: 0 },
      uSpawnEventCount:   { value: 0 },
      // Emission curve (Phase AJ): off + identity arrays is the
      // exact legacy respawn path.
      uEmissionCurveEnabled: { value: false },
      uEmissionCurvePeriod:  { value: 8 },
      uEmissionCurveT:       { value: [0, 1, 1, 1, 1, 1, 1, 1] },
      uEmissionCurveV:       { value: [1, 1, 1, 1, 1, 1, 1, 1] },
      uKillBoundary: { value: false },
      uKillMask:     { value: false },
      uKillMaskTex:  { value: null },
      uKillMaskThreshold: { value: 0.5 },
      uKillMaskInvert: { value: false },
      // Group kill (Phase DG): attribute bake + gate uniforms,
      // resolved per frame in runSimulationPasses.
      uGroupKillEnabled: { value: false },
      uAttrTex:      { value: null },
      uGroupSlot:    { value: 0 },
      uGroupMode:    { value: 1 },
      uGroupLow:     { value: 0.25 },
      uGroupHigh:    { value: 0.75 },
      uGroupInvert:  { value: false },
    },
    vertexShader: SIM_VERT, fragmentShader: SIM_POS_FRAG,
  });
}

// Vellum projection material (Phase AR): one Jacobi iteration of
// the distance-constraint solve. Shared-path only — the replica
// stacks never receive it (the solver is resolved off while
// stacks are active, mirroring the morph suppression).
export function createVellumProjMaterial(texSize: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uPosTex:          { value: null },
      uVellumRestTex:   { value: null },
      uVellumStateTex:  { value: null },
      uVellumTearEnabled: { value: false },
      uVellumMode:      { value: 0 },
      uVellumStiffness: { value: 0.8 },
      uVellumBend:      { value: 0.3 },
      uVellumPin:       { value: 1 },
      uVellumGlue:      { value: 0 },
      uVellumGlueStateEnabled: { value: false },
      uTexSizeF:        { value: texSize },
    },
    vertexShader: SIM_VERT, fragmentShader: SIM_VELLUM_PROJ_FRAG,
  });
}

// Vellum tear-state material (Phase AR): updates the link
// survival texture from the frame-start positions.
export function createVellumStateMaterial(texSize: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uPosTex:          { value: null },
      uVellumRestTex:   { value: null },
      uVellumStateTex:  { value: null },
      uVellumTear:      { value: 0 },
      uVellumMode:      { value: 0 },
      uVellumPin:       { value: 1 },
      uVellumGlueBreak: { value: 0 },
      uTexSizeF:        { value: texSize },
    },
    vertexShader: SIM_VERT, fragmentShader: SIM_VELLUM_STATE_FRAG,
  });
}

// Vellum stitch material (Phase BB): the velocity-coupling
// sweep over the structural links. Shared-path only, like the
// other Vellum materials.
export function createVellumVelMaterial(texSize: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uVelTex:          { value: null },
      uVellumStateTex:  { value: null },
      uVellumTearEnabled: { value: false },
      uVellumMode:      { value: 0 },
      uVellumStitch:    { value: 0 },
      uVellumPin:       { value: 1 },
      uTexSizeF:        { value: texSize },
    },
    vertexShader: SIM_VERT, fragmentShader: SIM_VELLUM_VEL_FRAG,
  });
}

export function useGpgpuSimulationAssets({ config, texSize, simScene, simGeo }: UseGpgpuAssetsArgs) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const velSimMat = useMemo(() => createVelSimMaterial(texSize, config), []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const posSimMat = useMemo(() => createPosSimMaterial(texSize, config), []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const vellumProjMat = useMemo(() => createVellumProjMaterial(texSize), []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const vellumStateMat = useMemo(() => createVellumStateMaterial(texSize), []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const vellumVelMat = useMemo(() => createVellumVelMaterial(texSize), []);

  // Aux event emission materials (B3): the shared event uniforms are
  // declared in gpgpuShaderAux's AUX_EVENT_GLSL chunk; the passes in
  // gpgpuSimulationPasses.runAuxSimulationPasses fill them per frame.
  const auxVelMat = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      uAuxPosTex:    { value: null },
      uAuxVelTex:    { value: null },
      uMainPosTex:   { value: null },
      uMainVelTex:   { value: null },
      uMainTexSizeF: { value: texSize },
      uAuxCount:     { value: 4096 },
      uAuxMode:      { value: 0 },
      uAuxIntensity: { value: 1.0 },
      uAuxSpeed:     { value: 26.0 },
      uAuxLife:      { value: 0.75 },
      uAuxGravityScale: { value: 1.0 },
      uAuxDrag:      { value: 0 },
      uAuxCurl:      { value: 0 },
      uAgeEnabled:   { value: false },
      uAgeMax:       { value: 8.0 },
      uFloorEnabled: { value: false },
      uFloorY:       { value: -110.0 },
      uFloorBounce:  { value: 0.62 },
      uBounceRadius: { value: 150.0 },
      uBounce:       { value: 0.65 },
      uGravity:      { value: 0.2 },
      uDelta:        { value: 0.016 },
      uTime:         { value: 0 },
    },
    vertexShader: SIM_VERT, fragmentShader: AUX_VEL_FRAG,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);

  const auxPosMat = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      uAuxPosTex:    { value: null },
      uAuxVelTex:    { value: null },
      uAuxVelOutTex: { value: null },
      uMainPosTex:   { value: null },
      uMainVelTex:   { value: null },
      uMainTexSizeF: { value: texSize },
      uAuxCount:     { value: 4096 },
      uAuxMode:      { value: 0 },
      uAuxIntensity: { value: 1.0 },
      uAuxSpeed:     { value: 26.0 },
      uAgeEnabled:   { value: false },
      uAgeMax:       { value: 8.0 },
      uFloorEnabled: { value: false },
      uFloorY:       { value: -110.0 },
      uBounceRadius: { value: 150.0 },
      uDelta:        { value: 0.016 },
      uTime:         { value: 0 },
    },
    vertexShader: SIM_VERT, fragmentShader: AUX_POS_FRAG,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);

  // Aux chain materials (Phase W1): one shared pair for levels 2
  // and 3 — the passes run sequentially per level with that level's
  // uniforms and salt, so a single material pair serves both. The
  // event uniforms are declared in AUX_CHAIN_EVENT_GLSL.
  const auxChainVelMat = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      uAuxPosTex:    { value: null },
      uAuxVelTex:    { value: null },
      uMainPosTex:   { value: null },
      uMainVelTex:   { value: null },
      uMainTexSizeF: { value: 128 },
      uSrcCount:     { value: 4096 },
      uAuxCount:     { value: 4096 },
      uAuxMode:      { value: 0 },
      uAuxIntensity: { value: 1.0 },
      uAuxSpeed:     { value: 26.0 },
      uAuxLife:      { value: 0.75 },
      uAuxGravityScale: { value: 1.0 },
      uAuxDrag:      { value: 0 },
      uAuxCurl:      { value: 0 },
      uChainSalt:    { value: 0 },
      uFloorEnabled: { value: false },
      uFloorY:       { value: -110.0 },
      uFloorBounce:  { value: 0.62 },
      uBounceRadius: { value: 150.0 },
      uBounce:       { value: 0.65 },
      uGravity:      { value: 0.2 },
      uDelta:        { value: 0.016 },
      uTime:         { value: 0 },
    },
    vertexShader: SIM_VERT, fragmentShader: AUX_CHAIN_VEL_FRAG,
   
  }), []);

  const auxChainPosMat = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      uAuxPosTex:    { value: null },
      uAuxVelTex:    { value: null },
      uAuxVelOutTex: { value: null },
      uMainPosTex:   { value: null },
      uMainVelTex:   { value: null },
      uMainTexSizeF: { value: 128 },
      uSrcCount:     { value: 4096 },
      uAuxCount:     { value: 4096 },
      uAuxMode:      { value: 0 },
      uAuxIntensity: { value: 1.0 },
      uAuxSpeed:     { value: 26.0 },
      uChainSalt:    { value: 0 },
      uFloorEnabled: { value: false },
      uFloorY:       { value: -110.0 },
      uBounceRadius: { value: 150.0 },
      uDelta:        { value: 0.016 },
      uTime:         { value: 0 },
    },
    vertexShader: SIM_VERT, fragmentShader: AUX_CHAIN_POS_FRAG,
   
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

  // FLIP layer (Phase AT): P2G splat (custom ONE/ONE blending
  // so deposits accumulate in the float transfer target),
  // composite, pressure Jacobi, gradient subtraction and the
  // zero-clear used for the transfer / pressure targets.
  const flipSplatMat = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      uPosTex:       { value: null },
      uVelTex:       { value: null },
      uBounceRadius: { value: 150.0 },
      uFluidScale:   { value: 1.5 },
      uCellOffset:   { value: new THREE.Vector2(0, 0) },
    },
    vertexShader: FLIP_SPLAT_VERT, fragmentShader: FLIP_SPLAT_FRAG,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
    depthTest: false,
    depthWrite: false,
    transparent: false,
   
  }), []);

  const flipCompositeMat = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      uAdvTex:      { value: null },
      uTransferTex: { value: null },
      uAvgWeight:   { value: 1.0 },
    },
    vertexShader: SIM_VERT, fragmentShader: FLIP_COMPOSITE_FRAG,
  }), []);

  const flipJacobiMat = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      uVelTex: { value: null },
      uPresIn: { value: null },
    },
    vertexShader: SIM_VERT, fragmentShader: FLIP_JACOBI_FRAG,
  }), []);

  const flipSubtractMat = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      uVelTex:  { value: null },
      uPresTex: { value: null },
    },
    vertexShader: SIM_VERT, fragmentShader: FLIP_SUBTRACT_FRAG,
  }), []);

  const flipClearMat = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {},
    vertexShader: SIM_VERT, fragmentShader: FLIP_CLEAR_FRAG,
  }), []);

  // Vorticity confinement (Phase DL): curl of the composite
  // field, then the Fedkiw confinement force. Only run while
  // the DL keys are on (see runFluidAdvectionPass); constructed
  // unconditionally with the other FLIP materials.
  const flipVorticityCurlMat = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      uVelTex: { value: null },
    },
    vertexShader: SIM_VERT, fragmentShader: FLIP_VORTICITY_CURL_FRAG,
  }), []);

  const flipVorticityForceMat = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      uVelTex:  { value: null },
      uCurlTex: { value: null },
      uDelta:   { value: 0.016 },
      uEpsilon: { value: 0 },
    },
    vertexShader: SIM_VERT, fragmentShader: FLIP_VORTICITY_FORCE_FRAG,
  }), []);

  // Pyro grid materials (Phase CA): the atlas solver's seven
  // passes plus a clear (the FLIP clear shader reused — pressure
  // targets restart from zero every step, the FLIP rule). The
  // shared atlas uniforms are declared in PYRO_GRID_COMMON; the
  // pass runner (gpgpuPyroGridPasses) fills every uniform per
  // step, so the defaults here are placeholders only.
  const pyroCommonUniforms = () => ({
    uGridN: { value: 1 },
    uAtlasSize: { value: new THREE.Vector2(1, 1) },
    uAtlasTiles: { value: new THREE.Vector2(1, 1) },
    uManualTrilinear: { value: false },
  });
  const pyroAdvectVelMat = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      ...pyroCommonUniforms(),
      uVelIn: { value: null },
      uDelta: { value: 0.016 },
      uMaxSpeed: { value: 128 },
    },
    vertexShader: SIM_VERT, fragmentShader: PYRO_GRID_ADVECT_VEL_FRAG,
  }), []);
  const pyroAdvectScalarMat = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      ...pyroCommonUniforms(),
      uScalarIn: { value: null },
      uVelIn: { value: null },
      uDelta: { value: 0.016 },
    },
    vertexShader: SIM_VERT, fragmentShader: PYRO_GRID_ADVECT_SCALAR_FRAG,
  }), []);
  const pyroForcesVelMat = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      ...pyroCommonUniforms(),
      uVelIn: { value: null },
      uScalarIn: { value: null },
      uDelta: { value: 0.016 },
      uBuoyancy: { value: 1.2 },
      uBuoyAccel: { value: 250 },
      uDensityWeight: { value: 0 },
      uMaxSpeed: { value: 128 },
    },
    vertexShader: SIM_VERT, fragmentShader: PYRO_GRID_FORCES_VEL_FRAG,
  }), []);
  const pyroScalarUpdateMat = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      ...pyroCommonUniforms(),
      uScalarIn: { value: null },
      uDelta: { value: 0.016 },
      uDiffuse: { value: 0.05 },
      uCooling: { value: 1 },
      uTempCoolRate: { value: 0.22 },
      uDensityDecayRate: { value: 0.03 },
      uEmitTemp: { value: 1 },
      uEmitDensity: { value: 80 },
      uEmitTempRate: { value: 8 },
      uSourceCenter: { value: new THREE.Vector3(15.5, 2, 15.5) },
      uSourceRadius: { value: 2.67 },
      uFuelRate: { value: 0 },
      uFuelEmit: { value: 60 },
      uFuelReactionK: { value: 2.5 },
      uFuelHeat: { value: 3 },
      uIgniteLo: { value: 0.15 },
      uIgniteHi: { value: 0.35 },
      uTempMax: { value: 4 },
    },
    vertexShader: SIM_VERT, fragmentShader: PYRO_GRID_SCALAR_UPDATE_FRAG,
  }), []);
  const pyroDivergenceMat = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      ...pyroCommonUniforms(),
      uVelIn: { value: null },
    },
    vertexShader: SIM_VERT, fragmentShader: PYRO_GRID_DIVERGENCE_FRAG,
  }), []);
  const pyroJacobiMat = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      ...pyroCommonUniforms(),
      uPresIn: { value: null },
      uDivTex: { value: null },
    },
    vertexShader: SIM_VERT, fragmentShader: PYRO_GRID_JACOBI_FRAG,
  }), []);
  const pyroSubtractMat = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      ...pyroCommonUniforms(),
      uVelIn: { value: null },
      uPresTex: { value: null },
      uMaxSpeed: { value: 128 },
    },
    vertexShader: SIM_VERT, fragmentShader: PYRO_GRID_SUBTRACT_FRAG,
  }), []);
  const pyroCurlMat = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      ...pyroCommonUniforms(),
      uVelIn: { value: null },
    },
    vertexShader: SIM_VERT, fragmentShader: PYRO_GRID_CURL_FRAG,
  }), []);
  const pyroVorticityForceMat = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      ...pyroCommonUniforms(),
      uVelIn: { value: null },
      uCurlIn: { value: null },
      uDelta: { value: 0.016 },
      uEpsilon: { value: 0 },
      uMaxSpeed: { value: 128 },
    },
    vertexShader: SIM_VERT, fragmentShader: PYRO_GRID_VORTICITY_FORCE_FRAG,
  }), []);
  const pyroClearMat = flipClearMat;

  // Whitewater materials (Phase BC): the foam pool's two passes.
  // The shared field uniforms are declared in
  // gpgpuShaderWhitewater's WW_SPAWN_GLSL chunk; the passes in
  // gpgpuSimulationPasses.runWhitewaterSimulationPasses fill them
  // per frame.
  const wwVelMat = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      uWwPosTex:       { value: null },
      uWwVelTex:       { value: null },
      uFluidTex:       { value: null },
      uBounceRadius:   { value: 150.0 },
      uFluidScale:     { value: 1.5 },
      uFluidInfluence: { value: 0.8 },
      uWwThreshold:    { value: 0.3 },
      uWwAmount:       { value: 1.0 },
      uWwLife:         { value: 0.7 },
      uDelta:          { value: 0.016 },
      uTime:           { value: 0 },
    },
    vertexShader: SIM_VERT, fragmentShader: WW_VEL_FRAG,
   
  }), []);

  const wwPosMat = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      uWwPosTex:       { value: null },
      uWwVelTex:       { value: null },
      uWwVelOutTex:    { value: null },
      uFluidTex:       { value: null },
      uBounceRadius:   { value: 150.0 },
      uFluidScale:     { value: 1.5 },
      uFluidInfluence: { value: 0.8 },
      uWwThreshold:    { value: 0.3 },
      uWwAmount:       { value: 1.0 },
      uDelta:          { value: 0.016 },
      uTime:           { value: 0 },
    },
    vertexShader: SIM_VERT, fragmentShader: WW_POS_FRAG,
   
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
    vellumProjMat,
    vellumStateMat,
    vellumVelMat,
    auxVelMat,
    auxPosMat,
    auxChainVelMat,
    auxChainPosMat,
    wwVelMat,
    wwPosMat,
    blitMat,
    sortDepthMat,
    bitonicMat,
    fluidAdvectMat,
    flipSplatMat,
    flipCompositeMat,
    flipJacobiMat,
    flipSubtractMat,
    flipClearMat,
    flipVorticityCurlMat,
    flipVorticityForceMat,
    pyroAdvectVelMat,
    pyroAdvectScalarMat,
    pyroForcesVelMat,
    pyroScalarUpdateMat,
    pyroDivergenceMat,
    pyroJacobiMat,
    pyroSubtractMat,
    pyroCurlMat,
    pyroVorticityForceMat,
    pyroClearMat,
  };
}
