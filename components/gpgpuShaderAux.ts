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
}

export function buildAuxEventGlsl(options?: AuxShaderVariantOptions): string {
  const sdf = !!options?.sdfSplash;
  return AUX_EVENT_UNIFORMS
    + (sdf ? AUX_SDF_UNIFORMS : '')
    + AUX_EVENT_HASH
    + (sdf ? AUX_SDF_EVAL_GLSL : '')
    + AUX_EVENT_BODY_A
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

// Phase 20 stage 4: the SDF-splash variant of the velocity pass.
// The stock string above is the default in every configuration
// except (SDF collider on + bounceSplash), selected by the
// material swap in useGpgpuSimulationAssets.
export function buildAuxVelFrag(options?: AuxShaderVariantOptions): string {
  if (!options?.sdfSplash) return AUX_VEL_FRAG;
  return AUX_VEL_FRAG.replace(AUX_EVENT_GLSL, () => AUX_EVENT_GLSL_PHASE20);
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
  if (!options?.sdfSplash) return AUX_POS_FRAG;
  return AUX_POS_FRAG.replace(AUX_EVENT_GLSL, () => AUX_EVENT_GLSL_PHASE20);
}
export const AUX_POS_FRAG_PHASE20 = buildAuxPosFrag({ sdfSplash: true });

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

const AUX_CHAIN_EVENT_GLSL = /* glsl */ `
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

// ── Aux draw ──
// ── Aux draw vertex (builder form, Phase 30 stage 3): the stock
// string is the builder with no options — the shadow variant
// splices the LIGHT_SHADOW_GLSL chunk + a varying + the factor
// compute at the world position, mirroring the GPGPU points
// draw (Phase 23). Off (the default) assembles the stock
// string byte-identically.
export interface AuxDrawShaderVariantOptions {
  shadowMap?: boolean;
}

const AUX_DRAW_VERT_HEAD = /* glsl */ `
  precision highp float;
  uniform sampler2D uAuxPosTex;
  uniform sampler2D uAuxVelTex;
  uniform float uAuxSize;
  attribute vec2 aTexCoord;
  varying float vAlpha;
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
  return AUX_DRAW_VERT_HEAD
    + (shadowMap ? AUX_DRAW_VERT_SHADOWMAP_VARYING : '')
    + (shadowMap ? LIGHT_SHADOW_GLSL : '')
    + AUX_DRAW_VERT_BODY_A
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

const AUX_DRAW_FRAG_BODY_B = /* glsl */ `  }
`;

export function buildAuxDrawFrag(options?: AuxDrawShaderVariantOptions): string {
  const shadowMap = !!options?.shadowMap;
  return AUX_DRAW_FRAG_HEAD
    + (shadowMap ? AUX_DRAW_FRAG_SHADOWMAP_VARYING : '')
    + AUX_DRAW_FRAG_BODY_A
    + (shadowMap ? AUX_DRAW_FRAG_SHADOWMAP_WRITE : AUX_DRAW_FRAG_WRITE)
    + AUX_DRAW_FRAG_BODY_B;
}

export const AUX_DRAW_FRAG = buildAuxDrawFrag();

export const AUX_DRAW_FRAG_PHASE30 = buildAuxDrawFrag({ shadowMap: true });

