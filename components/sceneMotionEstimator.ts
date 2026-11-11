import * as THREE from 'three';
import type { ParticleConfig } from '../types';
import { resolveMotionChainCodes } from '../lib/motionChain';
import { resolveMotionRoute } from '../lib/motionRoute';
import { resolveMotionGraphSteps } from '../lib/motionGraph';
import { resolveMotionDag } from '../lib/motionDag';
import { getMotionGroupIndexByValue } from './motionCatalog';
import { applySpecificMotionEstimate } from './sceneMotionEstimatorSpecific';
import {
  noiseVec3,
  tempChainA,
  tempChainB,
  tempGraphBranch,
  tempGraphMain,
  tempGraphOut,
  tempDagRegs,
  tempDagOut,
  tempDir,
  tempMotion,
  tempNoise,
  tempSeed,
  tempStageSeed,
  tempWindDir,
  upAxis,
  xAxis,
  yAxis,
  zAxis,
  type LayerEstimateArgs,
  type MotionEstimateContext,
} from './sceneMotionEstimatorShared';

/**
 * One stage of a motion estimate: applies a single motion to `input` and
 * writes the raw (pre-affectPos) result to `out`. Chaining stages means
 * feeding one stage's output into the next, mirroring the serial
 * applyMotion calls in the vertex shader.
 */
function applyMotionEstimate(
  input: THREE.Vector3,
  motionType: number,
  ctx: MotionEstimateContext,
  out: THREE.Vector3,
) {
  const { timePhase, amp, freq, phase, rnd, variant } = ctx;
  const group = getMotionGroupIndexByValue(motionType);

  tempMotion.copy(input);
  tempStageSeed.set(
    input.x * 0.012 * ctx.noiseScale + timePhase * 0.3 * ctx.evolution,
    input.y * 0.012 * ctx.noiseScale + phase,
    input.z * 0.012 * ctx.noiseScale + rnd * 9 + timePhase * 0.23,
  );

  if (applySpecificMotionEstimate(tempMotion, input, motionType, timePhase, amp, freq, phase, rnd, variant)) {
    // motion-specific override applied
  } else if (group === 0) {
    noiseVec3(tempNoise, tempStageSeed);
    tempDir.copy(ctx.wind).multiplyScalar(0.08);
    tempMotion.addScaledVector(tempNoise, amp * 0.22 * (0.35 + ctx.fluidForce * 0.08));
    tempMotion.addScaledVector(tempDir, amp * 0.08);
    tempMotion.applyAxisAngle(upAxis, tempNoise.x * 0.35 + timePhase * 0.08);
  } else if (group === 1) {
    const x = input.x * 0.01;
    const y = input.y * 0.01;
    const z = input.z * 0.01;
    tempMotion.set(
      Math.sin((y - z) * (0.7 + ctx.complexity * 0.05) + timePhase),
      Math.sin((z - x) * (0.9 + ctx.fidelity * 0.08) + timePhase * 0.9),
      Math.sin((x - y) * (0.8 + ctx.octaveMult * 0.04) + timePhase * 1.1),
    );
    tempMotion.multiplyScalar(amp * 0.3);
    tempMotion.add(input);
  } else if (group === 2) {
    const radial = Math.max(1, Math.hypot(input.x, input.z));
    const angle = Math.atan2(input.z, input.x) + timePhase * (0.35 + freq * 0.02);
    const helixY = Math.sin(timePhase * 0.7 + rnd * 6) * amp * 0.18;
    tempMotion.set(
      Math.cos(angle) * radial,
      input.y + helixY,
      Math.sin(angle) * radial,
    );
    tempMotion.addScaledVector(input.clone().normalize(), amp * 0.08 * Math.sin(timePhase * 1.3 + variant * 4));
  } else if (group === 3) {
    const sx = Math.sin(timePhase * (1.0 + rnd) + input.y * 0.01 * freq);
    const sy = Math.sin(timePhase * (1.3 + variant) + input.z * 0.01 * ctx.octaveMult);
    const sz = Math.cos(timePhase * (0.8 + ctx.lifeJitter) + input.x * 0.01 * ctx.complexity);
    tempMotion.set(sx, sy, sz).multiplyScalar(amp * 0.26).add(input);
  } else if (group === 4) {
    const cell = Math.max(10, 80 - freq * 0.3);
    tempMotion.set(
      Math.round(input.x / cell) * cell,
      Math.round(input.y / cell) * cell,
      Math.round(input.z / cell) * cell,
    );
    tempMotion.lerp(input, 0.55 + Math.sin(timePhase + variant * 5) * 0.1);
  } else if (group === 5) {
    tempDir.copy(input).normalize();
    const pulse = Math.sin(timePhase * (0.9 + ctx.speed * 4)) * amp * 0.32;
    tempMotion.addScaledVector(tempDir, pulse);
    tempMotion.y += Math.cos(timePhase * 0.7 + phase) * amp * 0.09;
  } else {
    const shear = Math.sin(timePhase * 0.8 + rnd * 4) * amp * 0.12;
    tempMotion.set(
      input.x + input.y * 0.08 * shear,
      input.y + Math.sin(input.x * 0.01 * freq + timePhase) * amp * 0.08,
      input.z + input.x * 0.08 * shear,
    );
  }

  out.copy(tempMotion);
}

// Motion route / chain / graph / DAG resolutions are pure functions of
// (config, layerIndex), and configs are immutable snapshots (every edit
// produces a new object), so identity-keyed memoisation returns exactly
// the same values while avoiding re-resolution and re-allocation for
// every estimated particle (line systems sample ~1,600 points per
// rebuild and several procedural systems sample per frame).
type EstimatorResolutions = {
  route: ReturnType<typeof resolveMotionRoute>;
  chain: ReturnType<typeof resolveMotionChainCodes>;
  graph: ReturnType<typeof resolveMotionGraphSteps>;
  dag: ReturnType<typeof resolveMotionDag>;
};
const estimatorResolutionCache = new WeakMap<ParticleConfig, Map<number, EstimatorResolutions>>();
function getEstimatorResolutions(config: ParticleConfig, layerIndex: 2 | 3): EstimatorResolutions {
  let perConfig = estimatorResolutionCache.get(config);
  if (!perConfig) {
    perConfig = new Map();
    estimatorResolutionCache.set(config, perConfig);
  }
  let resolved = perConfig.get(layerIndex);
  if (!resolved) {
    resolved = {
      route: resolveMotionRoute(config, layerIndex),
      chain: resolveMotionChainCodes(config, layerIndex),
      graph: resolveMotionGraphSteps(config, layerIndex),
      dag: resolveMotionDag(config, layerIndex),
    };
    perConfig.set(layerIndex, resolved);
  }
  return resolved;
}

export function estimateLayerPositionApprox({
  config,
  layerIndex,
  particleData,
  index,
  globalRadius,
  time,
}: LayerEstimateArgs) {
  const phase = particleData.d1[index * 4 + 0] ?? 0;
  const rnd = particleData.d1[index * 4 + 1] ?? 0;
  const motionType = Math.round(particleData.d1[index * 4 + 2] ?? 0);
  const radiusScale = particleData.d1[index * 4 + 3] ?? 1;
  const speedMult = particleData.d2[index * 4 + 0] ?? 1;
  const ampMult = particleData.d2[index * 4 + 1] ?? 1;
  const freqMult = particleData.d2[index * 4 + 2] ?? 1;
  const lifeJitter = particleData.d3[index * 4 + 1] ?? 0;
  const variant = particleData.d3[index * 4 + 2] ?? 0;
  const spawnOffset = particleData.d3[index * 4 + 0] ?? 0;

  const base = new THREE.Vector3(
    particleData.pos[index * 3 + 0] * radiusScale * globalRadius,
    particleData.pos[index * 3 + 1] * radiusScale * globalRadius,
    particleData.pos[index * 3 + 2] * radiusScale * globalRadius,
  );
  const offset = new THREE.Vector3(
    particleData.off[index * 3 + 0],
    particleData.off[index * 3 + 1],
    particleData.off[index * 3 + 2],
  );

  const isLayer2 = layerIndex === 2;
  const speed = (isLayer2 ? config.layer2FlowSpeed : config.layer3FlowSpeed) * speedMult;
  const amp = (isLayer2 ? config.layer2FlowAmplitude : config.layer3FlowAmplitude) * ampMult;
  const freq = (isLayer2 ? config.layer2FlowFrequency : config.layer3FlowFrequency) * freqMult;
  const noiseScale = isLayer2 ? config.layer2NoiseScale : config.layer3NoiseScale;
  const evolution = isLayer2 ? config.layer2Evolution : config.layer3Evolution;
  const complexity = isLayer2 ? config.layer2Complexity : config.layer3Complexity;
  const fluidForce = isLayer2 ? config.layer2FluidForce : config.layer3FluidForce;
  const fidelity = isLayer2 ? config.layer2Fidelity : config.layer3Fidelity;
  const octaveMult = isLayer2 ? config.layer2OctaveMult : config.layer3OctaveMult;
  const affectPos = isLayer2 ? config.layer2AffectPos : config.layer3AffectPos;
  const resistance = isLayer2 ? config.layer2Resistance : config.layer3Resistance;
  const moveWithWind = isLayer2 ? config.layer2MoveWithWind : config.layer3MoveWithWind;
  const neighborForce = isLayer2 ? config.layer2InteractionNeighbor : config.layer3InteractionNeighbor;
  const collisionMode = isLayer2 ? config.layer2CollisionMode : config.layer3CollisionMode;
  const collisionRadius = isLayer2 ? config.layer2CollisionRadius : config.layer3CollisionRadius;
  const repulsion = isLayer2 ? config.layer2Repulsion : config.layer3Repulsion;
  const gravity = isLayer2 ? config.layer2Gravity : config.layer3Gravity;
  const boundaryY = isLayer2 ? config.layer2BoundaryY : config.layer3BoundaryY;
  const boundaryEnabled = isLayer2 ? config.layer2BoundaryEnabled : config.layer3BoundaryEnabled;
  const boundaryBounce = isLayer2 ? config.layer2BoundaryBounce : config.layer3BoundaryBounce;
  const burst = isLayer2 ? config.layer2Burst : config.layer3Burst;
  const burstPhase = isLayer2 ? config.layer2BurstPhase : config.layer3BurstPhase;
  const life = isLayer2 ? config.layer2Life : config.layer3Life;
  const lifeSpread = isLayer2 ? config.layer2LifeSpread : config.layer3LifeSpread;
  const trailDrag = isLayer2 ? config.layer2TrailDrag : config.layer3TrailDrag;
  const trailTurbulence = isLayer2 ? config.layer2TrailTurbulence : config.layer3TrailTurbulence;
  const trailDrift = isLayer2 ? config.layer2TrailDrift : config.layer3TrailDrift;
  const orbitSpeed = isLayer2 ? config.layer2EmitterOrbitSpeed : config.layer3EmitterOrbitSpeed;
  const orbitRadius = isLayer2 ? config.layer2EmitterOrbitRadius : config.layer3EmitterOrbitRadius;
  const emitterPulseAmount = isLayer2 ? config.layer2EmitterPulseAmount : config.layer3EmitterPulseAmount;
  const spinX = isLayer2 ? config.layer2SpinX : config.layer3SpinX;
  const spinY = isLayer2 ? config.layer2SpinY : config.layer3SpinY;
  const spinZ = isLayer2 ? config.layer2SpinZ : config.layer3SpinZ;
  const wind = new THREE.Vector3(
    isLayer2 ? config.layer2WindX : config.layer3WindX,
    isLayer2 ? config.layer2WindY : config.layer3WindY,
    isLayer2 ? config.layer2WindZ : config.layer3WindZ,
  );

  const orbitPhase = time * Math.max(0, orbitSpeed);
  const emitterPulse = 1 + Math.sin(time * Math.max(0.05, orbitSpeed || 0.5) * 1.6 + phase) * emitterPulseAmount;
  const animatedOffset = offset.clone().multiplyScalar(emitterPulse).applyAxisAngle(upAxis, orbitPhase);
  animatedOffset.add(new THREE.Vector3(
    Math.cos(orbitPhase) * orbitRadius,
    Math.sin(orbitPhase * 0.5) * orbitRadius * 0.25,
    Math.sin(orbitPhase) * orbitRadius,
  ));

  const position = base.clone().add(animatedOffset);
  // Domain warp mirror: same two-octave noise displacement at the stack
  // input as the vertex shader (time drift approximated).
  if (layerIndex === 2 || layerIndex === 3) {
    const warpOn = isLayer2 ? config.layer2WarpEnabled : config.layer3WarpEnabled;
    if (warpOn) {
      const warpAmount = isLayer2 ? config.layer2WarpAmount : config.layer3WarpAmount;
      const warpScale = isLayer2 ? config.layer2WarpScale : config.layer3WarpScale;
      const wp = new THREE.Vector3(
        position.x * warpScale + rnd * 7.31,
        position.y * warpScale + rnd * 3.77,
        position.z * warpScale + rnd * 9.13 + time * 0.05,
      );
      const w1 = new THREE.Vector3();
      noiseVec3(w1, wp);
      const w2 = new THREE.Vector3();
      noiseVec3(w2, new THREE.Vector3(wp.x * 2.3 + 5.2 + time * 0.03, wp.y * 2.3 + 1.3, wp.z * 2.3 + 2.8));
      position.addScaledVector(w1, warpAmount * 0.6667);
      position.addScaledVector(w2, warpAmount * 0.3333);
    }
  }
  const timePhase = time * (0.4 + speed * 18) + phase * 0.5 + spawnOffset * Math.PI * 2;

  tempSeed.set(
    position.x * 0.012 * noiseScale + timePhase * 0.3 * evolution,
    position.y * 0.012 * noiseScale + phase,
    position.z * 0.012 * noiseScale + rnd * 9 + timePhase * 0.23,
  );

  const estimateCtx: MotionEstimateContext = {
    timePhase, amp, freq, speed, phase, rnd, variant, lifeJitter,
    noiseScale, evolution, complexity, fluidForce, fidelity, octaveMult, wind,
  };
  // Cross-layer motion routing (stage 2, method A): the source layer's
  // stack runs on the position before this layer's own motion, mirroring
  // the routed pre-stage in the vertex shader.
  if (layerIndex === 2 || layerIndex === 3) {
    const route = getEstimatorResolutions(config, layerIndex).route;
    if (route) {
      const srcIs2 = route.sourceLayer === 2;
      const routeSpeed = (srcIs2 ? config.layer2FlowSpeed : config.layer3FlowSpeed) * speedMult;
      const routeCtx: MotionEstimateContext = {
        timePhase: time * (0.4 + routeSpeed * 18) + phase * 0.5 + spawnOffset * Math.PI * 2,
        amp: (srcIs2 ? config.layer2FlowAmplitude : config.layer3FlowAmplitude) * ampMult,
        freq: (srcIs2 ? config.layer2FlowFrequency : config.layer3FlowFrequency) * freqMult,
        speed: routeSpeed,
        phase, rnd, variant, lifeJitter,
        noiseScale: srcIs2 ? config.layer2NoiseScale : config.layer3NoiseScale,
        evolution: srcIs2 ? config.layer2Evolution : config.layer3Evolution,
        complexity: srcIs2 ? config.layer2Complexity : config.layer3Complexity,
        fluidForce: srcIs2 ? config.layer2FluidForce : config.layer3FluidForce,
        fidelity: srcIs2 ? config.layer2Fidelity : config.layer3Fidelity,
        octaveMult: srcIs2 ? config.layer2OctaveMult : config.layer3OctaveMult,
        wind: new THREE.Vector3(
          srcIs2 ? config.layer2WindX : config.layer3WindX,
          srcIs2 ? config.layer2WindY : config.layer3WindY,
          srcIs2 ? config.layer2WindZ : config.layer3WindZ,
        ),
      };
      applyMotionEstimate(position, route.codes[0], routeCtx, tempChainB);
      position.copy(tempChainB);
      if (route.codes[1] >= 0) {
        applyMotionEstimate(position, route.codes[1], routeCtx, tempChainB);
        position.copy(tempChainB);
      }
      if (route.codes[2] >= 0) {
        applyMotionEstimate(position, route.codes[2], routeCtx, tempChainB);
        position.copy(tempChainB);
      }
    }
  }
  const graphSrc = position.clone();
  applyMotionEstimate(position, motionType, estimateCtx, tempChainA);
  let motionResult = tempChainA;
  const [chainType2, chainType3] = getEstimatorResolutions(config, layerIndex).chain;
  if (chainType2 >= 0) {
    applyMotionEstimate(motionResult, chainType2, estimateCtx, tempChainB);
    motionResult = tempChainB;
    if (chainType3 >= 0) {
      applyMotionEstimate(motionResult, chainType3, estimateCtx, tempChainA);
      motionResult = tempChainA;
    }
  }

  position.lerp(motionResult, THREE.MathUtils.clamp(affectPos, 0, 1));

  // Motion graph (stage 3): bounded step program over main/source/branch
  // registers, mirroring the graph section of the vertex shader.
  const graphSteps = getEstimatorResolutions(config, layerIndex).graph;
  if (graphSteps.length > 0) {
    tempGraphMain.copy(position);
    tempGraphBranch.copy(position);
    for (const step of graphSteps) {
      if (step.saveBranch) tempGraphBranch.copy(tempGraphMain);
      const graphInput = step.input === 'source' ? graphSrc : step.input === 'branch' ? tempGraphBranch : tempGraphMain;
      applyMotionEstimate(graphInput, step.code, estimateCtx, tempGraphOut);
      tempGraphMain.lerp(tempGraphOut, step.blend);
    }
    position.copy(tempGraphMain);
  }

  // Motion DAG (stage 4): register-machine program after the graph
  // section, mirroring the DAG section of the vertex shader.
  const dag = getEstimatorResolutions(config, layerIndex).dag;
  if (dag) {
    tempDagRegs[0].copy(position);
    tempDagRegs[1].copy(graphSrc);
    for (let i = 0; i < dag.nodes.length; i++) {
      const node = dag.nodes[i];
      const target = tempDagRegs[i + 2];
      const a = tempDagRegs[node.inA];
      if (node.kind === 'motion') {
        applyMotionEstimate(a, node.motionCode, estimateCtx, tempDagOut);
        target.copy(tempDagOut);
      } else if (node.kind === 'mix') {
        target.lerpVectors(a, tempDagRegs[node.inB], node.param);
      } else if (node.kind === 'scale') {
        target.copy(a).multiplyScalar(node.param);
      } else if (node.kind === 'source') {
        target.copy(graphSrc);
      } else {
        target.copy(a);
      }
    }
    position.copy(tempDagRegs[dag.output]);
  }
  position.addScaledVector(wind, moveWithWind * time * 0.025);
  position.y -= gravity * 0.01 * time;

  if (neighborForce !== 0) {
    noiseVec3(tempNoise, tempSeed.multiplyScalar(1.7));
    tempNoise.normalize();
    position.addScaledVector(tempNoise, neighborForce * 0.12);
  }

  if (collisionMode === 'world') {
    const worldRadius = Math.max(1, collisionRadius);
    const len = position.length();
    if (len > worldRadius) {
      tempDir.copy(position).normalize();
      position.copy(tempDir.multiplyScalar(worldRadius).addScaledVector(tempDir, -repulsion * 0.01));
    }
  }

  if (boundaryEnabled && position.y < boundaryY) {
    position.y = THREE.MathUtils.lerp(boundaryY, boundaryY + Math.abs(position.y - boundaryY) * Math.max(0, boundaryBounce), 0.75);
  }

  const particleLife = Math.max(4, life * (1 + lifeSpread * (lifeJitter * 2 - 1)));
  const lifeProgress = (((time * 60) / particleLife) + spawnOffset + burstPhase) % 1;
  const burstEnvelope = 1 - THREE.MathUtils.smoothstep(lifeProgress, 0, 0.32);
  tempDir.copy(position).normalize();
  position.addScaledVector(tempDir, burst * burstEnvelope * globalRadius * 0.08 * (0.5 + variant));
  noiseVec3(tempNoise, tempSeed.set(position.x * 0.01, position.y * 0.01, position.z * 0.01 + timePhase));
  position.addScaledVector(tempNoise, trailTurbulence * 6 * burstEnvelope);
  tempWindDir.copy(wind);
  if (tempWindDir.lengthSq() > 0.000001) {
    tempWindDir.normalize();
    position.addScaledVector(tempWindDir, trailDrift * 18 * burstEnvelope);
  }
  position.lerp(base.clone().add(animatedOffset), THREE.MathUtils.clamp(trailDrag * 0.16, 0, 0.65));

  if (spinX !== 0) position.applyAxisAngle(xAxis, spinX * time);
  if (spinY !== 0) position.applyAxisAngle(yAxis, spinY * time);
  if (spinZ !== 0) position.applyAxisAngle(zAxis, spinZ * time);

  position.multiplyScalar(Math.max(0, 1 - resistance * 0.025));
  return position;
}
