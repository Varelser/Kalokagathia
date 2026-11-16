import type { MutableRefObject } from 'react';
import * as THREE from 'three';
import type { ParticleConfig } from '../types';
import {
  stepWebGPUCompute,
  readbackWebGPUPositions,
} from '../lib/webgpuCompute';
import { particleLifeUniformArray } from '../lib/gpgpuParticleLife';

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
import { AUX_TEX_SIZE } from './gpgpuShaderAux';
import type { AuxLevelParams } from '../lib/auxChain';

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
  } = args;

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
    return;
  }

  velSimMat.uniforms.uFluidEnabled.value = false;
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
  morphTex: THREE.Texture | null;
  morphNormalTex: THREE.Texture | null;
  morphKickStart: number;
  prevPosTex: THREE.Texture | null;
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
      // The OBJ normal kick is not part of the WGSL pass (recorded
      // in the Phase R report).
      {
        enabled: Boolean(config.gpgpuMorphEnabled && morphTex),
        strength: config.gpgpuMorphStrength,
        orbitSpeed: config.gpgpuMorphOrbitSpeed,
        replicaPhaseGain: config.gpgpuMorphReplicaCount > 1 ? 1 : 0,
      },
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
  velSimMat.uniforms.uAttractorStrength.value = config.gpgpuAttractorStrength;
  velSimMat.uniforms.uAttractorScale.value = config.gpgpuAttractorScale;
  velSimMat.uniforms.uVortexEnabled.value = config.gpgpuVortexEnabled;
  velSimMat.uniforms.uVortexStrength.value = config.gpgpuVortexStrength;
  velSimMat.uniforms.uVortexTilt.value = config.gpgpuVortexTilt;
  velSimMat.uniforms.uWindEnabled.value = config.gpgpuWindEnabled;
  velSimMat.uniforms.uWindStrength.value = config.gpgpuWindStrength;
  velSimMat.uniforms.uWindX.value = config.gpgpuWindX;
  velSimMat.uniforms.uWindY.value = config.gpgpuWindY;
  velSimMat.uniforms.uWindZ.value = config.gpgpuWindZ;
  velSimMat.uniforms.uWindGust.value = config.gpgpuWindGust;
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
  velSimMat.uniforms.uVFieldEnabled.value = config.gpgpuVFieldEnabled;
  velSimMat.uniforms.uVFieldType.value = { dipole: 0, saddle: 1, spiral: 2, source: 3, abc: 4, gyre: 5, worley: 6 }[config.gpgpuVFieldType] ?? 3;
  velSimMat.uniforms.uVFieldStrength.value = config.gpgpuVFieldStrength;
  velSimMat.uniforms.uVFieldScale.value = config.gpgpuVFieldScale;
  velSimMat.uniforms.uSpringEnabled.value = config.gpgpuSpringEnabled;
  velSimMat.uniforms.uSpringStrength.value = config.gpgpuSpringStrength;
  velSimMat.uniforms.uInitPosTex.value = initPosTex;
  velSimMat.uniforms.uMorphEnabled.value = config.gpgpuMorphEnabled && !!morphTex;
  velSimMat.uniforms.uMorphTex.value = morphTex;
  // OBJ normal kick (Phase O): companion normal texture + speed.
  // The speed is passed verbatim; 0 (default) makes the shader skip
  // the kick block entirely. The age flag gates the respawn pulse.
  if (velSimMat.uniforms.uMorphNormalTex) velSimMat.uniforms.uMorphNormalTex.value = morphNormalTex;
  if (velSimMat.uniforms.uMorphObjNormalSpeed) velSimMat.uniforms.uMorphObjNormalSpeed.value = Math.max(0, config.gpgpuMorphObjNormalSpeed || 0);
  if (velSimMat.uniforms.uMorphKickStart) velSimMat.uniforms.uMorphKickStart.value = morphKickStart;
  if (velSimMat.uniforms.uAgeEnabled) velSimMat.uniforms.uAgeEnabled.value = config.gpgpuAgeEnabled;
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
  simMesh.material = velSimMat;
  gl.setRenderTarget(velOut);
  gl.render(simScene, simCamera);

  posSimMat.uniforms.uPosTex.value = posIn.texture;
  posSimMat.uniforms.uVelTex.value = velOut.texture;
  posSimMat.uniforms.uDelta.value = dt;
  posSimMat.uniforms.uTime.value = time;
  posSimMat.uniforms.uSpeed.value = config.gpgpuSpeed;
  posSimMat.uniforms.uBounceRadius.value = config.gpgpuBounceRadius;
  posSimMat.uniforms.uAgeEnabled.value = config.gpgpuAgeEnabled;
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
  posSimMat.uniforms.uMouseEnabled.value = config.gpgpuMouseEnabled;
  posSimMat.uniforms.uMousePos.value.copy(mouseWorld);
  posSimMat.uniforms.uMouseRadius.value = config.gpgpuMouseRadius;
  posSimMat.uniforms.uMouseMode.value = MOUSE_MODE_IDS[config.gpgpuMouseMode] ?? 0;
  posSimMat.uniforms.uMousePaintRate.value = config.gpgpuMousePaintRate;
  // Light emitter (Phase T): only the 'light' emit shape reroutes
  // the age respawn to the light position; everything else keeps
  // the legacy origin-sphere respawn.
  if (posSimMat.uniforms.uEmitLight) {
    posSimMat.uniforms.uEmitLight.value = config.gpgpuEmitShape === 'light';
    (posSimMat.uniforms.uEmitLightPos.value as THREE.Vector3).set(config.gpgpuLightPosX, config.gpgpuLightPosY, config.gpgpuLightPosZ);
  }
  simMesh.material = posSimMat;
  gl.setRenderTarget(posOut);
  gl.render(simScene, simCamera);
}

const SDF_SHAPE_IDS: Record<ParticleConfig['gpgpuSdfShape'], number> = {
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
};

// Aux event emission passes (B3): run after the main velocity/position
// passes, reading the main pool's frame-start textures (posIn/velIn —
// the death position and contact velocities of this frame) and the aux
// pool's own ping-pong pair. The caller flips the aux ping-pong and
// points the aux draw material at the outputs.
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
  } = args;

  if (config.gpgpuAuxMode === 'none') return;
  const modeId = AUX_MODE_IDS[config.gpgpuAuxMode] ?? 0;
  const auxCount = Math.max(0, Math.min(16384, Math.round(config.gpgpuAuxCount)));

  const velU = auxVelMat.uniforms;
  velU.uAuxPosTex.value = auxPosIn.texture;
  velU.uAuxVelTex.value = auxVelIn.texture;
  velU.uMainPosTex.value = mainPosTex;
  velU.uMainVelTex.value = mainVelTex;
  velU.uMainTexSizeF.value = texSize;
  velU.uAuxCount.value = auxCount;
  velU.uAuxMode.value = modeId;
  velU.uAuxIntensity.value = config.gpgpuAuxIntensity;
  velU.uAuxSpeed.value = config.gpgpuAuxSpeed;
  velU.uAuxLife.value = config.gpgpuAuxLife;
  velU.uAuxGravityScale.value = config.gpgpuAuxGravityScale;
  velU.uAuxDrag.value = config.gpgpuAuxDrag;
  velU.uAuxCurl.value = config.gpgpuAuxCurl;
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
  simMesh.material = auxVelMat;
  gl.setRenderTarget(auxVelOut);
  gl.render(simScene, simCamera);

  const posU = auxPosMat.uniforms;
  posU.uAuxPosTex.value = auxPosIn.texture;
  posU.uAuxVelTex.value = auxVelIn.texture;
  posU.uAuxVelOutTex.value = auxVelOut.texture;
  posU.uMainPosTex.value = mainPosTex;
  posU.uMainVelTex.value = mainVelTex;
  posU.uMainTexSizeF.value = texSize;
  posU.uAuxCount.value = auxCount;
  posU.uAuxMode.value = modeId;
  posU.uAuxIntensity.value = config.gpgpuAuxIntensity;
  posU.uAuxSpeed.value = config.gpgpuAuxSpeed;
  posU.uAgeEnabled.value = config.gpgpuAgeEnabled;
  posU.uAgeMax.value = config.gpgpuAgeMax;
  posU.uFloorEnabled.value = config.gpgpuFloorEnabled;
  posU.uFloorY.value = config.gpgpuFloorY;
  posU.uBounceRadius.value = config.gpgpuBounceRadius;
  posU.uDelta.value = dt;
  posU.uTime.value = time;
  simMesh.material = auxPosMat;
  gl.setRenderTarget(auxPosOut);
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
