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
//   probability 0.35 * intensity (Kinetix's gate).
// - sparkTrail: the slot's primary candidate continuously sheds
//   sparks; spawning happens on the slot's own recycle with a hash
//   gate, and the spark velocity is sourceVel * 0.15 + hash spread
//   (Kinetix's allocateSlot call for sparkTrail).
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

const AUX_EVENT_GLSL = /* glsl */ `
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

  float auxHash(float n) { return fract(sin(n) * 43758.5453123); }
  vec3 auxHash3(float n) {
    return vec3(auxHash(n + 0.13), auxHash(n + 17.71), auxHash(n + 41.37)) - 0.5;
  }

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
        bool sphereHit = d > uBounceRadius * 0.985 && dot(mVel.xyz, n) > 2.0;
        bool floorHit = uFloorEnabled && mPos.y < uFloorY + 1.5 && mVel.xyz.y < -2.0;
        if ((sphereHit || floorHit) && gate < 0.35 * uAuxIntensity) {
          vec3 jitter = auxHash3(auxIdx * 3.97 + tick * 1.71);
          if (floorHit) {
            gAuxSpawnVel = vec3(jitter.x * 1.2, 0.55 + 0.65 * auxHash(auxIdx * 7.9 + tick), jitter.z * 1.2) * uAuxSpeed * 0.8;
            return vec4(vec3(mPos.x, uFloorY + 0.3, mPos.z), 1.0);
          }
          gAuxSpawnVel = (n * (0.5 + auxHash(auxIdx * 9.1 + tick)) + jitter * 0.9) * uAuxSpeed * 0.7;
          return vec4(mPos.xyz, 1.0);
        }
      }
    }
    return vec4(0.0, 0.0, 0.0, 0.0);
  }
`;

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

  float auxHashLocal(float n) { return fract(sin(n) * 43758.5453123); }

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

// ── Aux draw ──
export const AUX_DRAW_VERT = /* glsl */ `
  precision highp float;
  uniform sampler2D uAuxPosTex;
  uniform sampler2D uAuxVelTex;
  uniform float uAuxSize;
  attribute vec2 aTexCoord;
  varying float vAlpha;
  void main() {
    vec4 posData = texture2D(uAuxPosTex, aTexCoord);
    float life = texture2D(uAuxVelTex, aTexCoord).w;
    float age = posData.w;
    bool isActive = life > 0.001 && age < life;
    float t = life > 0.001 ? clamp(age / life, 0.0, 1.0) : 1.0;
    vAlpha = isActive ? smoothstep(0.0, 0.12, t) * (1.0 - smoothstep(0.55, 1.0, t)) : 0.0;
    vec3 worldPos = isActive ? posData.xyz : vec3(0.0, -99999.0, 0.0);
    vec4 mvPos = modelViewMatrix * vec4(worldPos, 1.0);
    float dist = -mvPos.z;
    gl_PointSize = max(0.5, uAuxSize * (dist > 0.5 ? min(4.0, 500.0 / dist) : 1.0));
    gl_Position = projectionMatrix * mvPos;
  }
`;

export const AUX_DRAW_FRAG = /* glsl */ `
  precision highp float;
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vAlpha;
  void main() {
    vec2 pc = gl_PointCoord - 0.5;
    float d = length(pc);
    if (d > 0.5) discard;
    float shapeAlpha = smoothstep(0.5, 0.12, d);
    gl_FragColor = vec4(uColor, shapeAlpha * uOpacity * vAlpha);
  }
`;
