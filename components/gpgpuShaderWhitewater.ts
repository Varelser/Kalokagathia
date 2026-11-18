// Whitewater (Phase BC): a foam pool derived from the FLIP
// field (Phase AT) — a second, fixed-size GPU particle pool
// (64x64 texels) whose particles are spawned by the FIELD, not
// by main-pool events (that is the aux pool's job, B3). The
// distinction is the spawn test: each inactive foam slot probes
// one hashed field cell per 60 Hz tick and spawns there when
// the cell's agitation — vorticity magnitude + convergence,
// computed from the projected field texture — passes the
// threshold gate. Foam is a strict one-way dependent: it reads
// the field and never writes back, so the FLIP pipeline and the
// main pool are untouched by its existence.
//
// State layout mirrors the aux pool: position texture (xyz +
// age in w) and velocity texture (xyz + per-particle life in
// w). A particle is inactive while age >= life (initial state:
// age 10, life 0). The velocity pass decides spawning (it owns
// the spawn velocity and the new life); the position pass
// re-evaluates the identical spawn test — same uniforms, same
// field texture, same hash of (slot, 60 Hz tick) — to place the
// particle, so the two passes can never disagree.
//
// The field operators and the gate mirror lib/whitewater.ts
// term for term; the unit tests measure that twin.
//
// Scope, honestly: the FLIP layer is a 2D planar (xz) solver,
// so the foam lives on a thin sheet around the field plane
// (y within ±6% of the field extent). No free surface, no
// curvature / energy criterion, no foam-vs-spray separation.

export const WW_TEX_SIZE = 64;

// ── Shared spawn test ──
const WW_SPAWN_GLSL = /* glsl */ `
  uniform sampler2D uFluidTex;
  uniform float uBounceRadius;
  uniform float uFluidScale;
  uniform float uFluidInfluence;
  uniform float uWwThreshold;
  uniform float uWwAmount;

  float wwHash(float n) { return fract(sin(n) * 43758.5453123); }
  vec3 wwHash3(float n) {
    return vec3(wwHash(n + 0.13), wwHash(n + 17.71), wwHash(n + 41.37)) - 0.5;
  }

  vec2 wwTapC(vec2 uv) {
    float ts = 1.0 / 64.0;
    return clamp(uv, vec2(0.5 * ts), vec2(1.0 - 0.5 * ts));
  }

  // Vorticity about the vertical axis, per-cell units, central
  // differences with edge-clamped taps: dvz/dx - dvx/dz.
  float wwVorticity(vec2 uv) {
    float ts = 1.0 / 64.0;
    vec2 vR = texture2D(uFluidTex, wwTapC(uv + vec2( ts, 0.0))).xy;
    vec2 vL = texture2D(uFluidTex, wwTapC(uv - vec2( ts, 0.0))).xy;
    vec2 vT = texture2D(uFluidTex, wwTapC(uv + vec2(0.0,  ts))).xy;
    vec2 vB = texture2D(uFluidTex, wwTapC(uv - vec2(0.0, ts))).xy;
    return (vR.y - vL.y - (vT.x - vB.x)) * 0.5;
  }

  // Divergence with backward differences — the same one-sided
  // stencil the pressure Jacobi solves against. Negative is
  // convergence (flow piling into the cell).
  float wwDivergence(vec2 uv) {
    float ts = 1.0 / 64.0;
    vec2 vC = texture2D(uFluidTex, uv).xy;
    vec2 vL = texture2D(uFluidTex, wwTapC(uv - vec2( ts, 0.0))).xy;
    vec2 vB = texture2D(uFluidTex, wwTapC(uv - vec2(0.0, ts))).xy;
    return (vC.x - vL.x) + (vC.y - vB.y);
  }

  // Foam factor in [0, 1]: 0 at or below the threshold, 1 once
  // the agitation source reaches twice the threshold.
  float wwFoamFactor(vec2 uv) {
    float src = abs(wwVorticity(uv)) + max(0.0, -wwDivergence(uv));
    return clamp((src - uWwThreshold) / max(uWwThreshold, 0.001), 0.0, 1.0);
  }

  vec3 gWwSpawnVel;

  // Probes this slot's hashed candidate cell for this tick.
  // Returns the spawn position in xyz and 1.0 in w when the
  // cell's foam factor passes the gate; gWwSpawnVel then holds
  // the spawn velocity (the field's PIC velocity at the cell +
  // an upward pop + a small hash spread).
  vec4 findWwSpawn(float wwIdx, float time) {
    float tick = floor(time * 60.0);
    vec2 cell = vec2(
      floor(wwHash(wwIdx * 3.71 + tick * 13.13) * 64.0),
      floor(wwHash(wwIdx * 7.93 + tick * 5.37) * 64.0));
    vec2 fuv = (cell + 0.5) / 64.0;
    float gate = wwHash(wwIdx * 11.17 + tick * 7.71);
    if (gate >= clamp(wwFoamFactor(fuv) * uWwAmount, 0.0, 1.0)) {
      return vec4(0.0, 0.0, 0.0, 0.0);
    }
    float extent = uBounceRadius * uFluidScale;
    vec2 wxz = (fuv - 0.5) * 2.0 * extent;
    // In-cell jitter so spawns do not sit on cell centres.
    wxz += wwHash3(wwIdx * 1.93 + tick).xz * (2.0 * extent / 64.0);
    float y = (wwHash(wwIdx * 5.13 + tick * 3.31) * 2.0 - 1.0) * extent * 0.06;
    vec2 fv = texture2D(uFluidTex, fuv).xy * (uFluidInfluence * 60.0);
    gWwSpawnVel = vec3(fv.x, (0.25 + 0.75 * wwHash(wwIdx * 9.31 + tick)) * 5.0, fv.y)
      + wwHash3(wwIdx * 2.57 + tick) * 4.0;
    return vec4(wxz.x, y, wxz.y, 1.0);
  }
`;

// ── Whitewater velocity pass ──
export const WW_VEL_FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D uWwPosTex;
  uniform sampler2D uWwVelTex;
  uniform float uDelta;
  uniform float uTime;
  uniform float uWwLife;
  varying vec2 vUv;
  ${WW_SPAWN_GLSL}

  float wwHashLocal(float n) { return fract(sin(n) * 43758.5453123); }

  void main() {
    vec4 wwPos = texture2D(uWwPosTex, vUv);
    vec4 wwVel = texture2D(uWwVelTex, vUv);
    float wwIdx = floor(vUv.y * 64.0) * 64.0 + floor(vUv.x * 64.0);
    float age = wwPos.w;
    float life = wwVel.w;
    if (age >= life) {
      // Inactive: spawn on a field event, else stay parked
      // (velocity 0, life unchanged so the position pass sees
      // the same state).
      vec4 sp = findWwSpawn(wwIdx, uTime);
      if (sp.w > 0.5) {
        float newLife = uWwLife * (0.6 + 0.8 * wwHashLocal(wwIdx * 11.3 + floor(uTime * 60.0)));
        gl_FragColor = vec4(gWwSpawnVel, newLife);
        return;
      }
      gl_FragColor = vec4(0.0, 0.0, 0.0, life);
      return;
    }
    vec3 vel = wwVel.xyz;
    // Carried by the flow: relax the horizontal velocity toward
    // the field's PIC velocity at the particle's own position
    // (the same field-to-world scale the G2P transfer uses).
    vec2 fuv = wwPos.xz / (uBounceRadius * uFluidScale) * 0.5 + 0.5;
    if (fuv.x > 0.0 && fuv.x < 1.0 && fuv.y > 0.0 && fuv.y < 1.0) {
      vec2 fv = texture2D(uFluidTex, fuv).xy * (uFluidInfluence * 60.0);
      vel.xz = mix(vel.xz, fv, clamp(uDelta * 4.0, 0.0, 1.0));
    }
    // The birth pop decays and the foam settles back onto the
    // sheet — there is no y solver to fall through, and gravity
    // belongs to the main pool, not to this decorative layer.
    vel.y *= max(0.0, 1.0 - 2.0 * uDelta);
    float spd = length(vel);
    if (spd > 350.0) vel *= 350.0 / spd;
    gl_FragColor = vec4(vel, life);
  }
`;

// ── Whitewater position pass ──
export const WW_POS_FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D uWwPosTex;
  uniform sampler2D uWwVelTex;
  uniform sampler2D uWwVelOutTex;
  uniform float uDelta;
  uniform float uTime;
  varying vec2 vUv;
  ${WW_SPAWN_GLSL}

  void main() {
    vec4 wwPos = texture2D(uWwPosTex, vUv);
    vec4 wwVelIn = texture2D(uWwVelTex, vUv);
    vec4 wwVel = texture2D(uWwVelOutTex, vUv);
    float wwIdx = floor(vUv.y * 64.0) * 64.0 + floor(vUv.x * 64.0);
    float age = wwPos.w;
    float life = wwVelIn.w;
    if (age >= life) {
      // Same spawn test as the velocity pass: on a spawn, place
      // the particle at the spawn position with age 0 (its
      // velocity was already written by the velocity pass).
      vec4 sp = findWwSpawn(wwIdx, uTime);
      if (sp.w > 0.5) {
        gl_FragColor = vec4(sp.xyz, 0.0);
        return;
      }
      gl_FragColor = vec4(wwPos.xyz, age);
      return;
    }
    vec3 pos = wwPos.xyz + wwVel.xyz * uDelta * 60.0;
    // Foam stays on the field sheet: horizontal clamp at the
    // field extent, vertical clamp at 1.6x the sheet thickness.
    float extent = uBounceRadius * uFluidScale;
    pos.x = clamp(pos.x, -extent, extent);
    pos.z = clamp(pos.z, -extent, extent);
    float sheet = extent * 0.06 * 1.6;
    pos.y = clamp(pos.y, -sheet, sheet);
    gl_FragColor = vec4(pos, age + uDelta);
  }
`;

// ── Whitewater draw ──
// Same points idiom as the aux draw (round soft sprite, age
// envelope), with foam's own touches: a per-particle size hash
// and a shrink over life (foam grains dissolve rather than
// pop out).
export const WW_DRAW_VERT = /* glsl */ `
  precision highp float;
  uniform sampler2D uWwPosTex;
  uniform sampler2D uWwVelTex;
  uniform float uWwSize;
  attribute vec2 aTexCoord;
  varying float vAlpha;

  float wwDrawHash(float n) { return fract(sin(n) * 43758.5453123); }

  void main() {
    vec4 posData = texture2D(uWwPosTex, aTexCoord);
    float life = texture2D(uWwVelTex, aTexCoord).w;
    float age = posData.w;
    bool isActive = life > 0.001 && age < life;
    float t = life > 0.001 ? clamp(age / life, 0.0, 1.0) : 1.0;
    vAlpha = isActive ? smoothstep(0.0, 0.15, t) * (1.0 - smoothstep(0.5, 1.0, t)) : 0.0;
    vec3 worldPos = isActive ? posData.xyz : vec3(0.0, -99999.0, 0.0);
    vec4 mvPos = modelViewMatrix * vec4(worldPos, 1.0);
    float dist = -mvPos.z;
    float wwIdx = floor(aTexCoord.y * 64.0) * 64.0 + floor(aTexCoord.x * 64.0);
    float sizeHash = 0.7 + 0.6 * wwDrawHash(wwIdx * 3.17);
    float size = uWwSize * sizeHash * (1.0 - 0.45 * t);
    gl_PointSize = max(0.5, size * (dist > 0.5 ? min(4.0, 500.0 / dist) : 1.0));
    gl_Position = projectionMatrix * mvPos;
  }
`;

export const WW_DRAW_FRAG = /* glsl */ `
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
