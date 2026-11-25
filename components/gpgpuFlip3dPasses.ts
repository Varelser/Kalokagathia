// FLIP 3D completion (Phase 19 stage 2): pass orchestration
// for the atlas-packed 3D FLIP solver. One step:
//
//   clear transfer / pressure
//   P2G splat x8     : particles -> transfer (momentum, weight)
//   composite        : transfer -> velFree (grid velocity)
//   phi build        : transfer -> phi (occupancy chi + phi)
//   phi advect       : phi -> phi (semi-Lagrangian + occupancy
//                      correction, through the composite vel)
//   viscosity x4     : vel <-> scratch   (key > 0 only)
//   curvature+tension: phi -> curv; vel -> scratch (key > 0)
//   vorticity x2     : vel -> curv; vel -> scratch (DL keys)
//   pressure Jacobi  : presA <-> presB (free-surface BC)
//   subtract         : velLive -> velFree (projected)
//
// Buffer discipline: the two velocity buffers ping-pong like
// the Pyro grid's; the viscosity Jacobi runs an even iteration
// count so its result lands back in the live buffer, and the
// tension / vorticity stages each consume the live buffer into
// the scratch, which then becomes live. baseVelTexture records
// the pre-projection velocity (the G2P FLIP base), exactly the
// Pyro coupling's convention.
//
// The runner is a no-op unless the mode is '3d', the FLIP layer
// and the fluid field are on, and targets exist — targets are
// only allocated in 3D mode, so the legacy 2D path structurally
// cannot reach a single draw here. The numerics' CPU mirror is
// lib/flip3d.ts; the shaders are gpgpuShaderSimulationFlip3d.ts.

import * as THREE from 'three';
import type { ParticleConfig } from '../types';
import {
  FLIP3D_VISCOSITY_ITERATIONS,
  flip3dActive,
  flip3dHalfExtent,
  flip3dPassCount,
  setFlip3dRuntimeStatus,
} from '../lib/flip3d';
import { pyroGridVelScale } from '../lib/pyroGrid';

export type Flip3dTargets = {
  velA: THREE.WebGLRenderTarget;
  velB: THREE.WebGLRenderTarget;
  presA: THREE.WebGLRenderTarget;
  presB: THREE.WebGLRenderTarget;
  transfer: THREE.WebGLRenderTarget;
  phiA: THREE.WebGLRenderTarget;
  phiB: THREE.WebGLRenderTarget;
  scratch: THREE.WebGLRenderTarget;
  curv: THREE.WebGLRenderTarget;
  // Pre-projection velocity texture of the latest step (the
  // G2P coupling's FLIP base). Null until the first step.
  baseVelTexture: THREE.Texture | null;
  // Phi texture of the latest step (whitewater 3D's source).
  phiTexture: THREE.Texture | null;
  // FLIP WebGL atlas merge (案B, S1): one atlas holding the
  // projected velocity in its first tile half and the
  // pre-projection base in its second half (offset
  // baseTileOffset). Written by the merge draws at the end of
  // every step; applyFlip3dCoupleUniforms binds it into the
  // velocity material's dead uFlipBaseTex slot (S3).
  atlasVelBase: THREE.WebGLRenderTarget;
  mergedTilesX: number;
  mergedTilesY: number;
  mergedAtlasWidth: number;
  mergedAtlasHeight: number;
  baseTileOffset: number;
  resolution: number;
  atlasWidth: number;
  atlasHeight: number;
  tilesX: number;
  tilesY: number;
  floatLinear: boolean;
  velPingIsA: boolean;
  phiPingIsA: boolean;
  framesStepped: number;
};

export type Flip3dMaterials = {
  flip3dSplatMat: THREE.ShaderMaterial;
  flip3dCompositeMat: THREE.ShaderMaterial;
  flip3dPhiMat: THREE.ShaderMaterial;
  flip3dPhiAdvectMat: THREE.ShaderMaterial;
  flip3dViscosityMat: THREE.ShaderMaterial;
  flip3dCurvatureMat: THREE.ShaderMaterial;
  flip3dTensionMat: THREE.ShaderMaterial;
  flip3dJacobiMat: THREE.ShaderMaterial;
  flip3dSubtractMat: THREE.ShaderMaterial;
  flip3dCurlMat: THREE.ShaderMaterial;
  flip3dVorticityForceMat: THREE.ShaderMaterial;
  flip3dClearMat: THREE.ShaderMaterial;
  // Atlas merge copy (案B, S1): half-writing pass-through copy
  // (uniforms uSrcTex / uHalf) into targets.atlasVelBase.
  flip3dAtlasCopyMat: THREE.ShaderMaterial;
};

function setFlip3dCommonUniforms(mat: THREE.ShaderMaterial, targets: Flip3dTargets): void {
  const u = mat.uniforms;
  if (u.uGridN) u.uGridN.value = targets.resolution;
  if (u.uAtlasSize) (u.uAtlasSize.value as THREE.Vector2).set(targets.atlasWidth, targets.atlasHeight);
  if (u.uAtlasTiles) (u.uAtlasTiles.value as THREE.Vector2).set(targets.tilesX, targets.tilesY);
  if (u.uManualTrilinear) u.uManualTrilinear.value = !targets.floatLinear;
}

export function runFlip3dPasses(args: {
  config: ParticleConfig;
  targets: Flip3dTargets | null;
  materials: Flip3dMaterials;
  simMesh: THREE.Mesh;
  gl: THREE.WebGLRenderer;
  simScene: THREE.Scene;
  simCamera: THREE.Camera;
  dt: number;
  splatPoints: THREE.Points | null;
  posTex: THREE.Texture | null;
  velTex: THREE.Texture | null;
}): void {
  const { config, targets, materials, simMesh, gl, simScene, simCamera, splatPoints, posTex, velTex } = args;
  if (!flip3dActive(config) || !targets || !splatPoints || !posTex || !velTex) return;
  const dt = Math.min(Math.max(args.dt, 0), 0.05);
  if (!(dt > 0)) return;

  const drawInto = (mat: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget | null) => {
    simMesh.material = mat;
    gl.setRenderTarget(target);
    gl.render(simScene, simCamera);
  };
  const clearInto = (target: THREE.WebGLRenderTarget) => {
    drawInto(materials.flip3dClearMat, target);
  };

  const velCur = targets.velPingIsA ? targets.velA : targets.velB;
  const velFree = targets.velPingIsA ? targets.velB : targets.velA;
  const avgWeight = Math.max(1, config.gpgpuCount) / (targets.resolution ** 3);

  // 0. Clears (FLIP rule: transfer and pressure restart at zero).
  clearInto(targets.transfer);
  clearInto(targets.presA);
  clearInto(targets.presB);

  // 1. P2G splat: every particle's momentum in 8 trilinear
  // shares. Draw order is the particle index order, so the
  // accumulation is deterministic.
  {
    const mat = materials.flip3dSplatMat;
    setFlip3dCommonUniforms(mat, targets);
    mat.uniforms.uPosTex.value = posTex;
    mat.uniforms.uVelTex.value = velTex;
    mat.uniforms.uBounceRadius.value = config.gpgpuBounceRadius;
    mat.uniforms.uFluidScale.value = config.gpgpuFluidScale;
    simScene.add(splatPoints);
    simMesh.visible = false;
    gl.setRenderTarget(targets.transfer);
    for (let oz = 0; oz <= 1; oz++) {
      for (let oy = 0; oy <= 1; oy++) {
        for (let ox = 0; ox <= 1; ox++) {
          (mat.uniforms.uCellOffset.value as THREE.Vector3).set(ox, oy, oz);
          gl.render(simScene, simCamera);
        }
      }
    }
    simMesh.visible = true;
    simScene.remove(splatPoints);
  }

  // 2. Composite: momentum average -> the grid velocity in the
  // free velocity buffer.
  {
    const mat = materials.flip3dCompositeMat;
    setFlip3dCommonUniforms(mat, targets);
    mat.uniforms.uTransferTex.value = targets.transfer.texture;
    mat.uniforms.uAvgWeight.value = avgWeight;
    drawInto(mat, velFree);
  }
  let velLive: THREE.WebGLRenderTarget = velFree;
  let velSpare: THREE.WebGLRenderTarget = velCur;

  // 3. Phi build into the free phi buffer, then advect it
  // through the composite velocity (with the occupancy
  // correction) into the other phi buffer, which becomes the
  // step's phi.
  const phiFree = targets.phiPingIsA ? targets.phiB : targets.phiA;
  const phiOther = targets.phiPingIsA ? targets.phiA : targets.phiB;
  {
    const mat = materials.flip3dPhiMat;
    setFlip3dCommonUniforms(mat, targets);
    mat.uniforms.uTransferTex.value = targets.transfer.texture;
    mat.uniforms.uAvgWeight.value = avgWeight;
    drawInto(mat, phiFree);
  }
  {
    const mat = materials.flip3dPhiAdvectMat;
    setFlip3dCommonUniforms(mat, targets);
    mat.uniforms.uPhiIn.value = phiFree.texture;
    mat.uniforms.uVelTex.value = velLive.texture;
    mat.uniforms.uTransferTex.value = targets.transfer.texture;
    mat.uniforms.uAvgWeight.value = avgWeight;
    mat.uniforms.uDelta.value = dt;
    drawInto(mat, phiOther);
  }
  targets.phiPingIsA = phiOther === targets.phiA;
  targets.phiTexture = phiOther.texture;
  const phiTex = phiOther.texture;

  // 4. Viscosity (implicit Helmholtz, fixed 4 Jacobi iterations
  // — an even count, so the result lands back in the live
  // buffer). At key 0 the passes do not exist.
  const viscosity = Math.max(0, config.gpgpuFlipViscosity || 0);
  if (viscosity > 0) {
    const mat = materials.flip3dViscosityMat;
    setFlip3dCommonUniforms(mat, targets);
    mat.uniforms.uPhiTex.value = phiTex;
    mat.uniforms.uAlpha.value = viscosity * dt;
    mat.uniforms.uVelStar.value = velLive.texture;
    let iter: THREE.WebGLRenderTarget = velLive;
    let write: THREE.WebGLRenderTarget = targets.scratch;
    for (let i = 0; i < FLIP3D_VISCOSITY_ITERATIONS; i++) {
      mat.uniforms.uVelIter.value = iter.texture;
      drawInto(mat, write);
      const swap = iter; iter = write; write = swap;
    }
    velLive = iter;
    velSpare = velLive === targets.scratch ? velSpare : targets.scratch;
  }

  // 5. Surface tension (CSF): curvature baked from phi, then
  // the force applied into the scratch, which becomes live.
  // At key 0 neither pass exists.
  const tension = Math.max(0, config.gpgpuFlipSurfaceTension || 0);
  if (tension > 0) {
    const curvMat = materials.flip3dCurvatureMat;
    setFlip3dCommonUniforms(curvMat, targets);
    curvMat.uniforms.uPhiTex.value = phiTex;
    drawInto(curvMat, targets.curv);
    const mat = materials.flip3dTensionMat;
    setFlip3dCommonUniforms(mat, targets);
    mat.uniforms.uVelIn.value = velLive.texture;
    mat.uniforms.uPhiTex.value = phiTex;
    mat.uniforms.uCurvTex.value = targets.curv.texture;
    mat.uniforms.uSigma.value = tension;
    mat.uniforms.uDelta.value = dt;
    drawInto(mat, targets.scratch);
    velSpare = velLive;
    velLive = targets.scratch;
  }

  // 6. Vorticity confinement (the Phase DL keys, 3D form): the
  // shared Pyro curl / force shaders on the atlas. Only while
  // the DL toggle is on and epsilon > 0.
  const vorticityActive = Boolean(
    config.gpgpuFlipVorticityEnabled && config.gpgpuFlipVorticityEpsilon > 0,
  );
  if (vorticityActive) {
    const curlMat = materials.flip3dCurlMat;
    setFlip3dCommonUniforms(curlMat, targets);
    curlMat.uniforms.uVelIn.value = velLive.texture;
    drawInto(curlMat, targets.curv);
    const forceMat = materials.flip3dVorticityForceMat;
    setFlip3dCommonUniforms(forceMat, targets);
    forceMat.uniforms.uVelIn.value = velLive.texture;
    forceMat.uniforms.uCurlIn.value = targets.curv.texture;
    forceMat.uniforms.uDelta.value = dt;
    forceMat.uniforms.uEpsilon.value = config.gpgpuFlipVorticityEpsilon;
    if (forceMat.uniforms.uMaxSpeed) forceMat.uniforms.uMaxSpeed.value = 4.0 * targets.resolution;
    drawInto(forceMat, targets.scratch === velLive ? velSpare : targets.scratch);
    const written = targets.scratch === velLive ? velSpare : targets.scratch;
    velSpare = velLive;
    velLive = written;
  }

  // The pre-projection velocity (the G2P coupling's FLIP base).
  targets.baseVelTexture = velLive.texture;

  // 7. Pressure projection: Jacobi ping-pong from the cleared
  // pair, divergence recomputed from the fixed live velocity,
  // free-surface boundary condition from phi.
  const iterations = Math.max(0, Math.min(32, Math.round(config.gpgpuFlipPressureIterations)));
  let presIn: THREE.WebGLRenderTarget = targets.presA;
  let presOut: THREE.WebGLRenderTarget = targets.presB;
  if (iterations > 0) {
    const mat = materials.flip3dJacobiMat;
    setFlip3dCommonUniforms(mat, targets);
    mat.uniforms.uVelTex.value = velLive.texture;
    mat.uniforms.uPhiTex.value = phiTex;
    for (let i = 0; i < iterations; i++) {
      mat.uniforms.uPresIn.value = presIn.texture;
      drawInto(mat, presOut);
      const swap = presIn; presIn = presOut; presOut = swap;
    }
  }

  // 8. Gradient subtraction into a velocity buffer that is not
  // the live one (the scratch may be live after stages 5/6).
  const projected: THREE.WebGLRenderTarget = velLive === targets.velA ? targets.velB : targets.velA;
  {
    const mat = materials.flip3dSubtractMat;
    setFlip3dCommonUniforms(mat, targets);
    mat.uniforms.uVelIn.value = velLive.texture;
    mat.uniforms.uPresTex.value = presIn.texture;
    mat.uniforms.uPhiTex.value = phiTex;
    drawInto(mat, projected);
  }

  targets.velPingIsA = projected === targets.velA;

  // 9. Atlas merge (案B, S1): copy this step's (projected, base)
  // pair into the merged atlas — Vel into the first tile half,
  // Base into the second. This must stay AFTER the subtract
  // draw above and nowhere else: at this point the pair is in
  // its final form for the step (baseVelTexture was recorded
  // pre-projection and nothing overwrites velLive afterwards),
  // and the copy completes before the next step can overwrite
  // either source. applyFlip3dCoupleUniforms reads it (S3).
  {
    const mat = materials.flip3dAtlasCopyMat;
    mat.uniforms.uSrcTex.value = projected.texture;
    mat.uniforms.uHalf.value = 0;
    drawInto(mat, targets.atlasVelBase);
    if (targets.baseVelTexture) {
      mat.uniforms.uSrcTex.value = targets.baseVelTexture;
      mat.uniforms.uHalf.value = 1;
      drawInto(mat, targets.atlasVelBase);
    }
  }

  targets.framesStepped += 1;
  setFlip3dRuntimeStatus({
    active: true,
    resolution: targets.resolution,
    passesPerStep: flip3dPassCount({
      pressureIterations: iterations,
      viscosity,
      surfaceTension: tension,
      vorticity: vorticityActive,
    }),
    framesStepped: targets.framesStepped,
  });
}

// The velocity field as it stands after the latest step
// (post-projection) — the G2P coupling's PIC source.
export function flip3dCurrentVelTexture(targets: Flip3dTargets): THREE.Texture {
  return (targets.velPingIsA ? targets.velA : targets.velB).texture;
}

export function disposeFlip3dTargets(targets: Flip3dTargets | null): void {
  if (!targets) return;
  targets.velA.dispose();
  targets.velB.dispose();
  targets.presA.dispose();
  targets.presB.dispose();
  targets.transfer.dispose();
  targets.phiA.dispose();
  targets.phiB.dispose();
  targets.scratch.dispose();
  targets.curv.dispose();
  targets.atlasVelBase.dispose();
}

// G2P coupling (the FLIP pattern, on all three components):
// fills the velocity material's FLIP3D uniforms from the
// targets' latest step. The block in the shader only runs
// while the mode is 3D, the solver has stepped at least once
// and the base texture exists — otherwise the couple flag
// stays false and the velocity pass is untouched. The scale
// converts the grid's cells/second into the particle velocity
// unit via the shared pyroGridVelScale form.
export function applyFlip3dCoupleUniforms(args: {
  config: ParticleConfig;
  velSimMat: THREE.ShaderMaterial;
  targets: Flip3dTargets | null;
  useWebGPU: boolean;
}): void {
  const { config, velSimMat, targets, useWebGPU } = args;
  const u = velSimMat.uniforms;
  if (!u.uFlip3dCouple) return;
  const active = !useWebGPU
    && flip3dActive(config)
    && targets !== null
    && targets.framesStepped > 0
    && targets.baseVelTexture !== null;
  if (!active) {
    u.uFlip3dCouple.value = false;
    return;
  }
  const t = targets as Flip3dTargets;
  const halfExtent = flip3dHalfExtent(config);
  u.uFlip3dCouple.value = true;
  // Atlas merge (案B, S3): both fields are read from the ONE
  // merged atlas, bound through the 2D FLIP slot uFlipBaseTex
  // (dead in 3D mode — the S0 invariant). Vel is the first
  // tile half (offset 0 in the shader), Base the second half
  // (uFlip3dBaseTileOffset). uFlip3dVelTex / uFlip3dBaseTex
  // are no longer assigned: the shader does not declare them
  // any more and their uniform entries stay inert. The
  // !active branch above must NOT touch uFlipBaseTex — the
  // 2D pipeline owns that slot whenever it runs.
  u.uFlipBaseTex.value = t.atlasVelBase.texture;
  u.uFlip3dBlend.value = config.gpgpuFlipBlend;
  u.uFlip3dTransfer.value = config.gpgpuFlipTransfer;
  u.uFlip3dVelScale.value = pyroGridVelScale(halfExtent, t.resolution);
  (u.uFlip3dBounds.value as THREE.Vector4).set(0, 0, 0, halfExtent);
  u.uFlip3dGridN.value = t.resolution;
  (u.uFlip3dAtlasSize.value as THREE.Vector2).set(t.mergedAtlasWidth, t.mergedAtlasHeight);
  (u.uFlip3dAtlasTiles.value as THREE.Vector2).set(t.mergedTilesX, t.mergedTilesY);
  u.uFlip3dBaseTileOffset.value = t.baseTileOffset;
  u.uFlip3dManualTrilinear.value = !t.floatLinear;
}
