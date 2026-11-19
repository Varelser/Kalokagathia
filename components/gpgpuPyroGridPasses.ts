// Phase CA: Pyro grid solver pass orchestration. One step =
// 6 + Jacobi passes over the atlas targets (see
// lib/pyroGrid.ts pyroGridPassCount). Buffer discipline (two
// velocity buffers are enough because every stage's input has
// been fully consumed before its output slot is reused):
//
//   advect scalar : scalarCur  -> scalarScratch   (reads velCur)
//   advect vel    : velCur     -> velScratch      (reads velCur)
//   forces        : velScratch -> velCur          (reads scalarScratch)
//   scalar update : scalarScratch -> scalarCur
//   divergence    : velCur     -> div
//   jacobi x N    : presA <-> presB (both cleared first, FLIP rule)
//   subtract      : velCur     -> velScratch      (reads final pressure)
//   velCur := velScratch (ping flip recorded on the targets)
//
// The runner is a no-op unless the grid is enabled AND targets
// exist — targets are only allocated while the key is on and the
// diagnostics gate has confirmed float render targets, so the
// disabled path structurally cannot reach a single draw here.

import * as THREE from 'three';
import type { ParticleConfig } from '../types';
import {
  PYRO_GRID_BUOY_ACCEL,
  PYRO_GRID_DENSITY_DECAY_RATE,
  PYRO_GRID_EMIT_DENSITY,
  PYRO_GRID_EMIT_TEMP_RATE,
  PYRO_GRID_JACOBI_MAX,
  PYRO_GRID_MAX_SPEED_CELLS,
  PYRO_GRID_SCALAR_DIFFUSE,
  PYRO_GRID_SOURCE_Y,
  PYRO_GRID_TEMP_COOL_RATE,
  pyroGridPassCount,
  pyroGridSourceRadius,
  setPyroGridRuntimeStatus,
} from '../lib/pyroGrid';

export type PyroGridTargets = {
  velA: THREE.WebGLRenderTarget;
  velB: THREE.WebGLRenderTarget;
  scalarA: THREE.WebGLRenderTarget;
  scalarB: THREE.WebGLRenderTarget;
  presA: THREE.WebGLRenderTarget;
  presB: THREE.WebGLRenderTarget;
  div: THREE.WebGLRenderTarget;
  resolution: number;
  atlasWidth: number;
  atlasHeight: number;
  tilesX: number;
  tilesY: number;
  // Sampling path the targets were allocated for (hardware
  // trilinear when float linear filtering exists).
  floatLinear: boolean;
  velPingIsA: boolean;
  framesStepped: number;
};

export type PyroGridMaterials = {
  pyroAdvectVelMat: THREE.ShaderMaterial;
  pyroAdvectScalarMat: THREE.ShaderMaterial;
  pyroForcesVelMat: THREE.ShaderMaterial;
  pyroScalarUpdateMat: THREE.ShaderMaterial;
  pyroDivergenceMat: THREE.ShaderMaterial;
  pyroJacobiMat: THREE.ShaderMaterial;
  pyroSubtractMat: THREE.ShaderMaterial;
  pyroClearMat: THREE.ShaderMaterial;
};

function setPyroCommonUniforms(
  mat: THREE.ShaderMaterial,
  targets: PyroGridTargets,
): void {
  const u = mat.uniforms;
  if (u.uGridN) u.uGridN.value = targets.resolution;
  if (u.uAtlasSize) (u.uAtlasSize.value as THREE.Vector2).set(targets.atlasWidth, targets.atlasHeight);
  if (u.uAtlasTiles) (u.uAtlasTiles.value as THREE.Vector2).set(targets.tilesX, targets.tilesY);
  if (u.uManualTrilinear) u.uManualTrilinear.value = !targets.floatLinear;
}

export function runPyroGridPasses(args: {
  config: ParticleConfig;
  targets: PyroGridTargets | null;
  materials: PyroGridMaterials;
  simMesh: THREE.Object3D & { material: THREE.Material | THREE.Material[] };
  gl: THREE.WebGLRenderer;
  simScene: THREE.Scene;
  simCamera: THREE.Camera;
  dt: number;
}): void {
  const { config, targets, materials, simMesh, gl, simScene, simCamera } = args;
  if (!config.gpgpuPyroGridEnabled || !targets) return;
  const dt = Math.min(Math.max(args.dt, 0), 0.05);
  if (!(dt > 0)) return;

  const n = targets.resolution;
  const velCur = targets.velPingIsA ? targets.velA : targets.velB;
  const velScratch = targets.velPingIsA ? targets.velB : targets.velA;
  const scalarCur = targets.scalarA;
  const scalarScratch = targets.scalarB;
  const maxSpeed = PYRO_GRID_MAX_SPEED_CELLS * n;

  const drawInto = (mat: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget | null) => {
    (simMesh as THREE.Mesh).material = mat;
    gl.setRenderTarget(target);
    gl.render(simScene, simCamera);
  };
  const clearInto = (target: THREE.WebGLRenderTarget) => {
    drawInto(materials.pyroClearMat, target);
  };

  // 1. Advect scalar through the current velocity.
  {
    const mat = materials.pyroAdvectScalarMat;
    setPyroCommonUniforms(mat, targets);
    mat.uniforms.uScalarIn.value = scalarCur.texture;
    mat.uniforms.uVelIn.value = velCur.texture;
    mat.uniforms.uDelta.value = dt;
    drawInto(mat, scalarScratch);
  }

  // 2. Advect velocity through itself.
  {
    const mat = materials.pyroAdvectVelMat;
    setPyroCommonUniforms(mat, targets);
    mat.uniforms.uVelIn.value = velCur.texture;
    mat.uniforms.uDelta.value = dt;
    mat.uniforms.uMaxSpeed.value = maxSpeed;
    drawInto(mat, velScratch);
  }

  // 3. Buoyancy + walls (reads the advected scalar).
  {
    const mat = materials.pyroForcesVelMat;
    setPyroCommonUniforms(mat, targets);
    mat.uniforms.uVelIn.value = velScratch.texture;
    mat.uniforms.uScalarIn.value = scalarScratch.texture;
    mat.uniforms.uDelta.value = dt;
    mat.uniforms.uBuoyancy.value = config.gpgpuPyroBuoyancy;
    mat.uniforms.uBuoyAccel.value = PYRO_GRID_BUOY_ACCEL;
    mat.uniforms.uDensityWeight.value = 0;
    mat.uniforms.uMaxSpeed.value = maxSpeed;
    drawInto(mat, velCur);
  }

  // 4. Scalar update: diffusion, cooling/decay, source emission.
  {
    const mat = materials.pyroScalarUpdateMat;
    setPyroCommonUniforms(mat, targets);
    mat.uniforms.uScalarIn.value = scalarScratch.texture;
    mat.uniforms.uDelta.value = dt;
    mat.uniforms.uDiffuse.value = PYRO_GRID_SCALAR_DIFFUSE;
    mat.uniforms.uCooling.value = config.gpgpuPyroCooling;
    mat.uniforms.uTempCoolRate.value = PYRO_GRID_TEMP_COOL_RATE;
    mat.uniforms.uDensityDecayRate.value = PYRO_GRID_DENSITY_DECAY_RATE;
    mat.uniforms.uEmitTemp.value = config.gpgpuPyroTemperature;
    mat.uniforms.uEmitDensity.value = PYRO_GRID_EMIT_DENSITY;
    mat.uniforms.uEmitTempRate.value = PYRO_GRID_EMIT_TEMP_RATE;
    (mat.uniforms.uSourceCenter.value as THREE.Vector3).set(
      (n - 1) / 2,
      PYRO_GRID_SOURCE_Y,
      (n - 1) / 2,
    );
    mat.uniforms.uSourceRadius.value = pyroGridSourceRadius(n);
    drawInto(mat, scalarCur);
  }

  // 5. Divergence of the forced velocity (computed once; the
  // Jacobi iteration reads it every pass).
  {
    const mat = materials.pyroDivergenceMat;
    setPyroCommonUniforms(mat, targets);
    mat.uniforms.uVelIn.value = velCur.texture;
    drawInto(mat, targets.div);
  }

  // 6. Jacobi pressure solve from zero (FLIP clears every step).
  clearInto(targets.presA);
  clearInto(targets.presB);
  const jacobiIterations = Math.min(
    PYRO_GRID_JACOBI_MAX,
    Math.max(0, Math.floor(config.gpgpuPyroGridJacobiIterations) || 0),
  );
  let presIn = targets.presA;
  let presOut = targets.presB;
  for (let i = 0; i < jacobiIterations; i++) {
    const mat = materials.pyroJacobiMat;
    setPyroCommonUniforms(mat, targets);
    mat.uniforms.uPresIn.value = presIn.texture;
    mat.uniforms.uDivTex.value = targets.div.texture;
    drawInto(mat, presOut);
    const swap = presIn;
    presIn = presOut;
    presOut = swap;
  }

  // 7. Gradient subtraction (+ walls re-applied).
  {
    const mat = materials.pyroSubtractMat;
    setPyroCommonUniforms(mat, targets);
    mat.uniforms.uVelIn.value = velCur.texture;
    mat.uniforms.uPresTex.value = presIn.texture;
    mat.uniforms.uMaxSpeed.value = maxSpeed;
    drawInto(mat, velScratch);
  }

  targets.velPingIsA = !targets.velPingIsA;
  targets.framesStepped += 1;
  setPyroGridRuntimeStatus({
    active: true,
    resolution: n,
    passesPerStep: pyroGridPassCount(jacobiIterations),
    framesStepped: targets.framesStepped,
  });
}

export function disposePyroGridTargets(targets: PyroGridTargets | null): void {
  if (!targets) return;
  targets.velA.dispose();
  targets.velB.dispose();
  targets.scalarA.dispose();
  targets.scalarB.dispose();
  targets.presA.dispose();
  targets.presB.dispose();
  targets.div.dispose();
}
