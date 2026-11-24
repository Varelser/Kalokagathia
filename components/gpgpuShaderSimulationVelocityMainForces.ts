// ── Velocity sim fragment, part 3 of 5: main(): state setup + built-in force accumulation ──
// Split from gpgpuShaderSimulationVelocity.ts in Phase AV
// (behaviour-zero maintenance): this chunk is a verbatim slice
// of the original SIM_VEL_FRAG template literal. The shell
// module concatenates all five chunks in order; the assembled
// string is pinned byte-for-byte by phaseav_test.mjs.
//
// Phase 18 stage 2: the force blocks after the fixed head are
// split into named chunk constants so their application order
// can be rearranged by the gpgpuForceOrder key. Every block is
// a single scoped `if { ... }` statement whose declarations do
// not leak (verified against the source: block-local variables
// stay inside their block; the shared inputs — vel, pos,
// pyroTemp, curlTime, grp* scales, phaseState — are declared
// in the fixed head or, for phaseState, only mutated by the
// kuramoto block). The default-order concatenation of head +
// chunks is byte-identical to the pre-split VEL_FRAG_MAIN_FORCES
// (pinned by scripts/phase18-shader-hash.mjs and
// scripts/phase18-emitter-force-order.test.mjs).
import { normalizeGpgpuForceOrder } from '../lib/gpgpuForceOrder';
export const VEL_FRAG_MAIN_FORCES_HEAD = /* glsl */ `  void main() {
    vec4 posData = texture2D(uPosTex, vUv);
    vec4 velData = texture2D(uVelTex, vUv);
    vec3 pos = posData.xyz;
    vec3 vel = velData.xyz;
    float phaseState = velData.w;

    // Rigid bodies (Phase AU): the velocity of a point rigidly
    // attached to its body. The phase state is preserved
    // verbatim; every force below is superseded whole.
    if (uRigidEnabled) {
      vec4 cell = texture2D(uRigidCellTex, vUv);
      float bx = (cell.w + 0.5) / 64.0;
      vec4 bodyQuat = texture2D(uRigidBodyTex, vec2(bx, 0.375));
      vec4 bodyVel = texture2D(uRigidBodyTex, vec2(bx, 0.625));
      vec4 bodyAng = texture2D(uRigidBodyTex, vec2(bx, 0.875));
      vec3 r = kaloQuatRotate(bodyQuat, cell.xyz);
      gl_FragColor = vec4((bodyVel.xyz + cross(bodyAng.xyz, r)) / 60.0, phaseState);
      return;
    }

    // Spawn gate (Phase AB): an unreleased particle carries zero
    // velocity (its phase state is preserved verbatim) so it sits
    // parked — the position pass holds it off-screen — until the
    // release threshold crosses its hash. Burst 1 (default) skips
    // this entirely. TS twin: spawnStateForIndex in
    // lib/gpgpuLifecycle.ts.
    if (uSpawnBurst < 1.0) {
      float sThr = min(1.0, uSpawnBurst + uSpawnRate * spawnPulseTimeEx(uSpawnTime));
      if (spawnGateValue(vUv) >= sThr) {
        gl_FragColor = vec4(0.0, 0.0, 0.0, phaseState);
        return;
      }
    }

    // Spawn burst event (Phase AX): on the single frame the
    // spawn clock crosses the authored event time, the event's
    // cohort (the same hash the position pass respawns) is handed
    // the directly specified initial velocity, replacing whatever
    // it carried. The forces below then act on it as usual. Only
    // live particles reach this point (parked ones returned
    // above), matching the position pass, whose parked particles
    // never enter the respawn block.
    if (uSpawnEventEnabled && uSpawnEventSpeed > 0.0) {
      if (uSpawnTime - uDelta < uSpawnEventTime && uSpawnTime >= uSpawnEventTime) {
        if (spawnEventHash(vUv) < uSpawnEventCount) {
          vel = spawnEventVelocity(pos, vUv);
        }
      }
    }

    // Replica independent simulation (Phase W2): in stack mode
    // this pass simulates ONE replica block inside its own
    // textures. replicaSeed / replicaTime shift the stochastic
    // field sampling (turbulence / curl / wind gust / Levy gate)
    // so the copy evolves on its own field realization and clock
    // phase; in the shared path both are exact zeros and every
    // expression below reduces to its legacy form. globalUv
    // remaps this stack's texels onto the global layout for the
    // textures that live there (morph / normals / initial data);
    // in the shared path it is vUv itself.
    vec3 replicaSeed = uReplicaSeedOffset;
    float replicaTime = uTime + uReplicaTimeOffset;
    vec2 globalUv = vUv;
    if (uStackMode > 0.5) {
      float localIdx = floor(vUv.y * uTexSizeF) * uTexSizeF + floor(vUv.x * uTexSizeF);
      float globalIdx = uStackGlobalStart + localIdx;
      globalUv = (vec2(mod(globalIdx, uStackGlobalTexSizeF), floor(globalIdx / uStackGlobalTexSizeF)) + 0.5) / uStackGlobalTexSizeF;
    }

    // Named attributes (Phase AK): one fetch per texel while a
    // velocity consumer is active (the texture lives in the
    // global layout, hence globalUv). The per-force group scales
    // stay literal 1.0 while the gate is off, so every gated
    // statement below reduces to its legacy form (x * 1.0 is an
    // exact IEEE identity, the Phase AC curl-speed precedent).
    // Targets: 0 all, 1 gravity, 2 turbulence, 3 curl, 4 wind,
    // 5 morph.
    vec4 attrData = vec4(0.0);
    float grpGravity = 1.0;
    float grpTurbulence = 1.0;
    float grpCurl = 1.0;
    float grpWind = 1.0;
    float grpMorph = 1.0;
    if (uAttrEnabled) {
      attrData = texture2D(uAttrTex, globalUv);
      if (uGroupEnabled) {
        float grp = kaloGroupMembership(kaloAttrChannel(attrData, uGroupSlot), uGroupMode, uGroupLow, uGroupHigh, uGroupInvert);
        if (uGroupTarget == 0) {
          grpGravity = grp; grpTurbulence = grp; grpCurl = grp; grpWind = grp; grpMorph = grp;
        } else if (uGroupTarget == 1) grpGravity = grp;
        else if (uGroupTarget == 2) grpTurbulence = grp;
        else if (uGroupTarget == 3) grpCurl = grp;
        else if (uGroupTarget == 4) grpWind = grp;
        else if (uGroupTarget == 5) grpMorph = grp;
      }
    }

    // Age ratio for the Phase AC sim curves — the points shader's
    // convention (0.5 while age tracking is off).
    float ageNorm = uAgeEnabled ? clamp(posData.w / max(uAgeMax, 0.001), 0.0, 1.0) : 0.5;
    // Pyro temperature (Phase AS): a deterministic function of
    // the normalised age only — a particle is born at the full
    // emission temperature and cools monotonically toward the
    // ambient 0 as it ages (a power curve; Cooling 0 never cools,
    // guarded explicitly because pow(0, 0) is undefined). While
    // age tracking is off, ageNorm is the conventional 0.5, so
    // the temperature is one uniform value pool-wide. No state,
    // no randomness, no wall clock: FROZEN steps reproduce it
    // exactly, like the Phase AC age curves above.
    float pyroTemp = 0.0;
    if (uPyroEnabled) {
      float coolFactor = uPyroCooling > 0.0 ? pow(1.0 - ageNorm, uPyroCooling) : 1.0;
      pyroTemp = uPyroTemperature * coolFactor;
    }
    // Force over Lifetime baseline (Phase AC): the velocity before
    // the built-in force accumulation below.
    vec3 velForceBase = vel;
    // Curl field clock (Phase AC): the legacy rate is 0.15/s;
    // uCurlSpeed 1 multiplies it by exactly 1.0.
    float curlTime = replicaTime * 0.15 * uCurlSpeed;

    vel.y -= uGravity * uDelta * 9.8 * grpGravity;
`;
export const VEL_FRAG_FORCE_PYRO_BUOYANCY = /* glsl */ `
    // Pyro buoyancy (Phase AS): hot particles rise against a
    // gravity that stays downward — the gain is a separate term
    // in gravity units (the AQ discipline: a new interaction
    // keeps its own gain), replacing the legacy starter trick of
    // a negative gravity. Inside the force accumulation, so the
    // Phase AC Force-over-Lifetime capture below scales it like
    // every other built-in force.
    if (uPyroEnabled) {
      vel.y += pyroTemp * uPyroBuoyancy * uDelta * 9.8;
    }
`;
export const VEL_FRAG_FORCE_TURBULENCE = /* glsl */ `
    if (uTurbulence > 0.001) {
      float t = replicaTime * 0.25;
      vec3 np = pos * 0.007 + replicaSeed;
      vel += vec3(vnoise(np+vec3(t,0,0)),vnoise(np+vec3(0,t+13.7,0)),vnoise(np+vec3(0,0,t+27.4)))
             * uTurbulence * 18.0 * uDelta * grpTurbulence;
    }
`;
export const VEL_FRAG_FORCE_AUDIO_BLAST = /* glsl */ `
    if (uAudioBlast > 0.001) {
      vec3 dir = length(pos) > 0.001 ? normalize(pos) : vec3(0,1,0);
      vel += dir * uAudioBlast * 14.0 * uDelta;
    }
`;
export const VEL_FRAG_FORCE_NBODY = /* glsl */ `
    // N-Body gravity/repulsion
    if (uNBodyEnabled) {
      vec3 acc = vec3(0.0);
      float stride = uTexSizeF / float(uNBodySamples);
      for (int i = 0; i < 64; i++) {
        if (i >= uNBodySamples) break;
        float si = float(i) * stride;
        vec2 sUv = (vec2(mod(si, uTexSizeF), floor(si / uTexSizeF)) + 0.5) / uTexSizeF;
        vec3 oPos = texture2D(uPosTex, sUv).xyz;
        vec3 diff = oPos - pos;
        float r2 = dot(diff, diff) + uNBodySoftening * uNBodySoftening;
        float r  = sqrt(r2);
        if (r > 0.001) {
          vec3 dir2 = diff / r;
          if (r > uNBodyRepulsion) {
            acc += dir2 / r2;
          } else {
            acc -= dir2 / r2 * 0.5;
          }
        }
      }
      vel += acc * uNBodyStrength * uDelta * 500.0;
    }
`;
export const VEL_FRAG_FORCE_CURL = /* glsl */ `
    // Curl Noise (with optional field symmetry, B1b; symmetry 0 keeps
    // the exact legacy sampling expression). The B3 flavours/octaves
    // route through curlField; mode 'curl' with 1 octave keeps the
    // exact legacy expression below, untouched.
    if (uCurlEnabled) {
      vec3 curl = (uCurlMode == 0 && uCurlOctaves <= 1)
        ? (uCurlSymmetry == 0
          ? curlNoise(pos * uCurlScale + vec3(curlTime) + replicaSeed)
          : symmetricCurl(pos * uCurlScale + replicaSeed, vec3(curlTime)))
        : curlField(pos * uCurlScale + replicaSeed, vec3(curlTime));
      // Pyro disturbance linkage (Phase AS): the temperature
      // scales the stirring — hot smoke churns harder. The
      // factor is exactly 1.0 while Pyro is off (an IEEE
      // identity, the Phase AC / AK precedent).
      float pyroCurlMul = uPyroEnabled ? 1.0 + pyroTemp * uPyroDisturbanceHeat : 1.0;
      vel += curl * uCurlStrength * 20.0 * uDelta * grpCurl * pyroCurlMul;
    }
`;
export const VEL_FRAG_FORCE_PYRO_DISTURBANCE = /* glsl */ `
    // Pyro disturbance (Phase AS): Pyro's own stirring term, so
    // hot particles churn even with the curl block off. It
    // samples the same divergence-free curl field at a different
    // scale and offset (decorrelated from the block above) and
    // weights it by the particle temperature — this is a
    // temperature modulation of a curl field, not a grid
    // vorticity confinement solve.
    if (uPyroEnabled && uPyroDisturbance > 0.0) {
      vec3 pyroCurl = curlNoise(pos * uCurlScale * 2.3 + vec3(19.7, 7.3, 11.9) + vec3(curlTime * 1.31) + replicaSeed);
      vel += pyroCurl * pyroTemp * uPyroDisturbance * 20.0 * uDelta;
    }
`;
export const VEL_FRAG_FORCE_BOIDS = /* glsl */ `
    // Boids
    if (uBoidsEnabled) {
      vec3 sepForce = vec3(0.0);
      vec3 aliForce = vec3(0.0);
      vec3 cohPos   = vec3(0.0);
      int  cohCount = 0;
      float stride = uTexSizeF / float(uNBodySamples);
      for (int i = 0; i < 64; i++) {
        if (i >= uNBodySamples) break;
        float si = float(i) * stride;
        vec2 sUv = (vec2(mod(si, uTexSizeF), floor(si / uTexSizeF)) + 0.5) / uTexSizeF;
        if (length(sUv - vUv) < 1.5 / uTexSizeF) continue;
        vec3 oPos = texture2D(uPosTex, sUv).xyz;
        vec3 oVel = texture2D(uVelTex, sUv).xyz;
        float d = distance(pos, oPos);
        if (d < uBoidsRadius * 0.3 && d > 0.001) sepForce -= normalize(oPos - pos) / max(d, 0.5);
        if (d < uBoidsRadius) { aliForce += oVel; cohPos += oPos; cohCount++; }
      }
      if (cohCount > 0) {
        float inv = 1.0 / float(cohCount);
        vel += normalize(sepForce + vec3(0.0001)) * uBoidsSeparation * uDelta * 150.0;
        vel += normalize(aliForce * inv - vel + vec3(0.0001)) * uBoidsAlignment * uDelta * 60.0;
        vel += normalize(cohPos * inv - pos + vec3(0.0001)) * uBoidsCohesion * uDelta * 60.0;
      }
    }
`;
export const VEL_FRAG_FORCE_KURAMOTO = /* glsl */ `
    // Kuramoto phase synchronization: the phase lives in vel.w and is
    // coupled to sampled neighbours within a radius (sampled mean-field):
    // dPhase = omega_i + K * mean(sin(phase_j - phase_i)).
    if (uKuramotoEnabled) {
      float omega = (hash3(vec3(vUv * 271.0, 3.7)).x - 0.5) * uKuramotoSpread * 2.0;
      float sumSin = 0.0;
      float kStride = uTexSizeF / 64.0;
      for (int i = 0; i < 64; i++) {
        float si = float(i) * kStride;
        vec2 sUv = (vec2(mod(si, uTexSizeF), floor(si / uTexSizeF)) + 0.5) / uTexSizeF;
        if (length(sUv - vUv) < 1.5 / uTexSizeF) continue;
        vec3 oPos = texture2D(uPosTex, sUv).xyz;
        float wgt = clamp(1.5 - distance(pos, oPos) / max(uKuramotoRadius, 1.0), 0.0, 1.0);
        sumSin += wgt * sin(texture2D(uVelTex, sUv).w - phaseState);
      }
      float dPhase = omega + uKuramotoCoupling * (sumSin / 64.0) * 3.0;
      phaseState = mod(phaseState + dPhase * uDelta, 6.2831853);
    }
`;
export const VEL_FRAG_FORCE_PARTICLE_LIFE = /* glsl */ `
    // Particle Life: species-matrix forces over 64 stochastic neighbours.
    // Classic force law with beta = 0.3: universal short-range repulsion
    // for r < beta, and a triangular matrix-weighted band for beta <= r < 1
    // peaking at r = (1 + beta) / 2. Friction is applied inside this block
    // (frame-rate sane: the per-step retention factor uParticleLifeFriction
    // is defined at 60 fps and exponentiated by elapsed steps) so that
    // structures condense instead of heating forever; it only ever runs
    // while the subsystem is enabled, leaving the OFF path untouched.
    if (uParticleLifeEnabled) {
      int selfSpecies = plSpecies(vUv);
      vec3 plForce = vec3(0.0);
      // Behaviour force (Phase AA1): pursue / evade over the cyclic
      // predator chain, vision-gated. Zero when both coefficients
      // are 0, which keeps the legacy block bit-identical.
      vec3 behForce = vec3(0.0);
      bool behActive = uParticleLifePursue > 0.0 || uParticleLifeEvade > 0.0;
      float plStride = uTexSizeF / 64.0;
      float plRadius = max(uParticleLifeRadius, 1.0);
      const float plBeta = 0.3;
      for (int i = 0; i < 64; i++) {
        float si = float(i) * plStride;
        vec2 sUv = (vec2(mod(si, uTexSizeF), floor(si / uTexSizeF)) + 0.5) / uTexSizeF;
        if (length(sUv - vUv) < 1.5 / uTexSizeF) continue;
        vec3 oPos = texture2D(uPosTex, sUv).xyz;
        vec3 diff = oPos - pos;
        float d = length(diff);
        if (d < plRadius && d > 0.001) {
          vec3 dir = diff / d;
          float r = d / plRadius;
          if (r < plBeta) {
            plForce += dir * (r / plBeta - 1.0);
          } else {
            int otherSpecies = plSpecies(sUv);
            float a = uParticleLifeMatrix[selfSpecies * 6 + otherSpecies];
            float band = 1.0 - abs(2.0 * r - 1.0 - plBeta) / (1.0 - plBeta);
            plForce += dir * a * band;
            if (behActive) {
              int prey = int(mod(float(selfSpecies + 1), float(uParticleLifeSpecies)));
              int predator = int(mod(float(selfSpecies - 1 + uParticleLifeSpecies), float(uParticleLifeSpecies)));
              float pc = otherSpecies == prey ? 1.0 : 0.0;
              float ec = otherSpecies == predator ? 1.0 : 0.0;
              if (pc > 0.0 || ec > 0.0) {
                // Vision gate (TS twin: visionSees in
                // lib/particleLifeBehavior.ts): range, then the
                // cone around the velocity direction.
                float vRange = uParticleLifeVisionRange > 0.0 ? uParticleLifeVisionRange : plRadius;
                bool sees = d <= vRange;
                if (sees && uParticleLifeVisionAngle < 360.0) {
                  float spd = length(vel);
                  if (spd >= 0.01) {
                    float cosA = dot(dir, vel / spd);
                    sees = cosA >= cos(radians(uParticleLifeVisionAngle) * 0.5);
                  }
                }
                if (sees) behForce += dir * (uParticleLifePursue * pc - uParticleLifeEvade * ec) * band;
              }
            }
          }
        }
      }
      vel += plForce * uParticleLifeStrength * uDelta * 45.0;
      vel += behForce * uDelta * 45.0;
      // Meander (Phase AA1): per-particle wander — the phase is the
      // particle's own (plHash family), the sines sample its own
      // position, so neighbours wander differently. Amount 0 skips
      // the term entirely. TS twin: meanderVector.
      if (uParticleLifeMeanderAmount > 0.0) {
        float selfIdx = floor(vUv.y * uTexSizeF) * uTexSizeF + floor(vUv.x * uTexSizeF);
        float mPhase = plHash(selfIdx + 17.17) * 6.2831853;
        float mScale = 0.02 * max(uParticleLifeMeanderScale, 0.001);
        float mTime = uTime * 0.7;
        vec3 mVec = vec3(
          sin(pos.y * mScale + mPhase + mTime),
          sin(pos.z * mScale + mPhase * 1.7 + mTime),
          sin(pos.x * mScale + mPhase * 2.3 + mTime));
        vel += mVec * uParticleLifeMeanderAmount * uDelta * 30.0;
      }
      // Obstacle avoidance (Phase AB): the third Steering term —
      // a push along the SDF collider's normal, quadratic in the
      // proximity inside the vision range (same range fallback as
      // the vision gate: 0 = interaction radius). Only acts while
      // the collider is enabled. TS twin: obstacleAvoidForce in
      // lib/particleLifeBehavior.ts.
      if (uParticleLifeAvoid > 0.0 && uSdfEnabled) {
        float aRange = uParticleLifeVisionRange > 0.0 ? uParticleLifeVisionRange : plRadius;
        float aSd = abSdfDistance(pos);
        if (aSd < aRange) {
          float aw = clamp(1.0 - aSd / aRange, 0.0, 1.0);
          vel += abSdfNormal(pos) * (uParticleLifeAvoid * aw * aw) * uDelta * 45.0;
        }
      }
      vel *= pow(clamp(uParticleLifeFriction, 0.0, 1.0), uDelta * 60.0);
      // Max speed (Phase AA1): 0 = uncapped (legacy).
      if (uParticleLifeMaxSpeed > 0.0) {
        float spd2 = length(vel);
        if (spd2 > uParticleLifeMaxSpeed) vel *= uParticleLifeMaxSpeed / spd2;
      }
    }
`;
export const VEL_FRAG_FORCE_ATTRACTOR = /* glsl */ `
    // Strange Attractor
    if (uAttractorEnabled) {
      vec3 ap = pos / max(0.1, uAttractorScale);
      // Attractor space modes (Phase DO; TS twin:
      // lib/attractorSpace.ts). 0 = legacy sampling. Spread
      // recentres the sampling on the attractor's own centre
      // (per-type z centre) so world origin maps to the centre
      // and the structure forms around it — the sign matters:
      // subtracting the centre instead projects it onto the
      // containment sphere and worsens the legacy collapse.
      // Frame samples in rotated coordinates (world y is the
      // attractor's z, world z its y), so the two wings stand
      // in the view plane as two medallions around an open
      // centre.
      if (uAttractorSpaceMode == 1 || uAttractorSpaceMode == 2) {
        float zc = 0.0;
        if (uAttractorType == 0 || uAttractorType == 4 || uAttractorType == 5) zc = 23.0;
        else if (uAttractorType == 1) zc = 1.5;
        if (uAttractorSpaceMode == 1) {
          ap.z += zc;
        } else {
          ap = vec3(ap.x, ap.z, ap.y + zc);
        }
      }
      vec3 dv;
      if (uAttractorType == 0) { // Lorenz
        dv = vec3(10.0*(ap.y-ap.x), ap.x*(28.0-ap.z)-ap.y, ap.x*ap.y-2.667*ap.z);
      } else if (uAttractorType == 1) { // Rossler
        dv = vec3(-(ap.y+ap.z), ap.x+0.2*ap.y, 0.2+ap.z*(ap.x-5.7));
      } else if (uAttractorType == 3) { // Halvorsen
        dv = vec3(-1.4*ap.x - 4.0*ap.y - 4.0*ap.z - ap.y*ap.y,
                  -1.4*ap.y - 4.0*ap.z - 4.0*ap.x - ap.z*ap.z,
                  -1.4*ap.z - 4.0*ap.x - 4.0*ap.y - ap.x*ap.x);
      } else if (uAttractorType == 4) { // Chen
        dv = vec3(35.0*(ap.y-ap.x), -7.0*ap.x - ap.x*ap.z + 28.0*ap.y, ap.x*ap.y - 3.0*ap.z);
      } else if (uAttractorType == 5) { // Lu
        dv = vec3(36.0*(ap.y-ap.x), -ap.x*ap.z + 20.0*ap.y, ap.x*ap.y - 3.0*ap.z);
      } else if (uAttractorType == 6) { // Aizawa
        float zb = ap.z - 0.7;
        dv = vec3(zb*ap.x - 3.5*ap.y,
                  3.5*ap.x + zb*ap.y,
                  0.6 + 0.95*ap.z - (ap.z*ap.z*ap.z)/3.0 - (ap.x*ap.x + ap.y*ap.y)*(1.0 + 0.25*ap.z) + 0.1*ap.z*ap.x*ap.x*ap.x);
      } else if (uAttractorType == 7) { // Sprott F
        dv = vec3(ap.y + ap.z, -ap.x + 0.5*ap.y, ap.x*ap.x - ap.z);
      } else if (uAttractorType == 8) { // Rabinovich-Fabrikant
        dv = vec3(ap.y*(ap.z - 1.0 + ap.x*ap.x) + 0.1*ap.x,
                  ap.x*(3.0*ap.z + 1.0 - ap.x*ap.x) + 0.1*ap.y,
                  -2.0*ap.z*(0.14 + ap.x*ap.y));
      } else if (uAttractorType == 9) { // De Jong map (pull toward the mapped point)
        vec2 mp = vec2(sin(1.4*ap.y) - cos(-2.3*ap.x), sin(2.4*ap.x) - cos(-2.1*ap.y));
        dv = vec3(mp - ap.xy, -0.5*ap.z);
      } else if (uAttractorType == 10) { // Ikeda map (same adaptation)
        float r2 = dot(ap.xy, ap.xy);
        float tt = 0.4 - 6.0/(1.0 + r2);
        float ct = cos(tt); float st = sin(tt);
        vec2 mp = vec2(1.0, 0.0) + 0.918 * vec2(ap.x*ct - ap.y*st, ap.x*st + ap.y*ct);
        dv = vec3(mp - ap.xy, -0.5*ap.z);
      } else if (uAttractorType == 11) { // Chua (double scroll)
        float fx = -0.714*ap.x - 0.2145*(abs(ap.x + 1.0) - abs(ap.x - 1.0));
        dv = vec3(15.6*(ap.y - ap.x - fx), ap.x - ap.y + ap.z, -28.0*ap.y);
      } else { // Thomas (2)
        dv = vec3(sin(ap.y)-0.208*ap.x, sin(ap.z)-0.208*ap.y, sin(ap.x)-0.208*ap.z);
      }
      if (uAttractorSpaceMode == 0 || uAttractorSpaceMode == 3) {
        // Legacy pull. Ring (3) shares it: ring keeps the legacy
        // dynamics and does its work at the end of the position
        // pass instead (see gpgpuShaderSimulationPosition).
        vel += normalize(dv + vec3(0.0001)) * uAttractorStrength * uDelta * 40.0;
      } else {
        // Velocity matching (Phase DO): impose the field
        // itself as the velocity, so particles trace the
        // attractor's actual orbits instead of accumulating
        // momentum, overshooting to the containment sphere
        // and sliding to its tangent fixed points (the legacy
        // two-cluster collapse behind the black Star Section
        // Tube). The 0.015 rate advances the attractor's own
        // time by ~0.016 per frame at strength 1 through the
        // position pass's vel * dt * speed * 60 step — the
        // classic integration step for these fields. Frame
        // rotates the derivative with the same y/z swap as
        // the sampling.
        vec3 fv = dv;
        if (uAttractorSpaceMode == 2) fv = vec3(dv.x, dv.z, dv.y);
        vel = fv * uAttractorScale * 0.015 * uAttractorStrength;
      }
    }
`;
// Phase 27 (9-6 stage 1): strange attractor unit 2 — the same
// force law as unit 1, driven by the uAttractor2* uniform set.
// The chunk is DERIVED from the unit-1 chunk by renaming the
// uniform prefix, so the two units can never drift apart in
// the force laws (all 12 types and the space modes included).
// Variant-gated like 'steer-seek': it exists in the built
// shader only behind the attractor2 option (see
// buildMainForcesFragment), so the stock assembly stays
// byte-identical.
export const VEL_FRAG_FORCE_ATTRACTOR2 =
  VEL_FRAG_FORCE_ATTRACTOR
    .replace('// Strange Attractor\n', '// Strange Attractor (unit 2)\n')
    .replaceAll('uAttractor', 'uAttractor2');
export const VEL_FRAG_FORCE_LEVY = /* glsl */ `
    // Lévy flight: rare heavy-tailed impulses. The gate is quantised by tick
    // (floor(uTime * rate)) so jump frequency is frame-rate independent; the
    // magnitude follows a power law in the hash (clamped for stability).
    if (uLevyEnabled) {
      float tick = floor(replicaTime * uLevyRate);
      vec3 h = hash3(vec3(vUv * 913.7, tick * 17.31 + 4.7));
      if (h.x > 0.96) {
        vec3 dir = h - 0.5;
        float dl = length(dir);
        if (dl > 0.01) {
          float mag = min(pow(max(h.y, 0.002), -1.2), 60.0) * uLevyStrength * 1.5;
          vel += (dir / dl) * mag;
        }
      }
    }
`;
export const VEL_FRAG_FORCE_VORTEX = /* glsl */ `
    // Vortex
    if (uVortexEnabled) {
      vec3 axis = normalize(vec3(sin(uVortexTilt), cos(uVortexTilt), 0.0));
      vec3 tangent = cross(axis, pos);
      float tLen = length(tangent);
      if (tLen > 0.001) vel += (tangent / tLen) * uVortexStrength * uDelta * 80.0;
    }
`;
export const VEL_FRAG_FORCE_WIND = /* glsl */ `
    // Wind
    if (uWindEnabled) {
      vec3 gust = vec3(
        vnoise(pos * 0.01 + replicaSeed + vec3(replicaTime * 0.3, 0.0, 0.0)),
        vnoise(pos * 0.01 + replicaSeed + vec3(1.7, replicaTime * 0.25, 0.0)),
        vnoise(pos * 0.01 + replicaSeed + vec3(0.0, 3.1, replicaTime * 0.2))
      ) * uWindGust;
      vel += (normalize(vec3(uWindX, uWindY, uWindZ) + vec3(0.0001)) * uWindStrength + gust) * uDelta * 30.0 * grpWind;
    }
`;
export const VEL_FRAG_FORCE_WIND_VOLUME = /* glsl */ `
    // Wind volume (Phase AL): the same wind field, localised to a
    // placed sphere. The weight is the light falloff (1-(d/R)^2)^2
    // times the volume strength — at the centre with strength 1
    // the contribution equals the global wind's, and outside the
    // radius it is exactly zero. The group gate applies as it
    // does to the global wind.
    if (uWindVolumeEnabled) {
      float wvDist = length(pos - uWindVolumePos);
      float wvFall = 0.0;
      if (uWindVolumeRadius > 0.0 && wvDist < uWindVolumeRadius) {
        float wvQ = (wvDist / uWindVolumeRadius) * (wvDist / uWindVolumeRadius);
        float wvX = 1.0 - wvQ;
        wvFall = wvX * wvX;
      }
      if (wvFall > 0.0) {
        vec3 wvGust = vec3(
          vnoise(pos * 0.01 + replicaSeed + vec3(replicaTime * 0.3, 0.0, 0.0)),
          vnoise(pos * 0.01 + replicaSeed + vec3(1.7, replicaTime * 0.25, 0.0)),
          vnoise(pos * 0.01 + replicaSeed + vec3(0.0, 3.1, replicaTime * 0.2))
        ) * uWindGust;
        vel += (normalize(vec3(uWindX, uWindY, uWindZ) + vec3(0.0001)) * uWindStrength + wvGust)
          * (wvFall * uWindVolumeStrength) * uDelta * 30.0 * grpWind;
      }
    }
`;
export const VEL_FRAG_FORCE_SLOPE = /* glsl */ `
    // Terrain slope flow (Phase AE): run downhill along the
    // terrain gradient, proportional to the local slope. The
    // field is the XZ plane over [-uSlopeExtent, +uSlopeExtent];
    // outside it the edge texels clamp, so the flow follows the
    // border slope instead of vanishing.
    if (uSlopeForceEnabled) {
      vec2 slopeUv = clamp(pos.xz / (2.0 * max(uSlopeExtent, 0.001)) + 0.5, 0.0, 1.0);
      vec3 slopeSample = texture2D(uSlopeTex, slopeUv).rgb;
      vec2 downhill = slopeSample.rg * 2.0 - 1.0;
      vel += vec3(downhill.x, 0.0, downhill.y) * (slopeSample.b * uSlopeForceStrength) * uDelta * 30.0;
    }
`;
export const VEL_FRAG_FORCE_WELL = /* glsl */ `
    // Gravity Well(s). Count 1 keeps the exact legacy single well at
    // the origin; counts 2-4 (B3) place the wells on a slowly rotating
    // ring of radius uWellSpread, each with the same force law.
    if (uWellEnabled) {
      if (uWellCount <= 1) {
        vec3 toCenter = -pos;
        float d = length(toCenter) + uWellSoftening;
        vel += (toCenter / (d * d)) * uWellStrength * uDelta * 2000.0;
        vec3 tangent2 = cross(normalize(toCenter + vec3(0.001, 0.0, 0.0)), vec3(0.0, 1.0, 0.0));
        vel += tangent2 * uWellOrbit * uDelta * 50.0;
      } else {
        for (int wi = 0; wi < 4; wi++) {
          if (wi >= uWellCount) break;
          float wa = uTime * 0.35 + float(wi) * 6.2831853 / float(uWellCount);
          vec3 wellPos = vec3(cos(wa), 0.35 * sin(wa * 1.3), sin(wa)) * uWellSpread;
          vec3 toWell = wellPos - pos;
          float wd = length(toWell) + uWellSoftening;
          vel += (toWell / (wd * wd)) * uWellStrength * uDelta * 2000.0;
          vec3 wellTangent = cross(normalize(toWell + vec3(0.001, 0.0, 0.0)), vec3(0.0, 1.0, 0.0));
          vel += wellTangent * uWellOrbit * uDelta * 50.0;
        }
      }
    }
`;
export const VEL_FRAG_FORCE_ELASTIC = /* glsl */ `
    // Elastic Spring
    if (uElasticEnabled) {
      vel -= pos * uElasticStrength * uDelta * 2.0;
    }
`;
export const VEL_FRAG_FORCE_MAGNETIC = /* glsl */ `
    // Magnetic / Lorentz
    if (uMagneticEnabled) {
      vec3 B = normalize(vec3(uMagneticBX, uMagneticBY, uMagneticBZ) + vec3(0.0001));
      vel += cross(vel, B) * uMagneticStrength * uDelta * 0.8;
    }
`;
export const VEL_FRAG_FORCE_STEER_AVOID = /* glsl */ `
    // General steering avoidance (Phase 15, Houdini §3): the
    // Particle Life avoidance law generalised to every particle,
    // independent of the Life switch — a push along the SDF
    // collider's normal, quadratic in the proximity inside the
    // range (range 0 falls back to 1.5 * the SDF size, the
    // obstacleAvoidForce fallback shape). Strength 0 removes
    // the term entirely (bit-identical). When the Life avoidance
    // is also on, the two add. TS twin: obstacleAvoidForce in
    // lib/particleLifeBehavior.ts.
    if (uSteerAvoid > 0.0 && uSdfEnabled) {
      float sRange = uSteerAvoidRange > 0.0 ? uSteerAvoidRange : max(uSdfSize * 1.5, 1.0);
      float sSd = abSdfDistance(pos);
      if (sSd < sRange) {
        float sw = clamp(1.0 - sSd / sRange, 0.0, 1.0);
        vel += abSdfNormal(pos) * (uSteerAvoid * sw * sw) * uDelta * 45.0;
      }
    }

`;
export const VEL_FRAG_FORCE_STEER_SEEK = /* glsl */ `
    // Crowd steering (Phase 20 stage 2, Houdini §3): the GPU
    // twin of lib/steering.ts — seekForce / arriveForce /
    // pathFollowForce / steeringForState, formula for formula:
    // desired = normalize(target - pos) * maxSpeed (arrive ramps
    // the speed linearly inside the slowing radius), steer =
    // desired - vel, clamped to maxForce only when maxForce > 0.
    // The pass application (steer * strength * uDelta * 60) is
    // the Boids application convention; the force law itself is
    // steering.ts verbatim. Mode 3 (state) reads the attribute
    // slot via the head's attrData fetch: state 0 seeks the
    // target, state 1 arrives at the second target
    // (steeringForState's defaults; stateFromSlot's non-finite
    // case cannot occur — the attribute texture is finite by
    // construction). This chunk exists in the built shader ONLY
    // in the Phase 20 variant (see buildMainForcesFragment):
    // without the variant the assembly is byte-identical.
    if (uSteerSeekEnabled) {
      vec3 sTarget = uSteerSeekTarget;
      int sMode = uSteerSeekMode;
      bool sApply = true;
      if (sMode == 3) {
        float slotValue = kaloAttrChannel(attrData, uSteerSeekStateSlot);
        bool isState1 = slotValue >= uSteerSeekStateThreshold;
        sTarget = isState1 ? uSteerSeekTarget1 : uSteerSeekTarget;
        sMode = isState1 ? 1 : 0;
      }
      if (sMode == 2) {
        // Path following (pathFollowTarget): closest segment
        // projection, advanced lookAhead of arc length.
        if (uSteerSeekPathCount <= 0) {
          sApply = false;
        } else if (uSteerSeekPathCount == 1) {
          sTarget = uSteerSeekPath[0];
        } else {
          float bestDistSq = 1e30;
          float bestArc = 0.0;
          float arcBefore = 0.0;
          for (int i = 0; i < 7; i++) {
            if (i >= uSteerSeekPathCount - 1) break;
            vec3 pa = uSteerSeekPath[i];
            vec3 pb = uSteerSeekPath[i + 1];
            vec3 ab = pb - pa;
            float segLen = length(ab);
            float lenSq = dot(ab, ab);
            float pt = 0.0;
            if (lenSq > 0.0) pt = clamp(dot(pos - pa, ab) / lenSq, 0.0, 1.0);
            vec3 pq = pa + ab * pt;
            vec3 pdq = pos - pq;
            float distSq = dot(pdq, pdq);
            if (distSq < bestDistSq) { bestDistSq = distSq; bestArc = arcBefore + segLen * pt; }
            arcBefore += segLen;
          }
          float targetArc = clamp(bestArc + max(uSteerSeekPathLookAhead, 0.0), 0.0, arcBefore);
          float walkArc = 0.0;
          for (int i = 0; i < 7; i++) {
            if (i >= uSteerSeekPathCount - 1) break;
            vec3 pa = uSteerSeekPath[i];
            vec3 pb = uSteerSeekPath[i + 1];
            float segLen = length(pb - pa);
            if (targetArc <= walkArc + segLen || i == uSteerSeekPathCount - 2) {
              float pt = segLen > 0.0 ? clamp((targetArc - walkArc) / segLen, 0.0, 1.0) : 0.0;
              sTarget = pa + (pb - pa) * pt;
              break;
            }
            walkArc += segLen;
          }
          // PathRadius > 0: steer only outside the corridor.
          if (uSteerSeekPathRadius > 0.0 && sqrt(bestDistSq) <= uSteerSeekPathRadius) sApply = false;
        }
      }
      if (sApply) {
        vec3 toTarget = sTarget - pos;
        float sDist = length(toTarget);
        float effSpeed = uSteerSeekMaxSpeed;
        if (sMode == 1 && uSteerSeekSlowingRadius > 0.0 && sDist < uSteerSeekSlowingRadius) {
          effSpeed = uSteerSeekMaxSpeed * sDist / uSteerSeekSlowingRadius;
        }
        vec3 desired = sDist > 0.0 ? (toTarget / sDist) * effSpeed : vec3(0.0);
        vec3 steerForce = desired - vel;
        if (uSteerSeekMaxForce > 0.0) {
          float fLen = length(steerForce);
          if (fLen > uSteerSeekMaxForce) steerForce *= uSteerSeekMaxForce / fLen;
        }
        vel += steerForce * uSteerSeekStrength * uDelta * 60.0;
      }
    }
`;
export const VEL_FRAG_FORCE_CHUNKS: Record<string, string> = {
  'pyro-buoyancy': VEL_FRAG_FORCE_PYRO_BUOYANCY,
  'turbulence': VEL_FRAG_FORCE_TURBULENCE,
  'audio-blast': VEL_FRAG_FORCE_AUDIO_BLAST,
  'nbody': VEL_FRAG_FORCE_NBODY,
  'curl': VEL_FRAG_FORCE_CURL,
  'pyro-disturbance': VEL_FRAG_FORCE_PYRO_DISTURBANCE,
  'boids': VEL_FRAG_FORCE_BOIDS,
  'kuramoto': VEL_FRAG_FORCE_KURAMOTO,
  'particle-life': VEL_FRAG_FORCE_PARTICLE_LIFE,
  'attractor': VEL_FRAG_FORCE_ATTRACTOR,
  'attractor-2': VEL_FRAG_FORCE_ATTRACTOR2,
  'levy': VEL_FRAG_FORCE_LEVY,
  'vortex': VEL_FRAG_FORCE_VORTEX,
  'wind': VEL_FRAG_FORCE_WIND,
  'wind-volume': VEL_FRAG_FORCE_WIND_VOLUME,
  'slope': VEL_FRAG_FORCE_SLOPE,
  'well': VEL_FRAG_FORCE_WELL,
  'elastic': VEL_FRAG_FORCE_ELASTIC,
  'magnetic': VEL_FRAG_FORCE_MAGNETIC,
  'steer-avoid': VEL_FRAG_FORCE_STEER_AVOID,
  'steer-seek': VEL_FRAG_FORCE_STEER_SEEK,
};
/** Assemble head + force chunks in the given order (names are
 * normalised by lib/gpgpuForceOrder: unknown / duplicate names
 * dropped, missing chunks appended in default order). With no
 * order (or the default order) the result is byte-identical to
 * the historical VEL_FRAG_MAIN_FORCES.
 *
 * Phase 20 stage 2: the 'steer-seek' chunk is variant-gated —
 * it is spliced in only while `options.steeringSeek` is set,
 * because on the target GPU any code-text change breaks
 * bit-identity with the shipped string even when the code never
 * runs (the Phase 19 lesson). Without the option the chunk is
 * skipped wherever the order names it, and the result stays
 * byte-identical to the historical assembly. */
export interface MainForcesVariantOptions {
  steeringSeek?: boolean;
  // Phase 27: the 'attractor-2' chunk is variant-gated the
  // same way — spliced in only while the attractor unit-2
  // enable key is on.
  attractor2?: boolean;
}

export function buildMainForcesFragment(
  order?: string | readonly string[],
  options?: MainForcesVariantOptions,
): string {
  const names = normalizeGpgpuForceOrder(order);
  let out = VEL_FRAG_MAIN_FORCES_HEAD;
  for (const name of names) {
    if (name === 'steer-seek' && !options?.steeringSeek) continue;
    if (name === 'attractor-2' && !options?.attractor2) continue;
    out += VEL_FRAG_FORCE_CHUNKS[name];
  }
  return out;
}

export const VEL_FRAG_MAIN_FORCES = buildMainForcesFragment();
