import { LIGHT_SHADOW_GLSL } from '../lib/lightShadowMap';

// Aux event emission shaders (Kinetix integration B3).
//
// A second, fixed-size GPU particle pool (128x128 texels, of which
// gpgpuAuxCount are live slots) whose particles are spawned by EVENTS
// in the main GPGPU pool — the GPU-closed equivalent of Kinetix's
// auxMode (deathBurst / bounceSplash / sparkTrail):
//
// - Each aux slot watches a contiguous chunk of main particles
//   (mainCount / auxCount of them, up to 8 sampled candidates).
// - deathBurst: a candidate whose age wraps this frame (age + dt >=
//   ageMax, evaluated on the main position texture BEFORE this frame's
//   update, so the burst sits exactly at the death position) spawns a
//   burst with probability 0.25 * intensity (Kinetix's gate).
// - bounceSplash: a candidate touching the sphere bound with outward
//   velocity, or the floor plane with downward velocity, splashes with
//   probability 0.35 * intensity (Kinetix's gate). Phase 20 stage 4
//   (UE5 #22) adds a third contact source in the PHASE20 variant
//   strings only: the analytic SDF collider — a candidate inside the
//   velocity pass's reflection band (sd < 2.0) moving into the
//   surface (normal velocity < -2.0) splashes along the SDF normal
//   under the same 0.35 gate. The default strings stay
//   byte-identical to v2.01.0; see buildAuxEventGlsl.
// - sparkTrail: the slot's primary candidate continuously sheds
//   sparks; spawning happens on the slot's own recycle with a hash
//   gate, and the spark velocity is sourceVel * 0.15 + hash spread
//   (Kinetix's allocateSlot call for sparkTrail).
// - birthBurst (Phase AB): a candidate whose age restarted at ~0
//   on the previous frame — it (re)spawned through the main pool's
//   shared respawn block (age wrap, spawn-gate activation, kill) —
//   emits a gentle burst at its new position, with probability
//   0.35 * intensity. Modes 0-2 above are byte-untouched.
// - emit (Grammar 2.0 stage 1, slice 1D-2, mode 5): a LIVING
//   candidate is an emitter — it sheds this pool's particles at
//   an emission rate (per second, rolled per 60 Hz tick as
//   rate/60 on the shared gate hash) with a shaped velocity
//   distribution (sphere / cone / disc / point; lib/auxEmit.ts
//   is the semantics' source of truth). The emit text lives
//   only in the emit variant built by buildAuxEventGlsl /
//   buildAuxChainEventGlsl — every other configuration
//   assembles the stock strings byte-for-byte.
// - ruleSpawn (Grammar 2.0 stage 1, slice 1D-3, mode 4): a
//   candidate whose live-rule mask (the REP output, bound as
//   uMainRuleTex) carries the spawn pulse (bit 13) on this
//   frame spawns a child at its position, under the shared
//   hash gate capped by the level's intensity — the rule
//   decides whether, the Aux gate decides how many
//   (lib/auxRuleSpawn.ts is the semantics' source of truth).
//   LEVEL 1 ONLY: the REP exists only for the main pool, so
//   the ruleSpawn text lives only in the level-1 variant
//   built by buildAuxEventGlsl; the chain builders carry no
//   ruleSpawn option at all.
//
// State layout mirrors the main sim: position texture (xyz + age in
// w) and velocity texture (xyz + per-particle life in w). A particle
// is inactive while age >= life (initial state: age 10, life 0). The
// velocity pass decides spawning (it owns the burst velocity and the
// new life); the position pass re-evaluates the identical event test
// — same uniforms, same main textures, same hash of (slot, 60Hz tick)
// — to place the particle, so the two passes can never disagree.
// Everything stays on the GPU: no readback, no CPU neighbour work.

export const AUX_TEX_SIZE = 128;

// The event chunk is composed from verbatim segments in the
// Phase 19/20 manner (cf. buildDrawVert): the default assembly
// is byte-identical to the shipped v2.01.0 chunk, and the Phase
// 20 SDF-splash segments splice in only in the variant built
// by buildAuxEventGlsl({ sdfSplash: true }).
const AUX_EVENT_UNIFORMS = /* glsl */ `
  uniform sampler2D uMainPosTex;
  uniform sampler2D uMainVelTex;
  uniform float uMainTexSizeF;
  uniform float uAuxCount;
  uniform int   uAuxMode;
  uniform float uAuxIntensity;
  uniform float uAuxSpeed;
  uniform bool  uAgeEnabled;
  uniform float uAgeMax;
  uniform bool  uFloorEnabled;
  uniform float uFloorY;
  uniform float uBounceRadius;
`;
const AUX_SDF_UNIFORMS = /* glsl */ `  uniform bool  uSdfEnabled;
  uniform int   uSdfShape;
  uniform float uSdfX;
  uniform float uSdfY;
  uniform float uSdfZ;
  uniform float uSdfSize;
`;
const AUX_EVENT_HASH = /* glsl */ `
  float auxHash(float n) { vec3 p3 = fract(vec3(n) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yxz + 33.33); return fract((p3.x + p3.y) * p3.z); }
  vec3 auxHash3(float n) {
    return vec3(auxHash(n + 0.13), auxHash(n + 17.71), auxHash(n + 41.37)) - 0.5;
  }
`;
// Child emitter (slice 1D-2): the emit variant's extra uniforms
// and velocity shaping. The shaping mirrors the CPU twin
// auxEmitVelocity (lib/auxEmit.ts) term for term — same speed
// factor (the legacy 0.35 + 0.65 h distribution), same
// thresholds, same fallbacks. h3 is an auxHash3 sample in
// [-0.5, 0.5]^3; hA drives the speed factor (and nothing else),
// hB is the disc angle.
const AUX_EMIT_UNIFORMS = /* glsl */ `  uniform float uAuxEmitRate;
  uniform int   uAuxEmitShape;
  uniform float uAuxEmitSpread;
`;
const AUX_EMIT_VELOCITY_GLSL = /* glsl */ `
  vec3 auxEmitVelocity(vec3 parentVel, vec3 h3, float hA, float hB) {
    float mag = uAuxSpeed * (0.35 + 0.65 * hA);
    if (uAuxEmitShape == 3) {
      // point: almost no velocity — the child is placed at the
      // emitter and drifts on a hash whisper.
      return h3 * uAuxSpeed * 0.04;
    }
    if (uAuxEmitShape == 0) {
      // sphere: all directions, the legacy burst distribution.
      float dl = length(h3);
      vec3 dir = dl > 0.01 ? h3 / dl : vec3(0.0, 1.0, 0.0);
      return dir * mag;
    }
    float pl = length(parentVel);
    vec3 axis;
    if (pl > 0.001) {
      axis = parentVel / pl;
    } else {
      float hl = length(h3);
      axis = hl > 0.01 ? h3 / hl : vec3(0.0, 1.0, 0.0);
    }
    if (uAuxEmitShape == 1) {
      // cone: around the parent's direction; the spread widens
      // it (0 = straight ahead along the axis).
      vec3 dir = axis + h3 * (uAuxEmitSpread * 2.0);
      float dl2 = length(dir);
      dir = dl2 > 0.001 ? dir / dl2 : axis;
      return dir * mag;
    }
    // disc: velocities in the plane perpendicular to the
    // parent's direction; the spread is the axial thickness.
    vec3 helper = abs(axis.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
    vec3 bu = normalize(cross(axis, helper));
    vec3 bv = cross(axis, bu);
    float ang = hB * 6.2831853;
    vec3 planar = bu * cos(ang) + bv * sin(ang);
    return planar * mag + axis * (h3.x * uAuxEmitSpread * uAuxSpeed * 0.5);
  }
`;
// Spliced in front of the mode-0 dispatch in the emit variant
// of the event body only (the stock body is untouched).
const AUX_EVENT_EMIT_BRANCH = /* glsl */ `      if (uAuxMode == 5) {
        // emit (slice 1D-2): the candidate is a living emitter.
        // The main pool is alive while its age is below ageMax;
        // with the age system off every candidate is alive. The
        // per-tick gate probability is the emission rate
        // converted from per-second (rate/60 at the 60 Hz tick),
        // rolled on the shared (slot, tick, candidate) gate.
        bool emitAlive = !uAgeEnabled || mPos.w < uAgeMax;
        if (emitAlive && gate < clamp(uAuxEmitRate / 60.0, 0.0, 1.0)) {
          vec4 mVel = texture2D(uMainVelTex, srcUv);
          gAuxSpawnVel = auxEmitVelocity(
            mVel.xyz,
            auxHash3(auxIdx * 8.53 + tick * 1.37),
            auxHash(auxIdx * 5.97 + tick),
            auxHash(auxIdx * 9.31 + tick * 0.71));
          return vec4(mPos.xyz, 1.0);
        }
      }
`;
// Trail mechanism (Limit plan stage 4, slice S6): the trail
// variant's extra uniforms and dispatch branch. The branch
// mirrors the CPU twin in lib/trailAux.ts term for term —
// same candidate (candidate 0 of the slot's chunk, the
// sparkTrail mapping), same emit-tick phase test, same rate
// gate on the shared (slot, tick, candidate) hash. The child
// inherits the parent's velocity through the sparkTrail
// coefficient (0.15), so the inherit-scale variant rewrites
// it exactly as it does for sparkTrail; its attribute slots
// and species are recorded by the inheritance write pass,
// which re-evaluates this same branch. The life comes from
// uAuxLife, which the passes feed with the resolved trail
// life while this mode drives the pool.
const AUX_TRAIL_UNIFORMS = /* glsl */ `  uniform float uTrailEmitInterval;
  uniform float uTrailEmitRate;
`;
// Trail A/B minimisations (stage-4 gate fix round 6,
// STAGE4_FIX11_AUX_AB_RECORD): diag-only variants of the
// trail branch above, selected through the builders'
// `trailAb` option. The G4-5 triage separated the fault to
// "in steady state the event test never fires, although
// the tick walks all residues, the passes render, and the
// landing samples agree with the pool readback" — the
// remaining candidate is the compiled program's behaviour
// (candidate (a)). Each B stage removes exactly one element
// of the stock branch (or reformulates exactly one), so a
// real-GPU run can isolate which element the compiled
// program mishandles:
//
//   A  — the stock branch, verbatim (no marker).
//   B1 — force-fire: no condition at all. Tests the whole
//        downstream contract (ev.w, the velocity pass's
//        life write, the position pass's placement) plus
//        the loop's main-texture reads. If B1 does not
//        spawn, the fault is BELOW the branch's conditions.
//   B2 — tick phase only (mod / floor evaluation of
//        `mod(tick - trailPhase, interval) < 0.5`).
//   B3 — gate only (the shared gate hash + clamp +
//        uTrailEmitRate read).
//   B4 — parent aliveness only (uAgeEnabled / uAgeMax
//        uniform reads + the candidate's mPos.w read).
//   B5 — stock conditions, but the spawn velocity is a
//        constant: the branch's OWN uMainVelTex read is
//        the only element removed.
//   B6 — stock conditions, but the tick phase is computed
//        with the positive-safe double-mod formulation.
//        Separates "the mod() evaluation form" (B6 fires,
//        A/B2 do not) from "the tick value this program
//        sees" (B6 also silent).
//
// Every B branch carries an `aux-trail-ab-stage: Bx`
// marker comment so the diag hook can read the APPLIED
// stage back from the live materials' fragment strings.
// The stock branch carries no marker, and no builder emits
// a B branch unless `trailAb` names one — at the default
// (option absent, or 'A') every assembled string is the
// stock one byte-for-byte.
export type AuxTrailAbStage = 'A' | 'B1' | 'B2' | 'B3' | 'B4' | 'B5' | 'B6';
export const AUX_TRAIL_AB_STAGES: readonly AuxTrailAbStage[] = ['A', 'B1', 'B2', 'B3', 'B4', 'B5', 'B6'];
const AUX_EVENT_TRAIL_BRANCH_AB: Record<Exclude<AuxTrailAbStage, 'A'>, string> = {
  B1: /* glsl */ `      if (uAuxMode == 6) {
        // aux-trail-ab-stage: B1 (force-fire: no tick / alive / gate condition)
        if (s == 0) {
          vec4 mVel = texture2D(uMainVelTex, srcUv);
          gAuxSpawnVel = mVel.xyz * 0.15;
          return vec4(mPos.xyz, 1.0);
        }
        break;
      }
`,
  B2: /* glsl */ `      if (uAuxMode == 6) {
        // aux-trail-ab-stage: B2 (tick phase only)
        if (s == 0) {
          float trailInterval = max(uTrailEmitInterval, 1.0);
          float trailPhase = mod(auxIdx, trailInterval);
          bool trailTick = mod(tick - trailPhase, trailInterval) < 0.5;
          if (!trailTick) break;
          vec4 mVel = texture2D(uMainVelTex, srcUv);
          gAuxSpawnVel = mVel.xyz * 0.15;
          return vec4(mPos.xyz, 1.0);
        }
        break;
      }
`,
  B3: /* glsl */ `      if (uAuxMode == 6) {
        // aux-trail-ab-stage: B3 (gate only)
        if (s == 0) {
          if (gate >= clamp(uTrailEmitRate, 0.0, 1.0)) break;
          vec4 mVel = texture2D(uMainVelTex, srcUv);
          gAuxSpawnVel = mVel.xyz * 0.15;
          return vec4(mPos.xyz, 1.0);
        }
        break;
      }
`,
  B4: /* glsl */ `      if (uAuxMode == 6) {
        // aux-trail-ab-stage: B4 (parent aliveness only)
        if (s == 0) {
          bool trailAlive = !uAgeEnabled || mPos.w < uAgeMax;
          if (!trailAlive) break;
          vec4 mVel = texture2D(uMainVelTex, srcUv);
          gAuxSpawnVel = mVel.xyz * 0.15;
          return vec4(mPos.xyz, 1.0);
        }
        break;
      }
`,
  B5: /* glsl */ `      if (uAuxMode == 6) {
        // aux-trail-ab-stage: B5 (stock conditions, no uMainVelTex read in branch)
        if (s == 0) {
          float trailInterval = max(uTrailEmitInterval, 1.0);
          float trailPhase = mod(auxIdx, trailInterval);
          bool trailTick = mod(tick - trailPhase, trailInterval) < 0.5;
          bool trailAlive = !uAgeEnabled || mPos.w < uAgeMax;
          if (!trailTick || !trailAlive || gate >= clamp(uTrailEmitRate, 0.0, 1.0)) break;
          gAuxSpawnVel = vec3(0.0);
          return vec4(mPos.xyz, 1.0);
        }
        break;
      }
`,
  B6: /* glsl */ `      if (uAuxMode == 6) {
        // aux-trail-ab-stage: B6 (tick phase via positive-safe double-mod)
        if (s == 0) {
          float trailInterval = max(uTrailEmitInterval, 1.0);
          float trailPhase = mod(auxIdx, trailInterval);
          float trailPhaseMod = mod(tick - trailPhase, trailInterval);
          bool trailTick = mod(trailPhaseMod + trailInterval, trailInterval) < 0.5;
          bool trailAlive = !uAgeEnabled || mPos.w < uAgeMax;
          if (!trailTick || !trailAlive || gate >= clamp(uTrailEmitRate, 0.0, 1.0)) break;
          vec4 mVel = texture2D(uMainVelTex, srcUv);
          gAuxSpawnVel = mVel.xyz * 0.15;
          return vec4(mPos.xyz, 1.0);
        }
        break;
      }
`,
};
function auxTrailBranchForStage(stage?: AuxTrailAbStage): string {
  if (!stage || stage === 'A') return AUX_EVENT_TRAIL_BRANCH;
  return AUX_EVENT_TRAIL_BRANCH_AB[stage];
}
const AUX_EVENT_TRAIL_BRANCH = /* glsl */ `      if (uAuxMode == 6) {
        // trail (stage 4, S6): candidate 0 is this slot's
        // parent. The slot sheds on its OWN emit tick — the
        // tick phase is offset by the slot's phase so the
        // pool does not fire in one global burst — gated by
        // the shared gate hash against the emit rate, and
        // only while the parent is living (the emit mode's
        // aliveness rule). The parent of a slot is a pure
        // function of the slot index (the chunk arithmetic
        // above), so no parent id is stored anywhere: the
        // Ribbon rebuild groups by trailAuxParentIndex.
        if (s == 0) {
          float trailInterval = max(uTrailEmitInterval, 1.0);
          // FIX13 (stage-4 gate fix round 8): the phase test
          // is phrased boundary-avoiding — mod(tick - auxIdx
          // + 0.5, trailInterval) < 1.0 — in place of the
          // original two-step form (trailPhase = mod(auxIdx,
          // trailInterval); mod(tick - trailPhase,
          // trailInterval) < 0.5). For integer tick / auxIdx
          // the two are exactly equivalent (the test fires
          // iff (tick - auxIdx) is a multiple of the
          // interval — the CPU twin isTrailEmitTick in
          // lib/trailAux.ts, pinned equivalent by the S6
          // test), but the original fed exact multiples of a
          // non-power-of-2 interval (6) into mod(), where
          // the ANGLE/Metal fast reciprocal evaluates
          // mod(6k, 6.0) as 6.0 instead of 0.0: slots with
          // auxIdx = 6, 12, ... took phase 6.0 and the test
          // was permanently false in steady state (measured
          // on the real GPU in gate phase 8 — the declared
          // phase column read [0,1,2,3,4,5,6,1]; see
          // STAGE4_FIX13_RCP_MOD_RECORD). The shifted form's
          // mod argument is always a half-integer, never an
          // exact multiple, so the floor inside mod() never
          // sits on its discontinuity.
          bool trailTick = mod(tick - auxIdx + 0.5, trailInterval) < 1.0;
          bool trailAlive = !uAgeEnabled || mPos.w < uAgeMax;
          if (!trailTick || !trailAlive || gate >= clamp(uTrailEmitRate, 0.0, 1.0)) break;
          vec4 mVel = texture2D(uMainVelTex, srcUv);
          gAuxSpawnVel = mVel.xyz * 0.15;
          return vec4(mPos.xyz, 1.0);
        }
        break;
      }
`;
// Grammar connection (slice 1D-3): the ruleSpawn variant's
// REP binding and dispatch branch. The bit test mirrors the
// CPU twin auxRuleMaskHasSpawn (lib/auxRuleSpawn.ts); the
// burst velocity is the shared burst distribution (the
// deathBurst form), rolled on ruleSpawn's own hash constants.
const AUX_RULE_SPAWN_UNIFORMS = /* glsl */ `  uniform sampler2D uMainRuleTex;
`;
const AUX_EVENT_RULE_SPAWN_BRANCH = /* glsl */ `      if (uAuxMode == 4) {
        // ruleSpawn (slice 1D-3): the candidate's REP mask
        // carries the spawn pulse on bit 13 for exactly the
        // evaluations whose spawn rule matched (a pulse —
        // it never latches). The intensity-capped hash gate
        // ANDs with the pulse: the rule fires the candidate,
        // the gate thins the density.
        vec4 ruleData = texture2D(uMainRuleTex, srcUv);
        float spawnPulse = mod(floor(ruleData.r / 8192.0), 2.0);
        if (spawnPulse > 0.5 && gate < clamp(uAuxIntensity, 0.0, 1.0)) {
          vec3 dir = auxHash3(auxIdx * 2.71 + tick * 0.617);
          float dl = length(dir);
          dir = dl > 0.01 ? dir / dl : vec3(0.0, 1.0, 0.0);
          gAuxSpawnVel = dir * uAuxSpeed * (0.35 + 0.65 * auxHash(auxIdx * 4.13 + tick));
          return vec4(mPos.xyz, 1.0);
        }
      }
`;
const AUX_SDF_EVAL_GLSL = /* glsl */ `
  // SDF collider evaluation for the bounceSplash event test
  // (Phase 20 stage 4, UE5 #22). The formulas mirror the velocity
  // pass's collider block (gpgpuShaderSimulationVelocityMainTail)
  // shape for shape; that copy is inline in the hash-pinned
  // velocity string and the position pass keeps its own inline
  // copy for the same reason, so this chunk is the Aux program's
  // copy rather than a shared import. Returns the signed
  // distance; n receives the surface normal.
  float auxGyroidField(vec3 p, vec3 sc, float size) {
    vec3 q = (p - sc) * (3.14159265 / max(size, 1.0));
    return sin(q.x) * cos(q.y) + sin(q.y) * cos(q.z) + sin(q.z) * cos(q.x);
  }
  vec3 auxGyroidNormal(vec3 p, vec3 sc, float size) {
    vec3 q = (p - sc) * (3.14159265 / max(size, 1.0));
    vec3 g = vec3(
      cos(q.x) * cos(q.y) - sin(q.z) * sin(q.x),
      cos(q.y) * cos(q.z) - sin(q.x) * sin(q.y),
      cos(q.z) * sin(q.x) - sin(q.y) * sin(q.z)
    );
    return normalize(g + vec3(0.0001));
  }
  float auxSdfEval(vec3 p, out vec3 n) {
    vec3 sc = vec3(uSdfX, uSdfY, uSdfZ);
    float sd;
    if (uSdfShape == 0) {
      sd = length(p - sc) - uSdfSize;
      n = normalize(p - sc + vec3(0.0001));
    } else if (uSdfShape == 1) {
      vec3 q = abs(p - sc) - vec3(uSdfSize);
      sd = length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
      vec3 dq = p - sc; vec3 aq = abs(dq); vec3 dd = aq - vec3(uSdfSize);
      if (max(dd.x, max(dd.y, dd.z)) > 0.0) n = normalize(max(dd, 0.0) * sign(dq));
      else if (dd.x > dd.y && dd.x > dd.z) n = vec3(sign(dq.x), 0.0, 0.0);
      else if (dd.y > dd.z) n = vec3(0.0, sign(dq.y), 0.0);
      else n = vec3(0.0, 0.0, sign(dq.z));
    } else if (uSdfShape == 2) {
      vec3 lp = p - sc; float r2 = uSdfSize * 0.35;
      float ringD = length(lp.xz) - uSdfSize;
      sd = length(vec2(ringD, lp.y)) - r2;
      float lxz = length(lp.xz) + 0.001;
      n = normalize(vec3(lp.x / lxz * ringD, lp.y, lp.z / lxz * ringD));
    } else if (uSdfShape == 4) {
      sd = auxGyroidField(p, sc, uSdfSize) * uSdfSize * 0.227;
      n = auxGyroidNormal(p, sc, uSdfSize);
    } else {
      float yc = clamp(p.y - sc.y, -uSdfSize, uSdfSize);
      vec3 dp = vec3(p.x - sc.x, p.y - sc.y - yc, p.z - sc.z);
      sd = length(dp) - uSdfSize * 0.4;
      n = normalize(dp + vec3(0.0001));
    }
    return sd;
  }
`;
const AUX_EVENT_BODY_A = /* glsl */ `
  vec3 gAuxSpawnVel;

  // Scans this slot's candidate sources for the mode's event. Returns
  // the event position in xyz and 1.0 in w when an event fired and
  // passed the probability gate; gAuxSpawnVel then holds the burst
  // velocity for the spawn.
  vec4 findAuxEvent(float auxIdx, float delta, float time) {
    float mainCount = uMainTexSizeF * uMainTexSizeF;
    float chunk = max(1.0, floor(mainCount / max(uAuxCount, 1.0)));
    float srcBase = auxIdx * chunk;
    if (uAuxCount > mainCount) { srcBase = mod(auxIdx, mainCount); chunk = 1.0; }
    float stride = max(1.0, floor(chunk / 8.0));
    float tick = floor(time * 60.0);
    for (int s = 0; s < 8; s++) {
      float srcIdx = srcBase + float(s) * stride;
      if (srcIdx >= mainCount) break;
      vec2 srcUv = (vec2(mod(srcIdx, uMainTexSizeF), floor(srcIdx / uMainTexSizeF)) + 0.5) / uMainTexSizeF;
      vec4 mPos = texture2D(uMainPosTex, srcUv);
      float gate = auxHash(auxIdx * 3.71 + tick * 13.13 + float(s) * 7.7);
      if (uAuxMode == 2) {
        // sparkTrail: candidate 0 is the shedder. The caller's recycle
        // check sets the cadence; this hash only thins the density.
        if (s == 0) {
          if (gate >= clamp(0.9 * uAuxIntensity, 0.0, 1.0)) break;
          vec4 mVel = texture2D(uMainVelTex, srcUv);
          gAuxSpawnVel = mVel.xyz * 0.15 + auxHash3(auxIdx * 1.31 + tick) * uAuxSpeed * 0.55;
          return vec4(mPos.xyz, 1.0);
        }
        break;
      }
      if (uAuxMode == 3) {
        // birthBurst (Phase AB): the candidate (re)spawned on the
        // previous frame — its age restarted at ~0 through the
        // shared respawn block (age wrap, spawn-gate activation or
        // a kill), the same signal the morph kick envelope reads.
        // The window is 0.75 * delta so each birth fires on exactly
        // one frame start. The burst sits at the particle's current
        // position, one frame of motion past the emit point.
        if (uAgeEnabled && mPos.w < delta * 0.75 && gate < 0.35 * uAuxIntensity) {
          vec4 mVel = texture2D(uMainVelTex, srcUv);
          vec3 dir = auxHash3(auxIdx * 4.31 + tick * 1.113);
          float dl = length(dir);
          dir = dl > 0.01 ? dir / dl : vec3(0.0, 1.0, 0.0);
          gAuxSpawnVel = mVel.xyz * 0.25 + dir * uAuxSpeed * (0.2 + 0.3 * auxHash(auxIdx * 6.7 + tick));
          return vec4(mPos.xyz, 1.0);
        }
      }
      if (uAuxMode == 0) {
        // deathBurst: age wrap this frame (mPos.w is the pre-update age).
        if (uAgeEnabled && mPos.w + delta >= uAgeMax && gate < 0.25 * uAuxIntensity) {
          vec3 dir = auxHash3(auxIdx * 2.17 + tick * 0.913);
          float dl = length(dir);
          dir = dl > 0.01 ? dir / dl : vec3(0.0, 1.0, 0.0);
          gAuxSpawnVel = dir * uAuxSpeed * (0.35 + 0.65 * auxHash(auxIdx * 5.3 + tick));
          return vec4(mPos.xyz, 1.0);
        }
      } else if (uAuxMode == 1) {
        // bounceSplash: sphere-bound or floor contact this frame.
        vec4 mVel = texture2D(uMainVelTex, srcUv);
        float d = length(mPos.xyz);
        vec3 n = d > 0.001 ? mPos.xyz / d : vec3(0.0, 1.0, 0.0);
`;
const AUX_EVENT_SPLASH_TESTS = /* glsl */ `        bool sphereHit = d > uBounceRadius * 0.985 && dot(mVel.xyz, n) > 2.0;
        bool floorHit = uFloorEnabled && mPos.y < uFloorY + 1.5 && mVel.xyz.y < -2.0;
        if ((sphereHit || floorHit) && gate < 0.35 * uAuxIntensity) {
`;
const AUX_EVENT_SPLASH_TESTS_SDF = /* glsl */ `        bool sphereHit = d > uBounceRadius * 0.985 && dot(mVel.xyz, n) > 2.0;
        bool floorHit = uFloorEnabled && mPos.y < uFloorY + 1.5 && mVel.xyz.y < -2.0;
        bool sdfHit = false;
        vec3 sdfN = vec3(0.0, 1.0, 0.0);
        if (uSdfEnabled) {
          float sd = auxSdfEval(mPos.xyz, sdfN);
          sdfHit = sd < 2.0 && dot(mVel.xyz, sdfN) < -2.0;
        }
        vec3 splashN = sdfHit && !sphereHit ? sdfN : n;
        if ((sphereHit || floorHit || sdfHit) && gate < 0.35 * uAuxIntensity) {
`;
const AUX_EVENT_SPLASH_BODY = /* glsl */ `          vec3 jitter = auxHash3(auxIdx * 3.97 + tick * 1.71);
          if (floorHit) {
            gAuxSpawnVel = vec3(jitter.x * 1.2, 0.55 + 0.65 * auxHash(auxIdx * 7.9 + tick), jitter.z * 1.2) * uAuxSpeed * 0.8;
            return vec4(vec3(mPos.x, uFloorY + 0.3, mPos.z), 1.0);
          }
`;
const AUX_EVENT_SPLASH_VEL = /* glsl */ `          gAuxSpawnVel = (n * (0.5 + auxHash(auxIdx * 9.1 + tick)) + jitter * 0.9) * uAuxSpeed * 0.7;
`;
const AUX_EVENT_SPLASH_VEL_SDF = /* glsl */ `          gAuxSpawnVel = (splashN * (0.5 + auxHash(auxIdx * 9.1 + tick)) + jitter * 0.9) * uAuxSpeed * 0.7;
`;
const AUX_EVENT_BODY_B = /* glsl */ `          return vec4(mPos.xyz, 1.0);
        }
      }
    }
    return vec4(0.0, 0.0, 0.0, 0.0);
  }
`;

export interface AuxShaderVariantOptions {
  // Phase 20 stage 4 (UE5 #22): bounceSplash also fires on the
  // analytic SDF collider. Selected only while the SDF collider
  // is enabled AND the aux mode is bounceSplash (see
  // auxSdfSplashActive in lib/auxChain.ts), so the SDF text is
  // absent from the assembled shader in every other configuration.
  sdfSplash?: boolean;
  // Child emitter (Grammar 2.0 stage 1, slice 1D-2): the emit
  // mode's uniforms, velocity shaping and dispatch branch are
  // spliced into the event chunk. Selected only while the
  // level's mode is 'emit' (see auxEmitLevel1Active /
  // auxEmitChainActive in lib/auxEmit.ts), so the emit text is
  // absent from the assembled shader in every other
  // configuration and the stock strings stay byte-identical.
  emit?: boolean;
  // Spawn inheritance (Grammar 2.0 stage 1, slice 1D-1): the two
  // legacy parent-velocity coefficients (sparkTrail 0.15 /
  // birthBurst 0.25 in the event chunk) are scaled by
  // uAuxInheritVelScale. Selected only while inheritance is on
  // AND the scale differs from 1 (see auxInheritVelScaleActive
  // in lib/auxInherit.ts), so at the default the assembled
  // string is the stock one byte-for-byte; at scale 1 the
  // variant would still evaluate identically (x * 1.0 is exact).
  inheritVelScale?: boolean;
  // Grammar connection (Grammar 2.0 stage 1, slice 1D-3): the
  // ruleSpawn mode's REP binding (uMainRuleTex) and mode-4
  // dispatch branch are spliced into the event chunk. Selected
  // only while the level-1 mode is 'ruleSpawn' (see
  // auxRuleSpawnLevel1Active in lib/auxRuleSpawn.ts). LEVEL 1
  // ONLY by construction: the chain builders below accept no
  // ruleSpawn option — the REP exists only for the main pool,
  // so a chain source has no rule mask to sample.
  ruleSpawn?: boolean;
  // Trail mechanism (Limit plan stage 4, slice S6): the
  // trail mode's uniforms and mode-6 dispatch branch are
  // spliced into the event chunk. Selected only while the
  // Aux-type trail drives the level-1 pool (see
  // trailAuxActive in lib/trailAux.ts), so the trail text is
  // absent from the assembled shader in every other
  // configuration and the stock strings stay byte-identical.
  // LEVEL 1 ONLY, like ruleSpawn: the trail's parents live
  // in the main pool, so the chain builders accept no trail
  // option.
  trail?: boolean;
  // Trail A/B minimisation (stage-4 gate fix round 6):
  // DIAG ONLY — replaces the trail branch with one of the
  // hypothesis-isolating minimisations above. Selected only
  // through the ?diag=1 hook's stage switch
  // (lib/auxTrailAbDiag.ts, driven from
  // useGpgpuSimulationAssets); no product code path passes
  // it, and 'A' / absent reproduces the stock branch
  // byte-for-byte. Meaningful only together with `trail`.
  trailAb?: AuxTrailAbStage;
}

export function buildAuxEventGlsl(options?: AuxShaderVariantOptions): string {
  const sdf = !!options?.sdfSplash;
  const emit = !!options?.emit;
  const ruleSpawn = !!options?.ruleSpawn;
  const trail = !!options?.trail;
  let bodyA = AUX_EVENT_BODY_A;
  if (emit) {
    bodyA = bodyA.replace(
      '      if (uAuxMode == 0) {',
      () => AUX_EVENT_EMIT_BRANCH + '      if (uAuxMode == 0) {',
    );
  }
  if (ruleSpawn) {
    bodyA = bodyA.replace(
      '      if (uAuxMode == 0) {',
      () => AUX_EVENT_RULE_SPAWN_BRANCH + '      if (uAuxMode == 0) {',
    );
  }
  if (trail) {
    bodyA = bodyA.replace(
      '      if (uAuxMode == 0) {',
      () => auxTrailBranchForStage(options?.trailAb) + '      if (uAuxMode == 0) {',
    );
  }
  return AUX_EVENT_UNIFORMS
    + (sdf ? AUX_SDF_UNIFORMS : '')
    + (ruleSpawn ? AUX_RULE_SPAWN_UNIFORMS : '')
    + AUX_EVENT_HASH
    + (sdf ? AUX_SDF_EVAL_GLSL : '')
    + (emit ? AUX_EMIT_UNIFORMS + AUX_EMIT_VELOCITY_GLSL : '')
    + (trail ? AUX_TRAIL_UNIFORMS : '')
    + bodyA
    + (sdf ? AUX_EVENT_SPLASH_TESTS_SDF : AUX_EVENT_SPLASH_TESTS)
    + AUX_EVENT_SPLASH_BODY
    + (sdf ? AUX_EVENT_SPLASH_VEL_SDF : AUX_EVENT_SPLASH_VEL)
    + AUX_EVENT_BODY_B;
}

export const AUX_EVENT_GLSL = buildAuxEventGlsl();
export const AUX_EVENT_GLSL_PHASE20 = buildAuxEventGlsl({ sdfSplash: true });


// ── Aux velocity pass ──
export const AUX_VEL_FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D uAuxPosTex;
  uniform sampler2D uAuxVelTex;
  uniform float uDelta;
  uniform float uTime;
  uniform float uGravity;
  uniform float uBounce;
  uniform float uFloorBounce;
  uniform float uAuxLife;
  // Child-emitter independence (Phase Q): the child's own gravity
  // scale / extra drag / curl. Defaults (1 / 0 / 0) reproduce the
  // legacy shared physics exactly — the curl term is guarded so it
  // vanishes entirely at 0, and the other two reduce to the legacy
  // expressions at their defaults.
  uniform float uAuxGravityScale;
  uniform float uAuxDrag;
  uniform float uAuxCurl;
  varying vec2 vUv;
  ${AUX_EVENT_GLSL}

  float auxHashLocal(float n) { vec3 p3 = fract(vec3(n) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yxz + 33.33); return fract((p3.x + p3.y) * p3.z); }

  void main() {
    vec4 auxPos = texture2D(uAuxPosTex, vUv);
    vec4 auxVel = texture2D(uAuxVelTex, vUv);
    float auxIdx = floor(vUv.y * 128.0) * 128.0 + floor(vUv.x * 128.0);
    float age = auxPos.w;
    float life = auxVel.w;
    if (auxIdx >= uAuxCount) {
      gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0);
      return;
    }
    if (age >= life) {
      // Inactive: spawn on an event, else stay parked (velocity 0,
      // life unchanged so the position pass sees the same state).
      vec4 ev = findAuxEvent(auxIdx, uDelta, uTime);
      if (ev.w > 0.5) {
        float newLife = uAuxLife * (0.6 + 0.8 * auxHashLocal(auxIdx * 11.3 + floor(uTime * 60.0)));
        gl_FragColor = vec4(gAuxSpawnVel, newLife);
        return;
      }
      gl_FragColor = vec4(0.0, 0.0, 0.0, life);
      return;
    }
    vec3 vel = auxVel.xyz;
    // Aux physics: softened gravity, drag, floor + sphere bounces —
    // the same boundary vocabulary as the main sim, at decorative scale.
    // Phase Q: gravity is scaled by the child's own factor (1 =
    // legacy, 0 = weightless, negative = anti-gravity), the child
    // may carry extra drag, and a deterministic position-based curl
    // (Y-axis tangential swirl + a fixed sinusoidal shear — a pure
    // function of position, no time, no randomness, so the
    // deterministic renderer reproduces it frame for frame).
    // NOTE: the scale factor sits at the END of the legacy product
    // chain on purpose — at 1.0 the chain evaluates bit-identically
    // to the pre-Phase-Q expression (a mid-chain factor made the
    // Metal compiler reassociate the products and drift the result).
    vel.y -= uGravity * uDelta * 9.8 * 0.35 * uAuxGravityScale;
    if (uAuxCurl != 0.0) {
      float r = length(auxPos.xz);
      vec3 tang = r > 1.0 ? vec3(-auxPos.z, 0.0, auxPos.x) / r : vec3(0.0);
      vec3 shear = vec3(sin(auxPos.y * 0.05 + auxPos.z * 0.03), 0.0, cos(auxPos.x * 0.04 + auxPos.y * 0.03));
      vel += (tang * 18.0 + shear * 6.0) * uAuxCurl * uDelta;
    }
    vel *= max(0.0, 1.0 - (0.9 + uAuxDrag) * uDelta);
    if (uFloorEnabled && auxPos.y < uFloorY + 0.5 && vel.y < 0.0) {
      vel.y = -vel.y * uFloorBounce;
      vel.x *= 0.92;
      vel.z *= 0.92;
    }
    float d = length(auxPos.xyz);
    if (d > uBounceRadius && d > 0.001) {
      vec3 n = auxPos.xyz / d;
      float vn = dot(vel, n);
      if (vn > 0.0) vel -= n * vn * (1.0 + uBounce);
    }
    float spd = length(vel);
    if (spd > 350.0) vel *= 350.0 / spd;
    gl_FragColor = vec4(vel, life);
  }
`;

// Spawn inheritance (slice 1D-1): scale the two legacy
// parent-velocity terms of the event chunk by
// uAuxInheritVelScale. The uniform declaration is spliced after
// the child's own uAuxCurl declaration (present once in each
// velocity fragment); the coefficient terms appear once each in
// the embedded event chunk. Death / bounce keep coefficient 0 —
// no new inheritance is added to them.
function applyAuxInheritVelScale(frag: string): string {
  return frag
    .replace(
      'uniform float uAuxCurl;',
      'uniform float uAuxCurl;\n  uniform float uAuxInheritVelScale;',
    )
    .split('mVel.xyz * 0.15').join('mVel.xyz * (0.15 * uAuxInheritVelScale)')
    .split('mVel.xyz * 0.25').join('mVel.xyz * (0.25 * uAuxInheritVelScale)');
}

// Phase 20 stage 4: the SDF-splash variant of the velocity pass.
// The stock string above is the default in every configuration
// except (SDF collider on + bounceSplash), selected by the
// material swap in useGpgpuSimulationAssets.
export function buildAuxVelFrag(options?: AuxShaderVariantOptions): string {
  let frag = AUX_VEL_FRAG;
  if (options?.sdfSplash || options?.emit || options?.ruleSpawn || options?.trail) {
    frag = frag.replace(AUX_EVENT_GLSL, () => buildAuxEventGlsl({
      sdfSplash: !!options?.sdfSplash,
      emit: !!options?.emit,
      ruleSpawn: !!options?.ruleSpawn,
      trail: !!options?.trail,
      trailAb: options?.trailAb,
    }));
  }
  if (options?.inheritVelScale) {
    frag = applyAuxInheritVelScale(frag);
  }
  return frag;
}
export const AUX_VEL_FRAG_PHASE20 = buildAuxVelFrag({ sdfSplash: true });

// ── Aux position pass ──
export const AUX_POS_FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D uAuxPosTex;
  uniform sampler2D uAuxVelTex;
  uniform sampler2D uAuxVelOutTex;
  uniform float uDelta;
  uniform float uTime;
  varying vec2 vUv;
  ${AUX_EVENT_GLSL}

  void main() {
    vec4 auxPos = texture2D(uAuxPosTex, vUv);
    vec4 auxVelIn = texture2D(uAuxVelTex, vUv);
    vec4 auxVel = texture2D(uAuxVelOutTex, vUv);
    float auxIdx = floor(vUv.y * 128.0) * 128.0 + floor(vUv.x * 128.0);
    float age = auxPos.w;
    float life = auxVelIn.w;
    if (auxIdx >= uAuxCount) {
      gl_FragColor = vec4(0.0, -9999.0, 0.0, 1e6);
      return;
    }
    if (age >= life) {
      // Same event test as the velocity pass: on a spawn, place the
      // particle at the event position with age 0 (its velocity was
      // already written by the velocity pass this frame).
      vec4 ev = findAuxEvent(auxIdx, uDelta, uTime);
      if (ev.w > 0.5) {
        gl_FragColor = vec4(ev.xyz, 0.0);
        return;
      }
      gl_FragColor = vec4(auxPos.xyz, age);
      return;
    }
    vec3 pos = auxPos.xyz + auxVel.xyz * uDelta * 60.0;
    if (uFloorEnabled && pos.y < uFloorY) {
      pos.y = uFloorY + (uFloorY - pos.y) * 0.1;
    }
    float d = length(pos);
    if (d > uBounceRadius * 1.05 && d > 0.001) {
      pos = (pos / d) * uBounceRadius * 1.05;
    }
    gl_FragColor = vec4(pos, age + uDelta);
  }
`;

// Phase 20 stage 4: the SDF-splash variant of the position pass.
// It re-evaluates the identical event test as the velocity pass
// (same chunk, same uniforms), so the two passes can never
// disagree about an SDF splash either.
export function buildAuxPosFrag(options?: AuxShaderVariantOptions): string {
  if (!options?.sdfSplash && !options?.emit && !options?.ruleSpawn && !options?.trail) return AUX_POS_FRAG;
  return AUX_POS_FRAG.replace(AUX_EVENT_GLSL, () => buildAuxEventGlsl({
    sdfSplash: !!options?.sdfSplash,
    emit: !!options?.emit,
    ruleSpawn: !!options?.ruleSpawn,
    trail: !!options?.trail,
    trailAb: options?.trailAb,
  }));
}
export const AUX_POS_FRAG_PHASE20 = buildAuxPosFrag({ sdfSplash: true });

// ── Aux tick probe (stage-4 gate fix round 7, DIAG ONLY) ──
//
// Builds the fragment string of the tick-declaration probe
// material (lib/auxTickProbeDiag.ts): the SOURCE material's
// own fragment string with everything from its `void main()`
// onward replaced by a probe main that writes the program's
// own evaluation of the trail branch's tick expressions —
// tick = floor(uTime * 60.0), trailPhase = the slot's phase
// (auxIdx mod interval, computed boundary-avoiding as
// mod(auxIdx + 0.5, interval) - 0.5), trailTick = the stock
// branch's phase test mod(tick - auxIdx + 0.5, interval)
// < 1.0 (FIX13 phrasing; before FIX13 the probe declared
// the original two-step form and thereby exposed its
// failure in gate phase 8) — into the colour channels,
// alongside the raw uTrailEmitInterval. The prefix
// (precision, every uniform declaration, the event chunk
// with findAuxEvent) is the source string verbatim, so the
// probe program is compiled from the same source the pass
// program was, and the runner binds the SAME uniforms object
// the source material carries: what the probe declares is
// what a program in this compilation lineage computes from
// the values the runner actually supplied. The expressions
// mirror the stock trail branch (AUX_EVENT_TRAIL_BRANCH)
// term for term; auxIdx uses the same formula as the pass
// mains. Returns null when the source carries no main (the
// probe cannot be built) or no trail interval uniform (the
// tick expressions are not declared in that variant).
export function buildAuxTickProbeFrag(sourceFrag: string): string | null {
  if (!sourceFrag.includes('uTrailEmitInterval')) return null;
  const mainAt = sourceFrag.lastIndexOf('void main()');
  if (mainAt < 0) return null;
  const size = `${AUX_TEX_SIZE}.0`;
  return sourceFrag.slice(0, mainAt) + /* glsl */ `void main() {
    // aux-tick-probe: declaration main (stage-4 gate fix
    // round 7, diag only). Replaces the pass main; the pool
    // is never written by this program — the runner renders
    // it into a dedicated probe target only while armed.
    float auxIdx = floor(vUv.y * ${size}) * ${size} + floor(vUv.x * ${size});
    float tick = floor(uTime * 60.0);
    float trailInterval = max(uTrailEmitInterval, 1.0);
    float trailPhase = mod(auxIdx + 0.5, trailInterval) - 0.5;
    float trailTick = mod(tick - auxIdx + 0.5, trailInterval) < 1.0 ? 1.0 : 0.0;
    gl_FragColor = vec4(tick, trailPhase, trailTick, uTrailEmitInterval);
  }
`;
}

// ── Aux chain (Phase W1): levels 2 and 3 ─────────────────────────
//
// A chain level is the same two-pass pool machinery, but its event
// source is ANOTHER AUX POOL (the level above) instead of the main
// GPGPU pool. The differences from AUX_EVENT_GLSL are exactly the
// source semantics:
// - the source population is the upper pool's live slot count
//   (uSrcCount), not a texel count — dead texels beyond it are never
//   sampled;
// - a source particle carries its OWN life in vel.w (the main pool
//   uses the global ageMax instead), so deathBurst fires on the
//   frame the source's age crosses its own life, and only while the
//   source was alive at frame start (a parked dead particle's age
//   sits frozen past its life and must not re-fire);
// - bounceSplash and sparkTrail likewise require a live source.
// The gate probabilities are Kinetix's, shared with level 1 (0.25 /
// 0.35 / 0.9). uChainSalt decorrelates this level's hash rolls from
// the level above (same slot index, same tick, correlated sources).
// The legacy level-1 shaders above are NOT reused here on purpose:
// keeping them byte-untouched is what guarantees depth-1 output
// stays bit-identical.

export const AUX_CHAIN_EVENT_GLSL = /* glsl */ `
  uniform sampler2D uMainPosTex;
  uniform sampler2D uMainVelTex;
  uniform float uMainTexSizeF;
  uniform float uSrcCount;
  uniform float uAuxCount;
  uniform int   uAuxMode;
  uniform float uAuxIntensity;
  uniform float uAuxSpeed;
  uniform float uChainSalt;
  uniform bool  uFloorEnabled;
  uniform float uFloorY;
  uniform float uBounceRadius;

  float auxChainHash(float n) { vec3 p3 = fract(vec3(n) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yxz + 33.33); return fract((p3.x + p3.y) * p3.z); }
  vec3 auxChainHash3(float n) {
    return vec3(auxChainHash(n + 0.13), auxChainHash(n + 17.71), auxChainHash(n + 41.37)) - 0.5;
  }

  vec3 gAuxChainSpawnVel;

  // Scans this slot's candidate sources in the upper pool for the
  // mode's event. Same contract as findAuxEvent: event position in
  // xyz + 1.0 in w, gAuxChainSpawnVel holds the burst velocity.
  vec4 findAuxChainEvent(float auxIdx, float delta, float time) {
    float srcCount = max(uSrcCount, 0.0);
    if (srcCount < 1.0) return vec4(0.0, 0.0, 0.0, 0.0);
    float chunk = max(1.0, floor(srcCount / max(uAuxCount, 1.0)));
    float srcBase = auxIdx * chunk;
    if (uAuxCount > srcCount) { srcBase = mod(auxIdx, srcCount); chunk = 1.0; }
    float stride = max(1.0, floor(chunk / 8.0));
    float tick = floor(time * 60.0);
    for (int s = 0; s < 8; s++) {
      float srcIdx = srcBase + float(s) * stride;
      if (srcIdx >= srcCount) break;
      vec2 srcUv = (vec2(mod(srcIdx, uMainTexSizeF), floor(srcIdx / uMainTexSizeF)) + 0.5) / uMainTexSizeF;
      vec4 mPos = texture2D(uMainPosTex, srcUv);
      vec4 mVel = texture2D(uMainVelTex, srcUv);
      float srcLife = mVel.w;
      bool alive = srcLife > 0.001 && mPos.w < srcLife;
      float gate = auxChainHash(auxIdx * 3.71 + uChainSalt + tick * 13.13 + float(s) * 7.7);
      if (uAuxMode == 2) {
        // sparkTrail: candidate 0 sheds while it lives.
        if (s == 0) {
          if (!alive) break;
          if (gate >= clamp(0.9 * uAuxIntensity, 0.0, 1.0)) break;
          gAuxChainSpawnVel = mVel.xyz * 0.15 + auxChainHash3(auxIdx * 1.31 + uChainSalt + tick) * uAuxSpeed * 0.55;
          return vec4(mPos.xyz, 1.0);
        }
        break;
      }
      if (uAuxMode == 3) {
        // birthBurst (Phase AB): the source particle spawned on
        // the previous frame — its age restarted at 0 while it is
        // alive (same 0.75 * delta window as level 1).
        if (alive && mPos.w < delta * 0.75 && gate < 0.35 * uAuxIntensity) {
          vec3 dir = auxChainHash3(auxIdx * 4.31 + uChainSalt + tick * 1.113);
          float dl = length(dir);
          dir = dl > 0.01 ? dir / dl : vec3(0.0, 1.0, 0.0);
          gAuxChainSpawnVel = mVel.xyz * 0.25 + dir * uAuxSpeed * (0.2 + 0.3 * auxChainHash(auxIdx * 6.7 + uChainSalt + tick));
          return vec4(mPos.xyz, 1.0);
        }
      }
      if (uAuxMode == 0) {
        // deathBurst: the source's age crosses its own life this
        // frame (both textures are the frame-start state).
        if (alive && mPos.w + delta >= srcLife && gate < 0.25 * uAuxIntensity) {
          vec3 dir = auxChainHash3(auxIdx * 2.17 + uChainSalt + tick * 0.913);
          float dl = length(dir);
          dir = dl > 0.01 ? dir / dl : vec3(0.0, 1.0, 0.0);
          gAuxChainSpawnVel = dir * uAuxSpeed * (0.35 + 0.65 * auxChainHash(auxIdx * 5.3 + uChainSalt + tick));
          return vec4(mPos.xyz, 1.0);
        }
      } else if (uAuxMode == 1) {
        // bounceSplash: same contact tests as level 1, live sources
        // only (a parked particle has zero velocity and would fail
        // the tests anyway; the guard keeps that explicit).
        if (alive) {
          float d = length(mPos.xyz);
          vec3 n = d > 0.001 ? mPos.xyz / d : vec3(0.0, 1.0, 0.0);
          bool sphereHit = d > uBounceRadius * 0.985 && dot(mVel.xyz, n) > 2.0;
          bool floorHit = uFloorEnabled && mPos.y < uFloorY + 1.5 && mVel.xyz.y < -2.0;
          if ((sphereHit || floorHit) && gate < 0.35 * uAuxIntensity) {
            vec3 jitter = auxChainHash3(auxIdx * 3.97 + uChainSalt + tick * 1.71);
            if (floorHit) {
              gAuxChainSpawnVel = vec3(jitter.x * 1.2, 0.55 + 0.65 * auxChainHash(auxIdx * 7.9 + uChainSalt + tick), jitter.z * 1.2) * uAuxSpeed * 0.8;
              return vec4(vec3(mPos.x, uFloorY + 0.3, mPos.z), 1.0);
            }
            gAuxChainSpawnVel = (n * (0.5 + auxChainHash(auxIdx * 9.1 + uChainSalt + tick)) + jitter * 0.9) * uAuxSpeed * 0.7;
            return vec4(mPos.xyz, 1.0);
          }
        }
      }
    }
    return vec4(0.0, 0.0, 0.0, 0.0);
  }
`;

// Child emitter (slice 1D-2): the emit variant of the chain
// event chunk. The shaping is the level-1 function verbatim
// under the chain name (the chain chunk's own hash family feeds
// it); the branch is spliced in front of the mode-0 dispatch,
// exactly as at level 1. The stock chunk stays byte-identical
// in every non-emit configuration.
const AUX_CHAIN_EMIT_VELOCITY_GLSL = AUX_EMIT_VELOCITY_GLSL
  .replace('auxEmitVelocity', 'auxChainEmitVelocity');
const AUX_CHAIN_EVENT_EMIT_BRANCH = /* glsl */ `      if (uAuxMode == 5) {
        // emit (slice 1D-2): a living source particle emits
        // this level's particles at the per-tick probability
        // rate/60, rolled on this level's salted gate hash.
        if (alive && gate < clamp(uAuxEmitRate / 60.0, 0.0, 1.0)) {
          gAuxChainSpawnVel = auxChainEmitVelocity(
            mVel.xyz,
            auxChainHash3(auxIdx * 8.53 + uChainSalt + tick * 1.37),
            auxChainHash(auxIdx * 5.97 + uChainSalt + tick),
            auxChainHash(auxIdx * 9.31 + uChainSalt + tick * 0.71));
          return vec4(mPos.xyz, 1.0);
        }
      }
`;

export function buildAuxChainEventGlsl(options?: AuxShaderVariantOptions): string {
  if (!options?.emit) return AUX_CHAIN_EVENT_GLSL;
  return AUX_CHAIN_EVENT_GLSL
    .replace(
      '  uniform float uBounceRadius;\n',
      () => '  uniform float uBounceRadius;\n' + AUX_EMIT_UNIFORMS,
    )
    .replace(
      '  vec3 gAuxChainSpawnVel;',
      () => AUX_CHAIN_EMIT_VELOCITY_GLSL + '\n  vec3 gAuxChainSpawnVel;',
    )
    .replace(
      '      if (uAuxMode == 0) {',
      () => AUX_CHAIN_EVENT_EMIT_BRANCH + '      if (uAuxMode == 0) {',
    );
}

// ── Aux chain velocity pass ──
// The physics body mirrors AUX_VEL_FRAG exactly (same softened
// gravity chain, same boundary vocabulary); the level's own
// gravityScale / drag / curl arrive through the same uniform names,
// fed with the Aux2 values by the pass runner.
export const AUX_CHAIN_VEL_FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D uAuxPosTex;
  uniform sampler2D uAuxVelTex;
  uniform float uDelta;
  uniform float uTime;
  uniform float uGravity;
  uniform float uBounce;
  uniform float uFloorBounce;
  uniform float uAuxLife;
  uniform float uAuxGravityScale;
  uniform float uAuxDrag;
  uniform float uAuxCurl;
  varying vec2 vUv;
  ${AUX_CHAIN_EVENT_GLSL}

  float auxChainHashLocal(float n) { vec3 p3 = fract(vec3(n) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yxz + 33.33); return fract((p3.x + p3.y) * p3.z); }

  void main() {
    vec4 auxPos = texture2D(uAuxPosTex, vUv);
    vec4 auxVel = texture2D(uAuxVelTex, vUv);
    float auxIdx = floor(vUv.y * 128.0) * 128.0 + floor(vUv.x * 128.0);
    float age = auxPos.w;
    float life = auxVel.w;
    if (auxIdx >= uAuxCount) {
      gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0);
      return;
    }
    if (age >= life) {
      vec4 ev = findAuxChainEvent(auxIdx, uDelta, uTime);
      if (ev.w > 0.5) {
        float newLife = uAuxLife * (0.6 + 0.8 * auxChainHashLocal(auxIdx * 11.3 + uChainSalt * 7.0 + floor(uTime * 60.0)));
        gl_FragColor = vec4(gAuxChainSpawnVel, newLife);
        return;
      }
      gl_FragColor = vec4(0.0, 0.0, 0.0, life);
      return;
    }
    vec3 vel = auxVel.xyz;
    vel.y -= uGravity * uDelta * 9.8 * 0.35 * uAuxGravityScale;
    if (uAuxCurl != 0.0) {
      float r = length(auxPos.xz);
      vec3 tang = r > 1.0 ? vec3(-auxPos.z, 0.0, auxPos.x) / r : vec3(0.0);
      vec3 shear = vec3(sin(auxPos.y * 0.05 + auxPos.z * 0.03), 0.0, cos(auxPos.x * 0.04 + auxPos.y * 0.03));
      vel += (tang * 18.0 + shear * 6.0) * uAuxCurl * uDelta;
    }
    vel *= max(0.0, 1.0 - (0.9 + uAuxDrag) * uDelta);
    if (uFloorEnabled && auxPos.y < uFloorY + 0.5 && vel.y < 0.0) {
      vel.y = -vel.y * uFloorBounce;
      vel.x *= 0.92;
      vel.z *= 0.92;
    }
    float d = length(auxPos.xyz);
    if (d > uBounceRadius && d > 0.001) {
      vec3 n = auxPos.xyz / d;
      float vn = dot(vel, n);
      if (vn > 0.0) vel -= n * vn * (1.0 + uBounce);
    }
    float spd = length(vel);
    if (spd > 350.0) vel *= 350.0 / spd;
    gl_FragColor = vec4(vel, life);
  }
`;

// ── Aux chain position pass ──
export const AUX_CHAIN_POS_FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D uAuxPosTex;
  uniform sampler2D uAuxVelTex;
  uniform sampler2D uAuxVelOutTex;
  uniform float uDelta;
  uniform float uTime;
  varying vec2 vUv;
  ${AUX_CHAIN_EVENT_GLSL}

  void main() {
    vec4 auxPos = texture2D(uAuxPosTex, vUv);
    vec4 auxVelIn = texture2D(uAuxVelTex, vUv);
    vec4 auxVel = texture2D(uAuxVelOutTex, vUv);
    float auxIdx = floor(vUv.y * 128.0) * 128.0 + floor(vUv.x * 128.0);
    float age = auxPos.w;
    float life = auxVelIn.w;
    if (auxIdx >= uAuxCount) {
      gl_FragColor = vec4(0.0, -9999.0, 0.0, 1e6);
      return;
    }
    if (age >= life) {
      vec4 ev = findAuxChainEvent(auxIdx, uDelta, uTime);
      if (ev.w > 0.5) {
        gl_FragColor = vec4(ev.xyz, 0.0);
        return;
      }
      gl_FragColor = vec4(auxPos.xyz, age);
      return;
    }
    vec3 pos = auxPos.xyz + auxVel.xyz * uDelta * 60.0;
    if (uFloorEnabled && pos.y < uFloorY) {
      pos.y = uFloorY + (uFloorY - pos.y) * 0.1;
    }
    float d = length(pos);
    if (d > uBounceRadius * 1.05 && d > 0.001) {
      pos = (pos / d) * uBounceRadius * 1.05;
    }
    gl_FragColor = vec4(pos, age + uDelta);
  }
`;

// Chain velocity builder (slice 1D-1): the stock string is the
// default; the inherit-scale variant applies the same splice as
// the level-1 velocity pass (the chain event chunk carries the
// same two parent-velocity terms). Slice 1D-2 adds the emit
// variant of the chain event chunk.
export function buildAuxChainVelFrag(options?: AuxShaderVariantOptions): string {
  let frag = AUX_CHAIN_VEL_FRAG;
  if (options?.emit) {
    frag = frag.replace(AUX_CHAIN_EVENT_GLSL, () => buildAuxChainEventGlsl({ emit: true }));
  }
  if (options?.inheritVelScale) {
    frag = applyAuxInheritVelScale(frag);
  }
  return frag;
}

// Chain position builder (slice 1D-2): the stock string is the
// default; the emit variant re-evaluates the identical emit
// event test as the chain velocity pass.
export function buildAuxChainPosFrag(options?: AuxShaderVariantOptions): string {
  if (!options?.emit) return AUX_CHAIN_POS_FRAG;
  return AUX_CHAIN_POS_FRAG.replace(AUX_CHAIN_EVENT_GLSL, () => buildAuxChainEventGlsl({ emit: true }));
}

// ── Spawn inheritance write pass (Grammar 2.0 stage 1, 1D-1) ──
//
// The inheritance texture (one 128x128 RGBA float target per
// chain level, NOT ping-ponged) records, per aux slot, the
// parent values a spawn inherited: slots 0/1/2 raw in rgb and
// the parent's species (normalised) in a. It is written ONLY on
// the spawn frame, by this dedicated sparse-write pass: the
// fragment re-evaluates the velocity pass's identical spawn
// decision (same event chunk, same frame-start inputs — the
// position pass already re-evaluates it the same way) and
// DISCARDS every non-spawning texel, so unwritten slots keep
// their previous values without the pass ever sampling its own
// target. The position pass never writes it: the velocity side
// is the spawn decision-maker, and this pass is its mirror.
//
// The firing candidate's source uv is captured by splicing a
// global assignment in front of the event chunk's event
// returns — a variant of the chunk assembly only; the stock
// event strings are untouched.

function auxEventWithSrcCapture(eventGlsl: string): string {
  return '  vec2 gAuxSpawnSrcUv;\n'
    + eventGlsl
      .split('return vec4(vec3(mPos.x, uFloorY + 0.3, mPos.z), 1.0);')
      .join('gAuxSpawnSrcUv = srcUv; return vec4(vec3(mPos.x, uFloorY + 0.3, mPos.z), 1.0);')
      .split('return vec4(mPos.xyz, 1.0);')
      .join('gAuxSpawnSrcUv = srcUv; return vec4(mPos.xyz, 1.0);');
}

const AUX_INHERIT_HEAD = /* glsl */ `
  precision highp float;
  uniform sampler2D uAuxPosTex;
  uniform sampler2D uAuxVelTex;
  uniform sampler2D uMainAttrTex;
  uniform float uSpeciesCount;
  uniform float uDelta;
  uniform float uTime;
  varying vec2 vUv;
`;

const AUX_INHERIT_SPECIES_GLSL = /* glsl */ `
  float auxInheritDmHash11(float n) {
    vec3 p3 = fract(vec3(n) * vec3(0.1031, 0.1030, 0.0973));
    p3 += dot(p3, p3.yxz + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
  // The plSpecies derivation (velocity helpers / points
  // readout), normalised to [0, 1] exactly as the CPU twin
  // attrSpeciesValue (lib/gpgpuAttributes.ts): the species
  // index comes from the texel hash, divided by (count - 1),
  // with the count clamped to 2..6.
  float auxInheritSpeciesValue(vec2 srcUv) {
    float idx = floor(srcUv.y * uMainTexSizeF) * uMainTexSizeF + floor(srcUv.x * uMainTexSizeF);
    float count = clamp(floor(uSpeciesCount + 0.5), 2.0, 6.0);
    float h = auxInheritDmHash11((idx + 17.17) * 3.71 + 17.17);
    float sp = min(floor(h * count), count - 1.0);
    return sp / (count - 1.0);
  }
`;

const AUX_INHERIT_MAIN = /* glsl */ `
  void main() {
    vec4 auxPos = texture2D(uAuxPosTex, vUv);
    vec4 auxVel = texture2D(uAuxVelTex, vUv);
    float auxIdx = floor(vUv.y * 128.0) * 128.0 + floor(vUv.x * 128.0);
    if (auxIdx >= uAuxCount) discard;
    if (auxPos.w >= auxVel.w) {
      // Inactive at frame start: the velocity pass spawns on
      // the event this re-evaluation finds; mirror its decision.
      vec4 ev = findAuxEvent(auxIdx, uDelta, uTime);
      if (ev.w > 0.5) {
        vec3 slots = texture2D(uMainAttrTex, gAuxSpawnSrcUv).rgb;
        gl_FragColor = vec4(slots, auxInheritSpeciesValue(gAuxSpawnSrcUv));
        return;
      }
    }
    discard;
  }
`;

const AUX_INHERIT_CHAIN_HEAD = /* glsl */ `
  precision highp float;
  uniform sampler2D uAuxPosTex;
  uniform sampler2D uAuxVelTex;
  uniform sampler2D uSrcInheritTex;
  uniform float uDelta;
  uniform float uTime;
  varying vec2 vUv;
`;

const AUX_INHERIT_CHAIN_MAIN = /* glsl */ `
  void main() {
    vec4 auxPos = texture2D(uAuxPosTex, vUv);
    vec4 auxVel = texture2D(uAuxVelTex, vUv);
    float auxIdx = floor(vUv.y * 128.0) * 128.0 + floor(vUv.x * 128.0);
    if (auxIdx >= uAuxCount) discard;
    if (auxPos.w >= auxVel.w) {
      vec4 ev = findAuxChainEvent(auxIdx, uDelta, uTime);
      if (ev.w > 0.5) {
        // Verbatim copy of the parent's texel: slots and
        // species propagate down the chain without decay.
        gl_FragColor = texture2D(uSrcInheritTex, gAuxSpawnSrcUv);
        return;
      }
    }
    discard;
  }
`;

export interface AuxInheritShaderVariantOptions {
  // Level 1 only: follow the SDF-splash event variant, exactly
  // as the velocity / position pair does.
  sdfSplash?: boolean;
  // Assemble the chain form (source = the upper Aux pool, the
  // inheritance value copied from its inheritance texture).
  chain?: boolean;
  // Child emitter (slice 1D-2): follow the emit event variant
  // of the level's chunk, exactly as the velocity / position
  // pair does — an emit spawn records its inheritance through
  // the same sparse write as every other mode.
  emit?: boolean;
  // Grammar connection (slice 1D-3): LEVEL 1 ONLY — follow
  // the ruleSpawn event variant, so a rule-driven spawn
  // records its inheritance through the same sparse write
  // (its branch's return is a capture point, like every
  // other mode's). The chain form ignores this option: the
  // chain event chunk has no ruleSpawn branch to mirror.
  ruleSpawn?: boolean;
  // Trail mechanism (Limit plan stage 4, slice S6): LEVEL 1
  // ONLY — follow the trail event variant, so a trail child
  // records its attribute slots and species through the
  // same sparse write on its spawn frame. The chain form
  // ignores this option, like ruleSpawn.
  trail?: boolean;
  // Trail A/B minimisation (stage-4 gate fix round 6):
  // DIAG ONLY — follow the level-1 pair's A/B stage, exactly
  // as `trail` follows the trail variant (the inherit pass
  // re-evaluates the same branch, so it must minimise the
  // same way or its spawn decision would diverge from the
  // pair's). The chain form ignores this option, like
  // ruleSpawn / trail.
  trailAb?: AuxTrailAbStage;
}

export function buildAuxInheritFrag(options?: AuxInheritShaderVariantOptions): string {
  if (options?.chain) {
    return AUX_INHERIT_CHAIN_HEAD
      + auxEventWithSrcCapture(buildAuxChainEventGlsl({ emit: !!options?.emit }))
      + AUX_INHERIT_CHAIN_MAIN;
  }
  return AUX_INHERIT_HEAD
    + auxEventWithSrcCapture(buildAuxEventGlsl({ sdfSplash: !!options?.sdfSplash, emit: !!options?.emit, ruleSpawn: !!options?.ruleSpawn, trail: !!options?.trail, trailAb: options?.trailAb }))
    + AUX_INHERIT_SPECIES_GLSL
    + AUX_INHERIT_MAIN;
}

export const AUX_INHERIT_FRAG = buildAuxInheritFrag();
export const AUX_INHERIT_FRAG_PHASE20 = buildAuxInheritFrag({ sdfSplash: true });
export const AUX_CHAIN_INHERIT_FRAG = buildAuxInheritFrag({ chain: true });

// ── Aux draw ──
// ── Aux draw vertex (builder form, Phase 30 stage 3): the stock
// string is the builder with no options — the shadow variant
// splices the LIGHT_SHADOW_GLSL chunk + a varying + the factor
// compute at the world position, mirroring the GPGPU points
// draw (Phase 23). Off (the default) assembles the stock
// string byte-identically.
export interface AuxDrawShaderVariantOptions {
  shadowMap?: boolean;
  // Spawn inheritance (Grammar 2.0 stage 1, slice 1D-1): the
  // vertex samples this level's inheritance texture and the
  // fragment mixes the inherited colour into the level colour
  // by uAuxInheritColor. Selected only while inheritance is on
  // AND the mix is above 0 (auxInheritColorActive), so at the
  // default the assembled strings are the stock ones.
  inherit?: boolean;
}

const AUX_DRAW_VERT_HEAD = /* glsl */ `
  precision highp float;
  uniform sampler2D uAuxPosTex;
  uniform sampler2D uAuxVelTex;
  uniform float uAuxSize;
  attribute vec2 aTexCoord;
  varying float vAlpha;
`;

const AUX_DRAW_VERT_INHERIT_HEAD = /* glsl */ `  uniform sampler2D uAuxInheritTex;
  varying vec3 vInheritRgb;
`;

const AUX_DRAW_VERT_INHERIT_SAMPLE = /* glsl */ `    // Spawn inheritance (1D-1): the inherited slots, in the
    // design's simplified stage-1 form — clamped to [0, 1] and
    // read as rgb by the fragment's colour mix.
    vInheritRgb = clamp(texture2D(uAuxInheritTex, aTexCoord).rgb, 0.0, 1.0);
`;

const AUX_DRAW_VERT_SHADOWMAP_VARYING = /* glsl */ `  varying float vShadowMapMul;
`;

const AUX_DRAW_VERT_BODY_A = /* glsl */ `  void main() {
    vec4 posData = texture2D(uAuxPosTex, aTexCoord);
    float life = texture2D(uAuxVelTex, aTexCoord).w;
    float age = posData.w;
    bool isActive = life > 0.001 && age < life;
    float t = life > 0.001 ? clamp(age / life, 0.0, 1.0) : 1.0;
    vAlpha = isActive ? smoothstep(0.0, 0.12, t) * (1.0 - smoothstep(0.55, 1.0, t)) : 0.0;
    vec3 worldPos = isActive ? posData.xyz : vec3(0.0, -99999.0, 0.0);
`;

const AUX_DRAW_VERT_SHADOWMAP_COMPUTE = /* glsl */ `    // True shadow map (Phase 30 stage 3): sample the
    // light-viewpoint depth at the same worldPos the draw
    // uses — nothing moves worldPos in between.
    vShadowMapMul = kaloShadowFactor(worldPos);
`;

const AUX_DRAW_VERT_BODY_B = /* glsl */ `    vec4 mvPos = modelViewMatrix * vec4(worldPos, 1.0);
    float dist = -mvPos.z;
    gl_PointSize = max(0.5, uAuxSize * (dist > 0.5 ? min(4.0, 500.0 / dist) : 1.0));
    gl_Position = projectionMatrix * mvPos;
  }
`;

export function buildAuxDrawVert(options?: AuxDrawShaderVariantOptions): string {
  const shadowMap = !!options?.shadowMap;
  const inherit = !!options?.inherit;
  return AUX_DRAW_VERT_HEAD
    + (inherit ? AUX_DRAW_VERT_INHERIT_HEAD : '')
    + (shadowMap ? AUX_DRAW_VERT_SHADOWMAP_VARYING : '')
    + (shadowMap ? LIGHT_SHADOW_GLSL : '')
    + AUX_DRAW_VERT_BODY_A
    + (inherit ? AUX_DRAW_VERT_INHERIT_SAMPLE : '')
    + (shadowMap ? AUX_DRAW_VERT_SHADOWMAP_COMPUTE : '')
    + AUX_DRAW_VERT_BODY_B;
}

export const AUX_DRAW_VERT = buildAuxDrawVert();

export const AUX_DRAW_VERT_PHASE30 = buildAuxDrawVert({ shadowMap: true });


const AUX_DRAW_FRAG_HEAD = /* glsl */ `
  precision highp float;
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vAlpha;
`;

const AUX_DRAW_FRAG_INHERIT_VARYING = /* glsl */ `  varying vec3 vInheritRgb;
  uniform float uAuxInheritColor;
`;

const AUX_DRAW_FRAG_SHADOWMAP_VARYING = /* glsl */ `  varying float vShadowMapMul;
  uniform float uShadowMapStrength;
`;

const AUX_DRAW_FRAG_BODY_A = /* glsl */ `  void main() {
    vec2 pc = gl_PointCoord - 0.5;
    float d = length(pc);
    if (d > 0.5) discard;
    float shapeAlpha = smoothstep(0.5, 0.12, d);
`;

const AUX_DRAW_FRAG_WRITE = /* glsl */ `    gl_FragColor = vec4(uColor, shapeAlpha * uOpacity * vAlpha);
`;

const AUX_DRAW_FRAG_SHADOWMAP_WRITE = /* glsl */ `    // True shadow map (Phase 30 stage 3): the shadow factor
    // scales the colour exactly like the GPGPU points draw.
    vec3 auxCol = uColor * mix(1.0, vShadowMapMul, uShadowMapStrength);
    gl_FragColor = vec4(auxCol, shapeAlpha * uOpacity * vAlpha);
`;

const AUX_DRAW_FRAG_WRITE_INHERIT = /* glsl */ `    // Spawn inheritance (1D-1): the inherited colour mixes
    // into the level colour before the write.
    gl_FragColor = vec4(mix(uColor, vInheritRgb, uAuxInheritColor), shapeAlpha * uOpacity * vAlpha);
`;

const AUX_DRAW_FRAG_SHADOWMAP_WRITE_INHERIT = /* glsl */ `    // Spawn inheritance (1D-1) + true shadow map: the mix
    // resolves first, the shadow factor scales the result.
    vec3 auxCol = mix(uColor, vInheritRgb, uAuxInheritColor) * mix(1.0, vShadowMapMul, uShadowMapStrength);
    gl_FragColor = vec4(auxCol, shapeAlpha * uOpacity * vAlpha);
`;

const AUX_DRAW_FRAG_BODY_B = /* glsl */ `  }
`;

export function buildAuxDrawFrag(options?: AuxDrawShaderVariantOptions): string {
  const shadowMap = !!options?.shadowMap;
  const inherit = !!options?.inherit;
  const write = shadowMap
    ? (inherit ? AUX_DRAW_FRAG_SHADOWMAP_WRITE_INHERIT : AUX_DRAW_FRAG_SHADOWMAP_WRITE)
    : (inherit ? AUX_DRAW_FRAG_WRITE_INHERIT : AUX_DRAW_FRAG_WRITE);
  return AUX_DRAW_FRAG_HEAD
    + (shadowMap ? AUX_DRAW_FRAG_SHADOWMAP_VARYING : '')
    + (inherit ? AUX_DRAW_FRAG_INHERIT_VARYING : '')
    + AUX_DRAW_FRAG_BODY_A
    + write
    + AUX_DRAW_FRAG_BODY_B;
}

export const AUX_DRAW_FRAG = buildAuxDrawFrag();

export const AUX_DRAW_FRAG_PHASE30 = buildAuxDrawFrag({ shadowMap: true });

