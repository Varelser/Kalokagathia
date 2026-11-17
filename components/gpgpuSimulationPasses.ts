import type { MutableRefObject } from 'react';
import * as THREE from 'three';
import type { ParticleConfig } from '../types';
import {
  stepWebGPUCompute,
  readbackWebGPUPositions,
} from '../lib/webgpuCompute';
import { particleLifeUniformArray } from '../lib/gpgpuParticleLife';
import { isAgeCurveIdentity, normalizeAgeCurvePoints } from '../lib/ageCurve';

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
  // Lifecycle grammar (Phase AB): seconds since the spawn epoch
  // (the scene resets the epoch when the spawn keys / pool change;
  // defaults to `time` when the caller does not track one) and the
  // resolved Phase X mask texture for the mask kill (null unless
  // the kill is on and the mask image is ready).
  spawnTime?: number;
  killMaskTex?: THREE.Texture | null;
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
      // Phase X3 adds the OBJ normal kick (Phase O): the speed is
      // passed verbatim (0 = default skips the kick block in WGSL,
      // exactly as in the WebGL shader) and the kick start is the
      // same timestamp the WebGL branch receives. The WebGL
      // age-respawn trigger cannot fire here — the age lifecycle
      // stays WebGL-only and the capability registry routes
      // age-enabled configs to WebGL.
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
  if (velSimMat.uniforms.uParticleLifePursue) velSimMat.uniforms.uParticleLifePursue.value = config.gpgpuParticleLifePursue;
  if (velSimMat.uniforms.uParticleLifeEvade) velSimMat.uniforms.uParticleLifeEvade.value = config.gpgpuParticleLifeEvade;
  if (velSimMat.uniforms.uParticleLifeVisionRange) velSimMat.uniforms.uParticleLifeVisionRange.value = config.gpgpuParticleLifeVisionRange;
  if (velSimMat.uniforms.uParticleLifeVisionAngle) velSimMat.uniforms.uParticleLifeVisionAngle.value = config.gpgpuParticleLifeVisionAngle;
  if (velSimMat.uniforms.uParticleLifeMaxSpeed) velSimMat.uniforms.uParticleLifeMaxSpeed.value = config.gpgpuParticleLifeMaxSpeed;
  if (velSimMat.uniforms.uParticleLifeMeanderAmount) velSimMat.uniforms.uParticleLifeMeanderAmount.value = config.gpgpuParticleLifeMeanderAmount;
  if (velSimMat.uniforms.uParticleLifeMeanderScale) velSimMat.uniforms.uParticleLifeMeanderScale.value = config.gpgpuParticleLifeMeanderScale;
  if (velSimMat.uniforms.uParticleLifeAvoid) velSimMat.uniforms.uParticleLifeAvoid.value = Math.max(0, config.gpgpuParticleLifeAvoid || 0);
  // Lifecycle grammar (Phase AB): spawn gate + global drag / max
  // speed. The clamps mirror lib/gpgpuLifecycle.ts.
  if (velSimMat.uniforms.uSpawnRate) velSimMat.uniforms.uSpawnRate.value = Math.max(0.01, Math.min(1, config.gpgpuSpawnRate || 1));
  if (velSimMat.uniforms.uSpawnBurst) velSimMat.uniforms.uSpawnBurst.value = Math.max(0, Math.min(1, config.gpgpuSpawnBurst ?? 1));
  if (velSimMat.uniforms.uSpawnTime) velSimMat.uniforms.uSpawnTime.value = args.spawnTime ?? time;
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
  if (velSimMat.uniforms.uAgeCurveVelocityEnabled) velSimMat.uniforms.uAgeCurveVelocityEnabled.value = config.gpgpuAgeCurveVelocityEnabled && !isAgeCurveIdentity(acVelocityPoints);
  if (velSimMat.uniforms.uAgeCurveVelocity) velSimMat.uniforms.uAgeCurveVelocity.value = [...acVelocityPoints];
  if (velSimMat.uniforms.uAgeCurveForceEnabled) velSimMat.uniforms.uAgeCurveForceEnabled.value = config.gpgpuAgeCurveForceEnabled && !isAgeCurveIdentity(acForcePoints);
  if (velSimMat.uniforms.uAgeCurveForce) velSimMat.uniforms.uAgeCurveForce.value = [...acForcePoints];
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
  if (velSimMat.uniforms.uSphSurfaceTension) velSimMat.uniforms.uSphSurfaceTension.value = Math.max(0, config.gpgpuSphSurfaceTension || 0);
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
  // Lifecycle grammar (Phase AB): spawn gate + kill conditions.
  // The mask kill resolves here: key on AND a ready mask texture —
  // otherwise the shader keeps the legacy path (the UI states the
  // fallback, like the draw clip does).
  if (posSimMat.uniforms.uSpawnRate) posSimMat.uniforms.uSpawnRate.value = Math.max(0.01, Math.min(1, config.gpgpuSpawnRate || 1));
  if (posSimMat.uniforms.uSpawnBurst) posSimMat.uniforms.uSpawnBurst.value = Math.max(0, Math.min(1, config.gpgpuSpawnBurst ?? 1));
  if (posSimMat.uniforms.uSpawnTime) posSimMat.uniforms.uSpawnTime.value = args.spawnTime ?? time;
  if (posSimMat.uniforms.uKillBoundary) posSimMat.uniforms.uKillBoundary.value = !!config.gpgpuKillBoundary;
  if (posSimMat.uniforms.uKillMask) posSimMat.uniforms.uKillMask.value = !!config.gpgpuKillMask && !!args.killMaskTex;
  if (posSimMat.uniforms.uKillMaskTex) posSimMat.uniforms.uKillMaskTex.value = args.killMaskTex ?? null;
  if (posSimMat.uniforms.uKillMaskThreshold) posSimMat.uniforms.uKillMaskThreshold.value = Math.max(0, Math.min(1, config.gpgpuMaskThreshold ?? 0.5));
  if (posSimMat.uniforms.uKillMaskInvert) posSimMat.uniforms.uKillMaskInvert.value = !!config.gpgpuMaskInvert;
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
  birthBurst: 3,
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
  morphTex: THREE.Texture | null;
  morphNormalTex: THREE.Texture | null;
  morphKickStart: number;
  fluidVelMat: THREE.ShaderMaterial;
  globalTexSize: number;
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
      morphTex,
      morphNormalTex,
      morphKickStart,
      prevPosTex: stack.prevPos.texture,
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
