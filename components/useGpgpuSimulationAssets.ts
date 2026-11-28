import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { BLIT_FRAG, FLIP_CLEAR_FRAG, FLIP_COMPOSITE_FRAG, FLIP_JACOBI_FRAG, FLIP_SPLAT_FRAG, FLIP_SPLAT_VERT, FLIP_SUBTRACT_FRAG, FLIP_VORTICITY_CURL_FRAG, FLIP_VORTICITY_FORCE_FRAG, FLUID_ADVECT_FRAG, GRAINS_CELL_KEY_FRAG, GRAINS_PILE_DELTA_FRAG, GRAINS_PILE_LAMBDA_FRAG, GRAINS_VELOCITY_UPDATE_FRAG, SIM_VERT, SORT_BITONIC_FRAG, SORT_DEPTH_FRAG, buildPositionFragment, buildVelocityFragment } from "./gpgpuShaders";
import type { VelocityFragmentVariantOptions } from "./gpgpuShaderSimulationVelocity";
import { grainsNeighborhoodMode, grainsPileActive, grainsProjectionActive, resolveGrainsXsphStrength } from "../lib/gpgpuGrains";
import { hasEffectiveParticleRules } from "../lib/gpgpuParticleRules";
import { hasEffectiveLiveRules } from "../lib/gpgpuParticleRulesLive";
import { emitterRespawnShapeActive, emitterTransformActive, emitterVelocityDirectedActive } from "../lib/gpgpuEmitter";
import { emissionCloudActive, emissionMaskVariantActive, emissionPathActive, emissionPathAssetActive } from "../lib/gpgpuEmissionSource";
import { steeringPathAssetActive, steeringCrowdPathAssetActive } from "../lib/gpgpuPathAssets";
import { spawnAllocVariantActive, spawnRuleGateKeyOn } from "../lib/gpgpuSpawnAllocator";
import { fieldInstancesActive } from "../lib/gpgpuFieldInstances";
import { distributionActive } from "../lib/gpgpuDistribution";
import { predationActive, predationBirthActive } from "../lib/gpgpuPredation";
// Grammar 2.0 stage 2 (slice B6): the live-rule segments also stand while
// predation generates its rules — the generated list counts exactly like
// an effective user list for variant purposes.
const liveRulesPresent = (c: ParticleConfig): boolean => hasEffectiveLiveRules(c.gpgpuParticleRulesLive ?? '') || predationActive(c);
const liveSpawnPresent = (c: ParticleConfig): boolean => hasEffectiveLiveRules(c.gpgpuParticleRulesLive ?? '') || predationBirthActive(c);
import { shaderSeedActive } from "../lib/gpgpuRandom";
import { mergedSupplyActive } from "../lib/gpgpuMergedSupply";
import { relDragActive, targetSpeedActive } from "../lib/gpgpuSpeedDragSpin";
import { meanderStandaloneActive } from "../lib/gpgpuMeander";
import { ageFreeVariantOn } from "../lib/gpgpuAgeFreeCurves";
import { flip3dActive } from "../lib/flip3d";
import { grainsFullScanDowngradeApplies, resolveGrainsCellSortActive, setFlip3dGrainsDowngrade } from "../lib/flip3dAtlasDowngrade";
import { getMaxTextureImageUnits } from "../lib/gpuDiagnostics";
import { resolveCrowd, resolveSteeringSeek } from "../lib/steering";
import { SIM_VELLUM_PROJ_FRAG, SIM_VELLUM_STATE_FRAG, SIM_VELLUM_VEL_FRAG, SIM_VELLUM_VOLUME_APPLY_FRAG, SIM_VELLUM_VOLUME_PROJ_FRAG, SIM_VELLUM_VOLUME_REDUCE_FRAG, SIM_VELLUM_XPBD_CLEAR_FRAG, SIM_VELLUM_XPBD_LAMBDA_FRAG, SIM_VELLUM_XPBD_PROJ_FRAG, SIM_VELLUM_XPBD_VEL_FRAG } from "./gpgpuShaderSimulationVellum";
import { buildAuxChainPosFrag, buildAuxChainVelFrag, buildAuxInheritFrag, buildAuxPosFrag, buildAuxVelFrag } from "./gpgpuShaderAux";
import type { AuxTrailAbStage } from "./gpgpuShaderAux";
import { noteAuxTrailAbApplied, registerAuxTrailAbApplier } from "../lib/auxTrailAbDiag";
import { auxSdfSplashActive } from "../lib/auxChain";
import { auxInheritVelScaleActive } from "../lib/auxInherit";
import { auxEmitChainActive, auxEmitLevel1Active } from "../lib/auxEmit";
import { auxRuleSpawnLevel1Active } from "../lib/auxRuleSpawn";
import { trailAuxActive } from "../lib/trailAux";
import { WW_POS_FRAG, WW_VEL_FRAG } from "./gpgpuShaderWhitewater";
import { WW3_POS_FRAG, WW3_VEL_FRAG } from "./gpgpuShaderWhitewater3d";
import {
  FLIP3D_ATLAS_COPY_FRAG,
  FLIP3D_COMPOSITE_FRAG,
  FLIP3D_CURVATURE_FRAG,
  FLIP3D_JACOBI_FRAG,
  FLIP3D_PHI_ADVECT_FRAG,
  FLIP3D_PHI_FRAG,
  FLIP3D_SPLAT_FRAG,
  FLIP3D_SPLAT_VERT,
  FLIP3D_SUBTRACT_FRAG,
  FLIP3D_TENSION_FRAG,
  FLIP3D_VISCOSITY_FRAG,
} from "./gpgpuShaderSimulationFlip3d";
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
import { buildCustomForceHarness, compileCheckShader, extractCustomForceControls, setCustomForceStatus, syncCtrlUniforms, validateCustomForceCode } from "../lib/gpgpuCustomForce";
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
// Phase 19 gate fix: the velocity shader's string variant is
// resolved from the same conditions that drive the Phase 19
// uniforms — the Grains neighbourhood key (mode 1 = the complete
// scan) and FLIP 3D activity (the config side of the condition
// applyFlip3dCoupleUniforms uses to raise uFlip3dCouple). With
// both off the built string is byte-identical to v2.00.
export function velocityVariantOptions(config: ParticleConfig, texSize?: number): VelocityFragmentVariantOptions {
  return {
    // 案D downgrade, generalised by E3 (Grains Stage B): a
    // <=16-texture-unit GPU cannot carry the Grains complete
    // scan (17 units with or without the FLIP 3D coupling —
    // the resident preamble already fills all 16), so the
    // neighbourhood resolves to subsample and the full-scan
    // variant is not built. The rule itself lives in
    // lib/flip3dAtlasDowngrade.ts; the unit count is probed
    // once via lib/gpuDiagnostics.ts.
    grainsFullScan: grainsNeighborhoodMode(config) === 1
      && !grainsFullScanDowngradeApplies(config, getMaxTextureImageUnits()),
    flip3dCouple: flip3dActive(config),
    // Phase 20 stage 2: the steering chunk + uniforms exist in
    // the built string only while the steer-seek keys are on.
    steeringSeek: resolveSteeringSeek(config).active,
    // Round 84 gap 2: the crowd chunk variant + uniforms exist
    // in the built string only while the crowd key is on.
    crowd: resolveCrowd(config).enabled,
    // Phase 24: the Akinci surface-tension chunks exist in the
    // built string only while the Akinci strength key is above
    // zero (and SPH itself is on — the chunks live inside the
    // SPH block either way, this keeps the string stock for
    // non-SPH configs that carry a stale strength value).
    sphAkinci: !!config.gpgpuSphEnabled && (config.gpgpuSphSurfaceTensionAkinci || 0) > 0,
    // Phase 27 (9-6 stage 1): the attractor unit-2 chunk +
    // uniforms exist in the built string only while the
    // unit-2 enable key is on.
    attractor2: !!config.gpgpuAttractor2Enabled,
    // Phase 29 (9-6 stage 2): units 3 and 4, same discipline.
    attractor3: !!config.gpgpuAttractor3Enabled,
    attractor4: !!config.gpgpuAttractor4Enabled,
    // Grains Stage C: the XSPH segment + uniforms exist in the
    // built string only while the pile plan is active with a
    // positive XSPH strength.
    grainsPileXsph: grainsPileActive(config) && resolveGrainsXsphStrength(config) > 0,
    // G10 stage 1: the particle-rule mask segment exists in
    // the built string only while an effective rule list
    // exists (the Phase 19 splicing discipline).
    particleRules: hasEffectiveParticleRules(config.gpgpuParticleRules ?? ''),
    // Coupling stage 2: the free-particle segments exist in
    // the built string only while the free-particles key is
    // on (same discipline).
    rigidFree: !!config.gpgpuRigidFreeEnabled,
    // Grammar 2.0 stage 1 (slice 1A): the live-rule segment +
    // uniform set exist in the built string only while an
    // effective LIVE rule list exists (same discipline).
    particleRulesLive: liveRulesPresent(config),
    // Grammar 2.0 stage 2 (slice E2): the spawn allocator's
    // gate line + uniform set exist in the built string only
    // while the absolute rate key is set or the envelope is
    // enabled (same discipline).
    spawnAlloc: spawnAllocVariantActive(config),
    // Grammar 2.0 stage 2 (slice E2): the emitter-velocity
    // function + activation segment exist in the built string
    // only while the emitter velocity mode is 'directed'.
    emitterVelocity: emitterVelocityDirectedActive(config),
    // Grammar 2.0 stage 2 (slice B1): the field-instances
    // chunk + column-data uniform set exist in the built
    // string only while at least one field instance
    // resolves (same discipline).
    fieldInstances: fieldInstancesActive(config),
    // Grammar 2.0 stage 2 (slice B2): the path-asset variant
    // of the steer-seek chunk + its uniform set over the
    // shared column texture exist in the built string only
    // while steering follows an extended path asset (same
    // discipline).
    pathAssets: steeringPathAssetActive(config),
    // Grammar 2.0 stage 2 (B2 crowd follow-up): the
    // crowd-asset variant of the steer-seek chunk, gated by
    // its own disjoint predicate (crowd in charge + the
    // asset extended).
    crowdPathAssets: steeringCrowdPathAssetActive(config),
    // Grammar 2.0 stage 2 (slice B3): the 'rel-drag' chunk +
    // its uniform set exist in the built string only while
    // the relative-drag rate key is above zero (same
    // discipline).
    relDrag: relDragActive(config),
    // Grammar 2.0 stage 2 (slice B3): the tail's target-speed
    // block + its uniform set exist in the built string only
    // while the target speed key is above zero (same
    // discipline).
    targetSpeed: targetSpeedActive(config),
    // Grammar 2.0 stage 2 (slice B4): the age free curves'
    // uniform sets + free evaluations exist in the built
    // string only while the target's Enabled and FreeEnabled
    // are both on (same discipline).
    ageFreeVelocity: ageFreeVariantOn(config, 'velocity'),
    ageFreeForce: ageFreeVariantOn(config, 'force'),
    // Grammar 2.0 stage 2 (slice B7): the standalone
    // 'meander' chunk + the Particle Life chunk's
    // no-meander form exist in the built string only while
    // the standalone enable stands (same discipline).
    meanderStandalone: meanderStandaloneActive(config),
    // Grammar 2.0 stage 2 (texture-unit follow-up): the
    // merged supply forms exist in the built string only
    // while the merged supply stands (same discipline;
    // resolved by lib/gpgpuMergedSupply.ts, needs texSize).
    mergedSupply: texSize !== undefined && mergedSupplyActive(config, texSize),
  };
}

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
      uAttractorSpaceMode: { value: 0 },
      // Phase 27: declared in the shader only in the
      // attractor2 variant string; the entries are inert
      // otherwise.
      uAttractor2Enabled:  { value: false },
      uAttractor2Type:     { value: 0 },
      uAttractor2Strength: { value: 1.0 },
      uAttractor2Scale:    { value: 8.0 },
      uAttractor2SpaceMode: { value: 0 },
      // Phase 29: units 3 and 4, declared in the shader only
      // in their variant strings; inert otherwise.
      uAttractor3Enabled:  { value: false },
      uAttractor3Type:     { value: 0 },
      uAttractor3Strength: { value: 1.0 },
      uAttractor3Scale:    { value: 8.0 },
      uAttractor3SpaceMode: { value: 0 },
      uAttractor4Enabled:  { value: false },
      uAttractor4Type:     { value: 0 },
      uAttractor4Strength: { value: 1.0 },
      uAttractor4Scale:    { value: 8.0 },
      uAttractor4SpaceMode: { value: 0 },
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
      uSteerAvoid:                { value: 0 },
      uSteerAvoidRange:           { value: 0 },
      // Crowd steering (Phase 20 stage 2): declared in the
      // shader only in the Phase 20 variant; the passes fill
      // these from resolveSteeringSeek per frame.
      uSteerSeekEnabled:          { value: false },
      uSteerSeekMode:             { value: 0 },
      uSteerSeekStrength:         { value: 1 },
      uSteerSeekMaxSpeed:         { value: 1 },
      uSteerSeekMaxForce:         { value: 0 },
      uSteerSeekTarget:           { value: new THREE.Vector3() },
      uSteerSeekTarget1:          { value: new THREE.Vector3() },
      uSteerSeekSlowingRadius:    { value: 50 },
      uSteerSeekStateSlot:        { value: 0 },
      uSteerSeekStateThreshold:   { value: 0.5 },
      uSteerSeekPath:             { value: new Float32Array(24) },
      uSteerSeekPathCount:        { value: 0 },
      uSteerSeekPathLookAhead:    { value: 20 },
      uSteerSeekPathRadius:       { value: 0 },
      // Crowd state machine (Round 84 gap 2): declared in the
      // shader only in the crowd variant; the passes fill these
      // from resolveCrowd per frame.
      uCrowdAvoidRange:           { value: 0 },
      uCrowdAvoidHysteresis:      { value: 0.2 },
      uCrowdAvoidStrength:        { value: 1 },
      uCrowdIdleSpeed:            { value: 0.05 },
      uCrowdIdleSpeedOut:         { value: 0.1 },
      uCrowdIdleRadius:           { value: 0 },
      uCrowdIdleDamping:          { value: 0.9 },
      uCrowdLaneCount:            { value: 1 },
      uCrowdLaneWidth:            { value: 20 },
      uCrowdLaneOffset:           { value: 0 },
      uCrowdLaneLateralGain:      { value: 1 },
      uCrowdLaneLookAheadScale:   { value: 1 },
      uCrowdMultiObstacleEnabled: { value: false },
      // Lifecycle grammar (Phase AB): gate off / legacy drag at
      // the defaults; the passes fill them from config per frame.
      uSpawnRate:   { value: 1.0 },
      uSpawnBurst:  { value: 1.0 },
      uSpawnTime:   { value: 0 },
      // Spawn allocator (stage 2, E2): read only by the
      // allocator variant of the velocity fragment; the
      // emitter-velocity uniforms likewise. The passes fill
      // them from config per frame.
      uSpawnRateEff:   { value: 1.0 },
      uSpawnClockTime: { value: 0 },
      uSpawnClockPrev: { value: 0 },
      uEmitterVelDir:    { value: new THREE.Vector3(0, 1, 0) },
      uEmitterVelSpeed:  { value: 2 },
      uEmitterVelSpread: { value: 0.5 },
      uSpawnPulseInterval: { value: 0 },
      uSpawnPulseDuty:     { value: 0.3 },
      // Phase AX: cycles 0 / probability 1 = legacy pulse;
      // order mode 0 = legacy hash; event disabled.
      uSpawnPulseCycles:      { value: 0 },
      uSpawnPulseProbability: { value: 1 },
      uSpawnOrderTex:  { value: null },
      uSpawnOrderMode: { value: 0 },
      // Texture-unit fix (Grammar 2.0 stage 1): the live
      // variant derives the spawn gate value from the
      // initial-position texture divided by this normaliser
      // instead of sampling uSpawnOrderTex (see
      // gpgpuShaderSimulationVelocityPreamble.ts). Declared
      // in the shader only in the live variant string; the
      // entry is inert otherwise.
      uSpawnOrderMaxDist: { value: 0 },
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
      // Field instances (Grammar 2.0 stage 2, B1): declared
      // in the shader only in the field-instances variant
      // string; the entries are inert otherwise. The passes
      // fill them from getFieldColumnSupply per frame.
      uColTex:               { value: null },
      uColWidth:             { value: 256 },
      uColHeight:            { value: 2 },
      uColFieldsBase:        { value: 0 },
      uColLayersBase:        { value: 0 },
      uFieldInstanceCount:   { value: 0 },
      uFieldLayerAttrEnabled: { value: false },
      // Path assets (Grammar 2.0 stage 2, B2): declared in
      // the shader only in the path-assets variant string;
      // the entries are inert otherwise. The passes fill
      // them from getColumnSupply per frame.
      uColPathsBase:         { value: 0 },
      uColPathHeadersBase:   { value: 0 },
      uPathAssetCount:       { value: 0 },
      uPathAssetSlot:        { value: -1 },
      // Relative drag / target speed (Grammar 2.0 stage 2,
      // B3): declared in the shader only in their variant
      // strings; the entries are inert otherwise. The passes
      // fill them from lib/gpgpuSpeedDragSpin per frame.
      uRelDragWindVel:       { value: new THREE.Vector3(0, 0, 0) },
      uRelDragRate:          { value: 0 },
      uRelDragSlot:          { value: -1 },
      uTargetSpeed:          { value: 0 },
      uTargetSpeedBlend:     { value: 1 },
      uTargetSpeedSlot:      { value: -1 },
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
      // Live particle rules (Grammar 2.0 1A): the REP output
      // texture + its resolved enable, set per frame in
      // runSimulationPasses.
      uRuleLiveTex:       { value: null },
      uRuleLiveEnabled:   { value: false },
      // Merged supply (stage 2 texture-unit follow-up):
      // declared in the shader only in the merged variant
      // string; inert otherwise. The passes fill them from
      // the merged plan per frame.
      uMergedTex:         { value: null },
      uMergedTexHeight:   { value: 1 },
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
      uSphSurfaceSelectivity: { value: 0 },
      // Phase 24: declared in the shader only in the sphAkinci
      // variant string; the entry itself is inert otherwise.
      uSphSurfaceTensionAkinci: { value: 0 },
      // Grains (Phase AQ): disabled is the exact legacy path.
      uGrainsEnabled:     { value: false },
      uGrainsSize:        { value: 8.0 },
      uGrainsStiffness:   { value: 2.0 },
      uGrainsFriction:    { value: 0.6 },
      uGrainsCohesion:    { value: 0 },
      uGrainsRestitution: { value: 0 },
      uGrainsRestDamping: { value: 0.5 },
      // Neighbourhood scan (Phase 19): 0 = legacy subsample.
      uGrainsNeighborhood: { value: 0 },
      // Cell sort (Phase 19 fix2): written by the passes only
      // on frames where the sort ran; the legacy shader string
      // declares none of these, so the entries stay inert there.
      uGrainsSortTex:     { value: null },
      uGrainsCellSort:    { value: false },
      // XSPH (Stage C): written by the passes while the pile
      // plan is active; the stock shader string declares
      // neither, so the entries stay inert there.
      uGrainsXsphStrength: { value: 0 },
      uGrainsSupport:      { value: 16 },
      uGrainsCellOrigin:  { value: 0 },
      uGrainsCellSize:    { value: 1 },
      uGrainsCellDims:    { value: new THREE.Vector3(1, 1, 1) },
      // Vellum (Phase AR): disabled is the exact legacy path.
      uVellumEnabled:     { value: false },
      uVellumMode:        { value: 0 },
      uVellumPressure:    { value: 0 },
      uVellumDamping:     { value: 0 },
      // Rigid bodies (Phase AU): disabled is the exact legacy path.
      uRigidEnabled:      { value: false },
      uRigidCellTex:      { value: null },
      uRigidBodyTex:      { value: null },
      // Coupling stage 2: free-particle mix (off = verbatim).
      uRigidFreeEnabled:  { value: false },
      uRigidFreeFraction: { value: 0 },
      uRigidBodyCount:    { value: 0 },
      uRigidFreeBounce:   { value: 0 },
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
      // Age free curves (Grammar 2.0 stage 2, B4): declared
      // in the shader only in the age-free variant strings;
      // the entries hold the padded identity asset otherwise.
      uAgeCurveVelocityFreeT: { value: [0, 1, 1, 1, 1, 1, 1, 1] },
      uAgeCurveVelocityFreeV: { value: [1, 1, 1, 1, 1, 1, 1, 1] },
      uAgeCurveForceFreeT: { value: [0, 1, 1, 1, 1, 1, 1, 1] },
      uAgeCurveForceFreeV: { value: [1, 1, 1, 1, 1, 1, 1, 1] },
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
      // Multi-body mesh SDF: disabled + count 0 is the exact
      // legacy path (the atlas reuses uMeshSdfTex above).
      uMeshSdfMultiEnabled: { value: false },
      uMeshSdfBodyCount:    { value: 0 },
      uMeshSdfBodyOrigin:   { value: [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 0)] },
      uMeshSdfBodyDomain:   { value: [1.0, 1.0, 1.0, 1.0] },
      uMeshSdfBodyScale:    { value: [0.0, 0.0, 0.0, 0.0] },
      uMeshSdfBodyVoxel:    { value: [0.0, 0.0, 0.0, 0.0] },
      uMeshSdfBodyCell:     { value: [new THREE.Vector2(0, 0), new THREE.Vector2(0, 0), new THREE.Vector2(0, 0), new THREE.Vector2(0, 0)] },
      uMeshSdfBodyBounce:   { value: [0.5, 0.5, 0.5, 0.5] },
      uMeshSdfBodyFriction: { value: [0.25, 0.25, 0.25, 0.25] },
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
      // FLIP 3D coupling (Phase 19 stage 2): set only by
      // applyFlip3dCoupleUniforms; the defaults keep the G2P
      // block inert (own atlas uniforms — the 3D grid may run
      // at a different resolution than the Pyro grid).
      uFlip3dCouple:  { value: false },
      // Atlas merge (案B): uFlip3dVelTex / uFlip3dBaseTex are
      // no longer declared in the shader — both fields are
      // read from the merged atlas through uFlipBaseTex. The
      // entries stay (inert) so existing uniform objects keep
      // their shape; applyFlip3dCoupleUniforms no longer
      // assigns them.
      uFlip3dVelTex:  { value: null },
      uFlip3dBaseTex: { value: null },
      uFlip3dBaseTileOffset: { value: 0 },
      uFlip3dBlend:   { value: 0.95 },
      uFlip3dTransfer: { value: 1.0 },
      uFlip3dVelScale: { value: 0 },
      uFlip3dBounds:  { value: new THREE.Vector4(0, 0, 0, 150) },
      uFlip3dGridN:   { value: 1 },
      uFlip3dAtlasSize: { value: new THREE.Vector2(1, 1) },
      uFlip3dAtlasTiles: { value: new THREE.Vector2(1, 1) },
      uFlip3dManualTrilinear: { value: false },
    },
    vertexShader: SIM_VERT, fragmentShader: buildVelocityFragment('', undefined, velocityVariantOptions(config, texSize)),
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
      // Grains projection (Phase 19): disabled is the exact
      // legacy position pass.
      uGrainsProjEnabled: { value: false },
      uGrainsSize:        { value: 8.0 },
      uGrainsProjection:  { value: 1 },
      uGrainsNeighborhood: { value: 0 },
      uGrainsSamples:     { value: 16 },
      // Cell sort (Phase 19 fix2): as on the velocity material.
      uGrainsSortTex:     { value: null },
      uGrainsCellSort:    { value: false },
      uGrainsCellOrigin:  { value: 0 },
      uGrainsCellSize:    { value: 1 },
      uGrainsCellDims:    { value: new THREE.Vector3(1, 1, 1) },
      // Rigid bodies (Phase AU): disabled is the exact legacy path.
      uRigidEnabled:  { value: false },
      uRigidCellTex:  { value: null },
      uRigidBodyTex:  { value: null },
      // Coupling stage 2: free-particle mix (off = verbatim).
      uRigidFreeEnabled:  { value: false },
      uRigidFreeFraction: { value: 0 },
      uRigidBodyCount:    { value: 0 },
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
      // Multi-body mesh SDF: disabled + count 0 is the exact
      // legacy path (the atlas reuses uMeshSdfTex above).
      uMeshSdfMultiEnabled: { value: false },
      uMeshSdfBodyCount:    { value: 0 },
      uMeshSdfBodyOrigin:   { value: [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 0)] },
      uMeshSdfBodyDomain:   { value: [1.0, 1.0, 1.0, 1.0] },
      uMeshSdfBodyScale:    { value: [0.0, 0.0, 0.0, 0.0] },
      uMeshSdfBodyVoxel:    { value: [0.0, 0.0, 0.0, 0.0] },
      uMeshSdfBodyCell:     { value: [new THREE.Vector2(0, 0), new THREE.Vector2(0, 0), new THREE.Vector2(0, 0), new THREE.Vector2(0, 0)] },
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
      // Emitter respawn shape / transform (stage 2, E1/E0):
      // read only by the emitter variants of the position
      // fragment; resolved per frame in runSimulationPasses.
      uRespawnShape:  { value: 0 },
      uEmitterPos:    { value: new THREE.Vector3(0, 0, 0) },
      uEmitterRotScale: { value: new THREE.Matrix3() },
      // Emission sources (stage 2, E3): read only by the
      // emission variants of the position fragment; resolved
      // per frame in runSimulationPasses.
      uEmitCloudTex:  { value: null },
      uEmitPath:      { value: Array.from({ length: 8 }, () => new THREE.Vector3()) },
      uEmitPathCum:   { value: [0, 0, 0, 0, 0, 0, 0, 0] },
      uEmitPathCount: { value: 0 },
      // Path-asset emission (stage 2, B2): read only by the
      // asset variant of the position fragment; the passes
      // fill them from getColumnSupply per frame.
      uEmitColTex:      { value: null },
      uEmitColWidth:    { value: 256 },
      uEmitColHeight:   { value: 2 },
      uEmitPathBase:    { value: 0 },
      uEmitPathTexCount: { value: 0 },
      uEmitMaskEnabled: { value: false },
      // Distribution layer + shader seed (stage 2, B5): read
      // only by the B5 variants of the position fragment;
      // resolved per frame in runSimulationPasses.
      uDistOps:       { value: Array.from({ length: 8 }, () => new THREE.Vector4()) },
      uDistOpCount:   { value: 0 },
      uShaderSeedPhase: { value: 0 },
      // Lifecycle grammar (Phase AB): spawn gate + kill conditions.
      uSpawnRate:   { value: 1.0 },
      uSpawnBurst:  { value: 1.0 },
      uSpawnTime:   { value: 0 },
      // Spawn allocator (stage 2, E2): read only by the
      // allocator / rule-gate variants of the position
      // fragment; the passes fill them per frame.
      uSpawnRateEff:   { value: 1.0 },
      uSpawnClockTime: { value: 0 },
      uSpawnClockPrev: { value: 0 },
      uSpawnRuleGateEnabled: { value: false },
      uSpawnPulseInterval: { value: 0 },
      uSpawnPulseDuty:     { value: 0.3 },
      // Phase AX: cycles 0 / probability 1 = legacy pulse;
      // order mode 0 = legacy hash; event disabled.
      uSpawnPulseCycles:      { value: 0 },
      uSpawnPulseProbability: { value: 1 },
      uSpawnOrderTex:  { value: null },
      uSpawnOrderMode: { value: 0 },
      // Texture-unit fix (Grammar 2.0 stage 1): the live
      // variant declares uInitPosTex + this normaliser in
      // place of uSpawnOrderTex and derives the spawn gate
      // value identically to the velocity pass (see
      // gpgpuShaderSimulationPosition.ts). Both entries are
      // inert outside the live variant string.
      uInitPosTex:        { value: null },
      uSpawnOrderMaxDist: { value: 0 },
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
      uCollisionLifeLoss: { value: 0 },
      uCollisionKill: { value: false },
      uKillMaskTex:  { value: null },
      uKillMaskThreshold: { value: 0.5 },
      uKillMaskInvert: { value: false },
      // Group kill (Phase DG): attribute bake + gate uniforms,
      // resolved per frame in runSimulationPasses.
      uGroupKillEnabled: { value: false },
      // Particle rule kill (G10 stage 1), resolved per frame
      // in runSimulationPasses alongside the group kill.
      uParticleRuleKillEnabled: { value: false },
      // Live particle rule kill (Grammar 2.0 1A), resolved per
      // frame in runSimulationPasses alongside the baked kill.
      uParticleRuleLiveKillEnabled: { value: false },
      // Live true-kill (Grammar 2.0 1C), resolved per frame
      // in runSimulationPasses alongside the live kill.
      uParticleRuleLiveTrueKillEnabled: { value: false },
      uRuleLiveTex:  { value: null },
      // Merged supply (stage 2 texture-unit follow-up): the
      // live reads' y scale, declared only in the merged
      // position variant; inert otherwise.
      uLiveTexYScale: { value: 1 },
      uAttrTex:      { value: null },
      uGroupSlot:    { value: 0 },
      uGroupMode:    { value: 1 },
      uGroupLow:     { value: 0.25 },
      uGroupHigh:    { value: 0.75 },
      uGroupInvert:  { value: false },
    },
    vertexShader: SIM_VERT, fragmentShader: buildPositionFragment({ grainsProjection: grainsProjectionActive(config), grainsCellSort: resolveGrainsCellSortActive(config, getMaxTextureImageUnits()), particleRules: hasEffectiveParticleRules(config.gpgpuParticleRules ?? ''), particleRulesLive: liveRulesPresent(config), particleRulesLiveMerged: mergedSupplyActive(config, texSize), emitterShape: emitterRespawnShapeActive(config), emitterTransform: emitterTransformActive(config), spawnAlloc: spawnAllocVariantActive(config), spawnRuleGate: spawnRuleGateKeyOn(config) && liveSpawnPresent(config), emitterCloud: emissionCloudActive(config), emitterPath: emissionPathActive(config) && !emissionPathAssetActive(config), emitterPathAsset: emissionPathAssetActive(config), emitterMask: emissionMaskVariantActive(config), fieldInstances: fieldInstancesActive(config), emitDistribution: distributionActive(config), shaderSeed: shaderSeedActive(config), rigidFree: !!config.gpgpuRigidFreeEnabled }),
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
      uVellumTearGap:   { value: 0 },
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

// Vellum XPBD materials (Phase 19 stage 3): created always
// (cheap ShaderMaterial shells) but only ever RUN while
// solverMode = 'xpbd' and the xpbd pool exists — legacy mode
// never renders with them.
export function createVellumXpbdClearMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uClearValue: { value: new THREE.Vector4(0, 0, 0, 0) } },
    vertexShader: SIM_VERT, fragmentShader: SIM_VELLUM_XPBD_CLEAR_FRAG,
  });
}
export function createVellumXpbdLambdaMaterial(texSize: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uPosTex: { value: null }, uVellumRestTex: { value: null },
      uVellumStateTex: { value: null }, uLambdaTex: { value: null },
      uVellumTearEnabled: { value: false }, uVellumGlueStateEnabled: { value: false },
      uVellumMode: { value: 0 }, uVellumPin: { value: 1 }, uLambdaSet: { value: 0 },
      uAlphaTilde: { value: 0 }, uAlphaTildeBend: { value: 0 },
      uVellumGlue: { value: 0 }, uTexSizeF: { value: texSize },
    },
    vertexShader: SIM_VERT, fragmentShader: SIM_VELLUM_XPBD_LAMBDA_FRAG,
  });
}
export function createVellumXpbdProjMaterial(texSize: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uPosTex: { value: null }, uVellumRestTex: { value: null },
      uVellumStateTex: { value: null }, uLambda0Tex: { value: null }, uLambda1Tex: { value: null },
      uVellumTearEnabled: { value: false }, uVellumGlueStateEnabled: { value: false },
      uVellumMode: { value: 0 }, uVellumPin: { value: 1 },
      uVellumGlue: { value: 0 }, uVellumTearGap: { value: 0 },
      uXpbdRelaxation: { value: 0.25 }, uTexSizeF: { value: texSize },
    },
    vertexShader: SIM_VERT, fragmentShader: SIM_VELLUM_XPBD_PROJ_FRAG,
  });
}
export function createVellumVolumeReduceMaterial(texSize: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uSrcTex: { value: null }, uPosTex: { value: null },
      uLevel0: { value: true }, uSrcSizeF: { value: texSize },
      uTexSizeF: { value: texSize }, uVellumMode: { value: 1 }, uVellumPin: { value: 1 },
    },
    vertexShader: SIM_VERT, fragmentShader: SIM_VELLUM_VOLUME_REDUCE_FRAG,
  });
}
export function createVellumVolumeProjMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uVolumeTex: { value: null }, uRestVolume: { value: 0 },
      uTargetRatio: { value: 1 }, uAlphaTildeVol: { value: 0 }, uVolumeDenom: { value: 1 },
    },
    vertexShader: SIM_VERT, fragmentShader: SIM_VELLUM_VOLUME_PROJ_FRAG,
  });
}
export function createVellumVolumeApplyMaterial(texSize: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uPosTex: { value: null }, uLambdaVolTex: { value: null }, uVellumGradTex: { value: null },
      uVellumMode: { value: 1 }, uVellumPin: { value: 1 }, uTexSizeF: { value: texSize },
    },
    vertexShader: SIM_VERT, fragmentShader: SIM_VELLUM_VOLUME_APPLY_FRAG,
  });
}
export function createVellumXpbdVelMaterial(texSize: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uPosTex: { value: null }, uPrevPosTex: { value: null }, uVelTex: { value: null },
      uDt: { value: 1 / 60 }, uVellumDamping: { value: 0.05 },
      uVellumMode: { value: 0 }, uVellumPin: { value: 1 }, uTexSizeF: { value: texSize },
    },
    vertexShader: SIM_VERT, fragmentShader: SIM_VELLUM_XPBD_VEL_FRAG,
  });
}

// ── Aux variant delivery (stage-4 gate fix round 2, B2) ──
// The six Aux materials live in state (not useMemo) because
// the variant swap effect below REPLACES them when the
// variant key flips: a fresh ShaderMaterial built around the
// SAME uniforms object (shared by reference — the passes'
// per-frame fills land unchanged) and the same vertex shader,
// with the replaced material disposed. The pre-fix swap
// rewrote fragmentShader on the shared instances; that was
// the one delivery path never runtime-verified since stage-4
// S6, and the G4-5 gate showed the trail variant never
// reaching the running program (zero spawns over all slots
// and emit ticks while the spawn logic itself is proven
// correct). A fresh material cannot inherit a stale compiled
// program, so replacement closes the whole class. The stock
// shader strings are untouched: at the defaults the initial
// materials build exactly the pre-fix strings (pinned by
// stage4-trail-aux-s6).
export interface ActiveAuxMaterials {
  vel: THREE.ShaderMaterial;
  pos: THREE.ShaderMaterial;
  inherit: THREE.ShaderMaterial;
  chainVel: THREE.ShaderMaterial;
  chainPos: THREE.ShaderMaterial;
  chainInherit: THREE.ShaderMaterial;
}
let activeAuxMaterials: ActiveAuxMaterials | null = null;
// Read by the ?diag=1 hook's captureAuxVariantInfo (the
// getActiveOrientPass pattern): which fragment strings the
// live Aux materials actually carry.
export function getActiveAuxMaterials(): ActiveAuxMaterials | null {
  return activeAuxMaterials;
}
function rebuildAuxMaterial(old: THREE.ShaderMaterial, fragmentShader: string): THREE.ShaderMaterial {
  const next = new THREE.ShaderMaterial({
    uniforms: old.uniforms,
    vertexShader: old.vertexShader,
    fragmentShader,
  });
  old.dispose();
  return next;
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const vellumXpbdClearMat = useMemo(() => createVellumXpbdClearMaterial(), []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const vellumXpbdLambdaMat = useMemo(() => createVellumXpbdLambdaMaterial(texSize), []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const vellumXpbdProjMat = useMemo(() => createVellumXpbdProjMaterial(texSize), []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const vellumVolumeReduceMat = useMemo(() => createVellumVolumeReduceMaterial(texSize), []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const vellumVolumeProjMat = useMemo(() => createVellumVolumeProjMaterial(), []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const vellumVolumeApplyMat = useMemo(() => createVellumVolumeApplyMaterial(texSize), []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const vellumXpbdVelMat = useMemo(() => createVellumXpbdVelMaterial(texSize), []);

  // Aux event emission materials (B3): the shared event uniforms are
  // declared in gpgpuShaderAux's AUX_EVENT_GLSL chunk; the passes in
  // gpgpuSimulationPasses.runAuxSimulationPasses fill them per frame.
  const [auxVelMat, setAuxVelMat] = useState(() => new THREE.ShaderMaterial({
    uniforms: {
      uAuxPosTex:    { value: null },
      uAuxVelTex:    { value: null },
      uMainPosTex:   { value: null },
      uMainVelTex:   { value: null },
      // Grammar connection (1D-3): declared in the shader
      // only in the ruleSpawn variant; the passes fill it
      // per frame with the REP's latest output.
      uMainRuleTex:  { value: null },
      uMainTexSizeF: { value: texSize },
      uAuxCount:     { value: 4096 },
      uAuxMode:      { value: 0 },
      uAuxIntensity: { value: 1.0 },
      uAuxSpeed:     { value: 26.0 },
      uAuxLife:      { value: 0.75 },
      uAuxGravityScale: { value: 1.0 },
      uAuxDrag:      { value: 0 },
      uAuxCurl:      { value: 0 },
      // Spawn inheritance (1D-1): declared in the shader only
      // in the inherit-scale variant; the passes fill it per
      // frame from gpgpuAuxInheritVelScale.
      uAuxInheritVelScale: { value: 1.0 },
      // Child emitter (1D-2): declared in the shader only in
      // the emit variant; the passes fill them per frame.
      uAuxEmitRate:   { value: 30 },
      uAuxEmitShape:  { value: 0 },
      uAuxEmitSpread: { value: 0.5 },
      // Trail mechanism (stage 4, S6): declared in the shader
      // only in the trail variant; the passes fill them per
      // frame from gpgpuTrailEmitInterval / gpgpuTrailEmitRate.
      uTrailEmitInterval: { value: 2 },
      uTrailEmitRate:     { value: 1.0 },
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
      // Phase 20 stage 4: declared in the shader only in the
      // SDF-splash variant; the passes fill these per frame.
      uSdfEnabled:   { value: false },
      uSdfShape:     { value: 0 },
      uSdfX:         { value: 0 },
      uSdfY:         { value: 0 },
      uSdfZ:         { value: 0 },
      uSdfSize:      { value: 0 },
    },
    vertexShader: SIM_VERT, fragmentShader: buildAuxVelFrag({ sdfSplash: auxSdfSplashActive(config), inheritVelScale: auxInheritVelScaleActive(config), emit: auxEmitLevel1Active(config), ruleSpawn: auxRuleSpawnLevel1Active(config), trail: trailAuxActive(config) }),
  }));

  const [auxPosMat, setAuxPosMat] = useState(() => new THREE.ShaderMaterial({
    uniforms: {
      uAuxPosTex:    { value: null },
      uAuxVelTex:    { value: null },
      uAuxVelOutTex: { value: null },
      uMainPosTex:   { value: null },
      uMainVelTex:   { value: null },
      // Grammar connection (1D-3): see auxVelMat above.
      uMainRuleTex:  { value: null },
      uMainTexSizeF: { value: texSize },
      uAuxCount:     { value: 4096 },
      uAuxMode:      { value: 0 },
      uAuxIntensity: { value: 1.0 },
      uAuxSpeed:     { value: 26.0 },
      // Child emitter (1D-2): see auxVelMat above.
      uAuxEmitRate:   { value: 30 },
      uAuxEmitShape:  { value: 0 },
      uAuxEmitSpread: { value: 0.5 },
      // Trail mechanism (stage 4, S6): declared in the shader
      // only in the trail variant; the passes fill them per
      // frame from gpgpuTrailEmitInterval / gpgpuTrailEmitRate.
      uTrailEmitInterval: { value: 2 },
      uTrailEmitRate:     { value: 1.0 },
      uAgeEnabled:   { value: false },
      uAgeMax:       { value: 8.0 },
      uFloorEnabled: { value: false },
      uFloorY:       { value: -110.0 },
      uBounceRadius: { value: 150.0 },
      uDelta:        { value: 0.016 },
      uTime:         { value: 0 },
      // Phase 20 stage 4: see auxVelMat above.
      uSdfEnabled:   { value: false },
      uSdfShape:     { value: 0 },
      uSdfX:         { value: 0 },
      uSdfY:         { value: 0 },
      uSdfZ:         { value: 0 },
      uSdfSize:      { value: 0 },
    },
    vertexShader: SIM_VERT, fragmentShader: buildAuxPosFrag({ sdfSplash: auxSdfSplashActive(config), emit: auxEmitLevel1Active(config), ruleSpawn: auxRuleSpawnLevel1Active(config), trail: trailAuxActive(config) }),
  }));

  // Aux chain materials (Phase W1): one shared pair for levels 2
  // and 3 — the passes run sequentially per level with that level's
  // uniforms and salt, so a single material pair serves both. The
  // event uniforms are declared in AUX_CHAIN_EVENT_GLSL.
  const [auxChainVelMat, setAuxChainVelMat] = useState(() => new THREE.ShaderMaterial({
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
      // Spawn inheritance (1D-1): see auxVelMat above.
      uAuxInheritVelScale: { value: 1.0 },
      // Child emitter (1D-2): see auxVelMat above.
      uAuxEmitRate:   { value: 30 },
      uAuxEmitShape:  { value: 0 },
      uAuxEmitSpread: { value: 0.5 },
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
    vertexShader: SIM_VERT, fragmentShader: buildAuxChainVelFrag({ inheritVelScale: auxInheritVelScaleActive(config), emit: auxEmitChainActive(config) }),
  }));

  const [auxChainPosMat, setAuxChainPosMat] = useState(() => new THREE.ShaderMaterial({
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
      // Child emitter (1D-2): see auxVelMat above.
      uAuxEmitRate:   { value: 30 },
      uAuxEmitShape:  { value: 0 },
      uAuxEmitSpread: { value: 0.5 },
      uChainSalt:    { value: 0 },
      uFloorEnabled: { value: false },
      uFloorY:       { value: -110.0 },
      uBounceRadius: { value: 150.0 },
      uDelta:        { value: 0.016 },
      uTime:         { value: 0 },
    },
    vertexShader: SIM_VERT, fragmentShader: buildAuxChainPosFrag({ emit: auxEmitChainActive(config) }),
  }));

  // Spawn inheritance write materials (Grammar 2.0 stage 1,
  // slice 1D-1): the sparse-write pass that mirrors the velocity
  // pass's spawn decision into the per-level inheritance
  // texture. The level-1 material re-evaluates the level-1 event
  // chunk (with the SDF-splash variant in step with the pair);
  // the chain material re-evaluates the chain event chunk and
  // copies the upper level's inheritance texel. The passes in
  // gpgpuSimulationPasses fill the uniforms per frame; the
  // materials render only while inheritance is on.
  const [auxInheritMat, setAuxInheritMat] = useState(() => new THREE.ShaderMaterial({
    uniforms: {
      uAuxPosTex:    { value: null },
      uAuxVelTex:    { value: null },
      uMainPosTex:   { value: null },
      uMainVelTex:   { value: null },
      // Grammar connection (1D-3): see auxVelMat above —
      // the inheritance write re-evaluates the ruleSpawn
      // decision, so it binds the REP texture too.
      uMainRuleTex:  { value: null },
      uMainTexSizeF: { value: texSize },
      uAuxCount:     { value: 4096 },
      uAuxMode:      { value: 0 },
      uAuxIntensity: { value: 1.0 },
      uAuxSpeed:     { value: 26.0 },
      // Child emitter (1D-2): see auxVelMat above.
      uAuxEmitRate:   { value: 30 },
      uAuxEmitShape:  { value: 0 },
      uAuxEmitSpread: { value: 0.5 },
      // Trail mechanism (stage 4, S6): declared in the shader
      // only in the trail variant; the passes fill them per
      // frame from gpgpuTrailEmitInterval / gpgpuTrailEmitRate.
      uTrailEmitInterval: { value: 2 },
      uTrailEmitRate:     { value: 1.0 },
      uAgeEnabled:   { value: false },
      uAgeMax:       { value: 8.0 },
      uFloorEnabled: { value: false },
      uFloorY:       { value: -110.0 },
      uBounceRadius: { value: 150.0 },
      uMainAttrTex:  { value: null },
      uSpeciesCount: { value: 4 },
      uDelta:        { value: 0.016 },
      uTime:         { value: 0 },
      // Phase 20 stage 4: declared only in the SDF-splash
      // variant of the event chunk.
      uSdfEnabled:   { value: false },
      uSdfShape:     { value: 0 },
      uSdfX:         { value: 0 },
      uSdfY:         { value: 0 },
      uSdfZ:         { value: 0 },
      uSdfSize:      { value: 0 },
    },
    vertexShader: SIM_VERT, fragmentShader: buildAuxInheritFrag({ sdfSplash: auxSdfSplashActive(config), emit: auxEmitLevel1Active(config), ruleSpawn: auxRuleSpawnLevel1Active(config), trail: trailAuxActive(config) }),
  }));

  const [auxChainInheritMat, setAuxChainInheritMat] = useState(() => new THREE.ShaderMaterial({
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
      // Child emitter (1D-2): see auxVelMat above.
      uAuxEmitRate:   { value: 30 },
      uAuxEmitShape:  { value: 0 },
      uAuxEmitSpread: { value: 0.5 },
      uChainSalt:    { value: 0 },
      uFloorEnabled: { value: false },
      uFloorY:       { value: -110.0 },
      uBounceRadius: { value: 150.0 },
      uSrcInheritTex: { value: null },
      uDelta:        { value: 0.016 },
      uTime:         { value: 0 },
    },
    vertexShader: SIM_VERT, fragmentShader: buildAuxInheritFrag({ chain: true, emit: auxEmitChainActive(config) }),
  }));

  // Stage-4 gate fix round 2 (B2): publish the current Aux
  // materials for the ?diag=1 hook's variant readout. The
  // variant swap below replaces the materials, so the
  // registry follows the state values, not the first-render
  // instances; the cleanup clears only its own registration.
  useEffect(() => {
    activeAuxMaterials = {
      vel: auxVelMat,
      pos: auxPosMat,
      inherit: auxInheritMat,
      chainVel: auxChainVelMat,
      chainPos: auxChainPosMat,
      chainInherit: auxChainInheritMat,
    };
    return () => {
      if (activeAuxMaterials?.vel === auxVelMat) activeAuxMaterials = null;
    };
  }, [auxVelMat, auxPosMat, auxChainVelMat, auxChainPosMat, auxInheritMat, auxChainInheritMat]);

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

  // Grains cell sort (Phase 19 fix2): the cell-key pass feeding
  // the shared bitonic material above. The passes drive it only
  // while the runtime's sort pool exists (Grains on + complete
  // neighbourhood); the grid uniforms are rewritten per frame.
  const grainsCellKeyMat = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      uPosTex:          { value: null },
      uGrainsCellOrigin: { value: 0 },
      uGrainsCellSize:   { value: 1 },
      uGrainsCellDims:   { value: new THREE.Vector3(1, 1, 1) },
    },
    vertexShader: SIM_VERT, fragmentShader: GRAINS_CELL_KEY_FRAG,
  }), []);

  // Grains pile solver (Stage C): the lambda + delta materials
  // of the density-constraint iterations. The passes drive them
  // only while the runtime's pile targets exist (pile plan
  // active); the uniforms are rewritten per frame / iteration.
  const grainsPileLambdaMat = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      uPosTex:          { value: null },
      uTexSizeF:        { value: texSize },
      uGrainsSize:      { value: 8 },
      uGrainsSupport:   { value: 16 },
      uGrainsRho0:      { value: 0.003 },
      uGrainsSortTex:   { value: null },
      uGrainsCellSort:  { value: false },
      uGrainsCellOrigin: { value: 0 },
      uGrainsCellSize:   { value: 1 },
      uGrainsCellDims:   { value: new THREE.Vector3(1, 1, 1) },
    },
    vertexShader: SIM_VERT, fragmentShader: GRAINS_PILE_LAMBDA_FRAG,
  }), []);
  const grainsPileDeltaMat = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      uPosTex:          { value: null },
      uLambdaTex:       { value: null },
      uBasePosTex:      { value: null },
      uVelTex:          { value: null },
      uTexSizeF:        { value: texSize },
      uGrainsSize:      { value: 8 },
      uGrainsSupport:   { value: 16 },
      uGrainsRho0:      { value: 0.003 },
      uGrainsStiffness: { value: 0.25 },
      uGrainsFriction:  { value: 0.6 },
      uBounceRadius:    { value: 300 },
      uFloorEnabled:    { value: false },
      uFloorY:          { value: -110 },
      uGrainsSortTex:   { value: null },
      uGrainsCellSort:  { value: false },
      uGrainsCellOrigin: { value: 0 },
      uGrainsCellSize:   { value: 1 },
      uGrainsCellDims:   { value: new THREE.Vector3(1, 1, 1) },
    },
    vertexShader: SIM_VERT, fragmentShader: GRAINS_PILE_DELTA_FRAG,
  }), []);

  // Grains velocity update (Stage C follow-up): the PBF-style
  // velocity reconstruction that runs once after the pile
  // iterations while the plan's velocity update is active. The
  // uniforms are rewritten per frame; the pass renders into the
  // shared spare target and is blitted back over velOut.
  const grainsVelocityUpdateMat = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      uPosTex:     { value: null },
      uPosInTex:   { value: null },
      uVelTex:     { value: null },
      uDt:         { value: 0.016 },
      uSpeed:      { value: 1 },
      uBlend:      { value: 1 },
      uGrainsSize: { value: 8 },
      uDensityTex: { value: null },
      uRho0:       { value: 0.003 },
      uDenseDamp:  { value: 0.8 },
      uDenseLo:    { value: 0.8 },
      uDenseHi:    { value: 1.1 },
    },
    vertexShader: SIM_VERT, fragmentShader: GRAINS_VELOCITY_UPDATE_FRAG,
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

  // FLIP 3D materials (Phase 19 stage 2): the atlas solver's
  // passes. The shared atlas uniforms are declared in
  // PYRO_GRID_COMMON (the flip3d shaders compose it); the pass
  // runner (gpgpuFlip3dPasses) fills every uniform per step, so
  // the defaults here are placeholders only. The vorticity pair
  // reuses the Pyro grid's curl / force shaders on the atlas,
  // and the clear reuses the FLIP clear.
  const flip3dSplatMat = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      ...pyroCommonUniforms(),
      uPosTex:       { value: null },
      uVelTex:       { value: null },
      uBounceRadius: { value: 150.0 },
      uFluidScale:   { value: 1.5 },
      uCellOffset:   { value: new THREE.Vector3(0, 0, 0) },
    },
    vertexShader: FLIP3D_SPLAT_VERT, fragmentShader: FLIP3D_SPLAT_FRAG,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
    depthTest: false,
    depthWrite: false,
    transparent: false,
  }), []);
  const flip3dCompositeMat = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      ...pyroCommonUniforms(),
      uTransferTex: { value: null },
      uAvgWeight:   { value: 1.0 },
    },
    vertexShader: SIM_VERT, fragmentShader: FLIP3D_COMPOSITE_FRAG,
  }), []);
  const flip3dPhiMat = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      ...pyroCommonUniforms(),
      uTransferTex: { value: null },
      uAvgWeight:   { value: 1.0 },
    },
    vertexShader: SIM_VERT, fragmentShader: FLIP3D_PHI_FRAG,
  }), []);
  const flip3dPhiAdvectMat = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      ...pyroCommonUniforms(),
      uPhiIn:       { value: null },
      uVelTex:      { value: null },
      uTransferTex: { value: null },
      uAvgWeight:   { value: 1.0 },
      uDelta:       { value: 0.016 },
    },
    vertexShader: SIM_VERT, fragmentShader: FLIP3D_PHI_ADVECT_FRAG,
  }), []);
  const flip3dViscosityMat = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      ...pyroCommonUniforms(),
      uVelStar: { value: null },
      uVelIter: { value: null },
      uPhiTex:  { value: null },
      uAlpha:   { value: 0 },
    },
    vertexShader: SIM_VERT, fragmentShader: FLIP3D_VISCOSITY_FRAG,
  }), []);
  const flip3dCurvatureMat = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      ...pyroCommonUniforms(),
      uPhiTex: { value: null },
    },
    vertexShader: SIM_VERT, fragmentShader: FLIP3D_CURVATURE_FRAG,
  }), []);
  const flip3dTensionMat = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      ...pyroCommonUniforms(),
      uVelIn:   { value: null },
      uPhiTex:  { value: null },
      uCurvTex: { value: null },
      uSigma:   { value: 0 },
      uDelta:   { value: 0.016 },
    },
    vertexShader: SIM_VERT, fragmentShader: FLIP3D_TENSION_FRAG,
  }), []);
  const flip3dJacobiMat = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      ...pyroCommonUniforms(),
      uVelTex: { value: null },
      uPresIn: { value: null },
      uPhiTex: { value: null },
    },
    vertexShader: SIM_VERT, fragmentShader: FLIP3D_JACOBI_FRAG,
  }), []);
  const flip3dSubtractMat = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      ...pyroCommonUniforms(),
      uVelIn:   { value: null },
      uPresTex: { value: null },
      uPhiTex:  { value: null },
    },
    vertexShader: SIM_VERT, fragmentShader: FLIP3D_SUBTRACT_FRAG,
  }), []);
  const flip3dCurlMat = pyroCurlMat;
  const flip3dVorticityForceMat = pyroVorticityForceMat;
  const flip3dClearMat = flipClearMat;
  // Atlas merge copy (FLIP WebGL 案B, S1): half-writing
  // pass-through copy into the merged Vel+Base atlas. Drawn by
  // runFlip3dPasses at the end of every step; nothing reads the
  // merged atlas yet (S3 binds it on the velocity side).
  const flip3dAtlasCopyMat = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      uSrcTex: { value: null },
      uHalf:   { value: 0 },
    },
    vertexShader: SIM_VERT, fragmentShader: FLIP3D_ATLAS_COPY_FRAG,
    blending: THREE.NoBlending,
    depthTest: false,
    depthWrite: false,
    transparent: false,
  }), []);

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

  // Whitewater 3D materials (Phase 19 stage 2): the foam pool's
  // two passes while the FLIP mode is '3d'. The shared spawn
  // uniforms are declared in gpgpuShaderWhitewater3d's
  // WW3_SPAWN_GLSL chunk; runWhitewaterSimulationPasses fills
  // them per frame in its 3D branch.
  const ww3CommonUniforms = () => ({
    uWw3VelTex:       { value: null },
    uWw3PhiTex:       { value: null },
    uWw3GridN:        { value: 1 },
    uWw3AtlasSize:    { value: new THREE.Vector2(1, 1) },
    uWw3AtlasTiles:   { value: new THREE.Vector2(1, 1) },
    uWw3ManualTrilinear: { value: false },
    uBounceRadius:    { value: 150.0 },
    uFluidScale:      { value: 1.5 },
    uWwThreshold:     { value: 0.3 },
    uWwAmount:        { value: 1.0 },
    uWw3VelScale:     { value: 0 },
  });
  const ww3VelMat = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      ...ww3CommonUniforms(),
      uWwPosTex: { value: null },
      uWwVelTex: { value: null },
      uWwLife:   { value: 0.7 },
      uDelta:    { value: 0.016 },
      uTime:     { value: 0 },
    },
    vertexShader: SIM_VERT, fragmentShader: WW3_VEL_FRAG,
  }), []);
  const ww3PosMat = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      ...ww3CommonUniforms(),
      uWwPosTex:    { value: null },
      uWwVelTex:    { value: null },
      uWwVelOutTex: { value: null },
      uDelta:       { value: 0.016 },
      uTime:        { value: 0 },
    },
    vertexShader: SIM_VERT, fragmentShader: WW3_POS_FRAG,
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
  // Downgrade notice (design §4.3, generalised by E3): the
  // downgrade resolved in velocityVariantOptions is never
  // silent — mirror its state into the notice store the root
  // layout renders.
  useEffect(() => {
    setFlip3dGrainsDowngrade(grainsFullScanDowngradeApplies(config, getMaxTextureImageUnits()));
  }, [config]);
  // Phase 19 gate fix: the applied-key ref also tracks the Phase
  // 19 string variant, and it starts at the creation key (the
  // factories above already built the material from the initial
  // config's variant), so a variant-only change swaps the shader
  // through this same path and the mount behaviour is unchanged.
  const variantKeyOf = (opts: VelocityFragmentVariantOptions) =>
    `${opts.grainsFullScan ? 1 : 0}${opts.flip3dCouple ? 1 : 0}${opts.steeringSeek ? 1 : 0}${opts.sphAkinci ? 1 : 0}${opts.attractor2 ? 1 : 0}${opts.attractor3 ? 1 : 0}${opts.attractor4 ? 1 : 0}${opts.grainsPileXsph ? 1 : 0}${opts.crowd ? 1 : 0}${opts.particleRules ? 1 : 0}${opts.particleRulesLive ? 1 : 0}${opts.spawnAlloc ? 1 : 0}${opts.emitterVelocity ? 1 : 0}${opts.fieldInstances ? 1 : 0}${opts.pathAssets ? 1 : 0}${opts.crowdPathAssets ? 1 : 0}${opts.relDrag ? 1 : 0}${opts.targetSpeed ? 1 : 0}${opts.ageFreeVelocity ? 1 : 0}${opts.ageFreeForce ? 1 : 0}${opts.meanderStandalone ? 1 : 0}${opts.mergedSupply ? 1 : 0}${opts.rigidFree ? 1 : 0}`;
  const appliedForceCodeRef = useRef<string | null>(
    `\n\n${variantKeyOf(velocityVariantOptions(config, texSize))}`,
  );
  useEffect(() => {
    const enabled = config.gpgpuCustomForceEnabled;
    const code = enabled ? config.gpgpuCustomForceCode : '';
    // Phase 18 stage 2: the force order key rides the same swap
    // path. The applied-key ref tracks code + order together.
    const order = config.gpgpuForceOrder ?? '';
    // Phase 19 gate fix: the string variant rides the same path.
    const variantOpts = velocityVariantOptions(config, texSize);
    const appliedKey = `${code}\n${order}\n${variantKeyOf(variantOpts)}`;
    if (!code.trim()) {
      if (appliedForceCodeRef.current !== appliedKey) {
        // No custom snippet: the base is the stock shader for the
        // current order + variant (the default order with no
        // variant on is SIM_VEL_FRAG itself).
        velSimMat.fragmentShader = buildVelocityFragment('', order, variantOpts);
        velSimMat.needsUpdate = true;
        appliedForceCodeRef.current = appliedKey;
      }
      setCustomForceStatus({ state: 'inactive' });
      return;
    }
    // KCB1: keep ctrl() uniform values in sync even when only values changed
    // (no shader rebuild). Runs before the applied-code early return.
    syncCtrlUniforms(velSimMat.uniforms as Record<string, { value: unknown }>, extractCustomForceControls(code).decls, config.gpgpuCustomForceCtrlValues);
    if (appliedForceCodeRef.current === appliedKey) return;
    const validation = validateCustomForceCode(code);
    if (!validation.ok) {
      setCustomForceStatus({ state: 'error', message: validation.error ?? 'invalid code' });
      return;
    }
    const built = buildVelocityFragment(code, order, variantOpts);
    const check = compileCheckShader(gl.getContext() as WebGL2RenderingContext, SIM_VERT, buildCustomForceHarness(code));
    if (!check.ok) {
      setCustomForceStatus({ state: 'error', message: check.error ?? 'compile failed' });
      return;
    }
    velSimMat.fragmentShader = built;
    velSimMat.needsUpdate = true;
    appliedForceCodeRef.current = appliedKey;
    setCustomForceStatus({ state: 'active' });
  }, [config.gpgpuCustomForceEnabled, config.gpgpuCustomForceCode, config.gpgpuCustomForceCtrlValues, config.gpgpuForceOrder, config.gpgpuGrainsNeighborhood, config.gpgpuGrainsPileEnabled, config.gpgpuGrainsXsphStrength, config.gpgpuFlipMode, config.gpgpuFlipEnabled, config.gpgpuFluidEnabled, config.gpgpuAttractor2Enabled, config.gpgpuAttractor3Enabled, config.gpgpuAttractor4Enabled, config.gpgpuParticleRules, config.gpgpuParticleRulesLive, config.gpgpuSpawnRateAbsolute, config.gpgpuSpawnEnvelopeEnabled, config.gpgpuEmitterVelMode, config.gpgpuFieldInstances, config.gpgpuFieldLayers, config.gpgpuSteerSeekEnabled, config.gpgpuSteerSeekMode, config.gpgpuCrowdEnabled, config.gpgpuSteerSeekPaths, config.gpgpuSteerSeekPathSvg, config.gpgpuTargetSpeed, config.gpgpuRelDragRate, config.gpgpuAgeCurveVelocityEnabled, config.gpgpuAgeCurveVelocityFreeEnabled, config.gpgpuAgeCurveForceEnabled, config.gpgpuAgeCurveForceFreeEnabled, config.gpgpuMeanderEnabled, config.gpgpuParticleLifeMeanderAmount, config.gpgpuPredationEnabled, config.gpgpuPredationOutcome, config.gpgpuPredationStrike, config.gpgpuPredationStrikeFrames, config.gpgpuPredationGraceSeconds, config.gpgpuGroupsData, gl, velSimMat]);

  // Phase 19 gate fix: the position material's string variant
  // follows the Grains projection activity (the same condition
  // that resolves uGrainsProjEnabled in the passes). The factory
  // built the initial variant from the initial config; this
  // effect swaps it when the condition flips.
  // Phase 19 fix2: the variant key gains the cell-sort activity
  // (Grains on + complete neighbourhood) — while it holds, the
  // projection segment searches the sorted cell index instead
  // of walking the whole texture.
  const posVariantKey = (c: ParticleConfig) => `${grainsProjectionActive(c)}:${resolveGrainsCellSortActive(c, getMaxTextureImageUnits())}:${hasEffectiveParticleRules(c.gpgpuParticleRules ?? '')}:${liveRulesPresent(c)}:${mergedSupplyActive(c, texSize)}:${emitterRespawnShapeActive(c)}:${emitterTransformActive(c)}:${spawnAllocVariantActive(c)}:${spawnRuleGateKeyOn(c) && liveSpawnPresent(c)}:${emissionCloudActive(c)}:${emissionPathActive(c)}:${emissionPathAssetActive(c)}:${emissionMaskVariantActive(c)}:${fieldInstancesActive(c)}:${distributionActive(c)}:${shaderSeedActive(c)}:${!!c.gpgpuRigidFreeEnabled}`;
  const posProjectionRef = useRef(posVariantKey(config));
  useEffect(() => {
    const key = posVariantKey(config);
    if (posProjectionRef.current === key) return;
    posProjectionRef.current = key;
    posSimMat.fragmentShader = buildPositionFragment({
      grainsProjection: grainsProjectionActive(config),
      grainsCellSort: resolveGrainsCellSortActive(config, getMaxTextureImageUnits()),
      particleRules: hasEffectiveParticleRules(config.gpgpuParticleRules ?? ''),
      rigidFree: !!config.gpgpuRigidFreeEnabled,
      particleRulesLive: liveRulesPresent(config),
      particleRulesLiveMerged: mergedSupplyActive(config, texSize),
      emitterShape: emitterRespawnShapeActive(config),
      emitterTransform: emitterTransformActive(config),
      spawnAlloc: spawnAllocVariantActive(config),
      spawnRuleGate: spawnRuleGateKeyOn(config) && liveSpawnPresent(config),
      emitterCloud: emissionCloudActive(config),
      emitterPath: emissionPathActive(config) && !emissionPathAssetActive(config),
      emitterPathAsset: emissionPathAssetActive(config),
      emitterMask: emissionMaskVariantActive(config),
      fieldInstances: fieldInstancesActive(config),
      emitDistribution: distributionActive(config),
      shaderSeed: shaderSeedActive(config),
    });
    posSimMat.needsUpdate = true;
  }, [config.gpgpuGrainsEnabled, config.gpgpuGrainsProjection, config.gpgpuGrainsNeighborhood, config.gpgpuParticleRules, config.gpgpuRigidFreeEnabled, config.gpgpuParticleRulesLive, config.gpgpuRespawnShape, config.gpgpuEmitterPosX, config.gpgpuEmitterPosY, config.gpgpuEmitterPosZ, config.gpgpuEmitterRotX, config.gpgpuEmitterRotY, config.gpgpuEmitterRotZ, config.gpgpuEmitterScale, config.gpgpuSpawnRateAbsolute, config.gpgpuSpawnEnvelopeEnabled, config.gpgpuSpawnRuleGateEnabled, config.gpgpuPredationEnabled, config.gpgpuPredationBirth, config.gpgpuEmitSource, config.gpgpuEmitMaskEnabled, config.gpgpuMaskSource, config.gpgpuSteerSeekPath, config.gpgpuSteerSeekPaths, config.gpgpuSteerSeekPathSvg, config.gpgpuFieldInstances, config.gpgpuFieldLayers, config.gpgpuPredationOutcome, config.gpgpuPredationStrike, config.gpgpuGroupsData, config.gpgpuEmitDistribution, config.gpgpuShaderSeed, posSimMat]);

  // Phase 20 stage 4 (UE5 #22): the Aux pair's string variant
  // follows the SDF-splash activity (SDF collider on + bounceSplash
  // mode), the same condition the passes use to fill the SDF
  // uniforms. The factories built the initial variant from the
  // initial config; this effect swaps it when the condition flips.
  // Trail A/B minimisation (stage-4 gate fix round 6,
  // STAGE4_FIX11_AUX_AB_RECORD): DIAG ONLY. The ?diag=1
  // hook requests a stage through lib/auxTrailAbDiag; the
  // registered applier lands it in this state, and the
  // variant effect below rebuilds the level-1 trio with it
  // (the chain pair never carries the trail branch, so it
  // never rebuilds for a stage change). No product code
  // path requests a stage: the state stays 'A', the guard
  // below sees no change, and the materials keep the stock
  // strings byte-for-byte.
  const [auxTrailAbStage, setAuxTrailAbStage] = useState<AuxTrailAbStage>('A');
  useEffect(() => registerAuxTrailAbApplier((stage) => setAuxTrailAbStage(stage)), []);
  const auxVariantRef = useRef({
    sdfSplash: auxSdfSplashActive(config),
    inheritVelScale: auxInheritVelScaleActive(config),
    emit: auxEmitLevel1Active(config),
    chainEmit: auxEmitChainActive(config),
    ruleSpawn: auxRuleSpawnLevel1Active(config),
    // Trail mechanism (stage 4, S6): a LEVEL-1 dimension
    // like ruleSpawn — the chain pair never rebuilds for it.
    trail: trailAuxActive(config),
    // Trail A/B stage (fix round 6): a LEVEL-1 dimension
    // like trail; 'A' is the stock branch.
    trailAb: 'A' as AuxTrailAbStage,
  });
  useEffect(() => {
    const sdfSplash = auxSdfSplashActive(config);
    const inheritVelScale = auxInheritVelScaleActive(config);
    // Child emitter (1D-2): the emit variant follows the
    // level's mode — level 1 reads gpgpuAuxMode, the chain
    // pair reads the shared gpgpuAux2Mode.
    const emit = auxEmitLevel1Active(config);
    const chainEmit = auxEmitChainActive(config);
    // Grammar connection (1D-3): the ruleSpawn variant is a
    // LEVEL-1 dimension only (the REP exists only for the
    // main pool) — the chain pair never rebuilds for it.
    const ruleSpawn = auxRuleSpawnLevel1Active(config);
    // Trail mechanism (stage 4, S6): the trail variant is a
    // LEVEL-1 dimension like ruleSpawn.
    const trail = trailAuxActive(config);
    // Trail A/B stage (fix round 6): a LEVEL-1 dimension
    // like trail. Driven only by the ?diag=1 hook; in
    // product use it stays 'A' and this effect's behaviour
    // is unchanged.
    const trailAb = auxTrailAbStage;
    if (auxVariantRef.current.sdfSplash === sdfSplash
      && auxVariantRef.current.inheritVelScale === inheritVelScale
      && auxVariantRef.current.emit === emit
      && auxVariantRef.current.chainEmit === chainEmit
      && auxVariantRef.current.ruleSpawn === ruleSpawn
      && auxVariantRef.current.trail === trail
      && auxVariantRef.current.trailAb === trailAb) return;
    const trailAbChanged = auxVariantRef.current.trailAb !== trailAb;
    auxVariantRef.current = { sdfSplash, inheritVelScale, emit, chainEmit, ruleSpawn, trail, trailAb };
    // Stage-4 gate fix round 2 (B2): the swap REPLACES the
    // six materials (fresh ShaderMaterial around the shared
    // uniforms object, replaced instance disposed) instead of
    // rewriting fragmentShader on the shared instances — see
    // the delivery note above rebuildAuxMaterial. The ref
    // guard above still gates this on an actual variant-key
    // change, so the setters below run only on a flip; the
    // re-render they cause re-enters this effect with the key
    // already applied and returns at the guard.
    setAuxVelMat(rebuildAuxMaterial(auxVelMat, buildAuxVelFrag({ sdfSplash, inheritVelScale, emit, ruleSpawn, trail, trailAb })));
    setAuxPosMat(rebuildAuxMaterial(auxPosMat, buildAuxPosFrag({ sdfSplash, emit, ruleSpawn, trail, trailAb })));
    setAuxChainVelMat(rebuildAuxMaterial(auxChainVelMat, buildAuxChainVelFrag({ inheritVelScale, emit: chainEmit })));
    setAuxChainPosMat(rebuildAuxMaterial(auxChainPosMat, buildAuxChainPosFrag({ emit: chainEmit })));
    setAuxInheritMat(rebuildAuxMaterial(auxInheritMat, buildAuxInheritFrag({ sdfSplash, emit, ruleSpawn, trail, trailAb })));
    setAuxChainInheritMat(rebuildAuxMaterial(auxChainInheritMat, buildAuxInheritFrag({ chain: true, emit: chainEmit })));
    // Report the A/B stage this rebuild carried, so the
    // diag hook can separate "requested" from "applied"
    // (only on an actual stage change — config-driven
    // rebuilds preserve the stage silently).
    if (trailAbChanged) noteAuxTrailAbApplied(trailAb);
  }, [config.gpgpuSdfEnabled, config.gpgpuAuxMode, config.gpgpuAux2Mode, config.gpgpuAuxInheritSlots, config.gpgpuAuxInheritVelScale, config.gpgpuTrailEnabled, config.gpgpuTrailMode, auxTrailAbStage, auxVelMat, auxPosMat, auxChainVelMat, auxChainPosMat, auxInheritMat, auxChainInheritMat]);

  return {
    simMeshRef,
    velSimMat,
    posSimMat,
    vellumProjMat,
    vellumStateMat,
    vellumVelMat,
    vellumXpbdClearMat,
    vellumXpbdLambdaMat,
    vellumXpbdProjMat,
    vellumVolumeReduceMat,
    vellumVolumeProjMat,
    vellumVolumeApplyMat,
    vellumXpbdVelMat,
    auxVelMat,
    auxPosMat,
    auxChainVelMat,
    auxChainPosMat,
    auxInheritMat,
    auxChainInheritMat,
    wwVelMat,
    wwPosMat,
    blitMat,
    sortDepthMat,
    bitonicMat,
    grainsCellKeyMat,
    grainsPileLambdaMat,
    grainsPileDeltaMat,
    grainsVelocityUpdateMat,
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
    flip3dSplatMat,
    flip3dCompositeMat,
    flip3dPhiMat,
    flip3dPhiAdvectMat,
    flip3dViscosityMat,
    flip3dCurvatureMat,
    flip3dTensionMat,
    flip3dJacobiMat,
    flip3dSubtractMat,
    flip3dCurlMat,
    flip3dVorticityForceMat,
    flip3dClearMat,
    flip3dAtlasCopyMat,
    ww3VelMat,
    ww3PosMat,
  };
}
