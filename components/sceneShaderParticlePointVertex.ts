import { PHYSICS_LOGIC } from './scenePhysicsLogic';

export const PARTICLE_VERTEX_SHADER = `
  precision highp float;
  // モーションタイプ関連定数
  #define MOTION_TYPE_COUNT 90.0  // 実装されているモーションタイプの総数
  #define VARIANT_OFFSET    17.0  // バリアントほまったオフセット（モーフ時に璴歰を防ぐ）
  #define VARIANT_SCALE     11.0  // バリアントからモーションオフセットへの変換係数
  #define LIFE_TIME_SCALE   60.0  // 番小数（2Dライフ進行計算用のフレームスケール）
  ${PHYSICS_LOGIC}
  uniform float uTime; uniform float uOpacity; uniform float uAudioBassMotion; uniform float uAudioTrebleMotion; uniform float uAudioBassSize; uniform float uAudioTrebleSize; uniform float uAudioBassAlpha; uniform float uAudioTrebleAlpha; uniform float uAudioPulse; uniform float uAudioMorph; uniform float uAudioShatter; uniform float uAudioTwist; uniform float uAudioBend; uniform float uAudioWarp;
  uniform float uAudioBandAMotion; uniform float uAudioBandASize; uniform float uAudioBandAAlpha;
  uniform float uAudioBandBMotion; uniform float uAudioBandBSize; uniform float uAudioBandBAlpha;
  uniform float uGlobalSpeed; uniform float uGlobalAmp; uniform float uGlobalNoiseScale;
    uniform float uGlobalComplexity;
  uniform float uGlobalEvolution; uniform float uGlobalFidelity; uniform float uGlobalOctaveMult;
  uniform float uGlobalFreq; uniform float uGlobalRadius; uniform float uGlobalSize;
  uniform float uInstanced3D; uniform float uInstanced3DScale;
  uniform float uMediaReactive; uniform float uMediaSizeBoost; uniform float uMediaAlphaBoost;
  uniform float uMediaGlyphInstancing; uniform float uMediaGlyphDepthBoost; uniform float uMediaGlyphTwist; uniform float uMediaGlyphQuantize;
  uniform float uGravity; uniform vec3 uWind;
  uniform vec3 uSpin;
  uniform float uBoundaryY; uniform float uBoundaryEnabled; uniform float uBoundaryBounce;
  uniform float uViscosity; uniform float uFluidForce;
    uniform float uResistance; uniform float uMoveWithWind; uniform float uNeighborForce;
    uniform float uCollisionMode; uniform float uCollisionRadius; uniform float uRepulsion;
    uniform float uTrail; uniform float uLife; uniform float uLifeSpread; uniform float uLifeSizeBoost; uniform float uLifeSizeTaper; uniform float uBurst; uniform float uBurstPhase; uniform float uBurstMode; uniform float uBurstWaveform; uniform float uBurstSweepSpeed; uniform float uBurstSweepTilt; uniform float uBurstConeWidth; uniform float uEmitterOrbitSpeed; uniform float uEmitterOrbitRadius; uniform float uEmitterPulseAmount; uniform float uTrailDrag; uniform float uTrailTurbulence; uniform float uTrailDrift; uniform float uVelocityGlow; uniform float uVelocityAlpha; uniform float uFlickerAmount; uniform float uFlickerSpeed; uniform float uStreak; uniform float uSpriteMode; uniform float uAuxLife; uniform float uIsAux;
  uniform float uAffectPos; uniform vec2 uMouse; uniform float uMouseForce;
  uniform float uMouseRadius; uniform float uIsOrthographic;
        uniform float uInterLayerEnabled; uniform int uInterLayerColliderCount; uniform vec4 uInterLayerColliders[MAX_INTER_LAYER_COLLIDERS]; uniform float uInterLayerStrength; uniform float uInterLayerPadding;
  attribute vec3 aPosition; attribute vec3 aOffset; attribute vec4 aData1; attribute vec4 aData2; attribute vec4 aData3;
  attribute float aFeedbackIndex;
  // Position feedback (free-wiring stage 4, method C via texture ping-pong):
  // the previous frame's final layer-space positions, written by a shadow
  // simulation pass. Only the primary position call is fed back.
  uniform float uFeedbackEnabled; uniform float uFeedback; uniform float uFeedbackDecay;
  uniform sampler2D uFeedbackPrevTex; uniform float uFeedbackTexSize;
  varying float vAlpha; varying vec2 vUv; varying float vLife; varying float vVelocity; varying float vSpriteMode; varying float vVariant; varying float vBurst;
  vec3 applyAudioSpatialWarp(vec3 pos, vec3 origin, float timeValue, float amp, float phase, float variant) {
    float radiusNorm = clamp(length(pos.xz) / max(1.0, uGlobalRadius), 0.0, 3.0);
    float heightNorm = pos.y / max(1.0, uGlobalRadius);
    float twistAngle = uAudioTwist * (0.35 + variant * 0.85) * heightNorm * 2.8;
    float twistCos = cos(twistAngle);
    float twistSin = sin(twistAngle);
    pos.xz = mat2(twistCos, -twistSin, twistSin, twistCos) * pos.xz;
    float bendWave = sin(timeValue * 2.4 + phase + pos.y * 0.028) + cos(timeValue * 1.7 + phase * 0.7 + pos.x * 0.022);
    pos.x += bendWave * amp * uAudioBend * (0.08 + radiusNorm * 0.12);
    pos.z += cos(timeValue * 2.1 - phase + pos.x * 0.025) * amp * uAudioBend * (0.05 + abs(heightNorm) * 0.14);
    vec3 radialDir = normalize(vec3(pos.x, 0.0, pos.z) + vec3(0.0001));
    float warpWave = sin(length(pos.xz) * 0.045 - timeValue * 3.1 + phase) * 0.5 + 0.5;
    pos += radialDir * amp * uAudioWarp * mix(0.02, 0.12, warpWave) * (0.5 + variant * 0.6);
    pos.y += sin(length(origin.xz) * 0.03 + timeValue * 2.6 + phase) * amp * uAudioWarp * 0.08;
    vec3 tearNoise = noiseVec(pos * (0.04 + uAudioShatter * 0.02) + vec3(timeValue * 1.9 + phase));
    vec3 tearDir = normalize(vec3(tearNoise.x, tearNoise.y * 0.35 + sin(phase + timeValue), tearNoise.z) + vec3(0.0001));
    float tearMask = smoothstep(0.15, 0.95, fract(variant * 7.13 + tearNoise.x * 0.5 + timeValue * 0.12));
    pos += tearDir * amp * uAudioShatter * tearMask * mix(0.02, 0.16, variant);
    return pos;
  }
  void main() {
    vUv = uv; float aPhase = aData1.x; float aRandom = aData1.y; float aMotionType = aData1.z;
    float aBaseRadiusFactor = aData1.w; float aSpeedFactor = aData2.x; float aAmpFactor = aData2.y;
    float aFreqFactor = aData2.z; float aSizeFactor = aData2.w;
    float aSpawnOffset = aData3.x; float aLifeJitter = aData3.y; float aVariant = aData3.z; float aMediaLuma = aData3.w;
    float mediaMask = step(0.5, uMediaReactive);
    float glyphInstancingMask = step(0.5, uMediaGlyphInstancing);
    float glyphBandCount = max(2.0, uMediaGlyphQuantize);
    float glyphBand = floor(clamp(aMediaLuma, 0.0, 0.9999) * glyphBandCount) / max(1.0, glyphBandCount - 1.0);
    float mediaSizeScale = mix(1.0, mix(max(0.18, 1.0 - uMediaSizeBoost * 0.7), 1.0 + uMediaSizeBoost, clamp(aMediaLuma, 0.0, 1.0)), mediaMask);
    float mediaAlphaScale = mix(1.0, mix(max(0.06, 1.0 - uMediaAlphaBoost), 1.0 + uMediaAlphaBoost * 0.22, clamp(aMediaLuma, 0.0, 1.0)), mediaMask);
    float radius = aBaseRadiusFactor * uGlobalRadius;
    float speed = aSpeedFactor * uGlobalSpeed * (1.0 + uAudioTrebleMotion * 3.2 + uAudioBandAMotion * 3.2 + uAudioBandBMotion * 3.2);
    float amp = aAmpFactor * uGlobalAmp * (1.0 + uAudioBassMotion * 1.35);
    float trebleJitterMix = 1.0 + uAudioTrebleMotion * 1.8;
    float freq = aFreqFactor * uGlobalFreq * trebleJitterMix;
    float noiseScale = uGlobalNoiseScale * trebleJitterMix;
    float complexity = uGlobalComplexity * mix(1.0, trebleJitterMix, 0.6);
    float prevTime = max(uTime - 0.04, 0.0);
    float emitterOrbitPhase = uTime * max(0.0, uEmitterOrbitSpeed);
    float prevEmitterOrbitPhase = prevTime * max(0.0, uEmitterOrbitSpeed);
    float emitterPulse = 1.0 + sin(uTime * max(0.05, uEmitterOrbitSpeed) * 1.6 + aPhase) * uEmitterPulseAmount + uAudioPulse * (0.08 + aVariant * 0.08);
    float prevEmitterPulse = 1.0 + sin(prevTime * max(0.05, uEmitterOrbitSpeed) * 1.6 + aPhase) * uEmitterPulseAmount + uAudioPulse * (0.06 + aVariant * 0.05);
    vec3 animatedOffset = aOffset * emitterPulse;
    vec3 prevAnimatedOffset = aOffset * prevEmitterPulse;
    if (uEmitterOrbitRadius > 0.0 || length(aOffset.xz) > 0.001) {
      animatedOffset = rotate(animatedOffset, vec3(0.0, 1.0, 0.0), emitterOrbitPhase);
      prevAnimatedOffset = rotate(prevAnimatedOffset, vec3(0.0, 1.0, 0.0), prevEmitterOrbitPhase);
    }
    vec3 emitterOrbitOffset = vec3(cos(emitterOrbitPhase), sin(emitterOrbitPhase * 0.5) * 0.25, sin(emitterOrbitPhase)) * uEmitterOrbitRadius;
    vec3 prevEmitterOrbitOffset = vec3(cos(prevEmitterOrbitPhase), sin(prevEmitterOrbitPhase * 0.5) * 0.25, sin(prevEmitterOrbitPhase)) * uEmitterOrbitRadius;
    animatedOffset += emitterOrbitOffset;
    prevAnimatedOffset += prevEmitterOrbitOffset;

    vec3 pos = calculateLayerPosition(
        aPosition, animatedOffset, aMotionType, uTime,
        speed, amp, freq, radius,
        aPhase, aRandom, uWind, noiseScale,
        uGlobalEvolution, complexity, uFluidForce, uViscosity,
        uGlobalFidelity, uGlobalOctaveMult, uAffectPos,
        uResistance, uMoveWithWind, uNeighborForce,
        uCollisionMode, uCollisionRadius, uRepulsion,
        uGravity, uBoundaryY, uBoundaryEnabled, uBoundaryBounce,
        uInterLayerEnabled, uInterLayerColliderCount, uInterLayerColliders, uInterLayerStrength,
        uInterLayerPadding
    );
    if (uFeedbackEnabled > 0.5 && uFeedbackTexSize > 0.5) {
      vec2 fbUv = (vec2(mod(aFeedbackIndex, uFeedbackTexSize), floor(aFeedbackIndex / uFeedbackTexSize)) + 0.5) / uFeedbackTexSize;
      vec3 fbPrev = texture2D(uFeedbackPrevTex, fbUv).xyz;
      pos = mix(pos, fbPrev, clamp(uFeedback, 0.0, 1.0));
      pos = mix(pos, aPosition * radius + animatedOffset, clamp(uFeedbackDecay, 0.0, 1.0) * 0.15);
    }
    // prevPos is only needed for trail/streak rendering. Skip the full physics recalculation
    // when neither trail nor streak is active (uniform is the same for all particles in the warp).
    bool needPrevPos = (uTrail > 0.001 || uStreak > 0.001);
    vec3 prevPos = pos; // default: no delta → trailDelta = 0

    if (needPrevPos) {
      prevPos = calculateLayerPosition(
          aPosition, prevAnimatedOffset, aMotionType, prevTime,
          speed, amp, freq, radius,
          aPhase, aRandom, uWind, noiseScale,
          uGlobalEvolution, complexity, uFluidForce, uViscosity,
          uGlobalFidelity, uGlobalOctaveMult, uAffectPos,
          uResistance, uMoveWithWind, uNeighborForce,
          uCollisionMode, uCollisionRadius, uRepulsion,
          uGravity, uBoundaryY, uBoundaryEnabled, uBoundaryBounce,
          uInterLayerEnabled, uInterLayerColliderCount, uInterLayerColliders, uInterLayerStrength,
          uInterLayerPadding
      );
    }

    if (uAudioMorph > 0.001) {
      float altMotionType = mod(aMotionType + VARIANT_OFFSET + floor(aVariant * VARIANT_SCALE), MOTION_TYPE_COUNT);
      vec3 morphPos = calculateLayerPosition(
        aPosition, animatedOffset, altMotionType, uTime * (1.02 + aVariant * 0.12),
        speed, amp, freq * (1.0 + aVariant * 0.15), radius,
        aPhase + 1.7, aRandom, uWind, noiseScale,
        uGlobalEvolution, complexity, uFluidForce, uViscosity,
        uGlobalFidelity, uGlobalOctaveMult, uAffectPos,
        uResistance, uMoveWithWind, uNeighborForce,
        uCollisionMode, uCollisionRadius, uRepulsion,
        uGravity, uBoundaryY, uBoundaryEnabled, uBoundaryBounce,
        uInterLayerEnabled, uInterLayerColliderCount, uInterLayerColliders, uInterLayerStrength,
        uInterLayerPadding
      );
      float morphMix = clamp(uAudioMorph * (0.22 + aVariant * 0.48), 0.0, 0.92);
      pos = mix(pos, morphPos, morphMix);

      if (needPrevPos) {
        vec3 prevMorphPos = calculateLayerPosition(
          aPosition, prevAnimatedOffset, altMotionType, prevTime * (1.02 + aVariant * 0.12),
          speed, amp, freq * (1.0 + aVariant * 0.15), radius,
          aPhase + 1.7, aRandom, uWind, noiseScale,
          uGlobalEvolution, complexity, uFluidForce, uViscosity,
          uGlobalFidelity, uGlobalOctaveMult, uAffectPos,
          uResistance, uMoveWithWind, uNeighborForce,
          uCollisionMode, uCollisionRadius, uRepulsion,
          uGravity, uBoundaryY, uBoundaryEnabled, uBoundaryBounce,
          uInterLayerEnabled, uInterLayerColliderCount, uInterLayerColliders, uInterLayerStrength,
          uInterLayerPadding
        );
        prevPos = mix(prevPos, prevMorphPos, morphMix);
      }
    }

    if (length(uSpin) > 0.001) {
        pos = rotate(pos, vec3(1,0,0), uSpin.x * uTime);
        pos = rotate(pos, vec3(0,1,0), uSpin.y * uTime);
        pos = rotate(pos, vec3(0,0,1), uSpin.z * uTime);
        if (needPrevPos) {
          prevPos = rotate(prevPos, vec3(1,0,0), uSpin.x * prevTime);
          prevPos = rotate(prevPos, vec3(0,1,0), uSpin.y * prevTime);
          prevPos = rotate(prevPos, vec3(0,0,1), uSpin.z * prevTime);
        }
    }
    pos = applyAudioSpatialWarp(pos, animatedOffset, uTime, amp, aPhase, aVariant);
    if (needPrevPos) {
      prevPos = applyAudioSpatialWarp(prevPos, prevAnimatedOffset, prevTime, amp, aPhase, aVariant);
    }

    float lifeAlpha = 1.0;
    float lifeProgress = 0.0;
    if (uLife > 0.0) {
      float particleLife = max(4.0, uLife * mix(1.0 - uLifeSpread, 1.0 + uLifeSpread, aLifeJitter));
      lifeProgress = fract((uTime * LIFE_TIME_SCALE) / particleLife + aSpawnOffset + uBurstPhase);
      float burstEnvelope = 1.0 - smoothstep(0.0, 0.32, lifeProgress);
      float burstTailStart = mix(0.92, 0.36, clamp(uBurst, 0.0, 1.0));
      lifeAlpha = smoothstep(0.0, 0.08, lifeProgress) * (1.0 - smoothstep(burstTailStart, 1.0, lifeProgress));
      if (uBurstWaveform > 0.5 && uBurstWaveform < 1.5) {
        burstEnvelope *= 0.85 + sin(lifeProgress * 6.28318530718) * 0.15;
      } else if (uBurstWaveform > 1.5 && uBurstWaveform < 2.5) {
        float pulseA = 1.0 - smoothstep(0.0, 0.09, abs(lifeProgress - 0.12));
        float pulseB = 1.0 - smoothstep(0.0, 0.09, abs(lifeProgress - 0.26));
        float pulseC = 1.0 - smoothstep(0.0, 0.09, abs(lifeProgress - 0.41));
        burstEnvelope = max(pulseA, max(pulseB, pulseC));
        lifeAlpha *= 0.78 + burstEnvelope * 0.4;
      } else if (uBurstWaveform >= 2.5) {
        float beatA = 1.0 - smoothstep(0.0, 0.1, abs(lifeProgress - 0.16));
        float beatB = 1.0 - smoothstep(0.0, 0.1, abs(lifeProgress - 0.31));
        burstEnvelope = max(beatA, beatB * 0.82);
        lifeAlpha *= 0.82 + burstEnvelope * 0.3;
      }
      float burstPush = clamp(uBurst, 0.0, 2.0) * burstEnvelope;
      vec3 burstDir = normalize((pos - animatedOffset) + vec3(0.0001));
      if (uBurstMode > 0.5 && uBurstMode < 1.5) {
        float coneWidth = mix(0.08, 1.05, clamp(uBurstConeWidth, 0.0, 1.0));
        burstDir = normalize(vec3(
          sin(aPhase) * coneWidth * mix(0.12, 0.65, aVariant),
          mix(1.15, 0.22, clamp(uBurstConeWidth, 0.0, 1.0)) * mix(0.65, 1.0, aLifeJitter),
          cos(aPhase) * coneWidth * mix(0.12, 0.65, aVariant)
        ) + vec3(0.0001));
      } else if (uBurstMode >= 1.5) {
        float sweepAngle = uTime * max(0.05, uBurstSweepSpeed) + aPhase;
        float sweepTilt = mix(-0.9, 0.9, clamp(uBurstSweepTilt, 0.0, 1.0));
        vec3 sweepDir = normalize(vec3(cos(sweepAngle), sweepTilt + sin(uTime * max(0.05, uBurstSweepSpeed) * 0.75 + aVariant * 6.2831) * 0.25, sin(sweepAngle)) + vec3(0.0001));
        burstDir = mix(burstDir, sweepDir, 0.82);
      }
      pos += burstDir * amp * burstPush * mix(0.08, 0.2, aVariant);
      float dragMix = clamp(uTrailDrag, 0.0, 1.5) * clamp(lifeProgress, 0.0, 1.0);
      pos = mix(pos, animatedOffset + (pos - animatedOffset) * (1.0 - dragMix * 0.55), dragMix * 0.3);
      vec3 turbulence = noiseVec((pos + animatedOffset) * (0.02 + uTrailTurbulence * 0.018) + vec3(uTime * 0.35 + aPhase));
      pos += turbulence * amp * uTrailTurbulence * burstEnvelope * 0.05;
      vec3 driftDir = normalize(uWind + vec3(0.0001));
      pos += driftDir * amp * uTrailDrift * (0.25 + lifeProgress * 0.75) * 0.06;
    }
    pos += normalize((pos - animatedOffset) + vec3(0.0001)) * amp * uAudioPulse * mix(0.018, 0.072, aVariant);

    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    vec4 prevMvPosition = modelViewMatrix * vec4(prevPos, 1.0);

    if (uMouseForce != 0.0) {
        vec3 mouseWorld;
        if (uIsOrthographic > 0.5) { mouseWorld = vec3(uMouse.x * 500.0, uMouse.y * 500.0, 0.0); }
        else { mouseWorld = vec3(uMouse.x * 200.0, uMouse.y * 200.0, -uGlobalRadius); }
        float distToMouse = distance(mvPosition.xyz, mouseWorld);
        if (distToMouse < uMouseRadius) {
            float force = (1.0 - distToMouse / uMouseRadius) * uMouseForce * 20.0;
            mvPosition.xyz += normalize(mvPosition.xyz - mouseWorld) * force;
        }
    }

    float dist = -mvPosition.z;
    if (uIsOrthographic < 0.5 && dist <= 1.0) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      vLife = 0.0;
      vVelocity = 0.0;
      vSpriteMode = uSpriteMode;
      vVariant = aVariant;
      vBurst = 0.0;
      vAlpha = 0.0;
      return;
    }
    float sizeScale = (uIsOrthographic > 0.5) ? 1.0 : min(2.5, 400.0 / max(1.0, dist));
    float audioSizeBoost = 1.0 + uAudioBassSize * 1.85 + uAudioTrebleSize * 0.45 + uAudioPulse * 1.15
      + uAudioBandASize * 1.85 + uAudioBandBSize * 0.45;
    float pSize = aSizeFactor * uGlobalSize * sizeScale * audioSizeBoost;
    float lifeSizeScale = 1.0;
    if (uLife > 0.0) {
      float lifeBloom = sin(clamp(lifeProgress, 0.0, 1.0) * 3.14159265359);
      float lifeTaper = smoothstep(0.58, 1.0, lifeProgress);
      lifeSizeScale = max(0.15, 1.0 + lifeBloom * uLifeSizeBoost - lifeTaper * uLifeSizeTaper);
    }
    pSize *= lifeSizeScale;
    pSize *= mediaSizeScale;
    if (uIsAux > 0.5) {
      float auxLifeProgress = fract((uTime * LIFE_TIME_SCALE) / max(1.0, uAuxLife) + aRandom);
      float auxLifeAlpha = smoothstep(0.0, 0.12, auxLifeProgress) * (1.0 - smoothstep(0.65, 1.0, auxLifeProgress));
      lifeAlpha *= auxLifeAlpha;
      pSize *= mix(0.65, 1.35, auxLifeAlpha);
    }
    float clampedSize = clamp(pSize, 0.0, 500.0);
    vec2 trailDelta = mvPosition.xy - prevMvPosition.xy;
    float trailMagnitude = length(trailDelta);
    vec2 trailDir = trailMagnitude > 0.0001 ? normalize(trailDelta) : vec2(0.0, 1.0);
    vec2 trailPerp = vec2(-trailDir.y, trailDir.x);
    float dragTrailBoost = 1.0 + clamp(uTrailDrag, 0.0, 1.5) * clamp(lifeProgress, 0.0, 1.0);
    float trailAmount = clamp(uTrail, 0.0, 0.99) * clamp(trailMagnitude * 25.0, 0.0, 8.0) * (1.0 + max(0.0, uStreak) * 1.35) * dragTrailBoost;
    float streakStretch = 1.0 + trailAmount * (0.2 + max(0.0, uStreak));
    float streakWidth = max(0.16, 1.0 - trailAmount * 0.08 * (0.6 + max(0.0, uStreak)));

    if (uInstanced3D > 0.5) {
      // World-space 3D geometry: position.xyz is the local vertex of the geometry (cube/tetra)
      float geomSize = aSizeFactor * uGlobalSize * uInstanced3DScale * mediaSizeScale;
      vec3 instancedLocal = position.xyz;
      if (glyphInstancingMask > 0.5) {
        float glyphScale = mix(0.38, 1.72, glyphBand);
        float glyphTwist = (glyphBand - 0.5) * uMediaGlyphTwist + aVariant * 0.35;
        instancedLocal = rotate(instancedLocal, vec3(0.0, 1.0, 0.0), glyphTwist);
        instancedLocal = rotate(instancedLocal, vec3(0.0, 0.0, 1.0), glyphTwist * 0.42);
        pos.y += (glyphBand - 0.5) * uMediaGlyphDepthBoost * max(1.0, uGlobalSize) * 0.65;
        geomSize *= glyphScale;
      }
      gl_Position = projectionMatrix * modelViewMatrix * vec4(pos + instancedLocal * geomSize, 1.0);
    } else {
      mvPosition.xy += trailPerp * position.x * clampedSize * streakWidth + trailDir * position.y * clampedSize * streakStretch;
      gl_Position = projectionMatrix * mvPosition;
    }
    vLife = lifeProgress;
    vVelocity = clamp(trailMagnitude * 40.0, 0.0, 1.0);
    vSpriteMode = uSpriteMode;
    vVariant = aVariant;
    vBurst = clamp(uBurst, 0.0, 1.0) * (1.0 - smoothstep(0.0, 0.6, lifeProgress));
    float audioAlphaBoost = 1.0 + uAudioBassAlpha * 0.95 + uAudioTrebleAlpha * 0.35 + uAudioPulse * 0.85
      + uAudioBandAAlpha * 0.95 + uAudioBandBAlpha * 0.95;
    vAlpha = uOpacity * lifeAlpha * (1.0 - smoothstep(2000.0, 5000.0, length(pos))) * (1.0 + clamp(uTrail, 0.0, 0.99) * 0.35) * audioAlphaBoost * mediaAlphaScale;
  }
`;
