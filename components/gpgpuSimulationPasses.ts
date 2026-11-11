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
  velSimMat.uniforms.uBoidsEnabled.value = config.gpgpuBoidsEnabled;
  velSimMat.uniforms.uBoidsSeparation.value = config.gpgpuBoidsSeparation;
  velSimMat.uniforms.uBoidsAlignment.value = config.gpgpuBoidsAlignment;
  velSimMat.uniforms.uBoidsCohesion.value = config.gpgpuBoidsCohesion;
  velSimMat.uniforms.uBoidsRadius.value = config.gpgpuBoidsRadius;
  velSimMat.uniforms.uAttractorEnabled.value = config.gpgpuAttractorEnabled;
  velSimMat.uniforms.uAttractorType.value = { lorenz: 0, rossler: 1, thomas: 2, halvorsen: 3, chen: 4, lu: 5, aizawa: 6, sprott: 7, rabinovich: 8, dejong: 9, ikeda: 10 }[config.gpgpuAttractorType] ?? 0;
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
  velSimMat.uniforms.uSdfEnabled.value = config.gpgpuSdfEnabled;
  velSimMat.uniforms.uSdfShape.value = config.gpgpuSdfShape === 'sphere' ? 0 : config.gpgpuSdfShape === 'box' ? 1 : config.gpgpuSdfShape === 'torus' ? 2 : 3;
  velSimMat.uniforms.uSdfX.value = config.gpgpuSdfX;
  velSimMat.uniforms.uSdfY.value = config.gpgpuSdfY;
  velSimMat.uniforms.uSdfZ.value = config.gpgpuSdfZ;
  velSimMat.uniforms.uSdfSize.value = config.gpgpuSdfSize;
  velSimMat.uniforms.uSdfBounce.value = config.gpgpuSdfBounce;
  velSimMat.uniforms.uMouseEnabled.value = config.gpgpuMouseEnabled;
  velSimMat.uniforms.uMousePos.value.copy(mouseWorld);
  velSimMat.uniforms.uMouseStrength.value = config.gpgpuMouseStrength;
  velSimMat.uniforms.uMouseRadius.value = config.gpgpuMouseRadius;
  velSimMat.uniforms.uMouseMode.value = config.gpgpuMouseMode === 'attract' ? 0 : config.gpgpuMouseMode === 'repel' ? 1 : 2;
  simMesh.material = velSimMat;
  gl.setRenderTarget(velOut);
  gl.render(simScene, simCamera);

  posSimMat.uniforms.uPosTex.value = posIn.texture;
  posSimMat.uniforms.uVelTex.value = velOut.texture;
  posSimMat.uniforms.uDelta.value = dt;
  posSimMat.uniforms.uSpeed.value = config.gpgpuSpeed;
  posSimMat.uniforms.uBounceRadius.value = config.gpgpuBounceRadius;
  posSimMat.uniforms.uAgeEnabled.value = config.gpgpuAgeEnabled;
  posSimMat.uniforms.uAgeMax.value = config.gpgpuAgeMax;
  posSimMat.uniforms.uVerletEnabled.value = config.gpgpuVerletEnabled;
  posSimMat.uniforms.uPrevPosTex.value = prevPosTex;
  posSimMat.uniforms.uSdfEnabled.value = config.gpgpuSdfEnabled;
  posSimMat.uniforms.uSdfShape.value = config.gpgpuSdfShape === 'sphere' ? 0 : config.gpgpuSdfShape === 'box' ? 1 : config.gpgpuSdfShape === 'torus' ? 2 : 3;
  posSimMat.uniforms.uSdfX.value = config.gpgpuSdfX;
  posSimMat.uniforms.uSdfY.value = config.gpgpuSdfY;
  posSimMat.uniforms.uSdfZ.value = config.gpgpuSdfZ;
  posSimMat.uniforms.uSdfSize.value = config.gpgpuSdfSize;
  posSimMat.uniforms.uSdfBounce.value = config.gpgpuSdfBounce;
  simMesh.material = posSimMat;
  gl.setRenderTarget(posOut);
  gl.render(simScene, simCamera);
}
