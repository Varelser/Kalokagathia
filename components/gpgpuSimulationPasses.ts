import type { MutableRefObject } from 'react';
import * as THREE from 'three';
import type { ParticleConfig } from '../types';
import {
  stepWebGPUCompute,
  readbackWebGPUPositions,
} from '../lib/webgpuCompute';
import { particleLifeUniformArray } from '../lib/gpgpuParticleLife';
import { EMIT_SHAPE_IDS } from '../lib/gpgpuEmitShapes';
import { clampEmitterVelSpeed, clampEmitterVelSpread, emitterRotScaleElements, resolveEmitterBaseDirection, resolveEmitterTransform } from '../lib/gpgpuEmitter';
import { resolveSpawnRateEff } from '../lib/gpgpuSpawnAllocator';
import { resolveVellum } from '../lib/gpgpuVellum';
import { XPBD_JACOBI_RELAXATION } from '../lib/xpbdConstraints';
import { effectiveGrainsFriction, grainsCellGrid, grainsDemConfigEpochValue, grainsNeighborhoodMode, grainsProjectionActive, resolveGrainsDemGrid, resolveGrainsDemPlan, resolveGrainsPilePlan, resolveGrainsProjection, GRAINS_VELOCITY_DENSE_DAMP, GRAINS_VELOCITY_DENSE_HI, GRAINS_VELOCITY_DENSE_LO, type GrainsCellGrid } from '../lib/gpgpuGrains';
import { resolveGrainsCellSortActive, resolveGrainsNeighborhoodMode } from '../lib/flip3dAtlasDowngrade';
import { getMaxTextureImageUnits } from '../lib/gpuDiagnostics';
import { resolveRigid } from '../lib/rigidBodies';
import { crowdAvoidStrength, packSteeringPath, resolveCrowd, resolveSteeringSeek } from '../lib/steering';
import { packEmissionPathCum, resolveEmissionPath } from '../lib/gpgpuEmissionSource';
import { packDistributionOps, resolveDistributionOps } from '../lib/gpgpuDistribution';
import { resolveShaderSeedPhase } from '../lib/gpgpuRandom';
import { resolveEmitLightPos } from '../lib/gpgpuLightUnits';
import { meanderStandaloneActive } from '../lib/gpgpuMeander';
import { COLUMN_TEX_WIDTH, FIELD_COLUMN_LAYOUT, fieldLayerSlotAttrActive } from '../lib/gpgpuFieldInstances';
import { b3SlotAttrActive, resolveRelDrag, resolveTargetSpeed } from '../lib/gpgpuSpeedDragSpin';
import { getColumnSupply, resolvePathAsset } from '../lib/gpgpuPathAssets';
import { resolveMergedSupplyPlan } from '../lib/gpgpuMergedSupply';
import { normalizeAttrSlot, resolveAttrConsumers, resolveAttrDynInterval } from '../lib/gpgpuAttributes';
import { parseGpgpuGroups, resolveGroupGate } from '../lib/gpgpuGroups';
import { hasEffectiveParticleRules, particleRulesHaveAction } from '../lib/gpgpuParticleRules';
import {
  buildRuleEvalWgsl,
  liveRulesHaveAction,
  liveRulesHaveConsumedAction,
  resolveLiveParticleRules,
} from '../lib/gpgpuParticleRulesLive';
import { predationActive, predationBirthActive, predationTrueKillActive } from '../lib/gpgpuPredation';
import { resolveTrailAuxLifeSeconds, resolveTrailEmitInterval, resolveTrailEmitRate, trailAuxActive, TRAIL_AUX_MODE_ID } from '../lib/trailAux';
import {
  auxPassLandingArmed,
  getAuxPassDiagState,
  noteAuxPassLandingSample,
  noteAuxPassRender,
  AUX_PASS_LANDING_TEXELS,
} from '../lib/auxPassDiag';
import {
  auxTickProbeArmedSide,
  noteAuxTickProbeSample,
  AUX_TICK_PROBE_TEXELS,
} from '../lib/auxTickProbeDiag';
import { normalizeAgeCurvePoints } from '../lib/ageCurve';
import { ageCurveTargetSuppressed, resolveAgeFreeCurve } from '../lib/gpgpuAgeFreeCurves';
import { isFreeCurveIdentity, normalizeFreeCurvePoints, FREE_CURVE_MAX_POINTS } from '../lib/freeCurve';
import {
  getTerrainSlopeGradientTexture,
  terrainSlopeWorldExtent,
  getTerrainColliderTexture,
  terrainColliderHeightWorld,
  terrainColliderGradientScale,
  TERRAIN_DERIVED_SIZE,
} from '../lib/terrainDerivedMaps';
import {
  getMeshSdfCollider,
  getMeshSdfMultiCollider,
  meshSdfWorldScale,
  type MeshSdfMultiColliderData,
} from '../lib/meshSdfCollider';
import {
  pyroGridCurrentVelTexture,
  type PyroGridTargets,
} from './gpgpuPyroGridPasses';
import { pyroGridVelScale } from '../lib/pyroGrid';
import { flip3dActive, flip3dHalfExtent, resolveFlip3dResolution } from '../lib/flip3d';
import { resolveEffectiveTierSync } from '../lib/gpuTier';
import {
  flip3dCurrentVelTexture,
  type Flip3dTargets,
} from './gpgpuFlip3dPasses';
import { contactReplayEnabled, type GpgpuContactPass } from './gpgpuContactPass';

/**
 * Fill the multi-body mesh SDF uniforms of one sim material from
 * a ready multi collider. Bodies are compacted in body-number
 * order; slots past the count keep their zero defaults and are
 * never read (the shader loop breaks at uMeshSdfBodyCount).
 * Bounce/Friction arrays exist only on the velocity material.
 */
function applyMeshSdfMultiUniforms(
  uniforms: Record<string, { value: unknown }>,
  multi: MeshSdfMultiColliderData,
): void {
  if (uniforms.uMeshSdfMultiEnabled) uniforms.uMeshSdfMultiEnabled.value = true;
  if (uniforms.uMeshSdfBodyCount) uniforms.uMeshSdfBodyCount.value = multi.bodies.length;
  const origins = uniforms.uMeshSdfBodyOrigin?.value as THREE.Vector3[] | undefined;
  const cells = uniforms.uMeshSdfBodyCell?.value as THREE.Vector2[] | undefined;
  const domains = uniforms.uMeshSdfBodyDomain?.value as number[] | undefined;
  const scales = uniforms.uMeshSdfBodyScale?.value as number[] | undefined;
  const voxels = uniforms.uMeshSdfBodyVoxel?.value as number[] | undefined;
  const bounces = uniforms.uMeshSdfBodyBounce?.value as number[] | undefined;
  const frictions = uniforms.uMeshSdfBodyFriction?.value as number[] | undefined;
  multi.bodies.forEach((body, i) => {
    if (origins?.[i]) origins[i].set(body.origin[0], body.origin[1], body.origin[2]);
    if (cells?.[i]) cells[i].set(body.cellUv[0], body.cellUv[1]);
    // Defect fix 2026-11-27: pass the real domain through. The
    // old `> 0 ? : 1.0` substitution defeated the shader's
    // `domain <= 0` guard, so a zero-domain body (worldScale 0)
    // read as a live unit domain with distance 0 everywhere.
    if (domains) domains[i] = body.domainWorld;
    if (scales) scales[i] = body.scale;
    if (voxels) voxels[i] = body.voxelWorld;
    if (bounces) bounces[i] = Math.max(0, Math.min(1, body.bounce ?? 0.5));
    if (frictions) frictions[i] = Math.max(0, Math.min(1, body.friction ?? 0.25));
  });
  if (uniforms.uMeshSdfTex) uniforms.uMeshSdfTex.value = multi.texture;
}

/** Reset the multi-body uniforms to the disabled defaults. */
function clearMeshSdfMultiUniforms(uniforms: Record<string, { value: unknown }>): void {
  if (uniforms.uMeshSdfMultiEnabled) uniforms.uMeshSdfMultiEnabled.value = false;
  if (uniforms.uMeshSdfBodyCount) uniforms.uMeshSdfBodyCount.value = 0;
}

// Particle Life matrix cache: the flat uniform array only changes when
// preset / species / seed change, so avoid reallocating it every frame.
let plMatrixCacheKey = '';
let plMatrixCacheValue: Float32Array | null = null;
function resolveParticleLifeMatrix(config: ParticleConfig): Float32Array {
  const key = `${config.gpgpuParticleLifePreset}|${config.gpgpuParticleLifeSpecies}|${config.gpgpuParticleLifeSeed}`;
  if (key !== plMatrixCacheKey || !plMatrixCacheValue) {
    plMatrixCacheKey = key;
    plMatrixCacheValue = particleLifeUniformArray(
      config.gpgpuParticleLifePreset,
      config.gpgpuParticleLifeSpecies,
      config.gpgpuParticleLifeSeed,
    );
  }
  return plMatrixCacheValue;
}
import type { WebGPUComputeState } from '../lib/webgpuCompute';
import { AUX_TEX_SIZE, buildAuxTickProbeFrag } from './gpgpuShaderAux';
import type { AuxLevelParams } from '../lib/auxChain';
import { AUX_EMIT_SHAPE_IDS } from '../lib/auxEmit';
import { resolvePingPongTargets } from './gpgpuExecutionRouting';
import { replicaAgeBase, replicaSeedOffset, replicaTimeOffset } from '../lib/replicaIndependent';

export function updateMouseWorldPosition(args: {
  mouseNDC: THREE.Vector2;
  camera: THREE.Camera;
  mouseWorld: THREE.Vector3;
  tempVec: THREE.Vector3;
  tempDir: THREE.Vector3;
}): void {
  const { mouseNDC, camera, mouseWorld, tempVec, tempDir } = args;
  tempVec.set(mouseNDC.x, mouseNDC.y, 0.5).unproject(camera);
  tempDir.copy(tempVec).sub(camera.position).normalize();
  mouseWorld.copy(camera.position).addScaledVector(tempDir, camera.position.length());
}

export function blitPreviousPositionPass(args: {
  config: ParticleConfig;
  prevPosRT: THREE.WebGLRenderTarget | null;
  blitMat: THREE.ShaderMaterial;
  simMesh: THREE.Mesh;
  gl: THREE.WebGLRenderer;
  simScene: THREE.Scene;
  simCamera: THREE.Camera;
  posTexture: THREE.Texture;
}): void {
  const { config, prevPosRT, blitMat, simMesh, gl, simScene, simCamera, posTexture } = args;
  if (!config.gpgpuVerletEnabled || !prevPosRT) return;
  blitMat.uniforms.uTex.value = posTexture;
  simMesh.material = blitMat;
  gl.setRenderTarget(prevPosRT);
  gl.render(simScene, simCamera);
}

export function runFluidAdvectionPass(args: {
  config: ParticleConfig;
  fluidRTA: THREE.WebGLRenderTarget | null;
  fluidRTB: THREE.WebGLRenderTarget | null;
  fluidPingIsA: MutableRefObject<boolean>;
  fluidAdvectMat: THREE.ShaderMaterial;
  velSimMat: THREE.ShaderMaterial;
  simMesh: THREE.Mesh;
  gl: THREE.WebGLRenderer;
  simScene: THREE.Scene;
  simCamera: THREE.Camera;
  dt: number;
  time: number;
  // FLIP layer (Phase AT): the transfer / pressure targets, the
  // FLIP materials, the splat points (one vertex per particle
  // texel) and the frame-start particle textures. All optional:
  // absent extras (or the key off) keep the legacy one-way
  // advection path below byte-identical.
  flipTransferRT?: THREE.WebGLRenderTarget | null;
  flipPressureRT?: THREE.WebGLRenderTarget | null;
  flipSplatMat?: THREE.ShaderMaterial;
  flipCompositeMat?: THREE.ShaderMaterial;
  flipJacobiMat?: THREE.ShaderMaterial;
  flipSubtractMat?: THREE.ShaderMaterial;
  flipClearMat?: THREE.ShaderMaterial;
  flipPoints?: THREE.Points | null;
  flipPosTex?: THREE.Texture | null;
  flipVelTex?: THREE.Texture | null;
  // Vorticity confinement (Phase DL): the two extra materials.
  // Absent (or the keys off) keeps the FLIP pipeline below
  // byte-identical.
  flipVorticityCurlMat?: THREE.ShaderMaterial;
  flipVorticityForceMat?: THREE.ShaderMaterial;
  // Phase DL (sampling wiring): receives the render target
  // holding this frame's resolved final fluid field — the
  // projected field after every stage — or null while the
  // fluid is off. Consumers (whitewater, the ?diag=1 field
  // capture) must not guess it from the ping state: with
  // vorticity confinement on, the final field lands in the
  // composite target instead of the ping target.
  fluidFinalTargetRef?: { current: THREE.WebGLRenderTarget | null };
}): void {
  const {
    config,
    fluidRTA,
    fluidRTB,
    fluidPingIsA,
    fluidAdvectMat,
    velSimMat,
    simMesh,
    gl,
    simScene,
    simCamera,
    dt,
    time,
    flipTransferRT,
    flipPressureRT,
    flipSplatMat,
    flipCompositeMat,
    flipJacobiMat,
    flipSubtractMat,
    flipClearMat,
    flipPoints,
    flipPosTex,
    flipVelTex,
    flipVorticityCurlMat,
    flipVorticityForceMat,
    fluidFinalTargetRef,
  } = args;

  const flipActive = Boolean(
    config.gpgpuFluidEnabled && config.gpgpuFlipEnabled &&
    flipTransferRT && flipPressureRT && flipSplatMat && flipCompositeMat &&
    flipJacobiMat && flipSubtractMat && flipClearMat && flipPoints && flipPosTex && flipVelTex,
  );

  if (config.gpgpuFluidEnabled && fluidRTA && fluidRTB) {
    const fluidIn = fluidPingIsA.current ? fluidRTA : fluidRTB;
    const fluidOut = fluidPingIsA.current ? fluidRTB : fluidRTA;
    fluidAdvectMat.uniforms.uFluidIn.value = fluidIn.texture;
    fluidAdvectMat.uniforms.uDelta.value = dt;
    fluidAdvectMat.uniforms.uFluidDiffuse.value = config.gpgpuFluidDiffuse;
    fluidAdvectMat.uniforms.uFluidDecay.value = config.gpgpuFluidDecay;
    fluidAdvectMat.uniforms.uFluidStrength.value = config.gpgpuFluidStrength;
    fluidAdvectMat.uniforms.uTime.value = time;
    fluidAdvectMat.uniforms.uFluidExtForce.value = config.gpgpuFluidExtForce;
    simMesh.material = fluidAdvectMat;
    gl.setRenderTarget(fluidOut);
    gl.render(simScene, simCamera);
    fluidPingIsA.current = !fluidPingIsA.current;
    const currentFluid = fluidPingIsA.current ? fluidRTA : fluidRTB;
    velSimMat.uniforms.uFluidEnabled.value = true;
    velSimMat.uniforms.uFluidTex.value = currentFluid.texture;
    velSimMat.uniforms.uFluidInfluence.value = config.gpgpuFluidInfluence;
    velSimMat.uniforms.uFluidScale.value = config.gpgpuFluidScale;
    if (!flipActive) {
      if (velSimMat.uniforms.uFlipEnabled) velSimMat.uniforms.uFlipEnabled.value = false;
      if (fluidFinalTargetRef) fluidFinalTargetRef.current = currentFluid;
      return;
    }

    // FLIP 3D (Phase 19 stage 2): in '3d' mode the 2D FLIP
    // pipeline below does not run — the atlas solver
    // (runFlip3dPasses, stepped from the scene like the Pyro
    // grid) owns the transfer, and the velocity pass couples
    // through its own FLIP3D block. The 2D field keeps
    // advecting and feeding the legacy one-way consumers
    // exactly as the no-FLIP path above.
    if (config.gpgpuFlipMode === '3d') {
      if (velSimMat.uniforms.uFlipEnabled) velSimMat.uniforms.uFlipEnabled.value = false;
      if (fluidFinalTargetRef) fluidFinalTargetRef.current = currentFluid;
      return;
    }

    // ── FLIP layer (Phase AT) ──
    // currentFluid currently holds the advected field. The
    // pipeline below turns fluidIn (now free) into the composite
    // (pre-projection) field and lands the projected field back
    // in currentFluid, so the ping state above stays valid.
    const baseRT = fluidIn;
    const finalRT = currentFluid;
    const transferRT = flipTransferRT!;
    const pressureRT = flipPressureRT!;

    const clearInto = (rt: THREE.WebGLRenderTarget) => {
      simMesh.material = flipClearMat!;
      gl.setRenderTarget(rt);
      gl.render(simScene, simCamera);
    };

    // P2G: clear the transfer target, then deposit every
    // particle's momentum in 4 bilinear shares. Draw order is
    // the particle index order, so accumulation is
    // deterministic.
    clearInto(transferRT);
    flipSplatMat!.uniforms.uPosTex.value = flipPosTex;
    flipSplatMat!.uniforms.uVelTex.value = flipVelTex;
    flipSplatMat!.uniforms.uBounceRadius.value = config.gpgpuBounceRadius;
    flipSplatMat!.uniforms.uFluidScale.value = config.gpgpuFluidScale;
    simScene.add(flipPoints!);
    simMesh.visible = false;
    gl.setRenderTarget(transferRT);
    for (let oy = 0; oy <= 1; oy++) {
      for (let ox = 0; ox <= 1; ox++) {
        (flipSplatMat!.uniforms.uCellOffset.value as THREE.Vector2).set(ox, oy);
        gl.render(simScene, simCamera);
      }
    }
    simMesh.visible = true;
    simScene.remove(flipPoints!);

    // Composite: advected field + momentum average by coverage
    // → the pre-projection grid velocity in baseRT.
    flipCompositeMat!.uniforms.uAdvTex.value = finalRT.texture;
    flipCompositeMat!.uniforms.uTransferTex.value = transferRT.texture;
    flipCompositeMat!.uniforms.uAvgWeight.value = Math.max(1, config.gpgpuCount) / (64 * 64);
    simMesh.material = flipCompositeMat!;
    gl.setRenderTarget(baseRT);
    gl.render(simScene, simCamera);

    // Vorticity confinement (Phase DL, DD5a): while active,
    // two passes run on the composite field before the
    // projection — curl (composite → transferRT) and the
    // Fedkiw confinement force (→ finalRT, whose advected
    // contents the composite already consumed). The projection
    // then reads the FORCED field and lands back in baseRT, so
    // the target roles swap: the final field is baseRT and the
    // FLIP base texture (the pre-projection field the G2P
    // increment is formed against) is the forced field in
    // finalRT. Inactive, every assignment below reduces to the
    // legacy one and no extra pass runs.
    const vorticityActive = Boolean(
      config.gpgpuFlipVorticityEnabled && config.gpgpuFlipVorticityEpsilon > 0 &&
      flipVorticityCurlMat && flipVorticityForceMat,
    );
    let projectSourceRT: THREE.WebGLRenderTarget = baseRT;
    let projectedRT: THREE.WebGLRenderTarget = finalRT;
    if (vorticityActive) {
      flipVorticityCurlMat!.uniforms.uVelTex.value = baseRT.texture;
      simMesh.material = flipVorticityCurlMat!;
      gl.setRenderTarget(transferRT);
      gl.render(simScene, simCamera);
      flipVorticityForceMat!.uniforms.uVelTex.value = baseRT.texture;
      flipVorticityForceMat!.uniforms.uCurlTex.value = transferRT.texture;
      flipVorticityForceMat!.uniforms.uDelta.value = dt;
      flipVorticityForceMat!.uniforms.uEpsilon.value = config.gpgpuFlipVorticityEpsilon;
      simMesh.material = flipVorticityForceMat!;
      gl.setRenderTarget(finalRT);
      gl.render(simScene, simCamera);
      projectSourceRT = finalRT;
      projectedRT = baseRT;
    }

    // Pressure projection: Jacobi ping-pong between the (now
    // consumed) transfer target and the pressure target, both
    // cleared to zero pressure first. The divergence source is
    // the fixed pre-projection field (the composite, or the
    // forced field while vorticity confinement is active).
    clearInto(transferRT);
    clearInto(pressureRT);
    const iterations = Math.max(0, Math.min(32, Math.round(config.gpgpuFlipPressureIterations)));
    let presIn: THREE.WebGLRenderTarget = transferRT;
    let presOut: THREE.WebGLRenderTarget = pressureRT;
    flipJacobiMat!.uniforms.uVelTex.value = projectSourceRT.texture;
    for (let i = 0; i < iterations; i++) {
      flipJacobiMat!.uniforms.uPresIn.value = presIn.texture;
      simMesh.material = flipJacobiMat!;
      gl.setRenderTarget(presOut);
      gl.render(simScene, simCamera);
      const swap = presIn; presIn = presOut; presOut = swap;
    }

    // Gradient subtraction: projected field → projectedRT
    // (finalRT legacy, baseRT with vorticity confinement).
    flipSubtractMat!.uniforms.uVelTex.value = projectSourceRT.texture;
    flipSubtractMat!.uniforms.uPresTex.value = presIn.texture;
    simMesh.material = flipSubtractMat!;
    gl.setRenderTarget(projectedRT);
    gl.render(simScene, simCamera);

    velSimMat.uniforms.uFluidTex.value = projectedRT.texture;
    velSimMat.uniforms.uFlipEnabled.value = true;
    velSimMat.uniforms.uFlipBaseTex.value = projectSourceRT.texture;
    velSimMat.uniforms.uFlipBlend.value = config.gpgpuFlipBlend;
    velSimMat.uniforms.uFlipTransfer.value = config.gpgpuFlipTransfer;
    if (fluidFinalTargetRef) fluidFinalTargetRef.current = projectedRT;
    return;
  }

  velSimMat.uniforms.uFluidEnabled.value = false;
  if (velSimMat.uniforms.uFlipEnabled) velSimMat.uniforms.uFlipEnabled.value = false;
  if (fluidFinalTargetRef) fluidFinalTargetRef.current = null;
}

// Pyro grid coupling (Phase CB): fills the velocity material's
// pyro uniforms from the grid targets' latest step, in the same
// shape as the FLIP fill at the end of runFluidAdvectionPass.
// The block in the shader only runs while the grid is enabled,
// has stepped at least once, and the blend key is above 0 — at
// blend 0 (the default) the couple flag stays false and the
// velocity pass is untouched, which is what keeps grid-ON with
// default coupling keys byte-identical.
export function applyPyroGridCoupleUniforms(args: {
  config: ParticleConfig;
  velSimMat: THREE.ShaderMaterial;
  targets: PyroGridTargets | null;
  useWebGPU: boolean;
}): void {
  const { config, velSimMat, targets, useWebGPU } = args;
  const u = velSimMat.uniforms;
  if (!u.uPyroGridCouple) return;
  const active = !useWebGPU
    && config.gpgpuPyroGridEnabled
    && targets !== null
    && targets.framesStepped > 0
    && targets.baseVelTexture !== null
    && config.gpgpuPyroGridBlend > 0;
  if (!active) {
    u.uPyroGridCouple.value = false;
    return;
  }
  const t = targets as PyroGridTargets;
  u.uPyroGridCouple.value = true;
  u.uPyroGridVelTex.value = pyroGridCurrentVelTexture(t);
  u.uPyroGridBaseTex.value = t.baseVelTexture;
  u.uPyroGridBlend.value = config.gpgpuPyroGridBlend;
  u.uPyroGridTransfer.value = config.gpgpuPyroGridTransfer;
  u.uPyroGridVelScale.value = pyroGridVelScale(config.gpgpuBounceRadius, t.resolution);
  if (u.uGridN) u.uGridN.value = t.resolution;
  if (u.uAtlasSize) (u.uAtlasSize.value as THREE.Vector2).set(t.atlasWidth, t.atlasHeight);
  if (u.uAtlasTiles) (u.uAtlasTiles.value as THREE.Vector2).set(t.tilesX, t.tilesY);
  if (u.uManualTrilinear) u.uManualTrilinear.value = !t.floatLinear;
  if (u.uPyroGridBounds) (u.uPyroGridBounds.value as THREE.Vector4).set(0, 0, 0, config.gpgpuBounceRadius);
}

// Grains cell sort (Phase 19 fix2): build the spatial cell
// index of the frame-start positions — a cell-key pass into
// sortRTA, then the shared bitonic machinery (the same
// stage/step drive as runDepthSortPass in gpgpuVisualUpdates)
// sorts the pool DESCENDING by cell key. The velocity contact
// loop and the position projection segment both binary-search
// the result. The last-written target is tracked explicitly
// (the depth sort's return relies on pass parity; a searched
// structure must hand back the fully sorted texture, so this
// runner does not copy that convention).
export function runGrainsCellSortPass(args: {
  gl: THREE.WebGLRenderer;
  simScene: THREE.Scene;
  simCamera: THREE.Camera;
  simMesh: THREE.Mesh;
  posTexture: THREE.Texture;
  texSize: number;
  grid: GrainsCellGrid;
  sortRTA: THREE.WebGLRenderTarget | null;
  sortRTB: THREE.WebGLRenderTarget | null;
  cellKeyMat: THREE.ShaderMaterial;
  bitonicMat: THREE.ShaderMaterial;
}): THREE.Texture | null {
  const { gl, simScene, simCamera, simMesh, posTexture, texSize, grid, sortRTA, sortRTB, cellKeyMat, bitonicMat } = args;
  if (!sortRTA || !sortRTB) return null;

  cellKeyMat.uniforms.uPosTex.value = posTexture;
  cellKeyMat.uniforms.uGrainsCellOrigin.value = grid.origin;
  cellKeyMat.uniforms.uGrainsCellSize.value = grid.cellSize;
  (cellKeyMat.uniforms.uGrainsCellDims.value as THREE.Vector3).set(grid.dimX, grid.dimY, grid.dimZ);
  simMesh.material = cellKeyMat;
  gl.setRenderTarget(sortRTA);
  gl.render(simScene, simCamera);

  const logN = Math.log2(texSize * texSize);
  let pingA = true;
  let current: THREE.WebGLRenderTarget = sortRTA;
  bitonicMat.uniforms.uTexSizeF.value = texSize;
  for (let stage = 0; stage < logN; stage++) {
    for (let step = stage; step >= 0; step--) {
      const sIn = pingA ? sortRTA : sortRTB;
      const sOut = pingA ? sortRTB : sortRTA;
      bitonicMat.uniforms.uSortIn.value = sIn.texture;
      bitonicMat.uniforms.uStep.value = step;
      bitonicMat.uniforms.uStage.value = stage;
      simMesh.material = bitonicMat;
      gl.setRenderTarget(sOut);
      gl.render(simScene, simCamera);
      current = sOut;
      pingA = !pingA;
    }
  }
  return current.texture;
}

export function runSimulationPasses(args: {
  useWebGPU: boolean;
  config: ParticleConfig;
  texSize: number;
  dt: number;
  time: number;
  blast: number;
  mouseWorld: THREE.Vector3;
  simMesh: THREE.Mesh;
  gl: THREE.WebGLRenderer;
  simScene: THREE.Scene;
  simCamera: THREE.Camera;
  posIn: THREE.WebGLRenderTarget;
  posOut: THREE.WebGLRenderTarget;
  velIn: THREE.WebGLRenderTarget;
  velOut: THREE.WebGLRenderTarget;
  velSimMat: THREE.ShaderMaterial;
  posSimMat: THREE.ShaderMaterial;
  initPosTex: THREE.Texture | null;
  // Named attributes (Phase AK): the static attribute texture in
  // the global texel layout, or null while no consumer is active
  // (the runtime builds it on demand) — null keeps every
  // attribute uniform off and the velocity pass on its exact
  // legacy path.
  attrTex?: THREE.Texture | null;
  // Live particle rules (Grammar 2.0 stage 1, slice 1A): the
  // rule evaluation pass's latest output texture, or null
  // while no REP exists (no live rules) — null keeps both
  // live uniforms off and the consumers on their baked-only
  // path.
  ruleLiveTex?: THREE.Texture | null;
  // Contact pass (Grammar 2.0 stage 1, the slice-1B
  // follow-up): the scene supplies the pass only while a
  // live rule condition reads hit / hits. The runner drives
  // it between the velocity and position renders (run under
  // the plain-Euler resolution, suppress otherwise — see
  // components/gpgpuContactPass.ts). The replica-stack
  // runner passes none, so stacks never drive it (the scene
  // suppresses it there instead).
  contactPass?: GpgpuContactPass | null;
  morphTex: THREE.Texture | null;
  // Emission cloud (stage 2, E3): the runtime's published
  // emission-source cloud texture (the morph cloud reused as
  // a source, or the bitmap cloud); read only by the cloud
  // variant of the position fragment. The replica-stack
  // runner passes none — stacks never emit from a cloud.
  emitCloudTex?: THREE.Texture | null;
  morphNormalTex: THREE.Texture | null;
  morphKickStart: number;
  prevPosTex: THREE.Texture | null;
  // Lifecycle grammar (Phase AB): seconds since the spawn epoch
  // (the scene resets the epoch when the spawn keys / pool change;
  // defaults to `time` when the caller does not track one) and the
  // resolved Phase X mask texture for the mask kill (null unless
  // the kill is on and the mask image is ready).
  spawnTime?: number;
  // Spawn allocator (stage 2, E2): the envelope clock the
  // allocator variant's thresholds run on, accumulated by the
  // scene (advanceSpawnEnvelopeClock); the previous frame's
  // value rides alongside for the activation tests. Both fall
  // back to the spawn time (and spawn time − dt) when the
  // caller does not track them.
  spawnClockTime?: number;
  spawnClockPrev?: number;
  killMaskTex?: THREE.Texture | null;
  // Group kill (Phase DG): the replica-stack runner sets this —
  // in a stack pass vUv is stack-local while the attribute bake
  // is in the global layout, so the group kill must stay off
  // there (the same suppression style as vellum / rigid).
  suppressGroupKill?: boolean;
  // Spawn order (Phase AX): the baked distance-order texture for
  // the pool's initial positions (built by the runtime alongside
  // the initial data). Null unless the order mode is a distance
  // mode — the passes then resolve uSpawnOrderMode 0 and the
  // shaders read the legacy hash, so a missing texture can never
  // change the order silently.
  spawnOrderTex?: THREE.Texture | null;
  // Texture-unit fix (Grammar 2.0 stage 1): the spawn-order
  // bake's normaliser (spawnDistanceMaxValue over the same
  // initial positions). The live shader variants derive the
  // gate value from the initial-position texture divided by
  // this scalar instead of sampling the order texture, so
  // the velocity live variant stays inside the 16-unit
  // floor. Set alongside spawnOrderTex by the runtime.
  spawnOrderMaxDist?: number;
  // Multi-touch interference (Phase AO): world positions of all
  // tracked pointers (index 0 = primary) and how many entries are
  // live. Only consulted while gpgpuMouseMultiTouch is on; absent
  // or off keeps uMouseCount at 0 and the legacy path verbatim.
  mouseWorldMulti?: THREE.Vector3[];
  mouseMultiCount?: number;
  // Vellum (Phase AR): shared-path extras for the constraint
  // solver — the rest-pose texture, the projection / tear-state
  // materials, the tear ping-pong pair, a scratch target for the
  // projection ping-pong (the Verlet previous-position RT, whose
  // frame-start copy the position pass has already consumed) and
  // the blit material for the final landing copy. All optional:
  // the replica-stack runner passes none of them (the runtime
  // suppresses stacks while the solver is on), and absent extras
  // skip the solver's passes entirely.
  vellumRestTex?: THREE.Texture | null;
  vellumProjMat?: THREE.ShaderMaterial;
  vellumStateMat?: THREE.ShaderMaterial;
  vellumVelMat?: THREE.ShaderMaterial;
  vellumStateIn?: THREE.WebGLRenderTarget | null;
  vellumStateOut?: THREE.WebGLRenderTarget | null;
  vellumSpareRT?: THREE.WebGLRenderTarget | null;
  blitMat?: THREE.ShaderMaterial;
  // Grains cell sort (Phase 19 fix2): the cell-key material,
  // the shared bitonic material and the sort ping-pong pair
  // (allocated by the runtime only while Grains runs the
  // complete neighbourhood). All optional: the replica-stack
  // runner passes none of them, and absent extras leave
  // uGrainsCellSort false — the shaders keep their complete
  // scan fallback and no sort pass runs.
  grainsCellKeyMat?: THREE.ShaderMaterial;
  grainsBitonicMat?: THREE.ShaderMaterial;
  grainsSortRTA?: THREE.WebGLRenderTarget | null;
  grainsSortRTB?: THREE.WebGLRenderTarget | null;
  // Grains pile solver (Stage C): the lambda / delta materials,
  // the lambda target, the pile-start snapshot target and a
  // spare target for the iteration ping-pong (the scene passes
  // the Verlet previous-position RT, whose frame-start copy the
  // position pass has already consumed — the same spare the
  // Vellum iterations use, sequentially). All optional: absent
  // extras skip the pile iterations entirely.
  grainsPileLambdaMat?: THREE.ShaderMaterial;
  grainsPileDeltaMat?: THREE.ShaderMaterial;
  grainsVelocityUpdateMat?: THREE.ShaderMaterial;
  grainsLambdaRT?: THREE.WebGLRenderTarget | null;
  grainsPileBaseRT?: THREE.WebGLRenderTarget | null;
  grainsPileSpareRT?: THREE.WebGLRenderTarget | null;
  // Vellum XPBD (Phase 19 stage 3): the Δλ-solve extras — the
  // four new materials, the λ pair, the volume reduction chain
  // + 1×1 volume-λ target, and the baked volume gradient
  // texture with its rest volume / denominator. All optional
  // and only ever supplied in xpbd mode; absent extras keep
  // the runner on the legacy projection below.
  vellumXpbdClearMat?: THREE.ShaderMaterial;
  vellumXpbdLambdaMat?: THREE.ShaderMaterial;
  vellumXpbdProjMat?: THREE.ShaderMaterial;
  vellumVolumeReduceMat?: THREE.ShaderMaterial;
  vellumVolumeProjMat?: THREE.ShaderMaterial;
  vellumVolumeApplyMat?: THREE.ShaderMaterial;
  vellumXpbdVelMat?: THREE.ShaderMaterial;
  vellumLambda0RT?: THREE.WebGLRenderTarget | null;
  vellumLambda1RT?: THREE.WebGLRenderTarget | null;
  vellumVolumeChain?: THREE.WebGLRenderTarget[] | null;
  vellumLambdaVolRT?: THREE.WebGLRenderTarget | null;
  vellumGradTex?: THREE.Texture | null;
  vellumVolumeInfo?: { restVolume: number; denom: number } | null;
  // Rigid bodies (Phase AU): the per-particle cell texture and
  // the solver's body-state texture. The solver itself is stepped
  // CPU-side by the scene before this runner is called; these
  // textures are the whole contract. Absent (no morph cloud to
  // bind) keeps the rigid uniforms off and every path verbatim.
  rigidCellTex?: THREE.Texture | null;
  rigidBodyTex?: THREE.Texture | null;
  /** Coupling stage 2: the solver's live body count (the body
   *  texture is RIGID_BODY_MAX wide; only this many entries are
   *  real bodies for the free-particle collider loops). */
  rigidBodyCount?: number;
  webgpuState: WebGPUComputeState | null;
  webgpuPosTex: THREE.DataTexture | null;
  webgpuPingIsARef: MutableRefObject<boolean>;
}): void {
  const {
    useWebGPU,
    config,
    texSize,
    dt,
    time,
    blast,
    mouseWorld,
    simMesh,
    gl,
    simScene,
    simCamera,
    posIn,
    posOut,
    velIn,
    velOut,
    velSimMat,
    posSimMat,
    initPosTex,
    morphTex,
    morphNormalTex,
    morphKickStart,
    prevPosTex,
    webgpuState,
    webgpuPosTex,
    webgpuPingIsARef,
  } = args;

  if (useWebGPU && webgpuState) {
    // Live particle rules (Grammar 2.0 stage 1, WGSL slice):
    // the WGSL REP program, built with the same inputs the
    // WebGL wiring builds its REP fragment from (the resolved
    // rule list, the attribute names, the group definitions,
    // the density supply present on this route too — the
    // density pass runs here as well). buildRuleEvalWgsl
    // returns null for anything the WGSL REP cannot evaluate
    // faithfully, and the capability registry has already
    // routed those configs to WebGL, so a null here means
    // simply "no live rules stand". The signature mirrors the
    // WebGL REP's (rules / groups / names / interval) plus
    // the texture size, since the WGSL REP is a compiled
    // program rather than a texture-sized pass.
    const liveRulesResolved = resolveLiveParticleRules(config.gpgpuParticleRulesLive ?? '');
    const liveGroupDefs = parseGpgpuGroups(config.gpgpuGroupsData ?? '');
    const liveWgsl = buildRuleEvalWgsl(liveRulesResolved, {
      names: config.gpgpuAttrNames,
      names2: config.gpgpuAttrNames2,
      groupDefs: liveGroupDefs,
      densityAvailable: true,
    });
    const liveRepSignature = liveWgsl
      ? `repw|${config.gpgpuParticleRulesLive ?? ''}|${config.gpgpuGroupsData ?? ''}|${config.gpgpuAttrNames.join(',')}|${config.gpgpuAttrNames2.join(',')}|${resolveAttrDynInterval(config.gpgpuRuleEvalInterval)}|${webgpuState.texSize}`
      : '';
    stepWebGPUCompute(
      webgpuState,
      webgpuPingIsARef.current,
      dt,
      time,
      config.gpgpuGravity,
      config.gpgpuTurbulence,
      config.gpgpuBounceRadius,
      config.gpgpuBounce,
      config.gpgpuSpeed,
      // Morph attraction (Phase R): enabled only when a baked morph
      // texture exists, mirroring the WebGL branch's uMorphEnabled.
      // Phase X3 adds the OBJ normal kick (Phase O): the speed is
      // passed verbatim (0 = default skips the kick block in WGSL,
      // exactly as in the WebGL shader) and the kick start is the
      // same timestamp the WebGL branch receives. Phase 15 ported
      // the age lifecycle to the WGSL position pass, so the
      // age-respawn kick trigger fires on this path too.
      {
        enabled: Boolean(config.gpgpuMorphEnabled && morphTex),
        strength: config.gpgpuMorphStrength,
        orbitSpeed: config.gpgpuMorphOrbitSpeed,
        replicaPhaseGain: config.gpgpuMorphReplicaCount > 1 ? 1 : 0,
        objNormalSpeed: morphTex ? Math.max(0, config.gpgpuMorphObjNormalSpeed || 0) : 0,
        kickStart: morphKickStart,
      },
      // Full force set (Phase X3): the same config values the
      // WebGL branch below assigns to its uniforms, with the same
      // clamps and the same enum-id maps.
      {
        // Particle rules (G10 stage 3): the WGSL passes consume
        // the same baked mask the WebGL branch below reads
        // (velocity permits + position kill). The vellum /
        // rigid suppression of the WebGL kill needs no mirror
        // here — those configs route to WebGL in the capability
        // registry, so they never run on this path.
        particleRulesEnabled: !!args.attrTex && hasEffectiveParticleRules(config.gpgpuParticleRules ?? ''),
        particleRuleKillEnabled: !!args.attrTex && hasEffectiveParticleRules(config.gpgpuParticleRules ?? '')
          && particleRulesHaveAction(config.gpgpuParticleRules ?? '', 'kill') && !args.suppressGroupKill,
        // Live particle rules (Grammar 2.0 stage 1, WGSL
        // slice): the WGSL REP stands while liveWgsl is
        // non-null. The kill consumption mirrors the baked
        // kill's suppression rule (the group-kill suppression
        // applies to both, exactly as the WebGL wiring's
        // liveKill uniform is gated by the same flag).
        liveRulesEnabled: liveWgsl !== null,
        liveRuleKillEnabled: liveWgsl !== null
          && liveRulesHaveAction(config.gpgpuParticleRulesLive ?? '', 'kill') && !args.suppressGroupKill,
        liveRuleTrueKillEnabled: liveWgsl !== null
          && liveRulesHaveAction(config.gpgpuParticleRulesLive ?? '', 'true-kill'),
        liveRuleEval: liveWgsl
          ? {
            wgsl: liveWgsl,
            signature: liveRepSignature,
            interval: resolveAttrDynInterval(config.gpgpuRuleEvalInterval),
          }
          : null,
        audioBlast: blast,
        nBodyEnabled: config.gpgpuNBodyEnabled,
        nBodyStrength: config.gpgpuNBodyStrength,
        nBodySoftening: config.gpgpuNBodySoftening,
        nBodyRepulsion: config.gpgpuNBodyRepulsion,
        nBodySamples: Math.max(2, Math.min(64, config.gpgpuNBodySampleCount)),
        curlEnabled: config.gpgpuCurlEnabled,
        curlStrength: config.gpgpuCurlStrength,
        curlScale: config.gpgpuCurlScale,
        curlSymmetry: { none: 0, mirrorX: 1, radial4: 2, radial6: 3, octahedral: 4 }[config.gpgpuCurlSymmetry] ?? 0,
        curlMode: { curl: 0, ridged: 1, vortex: 2 }[config.gpgpuCurlMode] ?? 0,
        curlOctaves: Math.max(1, Math.min(3, Math.round(config.gpgpuCurlOctaves))),
        boidsEnabled: config.gpgpuBoidsEnabled,
        boidsSeparation: config.gpgpuBoidsSeparation,
        boidsAlignment: config.gpgpuBoidsAlignment,
        boidsCohesion: config.gpgpuBoidsCohesion,
        boidsRadius: config.gpgpuBoidsRadius,
        attractorEnabled: config.gpgpuAttractorEnabled,
        attractorType: { lorenz: 0, rossler: 1, thomas: 2, halvorsen: 3, chen: 4, lu: 5, aizawa: 6, sprott: 7, rabinovich: 8, dejong: 9, ikeda: 10, chua: 11 }[config.gpgpuAttractorType] ?? 0,
        attractorStrength: config.gpgpuAttractorStrength,
        attractorScale: config.gpgpuAttractorScale,
        attractor2Enabled: config.gpgpuAttractor2Enabled,
        attractor2Type: { lorenz: 0, rossler: 1, thomas: 2, halvorsen: 3, chen: 4, lu: 5, aizawa: 6, sprott: 7, rabinovich: 8, dejong: 9, ikeda: 10, chua: 11 }[config.gpgpuAttractor2Type] ?? 0,
        attractor2Strength: config.gpgpuAttractor2Strength,
        attractor2Scale: config.gpgpuAttractor2Scale,
        attractor3Enabled: config.gpgpuAttractor3Enabled,
        attractor3Type: { lorenz: 0, rossler: 1, thomas: 2, halvorsen: 3, chen: 4, lu: 5, aizawa: 6, sprott: 7, rabinovich: 8, dejong: 9, ikeda: 10, chua: 11 }[config.gpgpuAttractor3Type] ?? 0,
        attractor3Strength: config.gpgpuAttractor3Strength,
        attractor3Scale: config.gpgpuAttractor3Scale,
        attractor4Enabled: config.gpgpuAttractor4Enabled,
        attractor4Type: { lorenz: 0, rossler: 1, thomas: 2, halvorsen: 3, chen: 4, lu: 5, aizawa: 6, sprott: 7, rabinovich: 8, dejong: 9, ikeda: 10, chua: 11 }[config.gpgpuAttractor4Type] ?? 0,
        attractor4Strength: config.gpgpuAttractor4Strength,
        attractor4Scale: config.gpgpuAttractor4Scale,
        levyEnabled: config.gpgpuLevyEnabled,
        levyStrength: config.gpgpuLevyStrength,
        levyRate: config.gpgpuLevyRate,
        kuramotoEnabled: config.gpgpuKuramotoEnabled,
        kuramotoCoupling: config.gpgpuKuramotoCoupling,
        kuramotoSpread: config.gpgpuKuramotoSpread,
        kuramotoRadius: config.gpgpuKuramotoRadius,
        particleLifeEnabled: config.gpgpuParticleLifeEnabled,
        particleLifeStrength: config.gpgpuParticleLifeStrength,
        particleLifeRadius: config.gpgpuParticleLifeRadius,
        particleLifeFriction: config.gpgpuParticleLifeFriction,
        particleLifeSpecies: Math.max(2, Math.min(6, Math.round(config.gpgpuParticleLifeSpecies))),
        particleLifeMatrix: resolveParticleLifeMatrix(config),
        // Meander (Grammar 2.0 stage 2, B7 follow-up): the
        // WGSL velocity pass now carries the wander term; the
        // amount / scale ride verbatim from the same keys the
        // WebGL uniforms read, and the standalone flag comes
        // from the single resolution point in lib/gpgpuMeander.
        particleLifeMeanderAmount: config.gpgpuParticleLifeMeanderAmount,
        particleLifeMeanderScale: config.gpgpuParticleLifeMeanderScale,
        meanderStandaloneEnabled: meanderStandaloneActive(config),
        vortexEnabled: config.gpgpuVortexEnabled,
        vortexStrength: config.gpgpuVortexStrength,
        vortexTilt: config.gpgpuVortexTilt,
        windEnabled: config.gpgpuWindEnabled,
        windStrength: config.gpgpuWindStrength,
        windX: config.gpgpuWindX,
        windY: config.gpgpuWindY,
        windZ: config.gpgpuWindZ,
        windGust: config.gpgpuWindGust,
        wellEnabled: config.gpgpuWellEnabled,
        wellStrength: config.gpgpuWellStrength,
        wellSoftening: config.gpgpuWellSoftening,
        wellOrbit: config.gpgpuWellOrbit,
        wellCount: Math.max(1, Math.min(4, Math.round(config.gpgpuWellCount))),
        wellSpread: config.gpgpuWellSpread,
        elasticEnabled: config.gpgpuElasticEnabled,
        elasticStrength: config.gpgpuElasticStrength,
        magneticEnabled: config.gpgpuMagneticEnabled,
        magneticStrength: config.gpgpuMagneticStrength,
        magneticBX: config.gpgpuMagneticBX,
        magneticBY: config.gpgpuMagneticBY,
        magneticBZ: config.gpgpuMagneticBZ,
        sphEnabled: config.gpgpuSphEnabled,
        sphPressure: config.gpgpuSphPressure,
        sphViscosity: config.gpgpuSphViscosity,
        sphRadius: config.gpgpuSphRadius,
        sphRestDensity: config.gpgpuSphRestDensity,
        vFieldEnabled: config.gpgpuVFieldEnabled,
        vFieldType: { dipole: 0, saddle: 1, spiral: 2, source: 3, abc: 4, gyre: 5, worley: 6 }[config.gpgpuVFieldType] ?? 3,
        vFieldStrength: config.gpgpuVFieldStrength,
        vFieldScale: config.gpgpuVFieldScale,
        springEnabled: config.gpgpuSpringEnabled,
        springStrength: config.gpgpuSpringStrength,
        sdfEnabled: config.gpgpuSdfEnabled,
        sdfShape: SDF_SHAPE_IDS[config.gpgpuSdfShape] ?? 0,
        sdfX: config.gpgpuSdfX,
        sdfY: config.gpgpuSdfY,
        sdfZ: config.gpgpuSdfZ,
        sdfSize: config.gpgpuSdfSize,
        sdfBounce: config.gpgpuSdfBounce,
        floorEnabled: config.gpgpuFloorEnabled,
        floorY: config.gpgpuFloorY,
        floorBounce: config.gpgpuFloorBounce,
        mouseEnabled: config.gpgpuMouseEnabled,
        mousePos: mouseWorld,
        mouseStrength: config.gpgpuMouseStrength,
        mouseRadius: config.gpgpuMouseRadius,
        mouseMode: MOUSE_MODE_IDS[config.gpgpuMouseMode] ?? 0,
        mousePaintRate: config.gpgpuMousePaintRate,
        verletEnabled: config.gpgpuVerletEnabled,
        // Age lifecycle (Phase 15, UE5 #18): the same derivations
        // the WebGL branch applies to its position uniforms —
        // replica step gated on morph + multi-copy, count clamped
        // 1..8, emit-light from the emit shape. replicaAgeBase is
        // the shared path's 0 (the W2 stack mode that sets it is a
        // WebGL layer mechanism).
        ageEnabled: config.gpgpuAgeEnabled,
        ageMax: config.gpgpuAgeMax,
        ageReplicaCount: Math.max(1, Math.min(8, Math.round(config.gpgpuMorphReplicaCount))),
        ageReplicaStep: config.gpgpuMorphEnabled && config.gpgpuMorphReplicaCount > 1
          ? Math.max(0, Math.min(1, config.gpgpuMorphReplicaAgeStep))
          : 0,
        replicaAgeBase: 0,
        emitLightEnabled: config.gpgpuEmitShape === 'light',
        emitLightPos: resolveEmitLightPos(config),
        // Crowd steering (Phase 20 stage 2): the WGSL twin's
        // params, from the same single resolution point as the
        // WebGL uniforms below.
        steeringSeek: resolveSteeringSeek(config),
        // Obstacle avoidance twins (Round 84 gap 2, M1): the
        // WGSL velocity stage gains the Phase 15 / Phase AB
        // avoid terms; the values are the same config keys the
        // WebGL uniforms below read.
        steerAvoid: Math.max(0, config.gpgpuSteerAvoid || 0),
        steerAvoidRange: Math.max(0, config.gpgpuSteerAvoidRange || 0),
        particleLifeAvoid: Math.max(0, config.gpgpuParticleLifeAvoid || 0),
        particleLifeVisionRange: Math.max(0, config.gpgpuParticleLifeVisionRange || 0),
        // Crowd state machine (Round 84 gap 2): the WGSL
        // twin's params, from resolveCrowd.
        crowd: {
          ...resolveCrowd(config),
          avoidStrength: crowdAvoidStrength(Math.max(0, config.gpgpuSteerAvoid || 0)),
        },
      },
      // Fluid field (Phase 25): the same config values the WebGL
      // branch assigns to the advection material and the velocity
      // pass's fluid uniforms. The registry keeps any config that
      // combines the field with the FLIP layer on the WebGL path,
      // so the WGSL side only ever runs the legacy coupling.
      {
        enabled: config.gpgpuFluidEnabled,
        diffuse: config.gpgpuFluidDiffuse,
        decay: config.gpgpuFluidDecay,
        strength: config.gpgpuFluidStrength,
        influence: config.gpgpuFluidInfluence,
        scale: config.gpgpuFluidScale,
        extForce: config.gpgpuFluidExtForce,
      },
      // FLIP 3D (Phase 26): the same config values the WebGL
      // branch feeds runFlip3dPasses / applyFlip3dCoupleUniforms,
      // with the same clamps (pressure iterations 0..32 in the
      // passes runner; viscosity / tension floored at 0 there).
      // The resolution follows the shared rule the WebGL target
      // allocation uses, so both routes solve the same grid.
      {
        active: flip3dActive(config),
        resolution: flip3dActive(config)
          ? resolveFlip3dResolution(resolveEffectiveTierSync(), config.gpgpuFlip3dResolution)
          : 0,
        pressureIterations: Math.max(0, Math.min(32, Math.round(config.gpgpuFlipPressureIterations))),
        viscosity: Math.max(0, config.gpgpuFlipViscosity || 0),
        surfaceTension: Math.max(0, config.gpgpuFlipSurfaceTension || 0),
        vorticityEnabled: Boolean(config.gpgpuFlipVorticityEnabled),
        vorticityEpsilon: config.gpgpuFlipVorticityEpsilon,
        blend: config.gpgpuFlipBlend,
        transfer: config.gpgpuFlipTransfer,
        bounceRadius: config.gpgpuBounceRadius,
        fluidScale: config.gpgpuFluidScale,
        count: config.gpgpuCount,
      },
      // Grains DEM (stage 2-1): the resolved plan + grid from
      // the single resolution points in lib/gpgpuGrains.ts,
      // plus the boundary / lifecycle values the DEM passes
      // consume (the same derivations the force set above
      // uses). While the plan is inactive the step receives
      // active:false and the DEM group never engages.
      (() => {
        const demPlan = resolveGrainsDemPlan(config);
        const demGrid = resolveGrainsDemGrid(Math.max(0.001, config.gpgpuGrainsSize || 0), config.gpgpuBounceRadius);
        return {
          active: demPlan.active,
          radius: demPlan.radius,
          mass: demPlan.mass,
          inertia: demPlan.inertia,
          kn: demPlan.kn,
          kt: demPlan.kt,
          cn: demPlan.cn,
          ct: demPlan.ct,
          muS: demPlan.muS,
          muFloor: demPlan.muFloor,
          rollingFriction: demPlan.rollingFriction,
          localDamping: demPlan.localDamping,
          historySlots: demPlan.historySlots,
          maxSubsteps: demPlan.maxSubsteps,
          autoQuality: demPlan.autoQuality,
          cellSize: demGrid.cellSize,
          gridDim: demGrid.dimX,
          floorEnabled: config.gpgpuFloorEnabled,
          floorY: config.gpgpuFloorY,
          sdfEnabled: config.gpgpuSdfEnabled,
          sdfShape: SDF_SHAPE_IDS[config.gpgpuSdfShape] ?? 0,
          sdfX: config.gpgpuSdfX,
          sdfY: config.gpgpuSdfY,
          sdfZ: config.gpgpuSdfZ,
          sdfSize: config.gpgpuSdfSize,
          mouseEnabled: config.gpgpuMouseEnabled,
          mousePos: mouseWorld,
          mouseRadius: config.gpgpuMouseRadius,
          mouseMode: MOUSE_MODE_IDS[config.gpgpuMouseMode] ?? 0,
          mousePaintRate: config.gpgpuMousePaintRate,
          ageEnabled: config.gpgpuAgeEnabled,
          ageMax: config.gpgpuAgeMax,
          ageReplicaCount: Math.max(1, Math.min(8, Math.round(config.gpgpuMorphReplicaCount))),
          ageReplicaStep: config.gpgpuMorphEnabled && config.gpgpuMorphReplicaCount > 1
            ? Math.max(0, Math.min(1, config.gpgpuMorphReplicaAgeStep))
            : 0,
          replicaAgeBase: 0,
          emitLightEnabled: config.gpgpuEmitShape === 'light',
          emitLightPos: resolveEmitLightPos(config),
          configEpoch: grainsDemConfigEpochValue(),
        };
      })(),
    );
    webgpuPingIsARef.current = !webgpuPingIsARef.current;
    if (webgpuPosTex) {
      const posTex = webgpuPosTex;
      readbackWebGPUPositions(webgpuState).then((data) => {
        const target = posTex.image.data;
        if (!target) return;
        target.set(data);
        posTex.needsUpdate = true;
      });
    }
    return;
  }

  // Grains cell sort (Phase 19 fix2): while the complete
  // neighbourhood is on AND the scene supplied the sort pool,
  // build the spatial cell index from the frame-start
  // positions once, here — the velocity contact loop and the
  // position projection below both consume it. Absent pool
  // (replica stacks, mode 0) leaves grainsCellTex null and the
  // uniform writes below resolve uGrainsCellSort false, so
  // the shaders keep their scan fallback.
  // Grains pile plan (Stage C): the single resolution the sort
  // grid, the velocity XSPH uniforms and the pile iterations
  // below all share. While the plan is active the sort grid is
  // built with cell size = support radius h (the pile passes'
  // 27-cell search is then complete for the h window, and the
  // legacy gd-window consumers stay complete inside the larger
  // cells), and the sort is built even where the velocity
  // shader's texture-unit downgrade applies — the pile
  // materials carry few samplers and are not gated by it.
  const pilePlan = resolveGrainsPilePlan(config);
  const grainsGrid = grainsCellGrid(config.gpgpuBounceRadius, Math.max(0.001, config.gpgpuGrainsSize || 0), pilePlan.active ? pilePlan.supportRadius : undefined);
  const grainsCellTex = (resolveGrainsCellSortActive(config, getMaxTextureImageUnits()) || pilePlan.active) && args.grainsCellKeyMat && args.grainsBitonicMat && args.grainsSortRTA && args.grainsSortRTB
    ? runGrainsCellSortPass({
      gl,
      simScene,
      simCamera,
      simMesh,
      posTexture: posIn.texture,
      texSize,
      grid: grainsGrid,
      sortRTA: args.grainsSortRTA,
      sortRTB: args.grainsSortRTB,
      cellKeyMat: args.grainsCellKeyMat,
      bitonicMat: args.grainsBitonicMat,
    })
    : null;

  // Vellum (Phase AR): the single resolution every Vellum
  // consumer in this runner shares. While active, the lifecycle
  // resolutions below (age / spawn gate / kill / morph) protect
  // the constraint grid; while inactive every assignment is the
  // legacy one verbatim. (The WebGPU branch above never sees an
  // active solver — the capability registry routes it to WebGL.)
  const vellum = resolveVellum(config);
  // Rigid bodies (Phase AU): bound only while the solver's
  // supply textures exist (a morph cloud was baked and the
  // solver built). While bound, RBD owns the pool outright: the
  // Vellum resolution is forced inactive (the two solvers never
  // fight over the position texture) and the same lifecycle
  // protections as Vellum apply — a respawn or a kill would
  // shred the bodies' point membership. (resolveVellum returns
  // a fresh object per call, so mutating it here is safe.)
  const rigid = resolveRigid(config);
  const rigidActive = rigid.active && !!args.rigidCellTex && !!args.rigidBodyTex;
  if (rigidActive) {
    vellum.active = false;
    vellum.pressure = 0;
    vellum.damping = 0;
  }

  velSimMat.uniforms.uPosTex.value = posIn.texture;
  velSimMat.uniforms.uVelTex.value = velIn.texture;
  velSimMat.uniforms.uDelta.value = dt;
  velSimMat.uniforms.uTime.value = time;
  velSimMat.uniforms.uGravity.value = config.gpgpuGravity;
  velSimMat.uniforms.uTurbulence.value = config.gpgpuTurbulence;
  velSimMat.uniforms.uBounceRadius.value = config.gpgpuBounceRadius;
  velSimMat.uniforms.uBounce.value = config.gpgpuBounce;
  velSimMat.uniforms.uAudioBlast.value = blast;
  velSimMat.uniforms.uNBodyEnabled.value = config.gpgpuNBodyEnabled;
  velSimMat.uniforms.uNBodyStrength.value = config.gpgpuNBodyStrength;
  velSimMat.uniforms.uNBodySoftening.value = config.gpgpuNBodySoftening;
  velSimMat.uniforms.uNBodyRepulsion.value = config.gpgpuNBodyRepulsion;
  velSimMat.uniforms.uNBodySamples.value = Math.max(2, Math.min(64, config.gpgpuNBodySampleCount));
  velSimMat.uniforms.uTexSizeF.value = texSize;
  velSimMat.uniforms.uCurlEnabled.value = config.gpgpuCurlEnabled;
  velSimMat.uniforms.uCurlStrength.value = config.gpgpuCurlStrength;
  velSimMat.uniforms.uCurlScale.value = config.gpgpuCurlScale;
  velSimMat.uniforms.uCurlSymmetry.value = { none: 0, mirrorX: 1, radial4: 2, radial6: 3, octahedral: 4 }[config.gpgpuCurlSymmetry] ?? 0;
  velSimMat.uniforms.uCurlMode.value = { curl: 0, ridged: 1, vortex: 2 }[config.gpgpuCurlMode] ?? 0;
  velSimMat.uniforms.uCurlOctaves.value = Math.max(1, Math.min(3, Math.round(config.gpgpuCurlOctaves)));
  velSimMat.uniforms.uBoidsEnabled.value = config.gpgpuBoidsEnabled;
  velSimMat.uniforms.uBoidsSeparation.value = config.gpgpuBoidsSeparation;
  velSimMat.uniforms.uBoidsAlignment.value = config.gpgpuBoidsAlignment;
  velSimMat.uniforms.uBoidsCohesion.value = config.gpgpuBoidsCohesion;
  velSimMat.uniforms.uBoidsRadius.value = config.gpgpuBoidsRadius;
  velSimMat.uniforms.uAttractorEnabled.value = config.gpgpuAttractorEnabled;
  velSimMat.uniforms.uAttractorType.value = { lorenz: 0, rossler: 1, thomas: 2, halvorsen: 3, chen: 4, lu: 5, aizawa: 6, sprott: 7, rabinovich: 8, dejong: 9, ikeda: 10, chua: 11 }[config.gpgpuAttractorType] ?? 0;
  // Phase 27: attractor unit 2 — the uniform entries exist in
  // the material from creation (inert while the attractor2
  // variant string is not built).
  if (velSimMat.uniforms.uAttractor2Enabled) velSimMat.uniforms.uAttractor2Enabled.value = config.gpgpuAttractor2Enabled;
  if (velSimMat.uniforms.uAttractor2Type) velSimMat.uniforms.uAttractor2Type.value = { lorenz: 0, rossler: 1, thomas: 2, halvorsen: 3, chen: 4, lu: 5, aizawa: 6, sprott: 7, rabinovich: 8, dejong: 9, ikeda: 10, chua: 11 }[config.gpgpuAttractor2Type] ?? 0;
  if (velSimMat.uniforms.uAttractor3Enabled) velSimMat.uniforms.uAttractor3Enabled.value = config.gpgpuAttractor3Enabled;
  if (velSimMat.uniforms.uAttractor3Type) velSimMat.uniforms.uAttractor3Type.value = { lorenz: 0, rossler: 1, thomas: 2, halvorsen: 3, chen: 4, lu: 5, aizawa: 6, sprott: 7, rabinovich: 8, dejong: 9, ikeda: 10, chua: 11 }[config.gpgpuAttractor3Type] ?? 0;
  if (velSimMat.uniforms.uAttractor4Enabled) velSimMat.uniforms.uAttractor4Enabled.value = config.gpgpuAttractor4Enabled;
  if (velSimMat.uniforms.uAttractor4Type) velSimMat.uniforms.uAttractor4Type.value = { lorenz: 0, rossler: 1, thomas: 2, halvorsen: 3, chen: 4, lu: 5, aizawa: 6, sprott: 7, rabinovich: 8, dejong: 9, ikeda: 10, chua: 11 }[config.gpgpuAttractor4Type] ?? 0;
  velSimMat.uniforms.uLevyEnabled.value = config.gpgpuLevyEnabled;
  velSimMat.uniforms.uLevyStrength.value = config.gpgpuLevyStrength;
  velSimMat.uniforms.uLevyRate.value = config.gpgpuLevyRate;
  velSimMat.uniforms.uKuramotoEnabled.value = config.gpgpuKuramotoEnabled;
  velSimMat.uniforms.uKuramotoCoupling.value = config.gpgpuKuramotoCoupling;
  velSimMat.uniforms.uKuramotoSpread.value = config.gpgpuKuramotoSpread;
  velSimMat.uniforms.uKuramotoRadius.value = config.gpgpuKuramotoRadius;
  velSimMat.uniforms.uParticleLifeEnabled.value = config.gpgpuParticleLifeEnabled;
  velSimMat.uniforms.uParticleLifeStrength.value = config.gpgpuParticleLifeStrength;
  velSimMat.uniforms.uParticleLifeRadius.value = config.gpgpuParticleLifeRadius;
  velSimMat.uniforms.uParticleLifeFriction.value = config.gpgpuParticleLifeFriction;
  velSimMat.uniforms.uParticleLifeSpecies.value = Math.max(2, Math.min(6, Math.round(config.gpgpuParticleLifeSpecies)));
  velSimMat.uniforms.uParticleLifeMatrix.value = resolveParticleLifeMatrix(config);
  if (velSimMat.uniforms.uParticleLifePursue) velSimMat.uniforms.uParticleLifePursue.value = config.gpgpuParticleLifePursue;
  if (velSimMat.uniforms.uParticleLifeEvade) velSimMat.uniforms.uParticleLifeEvade.value = config.gpgpuParticleLifeEvade;
  if (velSimMat.uniforms.uParticleLifeVisionRange) velSimMat.uniforms.uParticleLifeVisionRange.value = config.gpgpuParticleLifeVisionRange;
  if (velSimMat.uniforms.uParticleLifeVisionAngle) velSimMat.uniforms.uParticleLifeVisionAngle.value = config.gpgpuParticleLifeVisionAngle;
  if (velSimMat.uniforms.uParticleLifeMaxSpeed) velSimMat.uniforms.uParticleLifeMaxSpeed.value = config.gpgpuParticleLifeMaxSpeed;
  if (velSimMat.uniforms.uParticleLifeMeanderAmount) velSimMat.uniforms.uParticleLifeMeanderAmount.value = config.gpgpuParticleLifeMeanderAmount;
  if (velSimMat.uniforms.uParticleLifeMeanderScale) velSimMat.uniforms.uParticleLifeMeanderScale.value = config.gpgpuParticleLifeMeanderScale;
  if (velSimMat.uniforms.uParticleLifeAvoid) velSimMat.uniforms.uParticleLifeAvoid.value = Math.max(0, config.gpgpuParticleLifeAvoid || 0);
  if (velSimMat.uniforms.uSteerAvoid) velSimMat.uniforms.uSteerAvoid.value = Math.max(0, config.gpgpuSteerAvoid || 0);
  if (velSimMat.uniforms.uSteerAvoidRange) velSimMat.uniforms.uSteerAvoidRange.value = Math.max(0, config.gpgpuSteerAvoidRange || 0);
  // Crowd steering (Phase 20 stage 2): the uniforms exist in the
  // material from creation; the shader declares them only in
  // the Phase 20 variant, which velocityVariantOptions selects
  // from the same resolved active flag.
  {
    const steer = resolveSteeringSeek(config);
    const u = velSimMat.uniforms;
    if (u.uSteerSeekEnabled) u.uSteerSeekEnabled.value = steer.active;
    if (u.uSteerSeekMode) u.uSteerSeekMode.value = steer.modeId;
    if (u.uSteerSeekStrength) u.uSteerSeekStrength.value = steer.strength;
    if (u.uSteerSeekMaxSpeed) u.uSteerSeekMaxSpeed.value = steer.maxSpeed;
    if (u.uSteerSeekMaxForce) u.uSteerSeekMaxForce.value = steer.maxForce;
    if (u.uSteerSeekTarget) (u.uSteerSeekTarget.value as THREE.Vector3).set(steer.target.x, steer.target.y, steer.target.z);
    if (u.uSteerSeekTarget1) (u.uSteerSeekTarget1.value as THREE.Vector3).set(steer.target1.x, steer.target1.y, steer.target1.z);
    if (u.uSteerSeekSlowingRadius) u.uSteerSeekSlowingRadius.value = steer.slowingRadius;
    if (u.uSteerSeekStateSlot) u.uSteerSeekStateSlot.value = steer.stateSlot;
    if (u.uSteerSeekStateThreshold) u.uSteerSeekStateThreshold.value = steer.stateThreshold;
    if (u.uSteerSeekPath) (u.uSteerSeekPath.value as Float32Array).set(steer.pathPacked);
    if (u.uSteerSeekPathCount) u.uSteerSeekPathCount.value = steer.path.length;
    if (u.uSteerSeekPathLookAhead) u.uSteerSeekPathLookAhead.value = steer.pathLookAhead;
    if (u.uSteerSeekPathRadius) u.uSteerSeekPathRadius.value = steer.pathRadius;
  }
  // Crowd state machine (Round 84 gap 2): the crowd variant's
  // uniforms, from the same resolution points (resolveCrowd +
  // crowdAvoidStrength over the steer-avoid key).
  {
    const crowd = resolveCrowd(config);
    const u = velSimMat.uniforms;
    if (u.uCrowdAvoidRange) u.uCrowdAvoidRange.value = crowd.avoidRange;
    if (u.uCrowdAvoidHysteresis) u.uCrowdAvoidHysteresis.value = crowd.avoidHysteresis;
    if (u.uCrowdAvoidStrength) u.uCrowdAvoidStrength.value = crowdAvoidStrength(Math.max(0, config.gpgpuSteerAvoid || 0));
    if (u.uCrowdIdleSpeed) u.uCrowdIdleSpeed.value = crowd.idleSpeed;
    if (u.uCrowdIdleSpeedOut) u.uCrowdIdleSpeedOut.value = crowd.idleSpeedOut;
    if (u.uCrowdIdleRadius) u.uCrowdIdleRadius.value = crowd.idleRadius;
    if (u.uCrowdIdleDamping) u.uCrowdIdleDamping.value = crowd.idleDamping;
    if (u.uCrowdLaneCount) u.uCrowdLaneCount.value = crowd.laneCount;
    if (u.uCrowdLaneWidth) u.uCrowdLaneWidth.value = crowd.laneWidth;
    if (u.uCrowdLaneOffset) u.uCrowdLaneOffset.value = crowd.laneOffset;
    if (u.uCrowdLaneLateralGain) u.uCrowdLaneLateralGain.value = crowd.laneLateralGain;
    if (u.uCrowdLaneLookAheadScale) u.uCrowdLaneLookAheadScale.value = crowd.laneLookAheadScale;
    if (u.uCrowdMultiObstacleEnabled) u.uCrowdMultiObstacleEnabled.value = crowd.multiObstacleEnabled;
  }
  // Lifecycle grammar (Phase AB): spawn gate + global drag / max
  // speed. The clamps mirror lib/gpgpuLifecycle.ts.
  if (velSimMat.uniforms.uSpawnRate) velSimMat.uniforms.uSpawnRate.value = Math.max(0.01, Math.min(1, config.gpgpuSpawnRate || 1));
  if (velSimMat.uniforms.uSpawnBurst) velSimMat.uniforms.uSpawnBurst.value = vellum.active ? 1 : Math.max(0, Math.min(1, config.gpgpuSpawnBurst ?? 1));
  // Rigid bodies (Phase AU): the spawn gate is pinned open while
  // the solver is bound (this later assignment wins).
  if (rigidActive && velSimMat.uniforms.uSpawnBurst) velSimMat.uniforms.uSpawnBurst.value = 1;
  if (velSimMat.uniforms.uSpawnTime) velSimMat.uniforms.uSpawnTime.value = args.spawnTime ?? time;
  // Spawn allocator (stage 2, E2): the effective rate + the
  // envelope clock, read only by the allocator variant; the
  // emitter-velocity uniforms likewise (directed mode only).
  if (velSimMat.uniforms.uSpawnRateEff) velSimMat.uniforms.uSpawnRateEff.value = resolveSpawnRateEff(config, texSize);
  if (velSimMat.uniforms.uSpawnClockTime) velSimMat.uniforms.uSpawnClockTime.value = args.spawnClockTime ?? args.spawnTime ?? time;
  if (velSimMat.uniforms.uSpawnClockPrev) velSimMat.uniforms.uSpawnClockPrev.value = args.spawnClockPrev ?? (args.spawnTime ?? time);
  if (velSimMat.uniforms.uEmitterVelDir) {
    const base = resolveEmitterBaseDirection(config);
    (velSimMat.uniforms.uEmitterVelDir.value as THREE.Vector3).set(base.x, base.y, base.z);
  }
  if (velSimMat.uniforms.uEmitterVelSpeed) velSimMat.uniforms.uEmitterVelSpeed.value = clampEmitterVelSpeed(config.gpgpuEmitterVelSpeed ?? 2);
  if (velSimMat.uniforms.uEmitterVelSpread) velSimMat.uniforms.uEmitterVelSpread.value = clampEmitterVelSpread(config.gpgpuEmitterVelSpread ?? 0.5);
  if (velSimMat.uniforms.uSpawnPulseInterval) velSimMat.uniforms.uSpawnPulseInterval.value = Math.max(0, Math.min(30, config.gpgpuSpawnPulseInterval ?? 0));
  if (velSimMat.uniforms.uSpawnPulseDuty) velSimMat.uniforms.uSpawnPulseDuty.value = Math.max(0.05, Math.min(1, config.gpgpuSpawnPulseDuty ?? 0.3));
  // Phase AX spawn grammar: pulse cycles / probability, distance
  // order (resolved: mode 1 only with a ready order texture and
  // the gate actually in play), and the burst event (suppressed
  // while Vellum / rigid bodies own the lifecycle, like the gate).
  if (velSimMat.uniforms.uSpawnPulseCycles) velSimMat.uniforms.uSpawnPulseCycles.value = Math.max(0, Math.min(64, Math.floor(config.gpgpuSpawnPulseCycles ?? 0)));
  if (velSimMat.uniforms.uSpawnPulseProbability) velSimMat.uniforms.uSpawnPulseProbability.value = Math.max(0, Math.min(1, config.gpgpuSpawnPulseProbability ?? 1));
  if (velSimMat.uniforms.uSpawnOrderTex) velSimMat.uniforms.uSpawnOrderTex.value = args.spawnOrderTex ?? null;
  if (velSimMat.uniforms.uSpawnOrderMaxDist) velSimMat.uniforms.uSpawnOrderMaxDist.value = args.spawnOrderMaxDist ?? 0;
  if (velSimMat.uniforms.uSpawnOrderMode) velSimMat.uniforms.uSpawnOrderMode.value = config.gpgpuSpawnOrderMode !== 'hash' && args.spawnOrderTex && !vellum.active && !rigidActive ? (config.gpgpuSpawnOrderMode === 'distanceFar' ? 2 : 1) : 0;
  if (velSimMat.uniforms.uSpawnEventEnabled) velSimMat.uniforms.uSpawnEventEnabled.value = !!config.gpgpuSpawnEventEnabled && !vellum.active && !rigidActive;
  if (velSimMat.uniforms.uSpawnEventTime) velSimMat.uniforms.uSpawnEventTime.value = Math.max(0, Math.min(600, config.gpgpuSpawnEventTime ?? 0));
  if (velSimMat.uniforms.uSpawnEventCount) velSimMat.uniforms.uSpawnEventCount.value = Math.max(0, Math.min(1, config.gpgpuSpawnEventCount ?? 0));
  if (velSimMat.uniforms.uSpawnEventSpeed) velSimMat.uniforms.uSpawnEventSpeed.value = Math.max(0, Math.min(50, config.gpgpuSpawnEventSpeed ?? 0));
  if (velSimMat.uniforms.uSpawnEventSpread) velSimMat.uniforms.uSpawnEventSpread.value = Math.max(0, Math.min(1, config.gpgpuSpawnEventSpread ?? 0));
  if (velSimMat.uniforms.uDragRate) velSimMat.uniforms.uDragRate.value = Math.max(0, Math.min(10, config.gpgpuDrag ?? 1.1));
  if (velSimMat.uniforms.uMaxSpeed) velSimMat.uniforms.uMaxSpeed.value = Math.max(0, config.gpgpuMaxSpeed || 0);
  // Signal & time grammar (Phase AC): curl evolution speed and the
  // age curves aimed at the simulation. A curve whose points are
  // all 1 is suppressed here (Enabled stays false), so enabling a
  // flat curve still runs the exact legacy shader path.
  if (velSimMat.uniforms.uCurlSpeed) velSimMat.uniforms.uCurlSpeed.value = Math.max(0, Math.min(4, config.gpgpuCurlSpeed ?? 1));
  if (velSimMat.uniforms.uAgeMax) velSimMat.uniforms.uAgeMax.value = config.gpgpuAgeMax;
  const acVelocityPoints = normalizeAgeCurvePoints(config.gpgpuAgeCurveVelocityPoints);
  const acForcePoints = normalizeAgeCurvePoints(config.gpgpuAgeCurveForcePoints);
  // Age free curves (Grammar 2.0 stage 2, B4): the suppression
  // follows the free curve's identity while a target's free
  // mode is on (lib/gpgpuAgeFreeCurves.ts), and the padded
  // knot arrays ride along for the variant strings.
  const acVelocityFree = resolveAgeFreeCurve(config, 'velocity');
  const acForceFree = resolveAgeFreeCurve(config, 'force');
  if (velSimMat.uniforms.uAgeCurveVelocityEnabled) velSimMat.uniforms.uAgeCurveVelocityEnabled.value = !ageCurveTargetSuppressed(config, 'velocity');
  if (velSimMat.uniforms.uAgeCurveVelocity) velSimMat.uniforms.uAgeCurveVelocity.value = [...acVelocityPoints];
  if (velSimMat.uniforms.uAgeCurveVelocityFreeT) velSimMat.uniforms.uAgeCurveVelocityFreeT.value = acVelocityFree.flatT;
  if (velSimMat.uniforms.uAgeCurveVelocityFreeV) velSimMat.uniforms.uAgeCurveVelocityFreeV.value = acVelocityFree.flatV;
  if (velSimMat.uniforms.uAgeCurveForceEnabled) velSimMat.uniforms.uAgeCurveForceEnabled.value = !ageCurveTargetSuppressed(config, 'force');
  if (velSimMat.uniforms.uAgeCurveForce) velSimMat.uniforms.uAgeCurveForce.value = [...acForcePoints];
  if (velSimMat.uniforms.uAgeCurveForceFreeT) velSimMat.uniforms.uAgeCurveForceFreeT.value = acForceFree.flatT;
  if (velSimMat.uniforms.uAgeCurveForceFreeV) velSimMat.uniforms.uAgeCurveForceFreeV.value = acForceFree.flatV;
  velSimMat.uniforms.uAttractorStrength.value = config.gpgpuAttractorStrength;
  velSimMat.uniforms.uAttractorScale.value = config.gpgpuAttractorScale;
  if (velSimMat.uniforms.uAttractorSpaceMode) velSimMat.uniforms.uAttractorSpaceMode.value = { legacy: 0, spread: 1, frame: 2, ring: 3 }[config.gpgpuAttractorSpaceMode] ?? 0;
  if (velSimMat.uniforms.uAttractor2Strength) velSimMat.uniforms.uAttractor2Strength.value = config.gpgpuAttractor2Strength;
  if (velSimMat.uniforms.uAttractor2Scale) velSimMat.uniforms.uAttractor2Scale.value = config.gpgpuAttractor2Scale;
  if (velSimMat.uniforms.uAttractor2SpaceMode) velSimMat.uniforms.uAttractor2SpaceMode.value = { legacy: 0, spread: 1, frame: 2, ring: 3 }[config.gpgpuAttractor2SpaceMode] ?? 0;
  if (velSimMat.uniforms.uAttractor3Strength) velSimMat.uniforms.uAttractor3Strength.value = config.gpgpuAttractor3Strength;
  if (velSimMat.uniforms.uAttractor3Scale) velSimMat.uniforms.uAttractor3Scale.value = config.gpgpuAttractor3Scale;
  if (velSimMat.uniforms.uAttractor3SpaceMode) velSimMat.uniforms.uAttractor3SpaceMode.value = { legacy: 0, spread: 1, frame: 2, ring: 3 }[config.gpgpuAttractor3SpaceMode] ?? 0;
  if (velSimMat.uniforms.uAttractor4Strength) velSimMat.uniforms.uAttractor4Strength.value = config.gpgpuAttractor4Strength;
  if (velSimMat.uniforms.uAttractor4Scale) velSimMat.uniforms.uAttractor4Scale.value = config.gpgpuAttractor4Scale;
  if (velSimMat.uniforms.uAttractor4SpaceMode) velSimMat.uniforms.uAttractor4SpaceMode.value = { legacy: 0, spread: 1, frame: 2, ring: 3 }[config.gpgpuAttractor4SpaceMode] ?? 0;
  velSimMat.uniforms.uVortexEnabled.value = config.gpgpuVortexEnabled;
  velSimMat.uniforms.uVortexStrength.value = config.gpgpuVortexStrength;
  velSimMat.uniforms.uVortexTilt.value = config.gpgpuVortexTilt;
  velSimMat.uniforms.uWindEnabled.value = config.gpgpuWindEnabled;
  velSimMat.uniforms.uWindStrength.value = config.gpgpuWindStrength;
  velSimMat.uniforms.uWindX.value = config.gpgpuWindX;
  velSimMat.uniforms.uWindY.value = config.gpgpuWindY;
  velSimMat.uniforms.uWindZ.value = config.gpgpuWindZ;
  velSimMat.uniforms.uWindGust.value = config.gpgpuWindGust;
  // Wind volume (Phase AL): placed localisation of the wind.
  if (velSimMat.uniforms.uWindVolumeEnabled) velSimMat.uniforms.uWindVolumeEnabled.value = config.gpgpuWindVolumeEnabled;
  if (velSimMat.uniforms.uWindVolumePos) {
    (velSimMat.uniforms.uWindVolumePos.value as THREE.Vector3).set(
      config.gpgpuWindVolumeX, config.gpgpuWindVolumeY, config.gpgpuWindVolumeZ,
    );
  }
  if (velSimMat.uniforms.uWindVolumeRadius) velSimMat.uniforms.uWindVolumeRadius.value = Math.max(0, config.gpgpuWindVolumeRadius ?? 60);
  if (velSimMat.uniforms.uWindVolumeStrength) velSimMat.uniforms.uWindVolumeStrength.value = config.gpgpuWindVolumeStrength ?? 1;
  // Field instances (Grammar 2.0 stage 2, B1): resolved
  // CPU-side like the terrain bakes — the cached getter
  // returns null unless at least one instance (or, since B2,
  // one path asset) resolves, so a null supply leaves every
  // field uniform at its inert entry and the stock shader
  // path verbatim. Resolving here (not via scene args) means
  // replica stacks share the fields, like the terrain forces
  // above. The layer slot modulation engages only while the
  // attribute texture is present — the same condition that
  // raises uAttrEnabled for this consumer below.
  {
    // B2: the supply is the COMBINED column supply (fields +
    // path assets in one texture — lib/gpgpuPathAssets.ts
    // getColumnSupply, which reproduces B1's supply byte for
    // byte while no path resolves).
    const fieldSupply = getColumnSupply(config);
    const fu = velSimMat.uniforms;
    // Merged supply (stage 2 texture-unit follow-up): while
    // the merged plan stands, the velocity variant reads
    // both supplies through the REP's taller texture (the
    // scene hands it over as args.ruleLiveTex); the column
    // uniforms below keep their values for the section
    // bases, and uColWidth feeds the merged fetch's remap.
    const mergedPlan = resolveMergedSupplyPlan(config, texSize);
    if (fu.uMergedTex) fu.uMergedTex.value = mergedPlan ? (args.ruleLiveTex ?? null) : null;
    if (fu.uMergedTexHeight) fu.uMergedTexHeight.value = mergedPlan ? mergedPlan.totalHeight : texSize;
    if (fu.uColTex) fu.uColTex.value = fieldSupply ? fieldSupply.texture : null;
    if (fu.uColWidth) fu.uColWidth.value = fieldSupply ? fieldSupply.width : COLUMN_TEX_WIDTH;
    if (fu.uColHeight) fu.uColHeight.value = fieldSupply ? fieldSupply.height : FIELD_COLUMN_LAYOUT.height;
    if (fu.uColFieldsBase) fu.uColFieldsBase.value = fieldSupply ? fieldSupply.fieldsBase : 0;
    if (fu.uColLayersBase) fu.uColLayersBase.value = fieldSupply ? fieldSupply.layersBase : 0;
    if (fu.uFieldInstanceCount) fu.uFieldInstanceCount.value = fieldSupply ? fieldSupply.instanceCount : 0;
    if (fu.uFieldLayerAttrEnabled) fu.uFieldLayerAttrEnabled.value = !!args.attrTex && fieldLayerSlotAttrActive(config);
    // Path assets (stage 2, B2): the path sections of the
    // same supply, read only by the asset variant of the
    // steer-seek chunk. The slot is the shared resolution
    // (-1 = every particle follows path 0).
    if (fu.uColPathsBase) fu.uColPathsBase.value = fieldSupply ? fieldSupply.pointsBase : 0;
    if (fu.uColPathHeadersBase) fu.uColPathHeadersBase.value = fieldSupply ? fieldSupply.headersBase : 0;
    if (fu.uPathAssetCount) fu.uPathAssetCount.value = fieldSupply ? fieldSupply.pathCount : 0;
    if (fu.uPathAssetSlot) fu.uPathAssetSlot.value = resolvePathAsset(config).slot;
    // Speed / relative drag (Grammar 2.0 stage 2, B3): the
    // resolved values from lib/gpgpuSpeedDragSpin. The
    // uniforms exist only in their variant strings; the
    // entries are inert otherwise.
    const relDrag = resolveRelDrag(config);
    if (fu.uRelDragWindVel) (fu.uRelDragWindVel.value as THREE.Vector3).set(relDrag.windVel.x, relDrag.windVel.y, relDrag.windVel.z);
    if (fu.uRelDragRate) fu.uRelDragRate.value = relDrag.rate;
    if (fu.uRelDragSlot) fu.uRelDragSlot.value = relDrag.slot;
    const targetSpeed = resolveTargetSpeed(config);
    if (fu.uTargetSpeed) fu.uTargetSpeed.value = targetSpeed.speed;
    if (fu.uTargetSpeedBlend) fu.uTargetSpeedBlend.value = targetSpeed.blend;
    if (fu.uTargetSpeedSlot) fu.uTargetSpeedSlot.value = targetSpeed.slot;
  }
  // Terrain slope flow (Phase AE): resolved CPU-side like the
  // kill mask — the texture getter returns null unless the key
  // is on AND the terrain mesh is live in plane mode, so the
  // disabled uniform keeps the exact legacy path. Resolving here
  // (not via scene args) means replica stacks share the force.
  const slopeTex = getTerrainSlopeGradientTexture(config);
  if (velSimMat.uniforms.uSlopeForceEnabled) velSimMat.uniforms.uSlopeForceEnabled.value = !!slopeTex;
  if (velSimMat.uniforms.uSlopeForceStrength) velSimMat.uniforms.uSlopeForceStrength.value = Math.max(0, config.gpgpuSlopeForceStrength ?? 1);
  if (velSimMat.uniforms.uSlopeTex) velSimMat.uniforms.uSlopeTex.value = slopeTex;
  if (velSimMat.uniforms.uSlopeExtent) velSimMat.uniforms.uSlopeExtent.value = Math.max(terrainSlopeWorldExtent(config), 0.001);
  // Terrain collider (Phase AI): resolved CPU-side like the
  // slope force — the texture getter returns null unless the
  // key is on AND the terrain mesh is live in plane mode, so
  // the disabled uniform keeps the exact legacy path. Resolving
  // here (shared by the replica-stack runner) means stacks
  // collide with the same terrain.
  const terrainColliderTex = getTerrainColliderTexture(config);
  if (velSimMat.uniforms.uTerrainColliderEnabled) velSimMat.uniforms.uTerrainColliderEnabled.value = !!terrainColliderTex;
  if (velSimMat.uniforms.uTerrainColliderTex) velSimMat.uniforms.uTerrainColliderTex.value = terrainColliderTex;
  if (velSimMat.uniforms.uTerrainExtent) velSimMat.uniforms.uTerrainExtent.value = Math.max(terrainSlopeWorldExtent(config), 0.001);
  if (velSimMat.uniforms.uTerrainHeightWorld) velSimMat.uniforms.uTerrainHeightWorld.value = terrainColliderTex ? terrainColliderHeightWorld(config) : 0;
  if (velSimMat.uniforms.uTerrainGradScale) velSimMat.uniforms.uTerrainGradScale.value = terrainColliderTex ? terrainColliderGradientScale(config) : 0;
  if (velSimMat.uniforms.uTerrainTexSize) velSimMat.uniforms.uTerrainTexSize.value = TERRAIN_DERIVED_SIZE;
  if (velSimMat.uniforms.uTerrainBounce) velSimMat.uniforms.uTerrainBounce.value = Math.max(0, Math.min(1, config.gpgpuTerrainColliderBounce ?? 0.5));
  if (velSimMat.uniforms.uTerrainFriction) velSimMat.uniforms.uTerrainFriction.value = Math.max(0, Math.min(1, config.gpgpuTerrainColliderFriction ?? 0.25));
  // Mesh SDF collider (Phase BY): resolved CPU-side like the
  // terrain collider — the getter returns null unless the key is
  // on AND the async bake has completed, so the disabled uniform
  // keeps the exact legacy path while baking / refused / off.
  // Multi-body mesh SDF: while the master key is on, the atlas
  // collider replaces the single one outright — and while its
  // bake is pending there is NO mesh collider (the single body
  // is not substituted), so a partial set can never appear.
  // Defect fix 2026-11-27: multi requires the parent mesh SDF
  // key as well (the UI nests the multi toggle inside it).
  const meshSdfMultiActiveVel = !!config.gpgpuMeshSdfEnabled && !!config.gpgpuMeshSdfMultiEnabled;
  const meshSdfMultiVel = meshSdfMultiActiveVel ? getMeshSdfMultiCollider(config) : null;
  const meshSdfVel = meshSdfMultiActiveVel ? null : getMeshSdfCollider(config);
  const meshSdfWorldVel = meshSdfWorldScale(config);
  if (meshSdfMultiActiveVel) {
    clearMeshSdfMultiUniforms(velSimMat.uniforms);
    if (velSimMat.uniforms.uMeshSdfEnabled) velSimMat.uniforms.uMeshSdfEnabled.value = false;
    if (meshSdfMultiVel) {
      applyMeshSdfMultiUniforms(velSimMat.uniforms, meshSdfMultiVel);
    } else if (velSimMat.uniforms.uMeshSdfTex) {
      velSimMat.uniforms.uMeshSdfTex.value = null;
    }
  } else {
    clearMeshSdfMultiUniforms(velSimMat.uniforms);
    if (velSimMat.uniforms.uMeshSdfEnabled) velSimMat.uniforms.uMeshSdfEnabled.value = !!meshSdfVel;
    if (velSimMat.uniforms.uMeshSdfTex) velSimMat.uniforms.uMeshSdfTex.value = meshSdfVel ? meshSdfVel.texture : null;
    if (velSimMat.uniforms.uMeshSdfOrigin && meshSdfVel) {
      const halfWorld = (meshSdfVel.grid.sideNorm * meshSdfWorldVel) / 2;
      (velSimMat.uniforms.uMeshSdfOrigin.value as THREE.Vector3).set(-halfWorld, -halfWorld, -halfWorld);
    }
    if (velSimMat.uniforms.uMeshSdfDomainWorld) velSimMat.uniforms.uMeshSdfDomainWorld.value = meshSdfVel ? meshSdfVel.grid.sideNorm * meshSdfWorldVel : 1.0;
    if (velSimMat.uniforms.uMeshSdfScale) velSimMat.uniforms.uMeshSdfScale.value = meshSdfVel ? meshSdfWorldVel : 0;
    if (velSimMat.uniforms.uMeshSdfVoxelWorld) velSimMat.uniforms.uMeshSdfVoxelWorld.value = meshSdfVel ? meshSdfVel.grid.voxelNorm * meshSdfWorldVel : 0;
    if (velSimMat.uniforms.uMeshSdfBounce) velSimMat.uniforms.uMeshSdfBounce.value = Math.max(0, Math.min(1, config.gpgpuMeshSdfBounce ?? 0.5));
    if (velSimMat.uniforms.uMeshSdfFriction) velSimMat.uniforms.uMeshSdfFriction.value = Math.max(0, Math.min(1, config.gpgpuMeshSdfFriction ?? 0.25));
  }
  // Named attributes (Phase AK): resolved CPU-side like the
  // terrain collider — the velocity consumers (force drive /
  // group gate) engage only when the attribute texture exists,
  // so a missing texture keeps the exact legacy path. The draw
  // drives resolve separately in syncVisualUniforms.
  {
    const attrConsumers = resolveAttrConsumers(config);
    const attrTex = args.attrTex ?? null;
    if (velSimMat.uniforms.uAttrTex) velSimMat.uniforms.uAttrTex.value = attrTex;
    // Particle rules (G10 stage 1): an effective rule list is
    // itself an attribute consumer (its mask rides slot 3 of
    // the same texture), and while rules are effective the
    // baked-group gate resolution is suppressed — the rule
    // engine owns slot 3 then (design 3.5), so the channel
    // must not also be read as group membership.
    const particleRulesActive = hasEffectiveParticleRules(config.gpgpuParticleRules ?? '');
    // Live particle rules (Grammar 2.0 1A): the REP texture +
    // its enable, resolved like the baked mask — the live
    // segment ANDs into the same grp* gates (design section 7).
    if (velSimMat.uniforms.uRuleLiveTex) velSimMat.uniforms.uRuleLiveTex.value = args.ruleLiveTex ?? null;
    if (velSimMat.uniforms.uRuleLiveEnabled) velSimMat.uniforms.uRuleLiveEnabled.value = !!args.ruleLiveTex && (liveRulesHaveConsumedAction(config.gpgpuParticleRulesLive ?? '') || predationActive(config));
    if (velSimMat.uniforms.uAttrEnabled) velSimMat.uniforms.uAttrEnabled.value = !!attrTex && (attrConsumers.forceActive || attrConsumers.groupActive || attrConsumers.steerStateActive || particleRulesActive || fieldLayerSlotAttrActive(config) || b3SlotAttrActive(config));
    if (velSimMat.uniforms.uAttrForceEnabled) velSimMat.uniforms.uAttrForceEnabled.value = !!attrTex && attrConsumers.forceActive;
    if (velSimMat.uniforms.uAttrForceSlot) velSimMat.uniforms.uAttrForceSlot.value = normalizeAttrSlot(config.gpgpuAttrForceSlot);
    if (velSimMat.uniforms.uAttrForceAmount) velSimMat.uniforms.uAttrForceAmount.value = Math.max(0, Math.min(1, config.gpgpuAttrForceAmount ?? 1));
    // Phase CV: a named group compiles down to this same gate —
    // a predicate group supplies the predicate values, a baked
    // group (snapshot/composite) reads its membership channel
    // (the runtime wrote exact 0/1 into the baked slot of the
    // attribute texture) as "above 0.5". No new shader code and
    // no new texture unit (the shader already links 16/16).
    const groupGate = resolveGroupGate(parseGpgpuGroups(config.gpgpuGroupsData ?? ''), config.gpgpuGroupRef ?? '');
    const gatePredicate = groupGate.kind === 'predicate'
      ? groupGate.predicate
      : groupGate.kind === 'baked' && !particleRulesActive
        ? { slot: groupGate.slot, mode: 'above' as const, low: 0.5, high: 1, invert: false }
        : null;
    if (velSimMat.uniforms.uGroupEnabled) velSimMat.uniforms.uGroupEnabled.value = !!attrTex && (gatePredicate !== null || attrConsumers.groupActive);
    if (velSimMat.uniforms.uGroupSlot) velSimMat.uniforms.uGroupSlot.value = gatePredicate ? gatePredicate.slot : Math.max(0, Math.min(3, Math.round(config.gpgpuGroupSlot ?? 0)));
    if (velSimMat.uniforms.uGroupMode) velSimMat.uniforms.uGroupMode.value = { below: 0, above: 1, band: 2 }[gatePredicate ? gatePredicate.mode : config.gpgpuGroupMode] ?? 1;
    if (velSimMat.uniforms.uGroupLow) velSimMat.uniforms.uGroupLow.value = gatePredicate ? gatePredicate.low : Math.max(0, Math.min(1, config.gpgpuGroupLow ?? 0.25));
    if (velSimMat.uniforms.uGroupHigh) velSimMat.uniforms.uGroupHigh.value = gatePredicate ? gatePredicate.high : Math.max(0, Math.min(1, config.gpgpuGroupHigh ?? 0.75));
    if (velSimMat.uniforms.uGroupTarget) velSimMat.uniforms.uGroupTarget.value = { all: 0, gravity: 1, turbulence: 2, curl: 3, wind: 4, morph: 5 }[config.gpgpuGroupTarget] ?? 0;
    if (velSimMat.uniforms.uGroupInvert) velSimMat.uniforms.uGroupInvert.value = gatePredicate ? gatePredicate.invert : !!config.gpgpuGroupInvert;
  }
  velSimMat.uniforms.uWellEnabled.value = config.gpgpuWellEnabled;
  velSimMat.uniforms.uWellStrength.value = config.gpgpuWellStrength;
  velSimMat.uniforms.uWellSoftening.value = config.gpgpuWellSoftening;
  velSimMat.uniforms.uWellOrbit.value = config.gpgpuWellOrbit;
  velSimMat.uniforms.uWellCount.value = Math.max(1, Math.min(4, Math.round(config.gpgpuWellCount)));
  velSimMat.uniforms.uWellSpread.value = config.gpgpuWellSpread;
  velSimMat.uniforms.uElasticEnabled.value = config.gpgpuElasticEnabled;
  velSimMat.uniforms.uElasticStrength.value = config.gpgpuElasticStrength;
  velSimMat.uniforms.uMagneticEnabled.value = config.gpgpuMagneticEnabled;
  velSimMat.uniforms.uMagneticStrength.value = config.gpgpuMagneticStrength;
  velSimMat.uniforms.uMagneticBX.value = config.gpgpuMagneticBX;
  velSimMat.uniforms.uMagneticBY.value = config.gpgpuMagneticBY;
  velSimMat.uniforms.uMagneticBZ.value = config.gpgpuMagneticBZ;
  velSimMat.uniforms.uSphEnabled.value = config.gpgpuSphEnabled;
  velSimMat.uniforms.uSphPressure.value = config.gpgpuSphPressure;
  velSimMat.uniforms.uSphViscosity.value = config.gpgpuSphViscosity;
  velSimMat.uniforms.uSphRadius.value = config.gpgpuSphRadius;
  velSimMat.uniforms.uSphRestDensity.value = config.gpgpuSphRestDensity;
  if (velSimMat.uniforms.uSphSurfaceTension) velSimMat.uniforms.uSphSurfaceTension.value = Math.max(0, config.gpgpuSphSurfaceTension || 0);
  if (velSimMat.uniforms.uSphSurfaceSelectivity) velSimMat.uniforms.uSphSurfaceSelectivity.value = Math.min(1, Math.max(0, config.gpgpuSphSurfaceSelectivity || 0));
  if (velSimMat.uniforms.uSphSurfaceTensionAkinci) velSimMat.uniforms.uSphSurfaceTensionAkinci.value = Math.max(0, config.gpgpuSphSurfaceTensionAkinci || 0);
  // Grains (Phase AQ): guarded like the surface tension — stack
  // materials built before this phase simply lack the uniforms.
  if (velSimMat.uniforms.uGrainsEnabled) {
    velSimMat.uniforms.uGrainsEnabled.value = config.gpgpuGrainsEnabled;
    velSimMat.uniforms.uGrainsSize.value = Math.max(0.001, config.gpgpuGrainsSize || 0);
    velSimMat.uniforms.uGrainsStiffness.value = Math.max(0, config.gpgpuGrainsStiffness || 0);
    // Phase BB: the single friction resolution — while the
    // repose-angle key is set it overrides the friction key
    // with tan(angle) (lib/gpgpuGrains.ts). At the default the
    // value is exactly the legacy friction key.
    velSimMat.uniforms.uGrainsFriction.value = effectiveGrainsFriction(config);
    velSimMat.uniforms.uGrainsCohesion.value = Math.max(0, config.gpgpuGrainsCohesion || 0);
    velSimMat.uniforms.uGrainsRestitution.value = Math.max(0, config.gpgpuGrainsRestitution || 0);
    velSimMat.uniforms.uGrainsRestDamping.value = Math.max(0, config.gpgpuGrainsRestDamping || 0);
    // XSPH (Stage C): the pile plan's strength + support
    // radius; the uniforms exist in the material's dictionary
    // always and are declared in the shader only behind the
    // grainsPileXsph variant, so the writes are inert otherwise.
    if (velSimMat.uniforms.uGrainsXsphStrength) {
      velSimMat.uniforms.uGrainsXsphStrength.value = pilePlan.active ? pilePlan.xsphStrength : 0;
    }
    if (velSimMat.uniforms.uGrainsSupport) {
      velSimMat.uniforms.uGrainsSupport.value = pilePlan.supportRadius;
    }
    // Neighbourhood scan (Phase 19): 0 keeps the AQ subsample
    // plan bit-for-bit; 1 switches the Grains loop (only) to
    // the complete scan.
    if (velSimMat.uniforms.uGrainsNeighborhood) {
      velSimMat.uniforms.uGrainsNeighborhood.value = grainsNeighborhoodMode(config);
    }
    // Cell sort (Phase 19 fix2): true only on frames where the
    // sort above actually ran (mode 1 AND the pool was
    // supplied); the grid uniforms follow the same resolution
    // the sort pass used. Guarded like the scan uniform — the
    // legacy shader string declares none of these.
    if (velSimMat.uniforms.uGrainsCellSort) {
      velSimMat.uniforms.uGrainsCellSort.value = !!grainsCellTex;
      if (velSimMat.uniforms.uGrainsSortTex) velSimMat.uniforms.uGrainsSortTex.value = grainsCellTex;
      if (velSimMat.uniforms.uGrainsCellOrigin) velSimMat.uniforms.uGrainsCellOrigin.value = grainsGrid.origin;
      if (velSimMat.uniforms.uGrainsCellSize) velSimMat.uniforms.uGrainsCellSize.value = grainsGrid.cellSize;
      if (velSimMat.uniforms.uGrainsCellDims) {
        (velSimMat.uniforms.uGrainsCellDims.value as THREE.Vector3).set(grainsGrid.dimX, grainsGrid.dimY, grainsGrid.dimZ);
      }
    }
  }
  // Vellum (Phase AR): guarded like Grains — the pressure force
  // and the velocity damping are the velocity pass's share of
  // the solver; the projection runs below the position pass.
  if (velSimMat.uniforms.uVellumEnabled) {
    velSimMat.uniforms.uVellumEnabled.value = vellum.active;
    velSimMat.uniforms.uVellumMode.value = vellum.modeId;
    // XPBD volume (Phase 19 stage 3, design 3-1): while the
    // volume constraint engages (xpbd + shell + volume key)
    // the legacy normal-force pressure is zeroed — the volume
    // constraint replaces it, never stacks on top of it.
    const volumeEngaged = vellum.active && vellum.solverMode === 'xpbd'
      && vellum.modeId === 1 && vellum.volumeEnabled;
    velSimMat.uniforms.uVellumPressure.value = vellum.active && !volumeEngaged ? vellum.pressure : 0;
    velSimMat.uniforms.uVellumDamping.value = vellum.active ? vellum.damping : 0;
  }
  // Rigid bodies (Phase AU): guarded like Grains — stack
  // materials built before this phase simply lack the uniforms.
  // While bound, the velocity pass writes rigid point velocities
  // and every force below is superseded by the shader's early
  // return; the solver itself was stepped by the scene.
  if (velSimMat.uniforms.uRigidEnabled) {
    velSimMat.uniforms.uRigidEnabled.value = rigidActive;
    velSimMat.uniforms.uRigidCellTex.value = rigidActive ? args.rigidCellTex : null;
    velSimMat.uniforms.uRigidBodyTex.value = rigidActive ? args.rigidBodyTex : null;
  }
  // Coupling stage 2: free-particle mix. Guarded like the
  // rigid block; inert unless the solver is bound AND the
  // Free key is on.
  if (velSimMat.uniforms.uRigidFreeEnabled) {
    const freeOn = rigidActive && rigid.freeEnabled;
    velSimMat.uniforms.uRigidFreeEnabled.value = freeOn;
    velSimMat.uniforms.uRigidFreeFraction.value = rigid.freeFraction;
    velSimMat.uniforms.uRigidBodyCount.value = args.rigidBodyCount ?? 0;
    velSimMat.uniforms.uRigidFreeBounce.value = rigid.restitution;
  }
  // Pyro (Phase AS): guarded like Grains — stack materials
  // built before this phase simply lack the uniforms.
  if (velSimMat.uniforms.uPyroEnabled) {
    velSimMat.uniforms.uPyroEnabled.value = config.gpgpuPyroEnabled;
    velSimMat.uniforms.uPyroTemperature.value = Math.max(0, config.gpgpuPyroTemperature || 0);
    velSimMat.uniforms.uPyroBuoyancy.value = Math.max(0, config.gpgpuPyroBuoyancy || 0);
    velSimMat.uniforms.uPyroCooling.value = Math.max(0, config.gpgpuPyroCooling || 0);
    velSimMat.uniforms.uPyroDisturbance.value = Math.max(0, config.gpgpuPyroDisturbance || 0);
    velSimMat.uniforms.uPyroDisturbanceHeat.value = Math.max(0, config.gpgpuPyroDisturbanceHeat || 0);
  }
  velSimMat.uniforms.uVFieldEnabled.value = config.gpgpuVFieldEnabled;
  velSimMat.uniforms.uVFieldType.value = { dipole: 0, saddle: 1, spiral: 2, source: 3, abc: 4, gyre: 5, worley: 6 }[config.gpgpuVFieldType] ?? 3;
  velSimMat.uniforms.uVFieldStrength.value = config.gpgpuVFieldStrength;
  velSimMat.uniforms.uVFieldScale.value = config.gpgpuVFieldScale;
  velSimMat.uniforms.uSpringEnabled.value = config.gpgpuSpringEnabled;
  velSimMat.uniforms.uSpringStrength.value = config.gpgpuSpringStrength;
  velSimMat.uniforms.uInitPosTex.value = initPosTex;
  // Vellum (Phase AR) resolves morph attraction off: the morph
  // targets would fight the constraint grid for every particle.
  // Rigid bodies (Phase AU) resolve it off for the same reason.
  velSimMat.uniforms.uMorphEnabled.value = config.gpgpuMorphEnabled && !!morphTex && !vellum.active && !rigidActive;
  velSimMat.uniforms.uMorphTex.value = morphTex;
  // OBJ normal kick (Phase O): companion normal texture + speed.
  // The speed is passed verbatim; 0 (default) makes the shader skip
  // the kick block entirely. The age flag gates the respawn pulse.
  if (velSimMat.uniforms.uMorphNormalTex) velSimMat.uniforms.uMorphNormalTex.value = morphNormalTex;
  if (velSimMat.uniforms.uMorphObjNormalSpeed) velSimMat.uniforms.uMorphObjNormalSpeed.value = Math.max(0, config.gpgpuMorphObjNormalSpeed || 0);
  if (velSimMat.uniforms.uMorphKickStart) velSimMat.uniforms.uMorphKickStart.value = morphKickStart;
  if (velSimMat.uniforms.uAgeEnabled) velSimMat.uniforms.uAgeEnabled.value = config.gpgpuAgeEnabled && !vellum.active && !rigidActive;
  velSimMat.uniforms.uMorphStrength.value = config.gpgpuMorphStrength;
  velSimMat.uniforms.uMorphOrbitSpeed.value = config.gpgpuMorphOrbitSpeed;
  // Replica phase offsets (baked into the morph texel alpha) apply
  // only when the replica grammar is active; gain 0 keeps the legacy
  // alpha (= 1) from shifting the orbit angle of existing configs.
  velSimMat.uniforms.uMorphReplicaPhaseGain.value = config.gpgpuMorphReplicaCount > 1 ? 1 : 0;
  velSimMat.uniforms.uSpeed.value = config.gpgpuSpeed;
  velSimMat.uniforms.uSdfEnabled.value = config.gpgpuSdfEnabled;
  velSimMat.uniforms.uSdfShape.value = SDF_SHAPE_IDS[config.gpgpuSdfShape] ?? 0;
  velSimMat.uniforms.uSdfX.value = config.gpgpuSdfX;
  velSimMat.uniforms.uSdfY.value = config.gpgpuSdfY;
  velSimMat.uniforms.uSdfZ.value = config.gpgpuSdfZ;
  velSimMat.uniforms.uSdfSize.value = config.gpgpuSdfSize;
  velSimMat.uniforms.uSdfBounce.value = config.gpgpuSdfBounce;
  velSimMat.uniforms.uFloorEnabled.value = config.gpgpuFloorEnabled;
  velSimMat.uniforms.uFloorY.value = config.gpgpuFloorY;
  velSimMat.uniforms.uFloorBounce.value = config.gpgpuFloorBounce;
  velSimMat.uniforms.uMouseEnabled.value = config.gpgpuMouseEnabled;
  velSimMat.uniforms.uMousePos.value.copy(mouseWorld);
  velSimMat.uniforms.uMouseStrength.value = config.gpgpuMouseStrength;
  velSimMat.uniforms.uMouseRadius.value = config.gpgpuMouseRadius;
  velSimMat.uniforms.uMouseMode.value = MOUSE_MODE_IDS[config.gpgpuMouseMode] ?? 0;
  velSimMat.uniforms.uMousePaintRate.value = config.gpgpuMousePaintRate;
  // Multi-touch (Phase AO): the resolved pointer count is the
  // ONLY switch for the shader's multi block. Key off (or no
  // tracked set supplied) writes 0, so the block never runs.
  const mouseMultiCount = config.gpgpuMouseMultiTouch && args.mouseWorldMulti
    ? Math.max(0, Math.min(4, args.mouseMultiCount ?? 0))
    : 0;
  if (velSimMat.uniforms.uMouseCount) velSimMat.uniforms.uMouseCount.value = mouseMultiCount;
  if (velSimMat.uniforms.uMousePosMulti && mouseMultiCount > 0 && args.mouseWorldMulti) {
    const arr = velSimMat.uniforms.uMousePosMulti.value as THREE.Vector3[];
    for (let i = 0; i < arr.length; i++) {
      if (i < mouseMultiCount) arr[i].copy(args.mouseWorldMulti[i]);
      else arr[i].set(0, 0, 0);
    }
  }
  simMesh.material = velSimMat;
  gl.setRenderTarget(velOut);
  gl.render(simScene, simCamera);

  posSimMat.uniforms.uPosTex.value = posIn.texture;
  posSimMat.uniforms.uVelTex.value = velOut.texture;
  posSimMat.uniforms.uDelta.value = dt;
  posSimMat.uniforms.uTime.value = time;
  posSimMat.uniforms.uSpeed.value = config.gpgpuSpeed;
  posSimMat.uniforms.uBounceRadius.value = config.gpgpuBounceRadius;
  // Vellum (Phase AR): age advance is resolved off while the
  // solver is active (a respawn would shred the grid), and the
  // paint gate flag follows the same resolution. Rigid bodies
  // (Phase AU) resolve it off for the same reason (a respawn
  // would shred the bodies' point membership).
  posSimMat.uniforms.uAgeEnabled.value = config.gpgpuAgeEnabled && !vellum.active && !rigidActive;
  if (posSimMat.uniforms.uVellumEnabled) posSimMat.uniforms.uVellumEnabled.value = vellum.active;
  // Grains projection (Phase 19): resolved through
  // lib/gpgpuGrains.ts — Grains off or strength 0 writes false
  // and the position pass stays verbatim legacy. The sample
  // count mirrors the velocity pass's uNBodySamples resolution
  // so both Grains scans share one plan.
  if (posSimMat.uniforms.uGrainsProjEnabled) {
    posSimMat.uniforms.uGrainsProjEnabled.value = grainsProjectionActive(config);
    posSimMat.uniforms.uGrainsSize.value = Math.max(0.001, config.gpgpuGrainsSize || 0);
    posSimMat.uniforms.uGrainsProjection.value = resolveGrainsProjection(config);
    if (posSimMat.uniforms.uGrainsNeighborhood) posSimMat.uniforms.uGrainsNeighborhood.value = resolveGrainsNeighborhoodMode(config, getMaxTextureImageUnits());
    if (posSimMat.uniforms.uGrainsSamples) posSimMat.uniforms.uGrainsSamples.value = Math.max(2, Math.min(64, config.gpgpuNBodySampleCount));
    // Cell sort (Phase 19 fix2): the projection segment
    // consumes the same sorted index the velocity pass used
    // this frame (built once, before both passes).
    if (posSimMat.uniforms.uGrainsCellSort) {
      posSimMat.uniforms.uGrainsCellSort.value = !!grainsCellTex;
      if (posSimMat.uniforms.uGrainsSortTex) posSimMat.uniforms.uGrainsSortTex.value = grainsCellTex;
      if (posSimMat.uniforms.uGrainsCellOrigin) posSimMat.uniforms.uGrainsCellOrigin.value = grainsGrid.origin;
      if (posSimMat.uniforms.uGrainsCellSize) posSimMat.uniforms.uGrainsCellSize.value = grainsGrid.cellSize;
      if (posSimMat.uniforms.uGrainsCellDims) {
        (posSimMat.uniforms.uGrainsCellDims.value as THREE.Vector3).set(grainsGrid.dimX, grainsGrid.dimY, grainsGrid.dimZ);
      }
    }
  }
  // Rigid bodies (Phase AU): while bound, the position pass
  // composes world positions from the body transforms (early
  // return in the shader); the solver was stepped by the scene.
  if (posSimMat.uniforms.uRigidEnabled) {
    posSimMat.uniforms.uRigidEnabled.value = rigidActive;
    posSimMat.uniforms.uRigidCellTex.value = rigidActive ? args.rigidCellTex : null;
    posSimMat.uniforms.uRigidBodyTex.value = rigidActive ? args.rigidBodyTex : null;
  }
  if (posSimMat.uniforms.uRigidFreeEnabled) {
    const freeOn = rigidActive && rigid.freeEnabled;
    posSimMat.uniforms.uRigidFreeEnabled.value = freeOn;
    posSimMat.uniforms.uRigidFreeFraction.value = rigid.freeFraction;
    posSimMat.uniforms.uRigidBodyCount.value = args.rigidBodyCount ?? 0;
  }
  posSimMat.uniforms.uAgeMax.value = config.gpgpuAgeMax;
  // Replica age phase (Phase M): gated exactly like the initial
  // data — morph on, more than one copy, step > 0 — else 0, which
  // restarts respawned particles at age 0 as before.
  if (posSimMat.uniforms.uAgeReplicaStep) {
    posSimMat.uniforms.uAgeReplicaStep.value = config.gpgpuMorphEnabled && config.gpgpuMorphReplicaCount > 1
      ? Math.max(0, Math.min(1, config.gpgpuMorphReplicaAgeStep))
      : 0;
  }
  if (posSimMat.uniforms.uAgeReplicaCount) posSimMat.uniforms.uAgeReplicaCount.value = Math.max(1, Math.min(8, Math.round(config.gpgpuMorphReplicaCount)));
  if (posSimMat.uniforms.uTexSizeF) posSimMat.uniforms.uTexSizeF.value = texSize;  posSimMat.uniforms.uVerletEnabled.value = config.gpgpuVerletEnabled;
  posSimMat.uniforms.uPrevPosTex.value = prevPosTex;
  posSimMat.uniforms.uSdfEnabled.value = config.gpgpuSdfEnabled;
  posSimMat.uniforms.uSdfShape.value = SDF_SHAPE_IDS[config.gpgpuSdfShape] ?? 0;
  posSimMat.uniforms.uSdfX.value = config.gpgpuSdfX;
  posSimMat.uniforms.uSdfY.value = config.gpgpuSdfY;
  posSimMat.uniforms.uSdfZ.value = config.gpgpuSdfZ;
  posSimMat.uniforms.uSdfSize.value = config.gpgpuSdfSize;
  posSimMat.uniforms.uSdfBounce.value = config.gpgpuSdfBounce;
  posSimMat.uniforms.uFloorEnabled.value = config.gpgpuFloorEnabled;
  posSimMat.uniforms.uFloorY.value = config.gpgpuFloorY;
  // Terrain collider (Phase AI): same resolution as the velocity
  // pass — the position pass only pushes out of the surface.
  if (posSimMat.uniforms.uTerrainColliderEnabled) posSimMat.uniforms.uTerrainColliderEnabled.value = !!terrainColliderTex;
  if (posSimMat.uniforms.uTerrainColliderTex) posSimMat.uniforms.uTerrainColliderTex.value = terrainColliderTex;
  if (posSimMat.uniforms.uTerrainExtent) posSimMat.uniforms.uTerrainExtent.value = Math.max(terrainSlopeWorldExtent(config), 0.001);
  if (posSimMat.uniforms.uTerrainHeightWorld) posSimMat.uniforms.uTerrainHeightWorld.value = terrainColliderTex ? terrainColliderHeightWorld(config) : 0;
  if (posSimMat.uniforms.uTerrainGradScale) posSimMat.uniforms.uTerrainGradScale.value = terrainColliderTex ? terrainColliderGradientScale(config) : 0;
  if (posSimMat.uniforms.uTerrainTexSize) posSimMat.uniforms.uTerrainTexSize.value = TERRAIN_DERIVED_SIZE;
  // Mesh SDF collider (Phase BY): same resolution as the
  // velocity pass — null while disabled / baking / refused keeps
  // the exact legacy path.
  // Multi-body mesh SDF: same resolution as the velocity pass —
  // while the master key is on, a pending atlas bake means NO
  // mesh collider in this pass either.
  const meshSdfMultiActivePos = !!config.gpgpuMeshSdfEnabled && !!config.gpgpuMeshSdfMultiEnabled;
  const meshSdfMultiPos = meshSdfMultiActivePos ? getMeshSdfMultiCollider(config) : null;
  const meshSdfPos = meshSdfMultiActivePos ? null : getMeshSdfCollider(config);
  const meshSdfWorldPos = meshSdfWorldScale(config);
  if (meshSdfMultiActivePos) {
    clearMeshSdfMultiUniforms(posSimMat.uniforms);
    if (posSimMat.uniforms.uMeshSdfEnabled) posSimMat.uniforms.uMeshSdfEnabled.value = false;
    if (meshSdfMultiPos) {
      applyMeshSdfMultiUniforms(posSimMat.uniforms, meshSdfMultiPos);
    } else if (posSimMat.uniforms.uMeshSdfTex) {
      posSimMat.uniforms.uMeshSdfTex.value = null;
    }
  } else {
    clearMeshSdfMultiUniforms(posSimMat.uniforms);
    if (posSimMat.uniforms.uMeshSdfEnabled) posSimMat.uniforms.uMeshSdfEnabled.value = !!meshSdfPos;
    if (posSimMat.uniforms.uMeshSdfTex) posSimMat.uniforms.uMeshSdfTex.value = meshSdfPos ? meshSdfPos.texture : null;
    if (posSimMat.uniforms.uMeshSdfOrigin && meshSdfPos) {
      const halfWorld = (meshSdfPos.grid.sideNorm * meshSdfWorldPos) / 2;
      (posSimMat.uniforms.uMeshSdfOrigin.value as THREE.Vector3).set(-halfWorld, -halfWorld, -halfWorld);
    }
    if (posSimMat.uniforms.uMeshSdfDomainWorld) posSimMat.uniforms.uMeshSdfDomainWorld.value = meshSdfPos ? meshSdfPos.grid.sideNorm * meshSdfWorldPos : 1.0;
    if (posSimMat.uniforms.uMeshSdfScale) posSimMat.uniforms.uMeshSdfScale.value = meshSdfPos ? meshSdfWorldPos : 0;
    if (posSimMat.uniforms.uMeshSdfVoxelWorld) posSimMat.uniforms.uMeshSdfVoxelWorld.value = meshSdfPos ? meshSdfPos.grid.voxelNorm * meshSdfWorldPos : 0;
  }
  posSimMat.uniforms.uMouseEnabled.value = config.gpgpuMouseEnabled;
  posSimMat.uniforms.uMousePos.value.copy(mouseWorld);
  posSimMat.uniforms.uMouseRadius.value = config.gpgpuMouseRadius;
  posSimMat.uniforms.uMouseMode.value = MOUSE_MODE_IDS[config.gpgpuMouseMode] ?? 0;
  posSimMat.uniforms.uMousePaintRate.value = config.gpgpuMousePaintRate;
  if (posSimMat.uniforms.uMouseCount) posSimMat.uniforms.uMouseCount.value = mouseMultiCount;
  if (posSimMat.uniforms.uMousePosMulti && mouseMultiCount > 0 && args.mouseWorldMulti) {
    const arr = posSimMat.uniforms.uMousePosMulti.value as THREE.Vector3[];
    for (let i = 0; i < arr.length; i++) {
      if (i < mouseMultiCount) arr[i].copy(args.mouseWorldMulti[i]);
      else arr[i].set(0, 0, 0);
    }
  }
  // Light emitter (Phase T): only the 'light' emit shape reroutes
  // the age respawn to the light position; everything else keeps
  // the legacy origin-sphere respawn.
  if (posSimMat.uniforms.uEmitLight) {
    posSimMat.uniforms.uEmitLight.value = config.gpgpuEmitShape === 'light';
    const emitLightPos = resolveEmitLightPos(config);
    (posSimMat.uniforms.uEmitLightPos.value as THREE.Vector3).set(emitLightPos.x, emitLightPos.y, emitLightPos.z);
  }
  // Emitter respawn shape / transform (stage 2, E1/E0): the
  // uniforms exist on the shared material but are read only by
  // the emitter variants of the fragment. The shape id follows
  // EMIT_SHAPE_IDS; 'auto' never reaches here as a variant, and
  // its id slot simply stays at the sphere id unused. The
  // transform matrix is the lib/gpgpuEmitter.ts array, uploaded
  // into the Matrix3's column-major elements verbatim.
  if (posSimMat.uniforms.uRespawnShape) {
    const rs = config.gpgpuRespawnShape ?? 'auto';
    posSimMat.uniforms.uRespawnShape.value = rs === 'auto' ? 0 : EMIT_SHAPE_IDS[rs];
  }
  if (posSimMat.uniforms.uEmitterPos) {
    const et = resolveEmitterTransform(config);
    (posSimMat.uniforms.uEmitterPos.value as THREE.Vector3).set(et.posX, et.posY, et.posZ);
    const m = posSimMat.uniforms.uEmitterRotScale.value as THREE.Matrix3;
    const els = emitterRotScaleElements(et);
    for (let i = 0; i < 9; i++) m.elements[i] = els[i];
  }
  // Distribution layer + shader seed (stage 2, B5): read only
  // by the B5 variants of the position fragment. The packed
  // operator list follows lib/gpgpuDistribution.ts; the seed
  // phase follows lib/gpgpuRandom.ts (0 while the opt-in is
  // off, when the uniforms are never read).
  if (posSimMat.uniforms.uDistOps) {
    const distOps = resolveDistributionOps(config);
    const packed = packDistributionOps(distOps);
    const arr = posSimMat.uniforms.uDistOps.value as THREE.Vector4[];
    for (let i = 0; i < arr.length; i++) arr[i].set(packed[i * 4], packed[i * 4 + 1], packed[i * 4 + 2], packed[i * 4 + 3]);
    if (posSimMat.uniforms.uDistOpCount) posSimMat.uniforms.uDistOpCount.value = distOps.length;
  }
  if (posSimMat.uniforms.uShaderSeedPhase) {
    posSimMat.uniforms.uShaderSeedPhase.value = resolveShaderSeedPhase(config);
  }
  // Emission sources (stage 2, E3): read only by the emission
  // variants of the position fragment. The cloud texture is
  // the runtime's published emission cloud. The path arrays
  // follow the steering supply discipline: the authored
  // points packed verbatim (packSteeringPath) plus the
  // arc-length table of lib/gpgpuEmissionSource.ts. The mask
  // gate follows the kill mask's resolution discipline (key
  // on AND a ready mask texture — the scene resolves the
  // texture for the emission gate too), suppressed under
  // vellum / rigid like the other kills.
  if (posSimMat.uniforms.uEmitCloudTex) posSimMat.uniforms.uEmitCloudTex.value = args.emitCloudTex ?? null;
  {
    const emitPath = resolveEmissionPath(config);
    if (posSimMat.uniforms.uEmitPathCount) posSimMat.uniforms.uEmitPathCount.value = emitPath ? emitPath.points.length : 0;
    if (emitPath && posSimMat.uniforms.uEmitPath) {
      const packed = packSteeringPath(emitPath.points);
      const arr = posSimMat.uniforms.uEmitPath.value as THREE.Vector3[];
      for (let i = 0; i < arr.length; i++) arr[i].set(packed[i * 3], packed[i * 3 + 1], packed[i * 3 + 2]);
    }
    if (emitPath && posSimMat.uniforms.uEmitPathCum) posSimMat.uniforms.uEmitPathCum.value = packEmissionPathCum(emitPath);
    // Path-asset emission (stage 2, B2): while the asset is
    // extended, the respawn walk reads asset path 0 from the
    // shared column texture (the same supply the velocity
    // pass fills above) instead of the uniform arrays. The
    // base is the absolute texel index of path 0's first
    // point; the count is its full point count.
    const colSupply = getColumnSupply(config);
    if (posSimMat.uniforms.uEmitColTex) posSimMat.uniforms.uEmitColTex.value = colSupply ? colSupply.texture : null;
    if (posSimMat.uniforms.uEmitColWidth) posSimMat.uniforms.uEmitColWidth.value = colSupply ? colSupply.width : COLUMN_TEX_WIDTH;
    if (posSimMat.uniforms.uEmitColHeight) posSimMat.uniforms.uEmitColHeight.value = colSupply ? colSupply.height : FIELD_COLUMN_LAYOUT.height;
    if (posSimMat.uniforms.uEmitPathBase) posSimMat.uniforms.uEmitPathBase.value = colSupply && colSupply.pathCount > 0 ? colSupply.pointsBase + (colSupply.pathPointOffsets[0] ?? 0) : 0;
    if (posSimMat.uniforms.uEmitPathTexCount) posSimMat.uniforms.uEmitPathTexCount.value = emitPath ? emitPath.points.length : 0;
  }
  if (posSimMat.uniforms.uEmitMaskEnabled) posSimMat.uniforms.uEmitMaskEnabled.value = !!config.gpgpuEmitMaskEnabled && !!args.killMaskTex && !vellum.active && !rigidActive;
  // Lifecycle grammar (Phase AB): spawn gate + kill conditions.
  // The mask kill resolves here: key on AND a ready mask texture —
  // otherwise the shader keeps the legacy path (the UI states the
  // fallback, like the draw clip does).
  if (posSimMat.uniforms.uSpawnRate) posSimMat.uniforms.uSpawnRate.value = Math.max(0.01, Math.min(1, config.gpgpuSpawnRate || 1));
  if (posSimMat.uniforms.uSpawnBurst) posSimMat.uniforms.uSpawnBurst.value = vellum.active ? 1 : Math.max(0, Math.min(1, config.gpgpuSpawnBurst ?? 1));
  if (rigidActive && posSimMat.uniforms.uSpawnBurst) posSimMat.uniforms.uSpawnBurst.value = 1;
  if (posSimMat.uniforms.uSpawnTime) posSimMat.uniforms.uSpawnTime.value = args.spawnTime ?? time;
  // Spawn allocator (stage 2, E2): same resolution as the
  // velocity pass — the effective rate and the envelope
  // clock (current + previous frame), read only by the
  // allocator variant of the position fragment.
  if (posSimMat.uniforms.uSpawnRateEff) posSimMat.uniforms.uSpawnRateEff.value = resolveSpawnRateEff(config, texSize);
  if (posSimMat.uniforms.uSpawnClockTime) posSimMat.uniforms.uSpawnClockTime.value = args.spawnClockTime ?? args.spawnTime ?? time;
  if (posSimMat.uniforms.uSpawnClockPrev) posSimMat.uniforms.uSpawnClockPrev.value = args.spawnClockPrev ?? (args.spawnTime ?? time);
  if (posSimMat.uniforms.uSpawnPulseInterval) posSimMat.uniforms.uSpawnPulseInterval.value = Math.max(0, Math.min(30, config.gpgpuSpawnPulseInterval ?? 0));
  if (posSimMat.uniforms.uSpawnPulseDuty) posSimMat.uniforms.uSpawnPulseDuty.value = Math.max(0.05, Math.min(1, config.gpgpuSpawnPulseDuty ?? 0.3));
  // Phase AX spawn grammar (same resolution as the velocity pass).
  if (posSimMat.uniforms.uSpawnPulseCycles) posSimMat.uniforms.uSpawnPulseCycles.value = Math.max(0, Math.min(64, Math.floor(config.gpgpuSpawnPulseCycles ?? 0)));
  if (posSimMat.uniforms.uSpawnPulseProbability) posSimMat.uniforms.uSpawnPulseProbability.value = Math.max(0, Math.min(1, config.gpgpuSpawnPulseProbability ?? 1));
  if (posSimMat.uniforms.uSpawnOrderTex) posSimMat.uniforms.uSpawnOrderTex.value = args.spawnOrderTex ?? null;
  // Texture-unit fix: the position live variant declares
  // uInitPosTex + uSpawnOrderMaxDist in place of the order
  // sampler (the same args the velocity pass consumes).
  if (posSimMat.uniforms.uInitPosTex) posSimMat.uniforms.uInitPosTex.value = initPosTex ?? null;
  if (posSimMat.uniforms.uSpawnOrderMaxDist) posSimMat.uniforms.uSpawnOrderMaxDist.value = args.spawnOrderMaxDist ?? 0;
  if (posSimMat.uniforms.uSpawnOrderMode) posSimMat.uniforms.uSpawnOrderMode.value = config.gpgpuSpawnOrderMode !== 'hash' && args.spawnOrderTex && !vellum.active && !rigidActive ? (config.gpgpuSpawnOrderMode === 'distanceFar' ? 2 : 1) : 0;
  if (posSimMat.uniforms.uSpawnEventEnabled) posSimMat.uniforms.uSpawnEventEnabled.value = !!config.gpgpuSpawnEventEnabled && !vellum.active && !rigidActive;
  if (posSimMat.uniforms.uSpawnEventTime) posSimMat.uniforms.uSpawnEventTime.value = Math.max(0, Math.min(600, config.gpgpuSpawnEventTime ?? 0));
  if (posSimMat.uniforms.uSpawnEventCount) posSimMat.uniforms.uSpawnEventCount.value = Math.max(0, Math.min(1, config.gpgpuSpawnEventCount ?? 0));
  // Emission curve (Phase AJ): resolved like the age curves —
  // disabled OR an identity curve keeps the legacy respawn path.
  // The knot arrays are padded to FREE_CURVE_MAX_POINTS by
  // repeating the last point (the shader's padded-loop form).
  {
    const freePoints = normalizeFreeCurvePoints(config.gpgpuFreeCurvePoints);
    const emissionActive = !!config.gpgpuEmissionCurveEnabled && !isFreeCurveIdentity(freePoints);
    if (posSimMat.uniforms.uEmissionCurveEnabled) posSimMat.uniforms.uEmissionCurveEnabled.value = emissionActive;
    if (posSimMat.uniforms.uEmissionCurvePeriod) posSimMat.uniforms.uEmissionCurvePeriod.value = Math.max(0.5, Math.min(120, config.gpgpuEmissionCurvePeriod ?? 8));
    if (posSimMat.uniforms.uEmissionCurveT) {
      const padded: number[] = [];
      for (let i = 0; i < FREE_CURVE_MAX_POINTS; i++) padded.push(freePoints[Math.min(i, freePoints.length - 1)].t);
      posSimMat.uniforms.uEmissionCurveT.value = padded;
    }
    if (posSimMat.uniforms.uEmissionCurveV) {
      const padded: number[] = [];
      for (let i = 0; i < FREE_CURVE_MAX_POINTS; i++) padded.push(freePoints[Math.min(i, freePoints.length - 1)].v);
      posSimMat.uniforms.uEmissionCurveV.value = padded;
    }
  }
  if (posSimMat.uniforms.uKillBoundary) posSimMat.uniforms.uKillBoundary.value = !!config.gpgpuKillBoundary && !vellum.active && !rigidActive;
  if (posSimMat.uniforms.uCollisionLifeLoss) posSimMat.uniforms.uCollisionLifeLoss.value = Math.max(0, config.gpgpuCollisionLifeLoss || 0) * (!vellum.active && !rigidActive ? 1 : 0);
  if (posSimMat.uniforms.uCollisionKill) posSimMat.uniforms.uCollisionKill.value = !!config.gpgpuCollisionKill && !vellum.active && !rigidActive;
  if (posSimMat.uniforms.uKillMask) posSimMat.uniforms.uKillMask.value = !!config.gpgpuKillMask && !!args.killMaskTex && !vellum.active && !rigidActive;
  if (posSimMat.uniforms.uKillMaskTex) posSimMat.uniforms.uKillMaskTex.value = args.killMaskTex ?? null;
  if (posSimMat.uniforms.uKillMaskThreshold) posSimMat.uniforms.uKillMaskThreshold.value = Math.max(0, Math.min(1, config.gpgpuMaskThreshold ?? 0.5));
  if (posSimMat.uniforms.uKillMaskInvert) posSimMat.uniforms.uKillMaskInvert.value = !!config.gpgpuMaskInvert;
  // Group kill (Phase DG): the named group referenced by the
  // Gate Group kills its non-members in the position pass. The
  // gate predicate is derived exactly as for the velocity force
  // gate (a predicate group supplies its predicate, a baked
  // group reads slot 3 above 0.5); a dangling reference resolves
  // to no predicate and the kill stays off. Suppressed under
  // vellum / rigid like the other kills, and in replica stacks
  // (vUv is stack-local there, the bake is global).
  {
    const attrConsumers = resolveAttrConsumers(config);
    const groupGate = resolveGroupGate(parseGpgpuGroups(config.gpgpuGroupsData ?? ''), config.gpgpuGroupRef ?? '');
    // Particle rules (G10 stage 1): while rules are effective
    // the rule engine owns slot 3, so the baked branch of the
    // gate resolution is not used as a gate (design 3.5).
    const particleRulesActive = hasEffectiveParticleRules(config.gpgpuParticleRules ?? '');
    const gatePredicate = groupGate.kind === 'predicate'
      ? groupGate.predicate
      : groupGate.kind === 'baked' && !particleRulesActive
        ? { slot: groupGate.slot, mode: 'above' as const, low: 0.5, high: 1, invert: false }
        : null;
    const groupKillOn = !!args.attrTex && attrConsumers.groupKillActive && gatePredicate !== null
      && !vellum.active && !rigidActive && !args.suppressGroupKill;
    if (posSimMat.uniforms.uGroupKillEnabled) posSimMat.uniforms.uGroupKillEnabled.value = groupKillOn;
    // Rule kill (G10): same suppression discipline as the
    // group kill (vellum / rigid / replica stacks).
    const ruleKillOn = !!args.attrTex && particleRulesActive
      && particleRulesHaveAction(config.gpgpuParticleRules ?? '', 'kill')
      && !vellum.active && !rigidActive && !args.suppressGroupKill;
    if (posSimMat.uniforms.uParticleRuleKillEnabled) posSimMat.uniforms.uParticleRuleKillEnabled.value = ruleKillOn;
    // Live rule kill (Grammar 2.0 1A): OR with the baked kill,
    // same suppression discipline. The REP texture is the
    // authority — no attrTex requirement (the REP output is a
    // texture of its own).
    const liveRuleKillOn = !!args.ruleLiveTex
      && liveRulesHaveAction(config.gpgpuParticleRulesLive ?? '', 'kill')
      && !vellum.active && !rigidActive && !args.suppressGroupKill;
    if (posSimMat.uniforms.uParticleRuleLiveKillEnabled) posSimMat.uniforms.uParticleRuleLiveKillEnabled.value = liveRuleKillOn;
    // Live true-kill (Grammar 2.0 1C): the REP mask's bit 6
    // is latched, so the position pass parks matched
    // particles for good. Same suppression discipline as
    // the live kill.
    const liveRuleTrueKillOn = !!args.ruleLiveTex
      && (liveRulesHaveAction(config.gpgpuParticleRulesLive ?? '', 'true-kill') || predationTrueKillActive(config))
      && !vellum.active && !rigidActive && !args.suppressGroupKill;
    if (posSimMat.uniforms.uParticleRuleLiveTrueKillEnabled) posSimMat.uniforms.uParticleRuleLiveTrueKillEnabled.value = liveRuleTrueKillOn;
    // Rule spawn gate (Grammar 2.0 stage 2, E2): the REP
    // mask's bit 13 (the live rules' spawn pulse) re-births
    // matched particles through the shared respawn block.
    // Same suppression discipline as the live kill, plus the
    // gate's own key and a live spawn action.
    const spawnRuleGateOn = !!args.ruleLiveTex
      && !!config.gpgpuSpawnRuleGateEnabled
      && (liveRulesHaveAction(config.gpgpuParticleRulesLive ?? '', 'spawn') || predationBirthActive(config))
      && !vellum.active && !rigidActive && !args.suppressGroupKill;
    if (posSimMat.uniforms.uSpawnRuleGateEnabled) posSimMat.uniforms.uSpawnRuleGateEnabled.value = spawnRuleGateOn;
    if (posSimMat.uniforms.uRuleLiveTex) posSimMat.uniforms.uRuleLiveTex.value = args.ruleLiveTex ?? null;
    // Merged supply (stage 2 texture-unit follow-up): the
    // live reads' y scale while the bound REP texture is the
    // taller merged target (1.0 = the plain square).
    if (posSimMat.uniforms.uLiveTexYScale) posSimMat.uniforms.uLiveTexYScale.value = resolveMergedSupplyPlan(config, texSize)?.yScale ?? 1;
    if (posSimMat.uniforms.uAttrTex) posSimMat.uniforms.uAttrTex.value = args.attrTex ?? null;
    if (gatePredicate) {
      if (posSimMat.uniforms.uGroupSlot) posSimMat.uniforms.uGroupSlot.value = gatePredicate.slot;
      if (posSimMat.uniforms.uGroupMode) posSimMat.uniforms.uGroupMode.value = { below: 0, above: 1, band: 2 }[gatePredicate.mode] ?? 1;
      if (posSimMat.uniforms.uGroupLow) posSimMat.uniforms.uGroupLow.value = gatePredicate.low;
      if (posSimMat.uniforms.uGroupHigh) posSimMat.uniforms.uGroupHigh.value = gatePredicate.high;
      if (posSimMat.uniforms.uGroupInvert) posSimMat.uniforms.uGroupInvert.value = gatePredicate.invert;
    }
  }
  // Contact pass (Grammar 2.0 stage 1, the slice-1B
  // follow-up): replay this step's contact judgments from
  // the frame-start positions and the fresh velocity,
  // between the velocity render and the position render it
  // mirrors. The bindings are the position material's own
  // resolved values above. Under a solver resolution the
  // replay cannot mirror (Verlet / Grains projection /
  // Vellum / Rigid — the same family the lifecycle
  // resolutions protect) the pass is suppressed instead and
  // hit / hits read 0.
  if (args.contactPass) {
    if (contactReplayEnabled({
      verletEnabled: config.gpgpuVerletEnabled,
      grainsProjection: grainsProjectionActive(config),
      vellum: vellum.active,
      rigid: rigidActive,
    })) {
      const meshHalfWorld = meshSdfPos ? (meshSdfPos.grid.sideNorm * meshSdfWorldPos) / 2 : 0;
      args.contactPass.run(gl, {
        posTex: posIn.texture,
        velTex: velOut.texture,
        delta: dt,
        speed: config.gpgpuSpeed,
        bounceRadius: config.gpgpuBounceRadius,
        sdf: {
          enabled: config.gpgpuSdfEnabled,
          shape: SDF_SHAPE_IDS[config.gpgpuSdfShape] ?? 0,
          x: config.gpgpuSdfX,
          y: config.gpgpuSdfY,
          z: config.gpgpuSdfZ,
          size: config.gpgpuSdfSize,
        },
        meshSdf: meshSdfPos ? {
          texture: meshSdfPos.texture,
          origin: new THREE.Vector3(-meshHalfWorld, -meshHalfWorld, -meshHalfWorld),
          domainWorld: meshSdfPos.grid.sideNorm * meshSdfWorldPos,
          scale: meshSdfWorldPos,
          voxelWorld: meshSdfPos.grid.voxelNorm * meshSdfWorldPos,
        } : null,
        floor: { enabled: config.gpgpuFloorEnabled, y: config.gpgpuFloorY },
        terrain: terrainColliderTex ? {
          texture: terrainColliderTex,
          extent: Math.max(terrainSlopeWorldExtent(config), 0.001),
          heightWorld: terrainColliderHeightWorld(config),
          gradScale: terrainColliderGradientScale(config),
          texSize: TERRAIN_DERIVED_SIZE,
        } : null,
      });
    } else {
      args.contactPass.suppress();
    }
  }
  simMesh.material = posSimMat;
  gl.setRenderTarget(posOut);
  gl.render(simScene, simCamera);

  // Grains pile solver (Stage C): density-constraint iterations
  // over the position pass's output. Runs only while the pile
  // plan is active AND the scene supplied the pile extras (the
  // replica-stack runner passes none). The pile-start positions
  // are snapshotted first (the friction term prices vel_now
  // against them); each iteration is a lambda pass into the
  // lambda target followed by a delta pass ping-ponging between
  // posOut and the spare target, and an odd landing is blitted
  // back so the frame ends with the solved positions in posOut,
  // exactly like the Vellum iterations below (which run after
  // the pile and reuse the same spare sequentially).
  if (pilePlan.active && args.grainsPileLambdaMat && args.grainsPileDeltaMat && args.grainsLambdaRT && args.grainsPileBaseRT && args.grainsPileSpareRT && args.blitMat) {
    args.blitMat.uniforms.uTex.value = posOut.texture;
    simMesh.material = args.blitMat;
    gl.setRenderTarget(args.grainsPileBaseRT);
    gl.render(simScene, simCamera);
    const lamU = args.grainsPileLambdaMat.uniforms;
    const delU = args.grainsPileDeltaMat.uniforms;
    for (const u of [lamU, delU]) {
      u.uTexSizeF.value = texSize;
      u.uGrainsSize.value = Math.max(0.001, config.gpgpuGrainsSize || 0);
      u.uGrainsSupport.value = pilePlan.supportRadius;
      u.uGrainsRho0.value = pilePlan.rho0;
      u.uGrainsCellSort.value = !!grainsCellTex;
      u.uGrainsSortTex.value = grainsCellTex;
      u.uGrainsCellOrigin.value = grainsGrid.origin;
      u.uGrainsCellSize.value = grainsGrid.cellSize;
      (u.uGrainsCellDims.value as THREE.Vector3).set(grainsGrid.dimX, grainsGrid.dimY, grainsGrid.dimZ);
    }
    delU.uGrainsStiffness.value = pilePlan.stiffness;
    delU.uGrainsFriction.value = effectiveGrainsFriction(config);
    delU.uBounceRadius.value = config.gpgpuBounceRadius;
    delU.uFloorEnabled.value = config.gpgpuFloorEnabled;
    delU.uFloorY.value = config.gpgpuFloorY;
    delU.uBasePosTex.value = args.grainsPileBaseRT.texture;
    delU.uVelTex.value = velOut.texture;
    delU.uLambdaTex.value = args.grainsLambdaRT.texture;
    let cur: THREE.WebGLRenderTarget = posOut;
    for (let iter = 0; iter < pilePlan.iterations; iter++) {
      lamU.uPosTex.value = cur.texture;
      simMesh.material = args.grainsPileLambdaMat;
      gl.setRenderTarget(args.grainsLambdaRT);
      gl.render(simScene, simCamera);
      const next = cur === posOut ? args.grainsPileSpareRT : posOut;
      delU.uPosTex.value = cur.texture;
      simMesh.material = args.grainsPileDeltaMat;
      gl.setRenderTarget(next);
      gl.render(simScene, simCamera);
      cur = next;
    }
    if (cur !== posOut) {
      args.blitMat.uniforms.uTex.value = cur.texture;
      simMesh.material = args.blitMat;
      gl.setRenderTarget(posOut);
      gl.render(simScene, simCamera);
    }
  }

  // Grains velocity update (Stage C follow-up, 案E): while the
  // plan's velocity update is active, blend velOut toward the
  // velocity reconstructed from the frame's displacement
  // through the POSITION PASS (pile base snapshot - posIn),
  // with a density-gated extra damping. Gate history
  // (2026-11-26): rounds 1 and 3 proved the post-solve
  // position cannot be the source at any displacement cap —
  // the solve's saturated push-out becomes an ejection pump
  // once it is velocity (round 1 launched to height ~300;
  // round 3's capped variant boiled the pile apart). 案A
  // (round 2, this pre-solve source) stopped the launch and
  // held the shape, leaving an interior speed2 floor of 2.29;
  // 案E adds the density factor on top: the lambda target's
  // rho (.y) relative to the plan's rho0 marks the interior,
  // where the reconstructed velocity is damped harder every
  // frame. Renders into the pile spare and blits back over
  // velOut, following the XPBD reconstruction below. The
  // dt > 0 guard keeps stopped and reverse playback untouched.
  if (pilePlan.velocityUpdateActive && args.dt > 0 && args.grainsVelocityUpdateMat && args.grainsPileBaseRT && args.grainsLambdaRT && args.grainsPileSpareRT && args.blitMat) {
    const vuU = args.grainsVelocityUpdateMat.uniforms;
    vuU.uPosTex.value = args.grainsPileBaseRT.texture;
    vuU.uPosInTex.value = posIn.texture;
    vuU.uVelTex.value = velOut.texture;
    vuU.uDensityTex.value = args.grainsLambdaRT.texture;
    vuU.uDt.value = args.dt;
    vuU.uSpeed.value = config.gpgpuSpeed;
    vuU.uBlend.value = pilePlan.velocityBlend;
    vuU.uGrainsSize.value = Math.max(0.001, config.gpgpuGrainsSize || 0);
    vuU.uRho0.value = pilePlan.rho0;
    vuU.uDenseDamp.value = GRAINS_VELOCITY_DENSE_DAMP;
    vuU.uDenseLo.value = GRAINS_VELOCITY_DENSE_LO;
    vuU.uDenseHi.value = GRAINS_VELOCITY_DENSE_HI;
    simMesh.material = args.grainsVelocityUpdateMat;
    gl.setRenderTarget(args.grainsPileSpareRT);
    gl.render(simScene, simCamera);
    args.blitMat.uniforms.uTex.value = args.grainsPileSpareRT.texture;
    simMesh.material = args.blitMat;
    gl.setRenderTarget(velOut);
    gl.render(simScene, simCamera);
  }

  // Vellum (Phase AR): tear state update + constraint projection
  // iterations. Runs only while the solver is active AND the
  // shared-path extras were supplied (the replica-stack runner
  // passes none of them). posIn is never written here — the aux
  // passes still read it as the frame-start positions. The
  // iterations ping-pong between posOut and the spare target
  // (the Verlet previous-position RT; its frame-start copy was
  // already consumed by the position pass above), and an odd
  // landing is blitted back so the frame always ends with the
  // solved positions in posOut, where every consumer reads them.
  if (vellum.active && args.vellumRestTex && args.vellumProjMat && args.vellumSpareRT && args.blitMat) {
    let stateTex: THREE.Texture | null = null;
    // The state pass maintains every severing channel at once:
    // it runs while tear is on, or while glue is on with a
    // finite break threshold (Phase BB — the .b channel).
    const glueBreakLive = vellum.glue > 0 && vellum.glueBreak > 0;
    if ((vellum.tear > 0 || glueBreakLive) && args.vellumStateMat && args.vellumStateIn && args.vellumStateOut) {
      // Strain is measured on the frame-start positions (posIn),
      // one frame behind the integration — deterministic, and
      // the severing is monotonic in the state pass itself.
      const stU = args.vellumStateMat.uniforms;
      stU.uPosTex.value = posIn.texture;
      stU.uVellumRestTex.value = args.vellumRestTex;
      stU.uVellumStateTex.value = args.vellumStateIn.texture;
      stU.uVellumTear.value = vellum.tear;
      stU.uVellumMode.value = vellum.modeId;
      stU.uVellumPin.value = vellum.pinId;
      stU.uVellumGlueBreak.value = glueBreakLive ? vellum.glueBreak : 0;
      stU.uTexSizeF.value = texSize;
      simMesh.material = args.vellumStateMat;
      gl.setRenderTarget(args.vellumStateOut);
      gl.render(simScene, simCamera);
      stateTex = args.vellumStateOut.texture;
    }
    const xpbdReady = vellum.solverMode === 'xpbd'
      && args.vellumXpbdClearMat && args.vellumXpbdLambdaMat && args.vellumXpbdProjMat
      && args.vellumLambda0RT && args.vellumLambda1RT;
    if (xpbdReady) {
      // ── XPBD solve (Phase 19 stage 3) ──
      // Substeps are true XPBD substeps: dt_s = dt / substeps,
      // λ resets at each substep head, each constraint solves
      // once per substep (λ pass pair → apply pass), then the
      // volume constraint when it engages. Positions ping-pong
      // between posOut and the spare target exactly like the
      // legacy projection, and land back in posOut.
      const dtSub = Math.max(args.dt, 1e-6) / vellum.substeps;
      const alphaTilde = vellum.compliance / (dtSub * dtSub);
      const alphaTildeBend = vellum.bendCompliance / (dtSub * dtSub);
      const volumeEngaged = vellum.modeId === 1 && vellum.volumeEnabled
        && args.vellumVolumeReduceMat && args.vellumVolumeProjMat && args.vellumVolumeApplyMat
        && args.vellumVolumeChain && args.vellumVolumeChain.length > 0
        && args.vellumLambdaVolRT && args.vellumGradTex && args.vellumVolumeInfo;
      const clearU = args.vellumXpbdClearMat!.uniforms;
      const lamU = args.vellumXpbdLambdaMat!.uniforms;
      lamU.uVellumRestTex.value = args.vellumRestTex;
      lamU.uVellumStateTex.value = stateTex;
      lamU.uVellumTearEnabled.value = !!stateTex;
      lamU.uVellumGlueStateEnabled.value = !!stateTex && glueBreakLive;
      lamU.uVellumMode.value = vellum.modeId;
      lamU.uVellumPin.value = vellum.pinId;
      lamU.uAlphaTilde.value = alphaTilde;
      lamU.uAlphaTildeBend.value = alphaTildeBend;
      lamU.uVellumGlue.value = vellum.glue;
      lamU.uTexSizeF.value = texSize;
      const xpU = args.vellumXpbdProjMat!.uniforms;
      xpU.uVellumRestTex.value = args.vellumRestTex;
      xpU.uVellumStateTex.value = stateTex;
      xpU.uVellumTearEnabled.value = !!stateTex;
      xpU.uVellumGlueStateEnabled.value = !!stateTex && glueBreakLive;
      xpU.uVellumMode.value = vellum.modeId;
      xpU.uVellumPin.value = vellum.pinId;
      xpU.uVellumGlue.value = vellum.glue;
      xpU.uVellumTearGap.value = vellum.tearGap;
      xpU.uXpbdRelaxation.value = XPBD_JACOBI_RELAXATION;
      xpU.uLambda0Tex.value = args.vellumLambda0RT!.texture;
      xpU.uLambda1Tex.value = args.vellumLambda1RT!.texture;
      xpU.uTexSizeF.value = texSize;
      let cur: THREE.WebGLRenderTarget = posOut;
      const renderTo = (mat: THREE.ShaderMaterial, dst: THREE.WebGLRenderTarget) => {
        simMesh.material = mat;
        gl.setRenderTarget(dst);
        gl.render(simScene, simCamera);
      };
      for (let s = 0; s < vellum.substeps; s++) {
        // λ clear (both sets) — XPBD resets λ per substep.
        (clearU.uClearValue.value as THREE.Vector4).set(0, 0, 0, 0);
        renderTo(args.vellumXpbdClearMat!, args.vellumLambda0RT!);
        renderTo(args.vellumXpbdClearMat!, args.vellumLambda1RT!);
        // λ passes: set 0 (structural/shear) and set 1
        // (bend/glue), both from the substep's input positions.
        lamU.uPosTex.value = cur.texture;
        lamU.uLambdaSet.value = 0;
        lamU.uLambdaTex.value = args.vellumLambda0RT!.texture;
        renderTo(args.vellumXpbdLambdaMat!, args.vellumLambda0RT!);
        lamU.uLambdaSet.value = 1;
        lamU.uLambdaTex.value = args.vellumLambda1RT!.texture;
        renderTo(args.vellumXpbdLambdaMat!, args.vellumLambda1RT!);
        // Apply: corrections land in the other position target.
        const dst = cur === posOut ? args.vellumSpareRT! : posOut;
        xpU.uPosTex.value = cur.texture;
        renderTo(args.vellumXpbdProjMat!, dst);
        cur = dst;
        if (volumeEngaged) {
          // Reduction chain: level 0 builds the signed-volume
          // partials from the current positions, later levels
          // sum 2×2 blocks down to 1×1.
          const chain = args.vellumVolumeChain!;
          const redU = args.vellumVolumeReduceMat!.uniforms;
          redU.uVellumMode.value = vellum.modeId;
          redU.uVellumPin.value = vellum.pinId;
          redU.uTexSizeF.value = texSize;
          for (let level = 0; level < chain.length; level++) {
            if (level === 0) {
              redU.uLevel0.value = true;
              redU.uPosTex.value = cur.texture;
              redU.uSrcTex.value = null;
              redU.uSrcSizeF.value = texSize;
            } else {
              redU.uLevel0.value = false;
              redU.uSrcTex.value = chain[level - 1].texture;
              redU.uSrcSizeF.value = chain[level - 1].width;
            }
            renderTo(args.vellumVolumeReduceMat!, chain[level]);
          }
          // Volume λ at 1×1, then the apply over the pool.
          const vpU = args.vellumVolumeProjMat!.uniforms;
          vpU.uVolumeTex.value = chain[chain.length - 1].texture;
          vpU.uRestVolume.value = args.vellumVolumeInfo!.restVolume;
          vpU.uTargetRatio.value = vellum.volumeRatio;
          vpU.uAlphaTildeVol.value = vellum.volumeCompliance / (dtSub * dtSub);
          vpU.uVolumeDenom.value = Math.max(args.vellumVolumeInfo!.denom, 1e-9);
          renderTo(args.vellumVolumeProjMat!, args.vellumLambdaVolRT!);
          const vaU = args.vellumVolumeApplyMat!.uniforms;
          vaU.uPosTex.value = cur.texture;
          vaU.uLambdaVolTex.value = args.vellumLambdaVolRT!.texture;
          vaU.uVellumGradTex.value = args.vellumGradTex;
          vaU.uVellumMode.value = vellum.modeId;
          vaU.uVellumPin.value = vellum.pinId;
          vaU.uTexSizeF.value = texSize;
          const vDst = cur === posOut ? args.vellumSpareRT! : posOut;
          renderTo(args.vellumVolumeApplyMat!, vDst);
          cur = vDst;
        }
      }
      if (cur !== posOut) {
        args.blitMat.uniforms.uTex.value = cur.texture;
        simMesh.material = args.blitMat;
        gl.setRenderTarget(posOut);
        gl.render(simScene, simCamera);
      }
      // Velocity reconstruction (XPBD): v = (x_new − x_start)
      // / dt over the whole frame, through the spare target —
      // then the stitch sweep below can still run on top.
      if (args.vellumXpbdVelMat) {
        const xvU = args.vellumXpbdVelMat.uniforms;
        xvU.uPosTex.value = posOut.texture;
        xvU.uPrevPosTex.value = posIn.texture;
        xvU.uVelTex.value = velOut.texture;
        xvU.uDt.value = Math.max(args.dt, 1e-6);
        xvU.uVellumDamping.value = vellum.damping;
        xvU.uVellumMode.value = vellum.modeId;
        xvU.uVellumPin.value = vellum.pinId;
        xvU.uTexSizeF.value = texSize;
        simMesh.material = args.vellumXpbdVelMat;
        gl.setRenderTarget(args.vellumSpareRT!);
        gl.render(simScene, simCamera);
        args.blitMat.uniforms.uTex.value = args.vellumSpareRT!.texture;
        simMesh.material = args.blitMat;
        gl.setRenderTarget(velOut);
        gl.render(simScene, simCamera);
      }
    } else {
    const projU = args.vellumProjMat.uniforms;
    projU.uVellumRestTex.value = args.vellumRestTex;
    projU.uVellumStateTex.value = stateTex;
    projU.uVellumTearEnabled.value = !!stateTex;
    projU.uVellumMode.value = vellum.modeId;
    projU.uVellumStiffness.value = vellum.stiffness;
    projU.uVellumBend.value = vellum.bend;
    projU.uVellumPin.value = vellum.pinId;
    projU.uVellumGlue.value = vellum.glue;
    projU.uVellumGlueStateEnabled.value = !!stateTex && glueBreakLive;
    projU.uVellumTearGap.value = vellum.tearGap;
    projU.uTexSizeF.value = texSize;
    let cur: THREE.WebGLRenderTarget = posOut;
    for (let i = 0; i < vellum.substeps; i++) {
      const dst = cur === posOut ? args.vellumSpareRT : posOut;
      projU.uPosTex.value = cur.texture;
      simMesh.material = args.vellumProjMat;
      gl.setRenderTarget(dst);
      gl.render(simScene, simCamera);
      cur = dst;
    }
    if (cur !== posOut) {
      args.blitMat.uniforms.uTex.value = cur.texture;
      simMesh.material = args.blitMat;
      gl.setRenderTarget(posOut);
      gl.render(simScene, simCamera);
    }
    }
    // Stitch (Phase BB): the velocity-coupling sweep, after the
    // solved positions have landed in posOut. It rewrites this
    // frame's velocity output (velOut) through the spare target
    // — free now that the projection ping-pong is done — so the
    // transmission is part of the velocity every consumer and
    // the next frame's integration see. At stitch 0 (default)
    // the pass never runs and velOut is verbatim legacy.
    if (vellum.stitch > 0 && args.vellumVelMat) {
      const velU = args.vellumVelMat.uniforms;
      velU.uVelTex.value = velOut.texture;
      velU.uVellumStateTex.value = stateTex;
      velU.uVellumTearEnabled.value = !!stateTex;
      velU.uVellumMode.value = vellum.modeId;
      velU.uVellumStitch.value = vellum.stitch;
      velU.uVellumPin.value = vellum.pinId;
      velU.uTexSizeF.value = texSize;
      simMesh.material = args.vellumVelMat;
      gl.setRenderTarget(args.vellumSpareRT);
      gl.render(simScene, simCamera);
      args.blitMat.uniforms.uTex.value = args.vellumSpareRT.texture;
      simMesh.material = args.blitMat;
      gl.setRenderTarget(velOut);
      gl.render(simScene, simCamera);
    }
  }
}

export const SDF_SHAPE_IDS: Record<ParticleConfig['gpgpuSdfShape'], number> = {
  sphere: 0,
  box: 1,
  torus: 2,
  capsule: 3,
  gyroid: 4,
};

const MOUSE_MODE_IDS: Record<ParticleConfig['gpgpuMouseMode'], number> = {
  attract: 0,
  repel: 1,
  swirl: 2,
  paint: 3,
};

const AUX_MODE_IDS: Record<Exclude<ParticleConfig['gpgpuAuxMode'], 'none'>, number> = {
  deathBurst: 0,
  bounceSplash: 1,
  sparkTrail: 2,
  birthBurst: 3,
  // Grammar connection (slice 1D-3): the rule-driven spawn.
  // Level 1 only — the type is Exclude<gpgpuAuxMode, 'none'>,
  // and 'ruleSpawn' is not a gpgpuAux2Mode value, so the
  // chain runner (which reads this same table through
  // AuxLevelParams.mode) can never resolve a chain level to
  // mode 4; the chain event chunk carries no branch for it
  // either (lib/auxRuleSpawn.ts).
  ruleSpawn: 4,
  // Child emitter (slice 1D-2): mode 5.
  emit: 5,
  // Trail mechanism (stage 4, S6): mode 6 is 'trail'
  // (TRAIL_AUX_MODE_ID in lib/trailAux.ts). It is NOT a
  // gpgpuAuxMode value — the level-1 runner substitutes it
  // while the Aux-type trail drives the pool — so it does
  // not belong in this table and the chain runner can never
  // resolve a chain level to it.
};

// Aux event emission passes (B3): run after the main velocity/position
// passes, reading the main pool's frame-start textures (posIn/velIn —
// the death position and contact velocities of this frame) and the aux
// pool's own ping-pong pair. The caller flips the aux ping-pong and
// points the aux draw material at the outputs.
// Tick probe machinery (stage-4 gate fix round 7, diag
// only; lib/auxTickProbeDiag.ts): while the ?diag=1 hook has
// a probe armed for one side, runAuxSimulationPasses renders
// a probe material ONCE after that frame's Aux renders —
// a material built from the armed side's own fragment
// string with only the main() output replaced by the tick
// declaration (buildAuxTickProbeFrag), sharing the side's
// uniforms OBJECT by reference — into a dedicated float
// target, and reads back the first texels as the sample.
// The probe materials are cached per source material
// instance (a variant rebuild replaces the instance, which
// invalidates the cache entry); the target is cached per
// size. Nothing here runs while unarmed, and the probe
// never writes into the pool targets.
const auxTickProbeMatCache: Partial<Record<'vel' | 'pos', { src: THREE.ShaderMaterial; mat: THREE.ShaderMaterial }>> = {};
let auxTickProbeTarget: THREE.WebGLRenderTarget | null = null;

function getAuxTickProbeMaterial(side: 'vel' | 'pos', src: THREE.ShaderMaterial): THREE.ShaderMaterial | null {
  const hit = auxTickProbeMatCache[side];
  if (hit && hit.src === src) return hit.mat;
  const frag = buildAuxTickProbeFrag(src.fragmentShader);
  if (!frag) return null;
  if (hit) hit.mat.dispose();
  const mat = new THREE.ShaderMaterial({
    vertexShader: src.vertexShader,
    fragmentShader: frag,
  });
  // The uniforms OBJECT ITSELF is the sharing contract (the
  // runner's per-frame writes land in it, and the probe
  // program must read the very values the pass program was
  // supplied) — assign it directly so the reference is the
  // source material's object regardless of how the
  // constructor handled the parameters.
  mat.uniforms = src.uniforms;
  auxTickProbeMatCache[side] = { src, mat };
  return mat;
}

function getAuxTickProbeTarget(size: number): THREE.WebGLRenderTarget {
  if (auxTickProbeTarget && auxTickProbeTarget.width === size && auxTickProbeTarget.height === size) {
    return auxTickProbeTarget;
  }
  auxTickProbeTarget?.dispose();
  auxTickProbeTarget = new THREE.WebGLRenderTarget(size, size, {
    type: THREE.FloatType,
    format: THREE.RGBAFormat,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    depthBuffer: false,
    stencilBuffer: false,
  });
  return auxTickProbeTarget;
}

export function runAuxSimulationPasses(args: {
  config: ParticleConfig;
  texSize: number;
  dt: number;
  time: number;
  simMesh: THREE.Mesh;
  gl: THREE.WebGLRenderer;
  simScene: THREE.Scene;
  simCamera: THREE.Camera;
  mainPosTex: THREE.Texture;
  mainVelTex: THREE.Texture;
  auxPosIn: THREE.WebGLRenderTarget;
  auxPosOut: THREE.WebGLRenderTarget;
  auxVelIn: THREE.WebGLRenderTarget;
  auxVelOut: THREE.WebGLRenderTarget;
  auxVelMat: THREE.ShaderMaterial;
  auxPosMat: THREE.ShaderMaterial;
  // Grammar connection (Grammar 2.0 stage 1, slice 1D-3): the
  // REP's latest output texture, sampled by the ruleSpawn
  // variant's event test (bit 13 of .r). Null while no live
  // rule has run — the variant's materials then sample an
  // unbound texture (black: no pulse anywhere, no spawns).
  // Only the level-1 materials declare the uniform.
  mainRuleTex?: THREE.Texture | null;
  // Spawn inheritance (Grammar 2.0 stage 1, slice 1D-1): the
  // sparse-write pass into this level's inheritance target,
  // driven right after the velocity pass (the spawn decision
  // maker). Absent (key off / no target / no attribute texture)
  // the pass never runs and the frame is the legacy one.
  inherit?: {
    target: THREE.WebGLRenderTarget;
    mat: THREE.ShaderMaterial;
    mainAttrTex: THREE.Texture | null;
  } | null;
}): void {
  const {
    config,
    texSize,
    dt,
    time,
    simMesh,
    gl,
    simScene,
    simCamera,
    mainPosTex,
    mainVelTex,
    auxPosIn,
    auxPosOut,
    auxVelIn,
    auxVelOut,
    auxVelMat,
    auxPosMat,
    inherit,
  } = args;

  // Trail mechanism (stage 4, S6): while the Aux-type trail
  // drives the pool, level 1 runs even at gpgpuAuxMode
  // 'none' — the trail IS the level-1 emitter then — and the
  // event mode is the trail mode (id 6), taking precedence
  // over the configured Aux mode for this level.
  const trailDriven = trailAuxActive(config);
  if (config.gpgpuAuxMode === 'none' && !trailDriven) return;
  const modeId = trailDriven || config.gpgpuAuxMode === 'none'
    ? TRAIL_AUX_MODE_ID
    : (AUX_MODE_IDS[config.gpgpuAuxMode] ?? 0);
  const mainRuleTex = args.mainRuleTex ?? null;
  const auxCount = Math.max(0, Math.min(16384, Math.round(config.gpgpuAuxCount)));

  const velU = auxVelMat.uniforms;
  velU.uAuxPosTex.value = auxPosIn.texture;
  velU.uAuxVelTex.value = auxVelIn.texture;
  velU.uMainPosTex.value = mainPosTex;
  velU.uMainVelTex.value = mainVelTex;
  // Grammar connection (slice 1D-3): declared in the shader
  // only in the ruleSpawn variant; filled whenever supplied.
  if (velU.uMainRuleTex) velU.uMainRuleTex.value = mainRuleTex;
  velU.uMainTexSizeF.value = texSize;
  velU.uAuxCount.value = auxCount;
  velU.uAuxMode.value = modeId;
  velU.uAuxIntensity.value = config.gpgpuAuxIntensity;
  velU.uAuxSpeed.value = config.gpgpuAuxSpeed;
  // Trail mechanism (stage 4, S6): while the trail drives
  // the pool, the spawn life is the resolved trail life
  // (explicit gpgpuTrailAuxLife, else derived from
  // gpgpuTrailLength); every other configuration keeps the
  // configured Aux life untouched.
  velU.uAuxLife.value = trailDriven ? resolveTrailAuxLifeSeconds(config) : config.gpgpuAuxLife;
  velU.uAuxGravityScale.value = config.gpgpuAuxGravityScale;
  velU.uAuxDrag.value = config.gpgpuAuxDrag;
  velU.uAuxCurl.value = config.gpgpuAuxCurl;
  // Child emitter (slice 1D-2): declared in the shader only in
  // the emit variant; the passes fill them per frame.
  if (velU.uAuxEmitRate) {
    velU.uAuxEmitRate.value = config.gpgpuAuxEmitRate;
    velU.uAuxEmitShape.value = AUX_EMIT_SHAPE_IDS[config.gpgpuAuxEmitShape] ?? 0;
    velU.uAuxEmitSpread.value = config.gpgpuAuxEmitSpread;
  }
  // Trail mechanism (stage 4, S6): declared in the shader
  // only in the trail variant; filled per frame.
  if (velU.uTrailEmitInterval) {
    velU.uTrailEmitInterval.value = resolveTrailEmitInterval(config.gpgpuTrailEmitInterval);
    velU.uTrailEmitRate.value = resolveTrailEmitRate(config.gpgpuTrailEmitRate);
  }
  if (velU.uAuxInheritVelScale) velU.uAuxInheritVelScale.value = config.gpgpuAuxInheritVelScale;
  velU.uAgeEnabled.value = config.gpgpuAgeEnabled;
  velU.uAgeMax.value = config.gpgpuAgeMax;
  velU.uFloorEnabled.value = config.gpgpuFloorEnabled;
  velU.uFloorY.value = config.gpgpuFloorY;
  velU.uFloorBounce.value = config.gpgpuFloorBounce;
  velU.uBounceRadius.value = config.gpgpuBounceRadius;
  velU.uBounce.value = config.gpgpuBounce;
  velU.uGravity.value = config.gpgpuGravity;
  velU.uDelta.value = dt;
  velU.uTime.value = time;
  // Phase 20 stage 4 (UE5 #22): the SDF collider set for the
  // bounceSplash SDF contact source. The uniforms exist on the
  // material in every configuration; only the PHASE20 variant
  // shader declares them.
  if (velU.uSdfEnabled) {
    velU.uSdfEnabled.value = config.gpgpuSdfEnabled;
    velU.uSdfShape.value = SDF_SHAPE_IDS[config.gpgpuSdfShape] ?? 0;
    velU.uSdfX.value = config.gpgpuSdfX;
    velU.uSdfY.value = config.gpgpuSdfY;
    velU.uSdfZ.value = config.gpgpuSdfZ;
    velU.uSdfSize.value = config.gpgpuSdfSize;
  }
  simMesh.material = auxVelMat;
  gl.setRenderTarget(auxVelOut);
  gl.render(simScene, simCamera);
  // Stage-4 gate fix round 5 (G4-5 triage): record the
  // render for the ?diag=1 landing stats — a counter and
  // the output target's uuid only (lib/auxPassDiag.ts).
  noteAuxPassRender('vel', auxVelOut.texture.uuid);

  // Spawn inheritance write (slice 1D-1): re-evaluates the
  // velocity pass's spawn decision against the same frame-start
  // inputs and writes the parent's slots / species into the
  // inheritance target for the slots that spawned (all other
  // texels discard, keeping their previous record). Runs
  // between the velocity and position passes; the position
  // pass never writes the inheritance target.
  if (inherit && inherit.mainAttrTex) {
    const inhU = inherit.mat.uniforms;
    inhU.uAuxPosTex.value = auxPosIn.texture;
    inhU.uAuxVelTex.value = auxVelIn.texture;
    inhU.uMainPosTex.value = mainPosTex;
    inhU.uMainVelTex.value = mainVelTex;
    // Grammar connection (slice 1D-3): the inheritance write
    // re-evaluates the same ruleSpawn decision, so it binds
    // the same REP texture (variant materials only).
    if (inhU.uMainRuleTex) inhU.uMainRuleTex.value = mainRuleTex;
    inhU.uMainTexSizeF.value = texSize;
    inhU.uAuxCount.value = auxCount;
    inhU.uAuxMode.value = modeId;
    inhU.uAuxIntensity.value = config.gpgpuAuxIntensity;
    inhU.uAuxSpeed.value = config.gpgpuAuxSpeed;
    if (inhU.uAuxEmitRate) {
      inhU.uAuxEmitRate.value = config.gpgpuAuxEmitRate;
      inhU.uAuxEmitShape.value = AUX_EMIT_SHAPE_IDS[config.gpgpuAuxEmitShape] ?? 0;
      inhU.uAuxEmitSpread.value = config.gpgpuAuxEmitSpread;
    }
    // Trail mechanism (stage 4, S6): the inheritance write
    // re-evaluates the same trail decision.
    if (inhU.uTrailEmitInterval) {
      inhU.uTrailEmitInterval.value = resolveTrailEmitInterval(config.gpgpuTrailEmitInterval);
      inhU.uTrailEmitRate.value = resolveTrailEmitRate(config.gpgpuTrailEmitRate);
    }
    inhU.uAgeEnabled.value = config.gpgpuAgeEnabled;
    inhU.uAgeMax.value = config.gpgpuAgeMax;
    inhU.uFloorEnabled.value = config.gpgpuFloorEnabled;
    inhU.uFloorY.value = config.gpgpuFloorY;
    inhU.uBounceRadius.value = config.gpgpuBounceRadius;
    inhU.uMainAttrTex.value = inherit.mainAttrTex;
    inhU.uSpeciesCount.value = config.gpgpuParticleLifeSpecies;
    inhU.uDelta.value = dt;
    inhU.uTime.value = time;
    if (inhU.uSdfEnabled) {
      inhU.uSdfEnabled.value = config.gpgpuSdfEnabled;
      inhU.uSdfShape.value = SDF_SHAPE_IDS[config.gpgpuSdfShape] ?? 0;
      inhU.uSdfX.value = config.gpgpuSdfX;
      inhU.uSdfY.value = config.gpgpuSdfY;
      inhU.uSdfZ.value = config.gpgpuSdfZ;
      inhU.uSdfSize.value = config.gpgpuSdfSize;
    }
    simMesh.material = inherit.mat;
    gl.setRenderTarget(inherit.target);
    // Sparse write: non-spawning texels discard so their
    // records persist across frames — the renderer's autoClear
    // must therefore be off for this render (the merge pass's
    // discipline below). With the default autoClear every
    // render first erases the whole target, leaving only the
    // current frame's spawns: every record died with its spawn
    // frame and the texture read as all-zero (gate C4-1,
    // second gap — STAGE1_INHERIT_FIX2_RECORD.md).
    const prevInheritAutoClear = gl.autoClear;
    gl.autoClear = false;
    gl.render(simScene, simCamera);
    gl.autoClear = prevInheritAutoClear;
  }

  const posU = auxPosMat.uniforms;
  posU.uAuxPosTex.value = auxPosIn.texture;
  posU.uAuxVelTex.value = auxVelIn.texture;
  posU.uAuxVelOutTex.value = auxVelOut.texture;
  posU.uMainPosTex.value = mainPosTex;
  posU.uMainVelTex.value = mainVelTex;
  // Grammar connection (slice 1D-3): see the velocity pass.
  if (posU.uMainRuleTex) posU.uMainRuleTex.value = mainRuleTex;
  posU.uMainTexSizeF.value = texSize;
  posU.uAuxCount.value = auxCount;
  posU.uAuxMode.value = modeId;
  posU.uAuxIntensity.value = config.gpgpuAuxIntensity;
  posU.uAuxSpeed.value = config.gpgpuAuxSpeed;
  if (posU.uAuxEmitRate) {
    posU.uAuxEmitRate.value = config.gpgpuAuxEmitRate;
    posU.uAuxEmitShape.value = AUX_EMIT_SHAPE_IDS[config.gpgpuAuxEmitShape] ?? 0;
    posU.uAuxEmitSpread.value = config.gpgpuAuxEmitSpread;
  }
  // Trail mechanism (stage 4, S6): see the velocity pass.
  if (posU.uTrailEmitInterval) {
    posU.uTrailEmitInterval.value = resolveTrailEmitInterval(config.gpgpuTrailEmitInterval);
    posU.uTrailEmitRate.value = resolveTrailEmitRate(config.gpgpuTrailEmitRate);
  }
  posU.uAgeEnabled.value = config.gpgpuAgeEnabled;
  posU.uAgeMax.value = config.gpgpuAgeMax;
  posU.uFloorEnabled.value = config.gpgpuFloorEnabled;
  posU.uFloorY.value = config.gpgpuFloorY;
  posU.uBounceRadius.value = config.gpgpuBounceRadius;
  posU.uDelta.value = dt;
  posU.uTime.value = time;
  // Phase 20 stage 4: same SDF set as the velocity pass — the
  // position pass re-evaluates the identical event test.
  if (posU.uSdfEnabled) {
    posU.uSdfEnabled.value = config.gpgpuSdfEnabled;
    posU.uSdfShape.value = SDF_SHAPE_IDS[config.gpgpuSdfShape] ?? 0;
    posU.uSdfX.value = config.gpgpuSdfX;
    posU.uSdfY.value = config.gpgpuSdfY;
    posU.uSdfZ.value = config.gpgpuSdfZ;
    posU.uSdfSize.value = config.gpgpuSdfSize;
  }
  simMesh.material = auxPosMat;
  gl.setRenderTarget(auxPosOut);
  gl.render(simScene, simCamera);
  // Stage-4 gate fix round 5 (G4-5 triage): see the
  // velocity pass above.
  noteAuxPassRender('pos', auxPosOut.texture.uuid);
  // Landing probe (armed only through the ?diag=1 hook):
  // read back the first texels of both output targets
  // immediately after this frame's renders, so the diag
  // side can prove the renders landed in the very targets
  // it reads back elsewhere. Unarmed frames pay nothing.
  if (auxPassLandingArmed()) {
    const n = Math.min(AUX_PASS_LANDING_TEXELS, auxVelOut.width, auxPosOut.width);
    if (n > 0) {
      const velBuf = new Float32Array(n * 4);
      const posBuf = new Float32Array(n * 4);
      gl.readRenderTargetPixels(auxVelOut, 0, 0, n, 1, velBuf);
      gl.readRenderTargetPixels(auxPosOut, 0, 0, n, 1, posBuf);
      const toTexels = (buf: Float32Array) => {
        const out: number[][] = [];
        for (let i = 0; i < n; i++) out.push([buf[i * 4], buf[i * 4 + 1], buf[i * 4 + 2], buf[i * 4 + 3]]);
        return out;
      };
      noteAuxPassLandingSample(toTexels(velBuf), toTexels(posBuf));
    }
  }
  // Tick probe (stage-4 gate fix round 7, armed only
  // through the ?diag=1 hook, one side at a time): render
  // the armed side's declaration material into the probe
  // target and read back the first texels. Runs after both
  // passes, so the shared uniforms object holds THIS
  // frame's supplied values (uTime included) whichever side
  // is armed. The mesh material and render target are
  // restored afterwards; the pool targets are never the
  // probe's destination.
  const tickProbeSide = auxTickProbeArmedSide();
  if (tickProbeSide) {
    const srcMat = tickProbeSide === 'vel' ? auxVelMat : auxPosMat;
    const probeMat = getAuxTickProbeMaterial(tickProbeSide, srcMat);
    const size = auxVelOut.width;
    const n = Math.min(AUX_TICK_PROBE_TEXELS, size);
    if (probeMat && n > 0) {
      const probeTarget = getAuxTickProbeTarget(size);
      simMesh.material = probeMat;
      gl.setRenderTarget(probeTarget);
      gl.render(simScene, simCamera);
      const buf = new Float32Array(n * 4);
      gl.readRenderTargetPixels(probeTarget, 0, 0, n, 1, buf);
      const texels: number[][] = [];
      for (let i = 0; i < n; i++) texels.push([buf[i * 4], buf[i * 4 + 1], buf[i * 4 + 2], buf[i * 4 + 3]]);
      const passState = getAuxPassDiagState();
      noteAuxTickProbeSample(tickProbeSide, texels, time, passState.velRenders, passState.posRenders);
      simMesh.material = auxPosMat;
      gl.setRenderTarget(auxPosOut);
    }
  }
}

// Whitewater passes (Phase BC): run after the fluid pass, reading
// the field texture the fluid pass just produced (the projected
// FLIP field while the FLIP layer is on) and the foam pool's own
// ping-pong pair. The caller flips the foam ping-pong and points
// the foam draw material at the outputs. Foam never writes into
// the field, the FLIP targets or the main pool — one-way only.
export function runWhitewaterSimulationPasses(args: {
  config: ParticleConfig;
  dt: number;
  time: number;
  simMesh: THREE.Mesh;
  gl: THREE.WebGLRenderer;
  simScene: THREE.Scene;
  simCamera: THREE.Camera;
  fluidTex: THREE.Texture;
  wwPosIn: THREE.WebGLRenderTarget;
  wwPosOut: THREE.WebGLRenderTarget;
  wwVelIn: THREE.WebGLRenderTarget;
  wwVelOut: THREE.WebGLRenderTarget;
  wwVelMat: THREE.ShaderMaterial;
  wwPosMat: THREE.ShaderMaterial;
  // Whitewater 3D (Phase 19 stage 2): while the FLIP mode is
  // '3d' and the 3D targets have stepped, the foam pool runs
  // on the 3D materials against the FLIP3D grid / phi textures
  // instead of the 2D field. Absent extras (or mode '2d') keep
  // the legacy path below verbatim. No extra key: the branch
  // follows gpgpuFlipMode.
  ww3VelMat?: THREE.ShaderMaterial;
  ww3PosMat?: THREE.ShaderMaterial;
  flip3dTargets?: Flip3dTargets | null;
}): void {
  const {
    config,
    dt,
    time,
    simMesh,
    gl,
    simScene,
    simCamera,
    fluidTex,
    wwPosIn,
    wwPosOut,
    wwVelIn,
    wwVelOut,
    wwVelMat,
    wwPosMat,
    ww3VelMat,
    ww3PosMat,
    flip3dTargets,
  } = args;

  if (!config.gpgpuWhitewaterEnabled || !config.gpgpuFluidEnabled || !config.gpgpuFlipEnabled) return;

  if (
    config.gpgpuFlipMode === '3d'
    && ww3VelMat && ww3PosMat && flip3dTargets
    && flip3dTargets.framesStepped > 0 && flip3dTargets.phiTexture
  ) {
    const t = flip3dTargets;
    const setWw3Common = (mat: THREE.ShaderMaterial) => {
      const u = mat.uniforms;
      u.uWw3VelTex.value = flip3dCurrentVelTexture(t);
      u.uWw3PhiTex.value = t.phiTexture;
      u.uWw3GridN.value = t.resolution;
      (u.uWw3AtlasSize.value as THREE.Vector2).set(t.atlasWidth, t.atlasHeight);
      (u.uWw3AtlasTiles.value as THREE.Vector2).set(t.tilesX, t.tilesY);
      u.uWw3ManualTrilinear.value = !t.floatLinear;
      u.uBounceRadius.value = config.gpgpuBounceRadius;
      u.uFluidScale.value = config.gpgpuFluidScale;
      u.uWwThreshold.value = config.gpgpuWhitewaterThreshold;
      u.uWwAmount.value = config.gpgpuWhitewaterAmount;
      u.uWw3VelScale.value = pyroGridVelScale(flip3dHalfExtent(config), t.resolution);
    };
    const velU = ww3VelMat.uniforms;
    setWw3Common(ww3VelMat);
    velU.uWwPosTex.value = wwPosIn.texture;
    velU.uWwVelTex.value = wwVelIn.texture;
    velU.uWwLife.value = config.gpgpuWhitewaterLife;
    velU.uDelta.value = dt;
    velU.uTime.value = time;
    simMesh.material = ww3VelMat;
    gl.setRenderTarget(wwVelOut);
    gl.render(simScene, simCamera);

    const posU = ww3PosMat.uniforms;
    setWw3Common(ww3PosMat);
    posU.uWwPosTex.value = wwPosIn.texture;
    posU.uWwVelTex.value = wwVelIn.texture;
    posU.uWwVelOutTex.value = wwVelOut.texture;
    posU.uDelta.value = dt;
    posU.uTime.value = time;
    simMesh.material = ww3PosMat;
    gl.setRenderTarget(wwPosOut);
    gl.render(simScene, simCamera);
    return;
  }

  const velU = wwVelMat.uniforms;
  velU.uWwPosTex.value = wwPosIn.texture;
  velU.uWwVelTex.value = wwVelIn.texture;
  velU.uFluidTex.value = fluidTex;
  velU.uBounceRadius.value = config.gpgpuBounceRadius;
  velU.uFluidScale.value = config.gpgpuFluidScale;
  velU.uFluidInfluence.value = config.gpgpuFluidInfluence;
  velU.uWwThreshold.value = config.gpgpuWhitewaterThreshold;
  velU.uWwAmount.value = config.gpgpuWhitewaterAmount;
  velU.uWwLife.value = config.gpgpuWhitewaterLife;
  velU.uDelta.value = dt;
  velU.uTime.value = time;
  simMesh.material = wwVelMat;
  gl.setRenderTarget(wwVelOut);
  gl.render(simScene, simCamera);

  const posU = wwPosMat.uniforms;
  posU.uWwPosTex.value = wwPosIn.texture;
  posU.uWwVelTex.value = wwVelIn.texture;
  posU.uWwVelOutTex.value = wwVelOut.texture;
  posU.uFluidTex.value = fluidTex;
  posU.uBounceRadius.value = config.gpgpuBounceRadius;
  posU.uFluidScale.value = config.gpgpuFluidScale;
  posU.uFluidInfluence.value = config.gpgpuFluidInfluence;
  posU.uWwThreshold.value = config.gpgpuWhitewaterThreshold;
  posU.uWwAmount.value = config.gpgpuWhitewaterAmount;
  posU.uDelta.value = dt;
  posU.uTime.value = time;
  simMesh.material = wwPosMat;
  gl.setRenderTarget(wwPosOut);
  gl.render(simScene, simCamera);
}

// Aux chain passes (Phase W1): one chain level (2 or 3) against the
// previous level's FRAME-START textures — the same pre-update state
// level 1 reads from the main pool, so a death/bounce event is
// located where it happened this frame at every level. The level's
// resolved parameters (lib/auxChain.ts) drive both passes; level >= 2
// physics (gravity / floor / sphere bound) follow the scene config
// exactly as level 1's do, with the level's own gravity scale, drag
// and curl in place of the shared ones.
export function runAuxChainSimulationPasses(args: {
  config: ParticleConfig;
  dt: number;
  time: number;
  simMesh: THREE.Mesh;
  gl: THREE.WebGLRenderer;
  simScene: THREE.Scene;
  simCamera: THREE.Camera;
  level: AuxLevelParams;
  srcPosTex: THREE.Texture;
  srcVelTex: THREE.Texture;
  srcCount: number;
  auxPosIn: THREE.WebGLRenderTarget;
  auxPosOut: THREE.WebGLRenderTarget;
  auxVelIn: THREE.WebGLRenderTarget;
  auxVelOut: THREE.WebGLRenderTarget;
  auxChainVelMat: THREE.ShaderMaterial;
  auxChainPosMat: THREE.ShaderMaterial;
  // Spawn inheritance (slice 1D-1): the sparse-write pass into
  // this level's inheritance target, copying the upper level's
  // inheritance texel for the slots that spawned. Absent (key
  // off / either target missing) the pass never runs.
  inherit?: {
    target: THREE.WebGLRenderTarget;
    mat: THREE.ShaderMaterial;
    srcInheritTex: THREE.Texture;
  } | null;
}): void {
  const {
    config,
    dt,
    time,
    simMesh,
    gl,
    simScene,
    simCamera,
    level,
    srcPosTex,
    srcVelTex,
    srcCount,
    auxPosIn,
    auxPosOut,
    auxVelIn,
    auxVelOut,
    auxChainVelMat,
    auxChainPosMat,
    inherit,
  } = args;

  const modeId = AUX_MODE_IDS[level.mode] ?? 0;
  const auxCount = Math.max(0, Math.min(16384, Math.round(config.gpgpuAuxCount)));

  const velU = auxChainVelMat.uniforms;
  velU.uAuxPosTex.value = auxPosIn.texture;
  velU.uAuxVelTex.value = auxVelIn.texture;
  velU.uMainPosTex.value = srcPosTex;
  velU.uMainVelTex.value = srcVelTex;
  velU.uMainTexSizeF.value = AUX_TEX_SIZE;
  velU.uSrcCount.value = srcCount;
  velU.uAuxCount.value = auxCount;
  velU.uAuxMode.value = modeId;
  velU.uAuxIntensity.value = level.intensity;
  velU.uAuxSpeed.value = level.speed;
  velU.uAuxLife.value = level.life;
  velU.uAuxGravityScale.value = level.gravityScale;
  velU.uAuxDrag.value = level.drag;
  velU.uAuxCurl.value = level.curl;
  // Child emitter (slice 1D-2): the level's emit set, declared
  // in the shader only in the chain emit variant.
  if (velU.uAuxEmitRate) {
    velU.uAuxEmitRate.value = level.emitRate;
    velU.uAuxEmitShape.value = AUX_EMIT_SHAPE_IDS[level.emitShape] ?? 0;
    velU.uAuxEmitSpread.value = level.emitSpread;
  }
  if (velU.uAuxInheritVelScale) velU.uAuxInheritVelScale.value = config.gpgpuAuxInheritVelScale;
  velU.uChainSalt.value = level.salt;
  velU.uFloorEnabled.value = config.gpgpuFloorEnabled;
  velU.uFloorY.value = config.gpgpuFloorY;
  velU.uFloorBounce.value = config.gpgpuFloorBounce;
  velU.uBounceRadius.value = config.gpgpuBounceRadius;
  velU.uBounce.value = config.gpgpuBounce;
  velU.uGravity.value = config.gpgpuGravity;
  velU.uDelta.value = dt;
  velU.uTime.value = time;
  simMesh.material = auxChainVelMat;
  gl.setRenderTarget(auxVelOut);
  gl.render(simScene, simCamera);

  // Spawn inheritance write (slice 1D-1): same placement as
  // level 1 — right after this level's velocity pass, copying
  // the upper level's inheritance texel for spawned slots.
  if (inherit) {
    const inhU = inherit.mat.uniforms;
    inhU.uAuxPosTex.value = auxPosIn.texture;
    inhU.uAuxVelTex.value = auxVelIn.texture;
    inhU.uMainPosTex.value = srcPosTex;
    inhU.uMainVelTex.value = srcVelTex;
    inhU.uMainTexSizeF.value = AUX_TEX_SIZE;
    inhU.uSrcCount.value = srcCount;
    inhU.uAuxCount.value = auxCount;
    inhU.uAuxMode.value = modeId;
    inhU.uAuxIntensity.value = level.intensity;
    inhU.uAuxSpeed.value = level.speed;
    if (inhU.uAuxEmitRate) {
      inhU.uAuxEmitRate.value = level.emitRate;
      inhU.uAuxEmitShape.value = AUX_EMIT_SHAPE_IDS[level.emitShape] ?? 0;
      inhU.uAuxEmitSpread.value = level.emitSpread;
    }
    inhU.uChainSalt.value = level.salt;
    inhU.uFloorEnabled.value = config.gpgpuFloorEnabled;
    inhU.uFloorY.value = config.gpgpuFloorY;
    inhU.uBounceRadius.value = config.gpgpuBounceRadius;
    inhU.uSrcInheritTex.value = inherit.srcInheritTex;
    inhU.uDelta.value = dt;
    inhU.uTime.value = time;
    simMesh.material = inherit.mat;
    gl.setRenderTarget(inherit.target);
    // Sparse write, same discipline as the level-1 write
    // above: autoClear off for this render, or every render
    // erases the records earlier frames wrote (gate C4-1,
    // second gap — STAGE1_INHERIT_FIX2_RECORD.md).
    const prevInheritAutoClear = gl.autoClear;
    gl.autoClear = false;
    gl.render(simScene, simCamera);
    gl.autoClear = prevInheritAutoClear;
  }

  const posU = auxChainPosMat.uniforms;
  posU.uAuxPosTex.value = auxPosIn.texture;
  posU.uAuxVelTex.value = auxVelIn.texture;
  posU.uAuxVelOutTex.value = auxVelOut.texture;
  posU.uMainPosTex.value = srcPosTex;
  posU.uMainVelTex.value = srcVelTex;
  posU.uMainTexSizeF.value = AUX_TEX_SIZE;
  posU.uSrcCount.value = srcCount;
  posU.uAuxCount.value = auxCount;
  posU.uAuxMode.value = modeId;
  posU.uAuxIntensity.value = level.intensity;
  posU.uAuxSpeed.value = level.speed;
  if (posU.uAuxEmitRate) {
    posU.uAuxEmitRate.value = level.emitRate;
    posU.uAuxEmitShape.value = AUX_EMIT_SHAPE_IDS[level.emitShape] ?? 0;
    posU.uAuxEmitSpread.value = level.emitSpread;
  }
  posU.uChainSalt.value = level.salt;
  posU.uFloorEnabled.value = config.gpgpuFloorEnabled;
  posU.uFloorY.value = config.gpgpuFloorY;
  posU.uBounceRadius.value = config.gpgpuBounceRadius;
  posU.uDelta.value = dt;
  posU.uTime.value = time;
  simMesh.material = auxChainPosMat;
  gl.setRenderTarget(auxPosOut);
  gl.render(simScene, simCamera);
}

// ── Replica independent simulation (Phase W2, method (a)) ──────
//
// One simulation stack per replica block: its own position /
// velocity ping-pong pair (seeded from the shared initial data),
// its own prev-position target for Verlet, and its own velocity /
// position materials (factory-built with the shared shaders).
// Each frame every stack steps with replica-private field seed /
// clock offsets, then its block is merged into the shared layout
// targets (the main pool's outputs for this frame) that all
// downstream consumers read. The shared runSimulationPasses above
// does the per-stack stepping unchanged — the stack-only uniforms
// (stack mode / global remap / seed / time / age base) are set
// here because the shared assignment code never touches them,
// and the per-stack config masks the Phase M age step to 0 (the
// stack supplies the same restart age as a constant base).
export type ReplicaStackPassTarget = {
  index: number;
  start: number;
  size: number;
  side: number;
  targets: {
    posA: THREE.WebGLRenderTarget;
    posB: THREE.WebGLRenderTarget;
    velA: THREE.WebGLRenderTarget;
    velB: THREE.WebGLRenderTarget;
  };
  prevPos: THREE.WebGLRenderTarget;
  pingIsA: boolean;
  velMat: THREE.ShaderMaterial;
  posMat: THREE.ShaderMaterial;
};

const STACK_WEBGPU_PING_REF: MutableRefObject<boolean> = { current: true };

export function runReplicaStackPasses(args: {
  config: ParticleConfig;
  dt: number;
  time: number;
  blast: number;
  mouseWorld: THREE.Vector3;
  simMesh: THREE.Mesh;
  gl: THREE.WebGLRenderer;
  simScene: THREE.Scene;
  simCamera: THREE.Camera;
  stacks: ReplicaStackPassTarget[];
  mergedPosOut: THREE.WebGLRenderTarget;
  mergedVelOut: THREE.WebGLRenderTarget;
  mergeMat: THREE.ShaderMaterial;
  blitMat: THREE.ShaderMaterial;
  initPosTex: THREE.Texture | null;
  attrTex?: THREE.Texture | null;
  morphTex: THREE.Texture | null;
  morphNormalTex: THREE.Texture | null;
  morphKickStart: number;
  fluidVelMat: THREE.ShaderMaterial;
  globalTexSize: number;
  // Multi-touch (Phase AO): forwarded to every stack's passes.
  mouseWorldMulti?: THREE.Vector3[];
  mouseMultiCount?: number;
}): void {
  const {
    config,
    dt,
    time,
    blast,
    mouseWorld,
    simMesh,
    gl,
    simScene,
    simCamera,
    stacks,
    mergedPosOut,
    mergedVelOut,
    mergeMat,
    blitMat,
    initPosTex,
    morphTex,
    morphNormalTex,
    morphKickStart,
    fluidVelMat,
    globalTexSize,
  } = args;

  // The Phase M respawn age step is a per-texel derivation in the
  // shared layout; inside a stack it is replaced by the constant
  // per-copy base set below, so the age step is masked out of the
  // config the shared assignment code sees.
  const stackConfig: ParticleConfig = { ...config, gpgpuMorphReplicaAgeStep: 0 };
  const divergence = config.gpgpuMorphReplicaDivergence;

  for (const stack of stacks) {
    const s = resolvePingPongTargets(stack.targets, stack.pingIsA);

    // Verlet previous-position copy for this stack (mirrors the
    // main pool's blitPreviousPositionPass).
    if (config.gpgpuVerletEnabled) {
      blitMat.uniforms.uTex.value = s.posIn.texture;
      simMesh.material = blitMat;
      gl.setRenderTarget(stack.prevPos);
      gl.render(simScene, simCamera);
    }

    // Stack-only uniforms: the shared assignment code in
    // runSimulationPasses never writes these, so they survive
    // into the stack's passes.
    const velU = stack.velMat.uniforms;
    velU.uStackMode.value = 1;
    velU.uStackGlobalStart.value = stack.start;
    velU.uStackGlobalTexSizeF.value = globalTexSize;
    const seed = replicaSeedOffset(stack.index, divergence);
    (velU.uReplicaSeedOffset.value as THREE.Vector3).set(seed[0], seed[1], seed[2]);
    velU.uReplicaTimeOffset.value = replicaTimeOffset(stack.index, divergence);
    // Fluid advection uniforms are owned by runFluidAdvectionPass
    // on the shared material; mirror its resolved state.
    velU.uFluidEnabled.value = fluidVelMat.uniforms.uFluidEnabled.value;
    velU.uFluidTex.value = fluidVelMat.uniforms.uFluidTex.value;
    velU.uFluidInfluence.value = fluidVelMat.uniforms.uFluidInfluence.value;
    velU.uFluidScale.value = fluidVelMat.uniforms.uFluidScale.value;
    stack.posMat.uniforms.uReplicaAgeBase.value = replicaAgeBase(
      stack.index,
      config.gpgpuMorphReplicaAgeStep,
      config.gpgpuAgeMax,
    );

    runSimulationPasses({
      useWebGPU: false,
      config: stackConfig,
      texSize: stack.side,
      dt,
      time,
      blast,
      mouseWorld,
      simMesh,
      gl,
      simScene,
      simCamera,
      posIn: s.posIn,
      posOut: s.posOut,
      velIn: s.velIn,
      velOut: s.velOut,
      velSimMat: stack.velMat,
      posSimMat: stack.posMat,
      initPosTex,
      attrTex: args.attrTex ?? null,
      suppressGroupKill: true,
      morphTex,
      morphNormalTex,
      morphKickStart,
      prevPosTex: stack.prevPos.texture,
      mouseWorldMulti: args.mouseWorldMulti,
      mouseMultiCount: args.mouseMultiCount,
      webgpuState: null,
      webgpuPosTex: null,
      webgpuPingIsARef: STACK_WEBGPU_PING_REF,
    });

    // Merge this stack's block into the shared layout outputs.
    // The merge is a PARTIAL write (fragments outside the block
    // discard), so the renderer's autoClear must be off: with the
    // default autoClear every merge render would first erase the
    // blocks merged before it, leaving only the last stack's
    // block in the shared targets.
    const mergeU = mergeMat.uniforms;
    mergeU.uGlobalTexSizeF.value = globalTexSize;
    mergeU.uStackTexSizeF.value = stack.side;
    mergeU.uBlockStart.value = stack.start;
    mergeU.uBlockSize.value = stack.size;
    simMesh.material = mergeMat;
    const prevAutoClear = gl.autoClear;
    gl.autoClear = false;
    mergeU.uStackTex.value = s.posOut.texture;
    gl.setRenderTarget(mergedPosOut);
    gl.render(simScene, simCamera);
    mergeU.uStackTex.value = s.velOut.texture;
    gl.setRenderTarget(mergedVelOut);
    gl.render(simScene, simCamera);
    gl.autoClear = prevAutoClear;

    stack.pingIsA = !stack.pingIsA;
  }
}
