export const PHYSICS_LAYER_POSITION_LOGIC = `
  // Serial motion chain (free-wiring stage 1): MOTION_MAP codes for the
  // chain's stage 2 / stage 3 for this layer, or -1 when absent. Declared
  // here so every shader that embeds PHYSICS_LOGIC shares the contract.
  uniform float uMotionChainType2;
  uniform float uMotionChainType3;
  // Cross-layer motion routing (free-wiring stage 2, method A): the source
  // layer's full motion stack (stage 1 + its chain) with the source layer's
  // parameters, applied to pos before this layer's own motion. -1 = absent.
  uniform float uMotionRouteType;
  uniform float uMotionRouteChainType2;
  uniform float uMotionRouteChainType3;
  uniform float uRouteSpeed;
  uniform float uRouteAmp;
  uniform float uRouteFreq;
  uniform vec3 uRouteWind;
  uniform float uRouteNoiseScale;
  uniform float uRouteEvolution;
  uniform float uRouteComplexity;
  uniform float uRouteFluidForce;
  uniform float uRouteViscosity;
  uniform float uRouteFidelity;
  uniform float uRouteOctaveMult;
  // Motion graph (free-wiring stage 3): bounded step program after the
  // layer's own stack. Each step: x = motion code, y = input select
  // (0 prev / 1 source / 2 branch), z = blend, w = save-branch flag.
  uniform vec4 uGraphSteps[8];
  uniform float uGraphStepCount;
  // Motion DAG (free-wiring stage 4): a structurally acyclic node program
  // after the graph section. Node i writes register i + 2; register 0 is
  // main (the position entering the DAG) and 1 is source. Each node:
  // x = kind (0 motion / 1 mix / 2 scale / 3 source / 4 copy),
  // y = input A register, z = input B register, w = blend or scale.
  uniform float uWarpEnabled;
  uniform float uWarpAmount;
  uniform float uWarpScale;
  uniform vec4 uDagNodes[16];
  uniform float uDagMotions[16];
  uniform float uDagNodeCount;
  uniform float uDagOutput;
  vec3 dagPick(float idx, vec3 regs[18]) {
    vec3 picked = regs[0];
    for (int ri = 0; ri < 18; ri++) {
      if (float(ri) == idx) picked = regs[ri];
    }
    return picked;
  }
  vec3 calculateLayerPosition(
    vec3 p, vec3 off, float motionType, float t,
    float speed, float amp, float freq, float radius,
    float phase, float rnd, vec3 wind, float noiseScale,
    float evolution, float complexity, float fluidForce, float viscosity,
    float fidelity, float octaveMult, float affectPos,
    float resistance, float moveWithWind, float neighborForce,
    float collisionMode, float collisionRadius, float repulsion,
    float gravity, float boundaryY, float boundaryEnabled, float boundaryBounce,
    float interLayerEnabled, int interLayerColliderCount, vec4 interLayerColliders[MAX_INTER_LAYER_COLLIDERS], float interLayerStrength,
    float interLayerPadding
  ) {
    vec3 pos = p * radius + off;
    if (uWarpEnabled > 0.5) {
      // Domain warp: distort the space the whole motion stack is evaluated
      // in (route / main / chain / graph / DAG all see the warped domain).
      vec3 wp = pos * uWarpScale + vec3(rnd * 7.31, rnd * 3.77, rnd * 9.13);
      vec3 w1 = noiseVec(wp + vec3(0.0, 0.0, t * 0.05));
      vec3 w2 = noiseVec(wp * 2.3 + vec3(5.2, 1.3, 2.8) + vec3(t * 0.03, 0.0, 0.0));
      pos += (w1 + 0.5 * w2) * (uWarpAmount * 0.6667);
    }
    if (uMotionRouteType > -0.5) {
      pos = applyMotion(
        pos, uMotionRouteType, t, uRouteSpeed, uRouteAmp, uRouteFreq, phase, rnd, uRouteWind, uRouteNoiseScale,
        uRouteEvolution, uRouteComplexity, uRouteFluidForce, uRouteViscosity, uRouteFidelity, uRouteOctaveMult
      );
      if (uMotionRouteChainType2 > -0.5) {
        pos = applyMotion(
          pos, uMotionRouteChainType2, t, uRouteSpeed, uRouteAmp, uRouteFreq, phase, rnd, uRouteWind, uRouteNoiseScale,
          uRouteEvolution, uRouteComplexity, uRouteFluidForce, uRouteViscosity, uRouteFidelity, uRouteOctaveMult
        );
      }
      if (uMotionRouteChainType3 > -0.5) {
        pos = applyMotion(
          pos, uMotionRouteChainType3, t, uRouteSpeed, uRouteAmp, uRouteFreq, phase, rnd, uRouteWind, uRouteNoiseScale,
          uRouteEvolution, uRouteComplexity, uRouteFluidForce, uRouteViscosity, uRouteFidelity, uRouteOctaveMult
        );
      }
    }
    vec3 graphSrc = pos;
    vec3 moved = applyMotion(
      pos, motionType, t, speed, amp, freq, phase, rnd, wind, noiseScale,
      evolution, complexity, fluidForce, viscosity, fidelity, octaveMult
    );
    if (uMotionChainType2 > -0.5) {
      moved = applyMotion(
        moved, uMotionChainType2, t, speed, amp, freq, phase, rnd, wind, noiseScale,
        evolution, complexity, fluidForce, viscosity, fidelity, octaveMult
      );
    }
    if (uMotionChainType3 > -0.5) {
      moved = applyMotion(
        moved, uMotionChainType3, t, speed, amp, freq, phase, rnd, wind, noiseScale,
        evolution, complexity, fluidForce, viscosity, fidelity, octaveMult
      );
    }
    pos = mix(pos, moved, clamp(affectPos, 0.0, 1.0));
    if (uGraphStepCount > 0.5) {
      vec3 gMain = pos;
      vec3 gBranch = pos;
      for (int gi = 0; gi < 8; gi++) {
        if (float(gi) >= uGraphStepCount) break;
        vec4 gst = uGraphSteps[gi];
        if (gst.w > 0.5) gBranch = gMain;
        vec3 gIn = gst.y < 0.5 ? gMain : (gst.y < 1.5 ? graphSrc : gBranch);
        vec3 gMoved = applyMotion(
          gIn, gst.x, t, speed, amp, freq, phase, rnd, wind, noiseScale,
          evolution, complexity, fluidForce, viscosity, fidelity, octaveMult
        );
        gMain = mix(gMain, gMoved, gst.z);
      }
      pos = gMain;
    }
    if (uDagNodeCount > 0.5) {
      vec3 dRegs[18];
      dRegs[0] = pos;
      dRegs[1] = graphSrc;
      for (int ni = 0; ni < 16; ni++) {
        if (float(ni) >= uDagNodeCount) break;
        vec4 nd = uDagNodes[ni];
        vec3 dA = dagPick(nd.y, dRegs);
        vec3 dOut;
        if (nd.x < 0.5) {
          dOut = applyMotion(
            dA, uDagMotions[ni], t, speed, amp, freq, phase, rnd, wind, noiseScale,
            evolution, complexity, fluidForce, viscosity, fidelity, octaveMult
          );
        } else if (nd.x < 1.5) {
          dOut = mix(dA, dagPick(nd.z, dRegs), nd.w);
        } else if (nd.x < 2.5) {
          dOut = dA * nd.w;
        } else if (nd.x < 3.5) {
          dOut = graphSrc;
        } else {
          dOut = dA;
        }
        dRegs[ni + 2] = dOut;
      }
      pos = dagPick(uDagOutput, dRegs);
    }
    pos += wind * moveWithWind * t * 0.025;
    pos.y -= gravity * 0.01 * t;

    if (neighborForce != 0.0) {
      pos += normalize(noiseVec(pos * 0.03 + t * 0.3 + rnd) + vec3(0.0001)) * neighborForce * 0.12;
    }

    if (collisionMode > 0.5) {
      float worldRadius = max(1.0, collisionRadius);
      float lenPos = length(pos);
      if (lenPos > worldRadius) {
        vec3 dir = normalize(pos);
        pos = dir * worldRadius - dir * repulsion * 0.01;
      }
    }

    if (boundaryEnabled > 0.5 && pos.y < boundaryY) {
      pos.y = mix(boundaryY, boundaryY + abs(pos.y - boundaryY) * max(0.0, boundaryBounce), 0.75);
    }

    if (interLayerEnabled > 0.5) {
      for (int colliderIndex = 0; colliderIndex < MAX_INTER_LAYER_COLLIDERS; colliderIndex++) {
        if (colliderIndex >= interLayerColliderCount) break;
        vec4 collider = interLayerColliders[colliderIndex];
        float colliderRadius = collider.w;
        if (colliderRadius <= 0.0) continue;
        vec3 delta = pos - collider.xyz;
        float dist = length(delta);
        float reach = colliderRadius + interLayerPadding;
        if (dist < reach) {
          vec3 dir = dist > 0.0001 ? delta / dist : normalize(hash3(rnd + float(colliderIndex)) * 2.0 - 1.0 + vec3(0.0001));
          float overlap = 1.0 - clamp(dist / max(0.0001, reach), 0.0, 1.0);
          pos += dir * overlap * interLayerStrength * 0.1;
        }
      }
    }

    pos *= max(0.0, 1.0 - resistance * 0.025);
    return pos;
  }
`;
