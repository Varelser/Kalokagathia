// Whitewater 3D (Phase 19 stage 2): the foam pool's spawn and
// transport while the FLIP mode is '3d'. The spawn source moves
// from the 2D field's thin sheet to the FLIP3D free surface: a
// hashed candidate cell (now 3D) must sit in the surface band
// (|phi| <= 1.5 cells) on the liquid side (chi >= 0.5) and pass
// the agitation gate — |curl| (now the full 3D vector) +
// convergence, in the same foam-factor shape as the 2D system.
// The birth position is projected onto the surface (phi = 0)
// along the phi gradient, the birth pop runs along the surface
// normal, and live foam is carried by the 3D grid velocity
// (trilinear sample) with NO sheet clamp — only the domain
// cube clamps. Still one foam population (no foam/spray
// split), still strictly one-way: foam never writes back into
// the grid. The TS twin is the whitewater3d* section of
// lib/whitewater.ts; the 2D shaders (gpgpuShaderWhitewater.ts)
// are untouched and remain the '2d' mode's path verbatim.

export const WW3_SPAWN_GLSL = /* glsl */ `
  uniform sampler2D uWw3VelTex;
  uniform sampler2D uWw3PhiTex;
  uniform float uWw3GridN;
  uniform vec2 uWw3AtlasSize;
  uniform vec2 uWw3AtlasTiles;
  uniform bool uWw3ManualTrilinear;
  uniform float uBounceRadius;
  uniform float uFluidScale;
  uniform float uWwThreshold;
  uniform float uWwAmount;
  uniform float uWw3VelScale;

  float ww3Hash(float n) { vec3 p3 = fract(vec3(n) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yxz + 33.33); return fract((p3.x + p3.y) * p3.z); }
  vec3 ww3Hash3(float n) {
    return vec3(ww3Hash(n + 0.13), ww3Hash(n + 17.71), ww3Hash(n + 41.37)) - 0.5;
  }

  vec2 ww3UvOfCell(vec3 cell) {
    vec2 tile = vec2(mod(cell.z, uWw3AtlasTiles.x), floor(cell.z / uWw3AtlasTiles.x));
    return (tile * uWw3GridN + cell.xy + 0.5) / uWw3AtlasSize;
  }
  vec3 ww3ClampCell(vec3 c) {
    return clamp(c, vec3(0.0), vec3(uWw3GridN - 1.0));
  }
  vec4 ww3Fetch(sampler2D tex, vec3 cell) {
    return texture2D(tex, ww3UvOfCell(ww3ClampCell(cell)));
  }
  vec4 ww3Sample(sampler2D tex, vec3 p) {
    vec3 pc = clamp(p, vec3(0.0), vec3(uWw3GridN - 1.0));
    vec3 b = floor(pc);
    vec3 f = pc - b;
    if (uWw3ManualTrilinear) {
      vec4 c000 = ww3Fetch(tex, b);
      vec4 c100 = ww3Fetch(tex, b + vec3(1.0, 0.0, 0.0));
      vec4 c010 = ww3Fetch(tex, b + vec3(0.0, 1.0, 0.0));
      vec4 c110 = ww3Fetch(tex, b + vec3(1.0, 1.0, 0.0));
      vec4 c001 = ww3Fetch(tex, b + vec3(0.0, 0.0, 1.0));
      vec4 c101 = ww3Fetch(tex, b + vec3(1.0, 0.0, 1.0));
      vec4 c011 = ww3Fetch(tex, b + vec3(0.0, 1.0, 1.0));
      vec4 c111 = ww3Fetch(tex, b + vec3(1.0, 1.0, 1.0));
      return mix(mix(mix(c000, c100, f.x), mix(c010, c110, f.x), f.y),
                 mix(mix(c001, c101, f.x), mix(c011, c111, f.x), f.y), f.z);
    }
    float z1 = min(b.z + 1.0, uWw3GridN - 1.0);
    vec2 tile0 = vec2(mod(b.z, uWw3AtlasTiles.x), floor(b.z / uWw3AtlasTiles.x));
    vec2 tile1 = vec2(mod(z1, uWw3AtlasTiles.x), floor(z1 / uWw3AtlasTiles.x));
    vec2 xy = pc.xy + 0.5;
    vec4 s0 = texture2D(tex, (tile0 * uWw3GridN + xy) / uWw3AtlasSize);
    vec4 s1 = texture2D(tex, (tile1 * uWw3GridN + xy) / uWw3AtlasSize);
    return mix(s0, s1, f.z);
  }

  vec3 ww3Curl(vec3 cell) {
    float duzDy = (ww3Fetch(uWw3VelTex, cell + vec3(0.0, 1.0, 0.0)).z - ww3Fetch(uWw3VelTex, cell - vec3(0.0, 1.0, 0.0)).z) * 0.5;
    float duyDz = (ww3Fetch(uWw3VelTex, cell + vec3(0.0, 0.0, 1.0)).y - ww3Fetch(uWw3VelTex, cell - vec3(0.0, 0.0, 1.0)).y) * 0.5;
    float duxDz = (ww3Fetch(uWw3VelTex, cell + vec3(0.0, 0.0, 1.0)).x - ww3Fetch(uWw3VelTex, cell - vec3(0.0, 0.0, 1.0)).x) * 0.5;
    float duzDx = (ww3Fetch(uWw3VelTex, cell + vec3(1.0, 0.0, 0.0)).z - ww3Fetch(uWw3VelTex, cell - vec3(1.0, 0.0, 0.0)).z) * 0.5;
    float duyDx = (ww3Fetch(uWw3VelTex, cell + vec3(1.0, 0.0, 0.0)).y - ww3Fetch(uWw3VelTex, cell - vec3(1.0, 0.0, 0.0)).y) * 0.5;
    float duxDy = (ww3Fetch(uWw3VelTex, cell + vec3(0.0, 1.0, 0.0)).x - ww3Fetch(uWw3VelTex, cell - vec3(0.0, 1.0, 0.0)).x) * 0.5;
    return vec3(duzDy - duyDz, duxDz - duzDx, duyDx - duxDy);
  }

  float ww3Divergence(vec3 cell) {
    vec3 vC = ww3Fetch(uWw3VelTex, cell).xyz;
    return (vC.x - ww3Fetch(uWw3VelTex, cell - vec3(1.0, 0.0, 0.0)).x)
         + (vC.y - ww3Fetch(uWw3VelTex, cell - vec3(0.0, 1.0, 0.0)).y)
         + (vC.z - ww3Fetch(uWw3VelTex, cell - vec3(0.0, 0.0, 1.0)).z);
  }

  vec3 ww3Normal(vec3 cell) {
    vec3 g = vec3(
      ww3Fetch(uWw3PhiTex, cell + vec3(1.0, 0.0, 0.0)).r - ww3Fetch(uWw3PhiTex, cell - vec3(1.0, 0.0, 0.0)).r,
      ww3Fetch(uWw3PhiTex, cell + vec3(0.0, 1.0, 0.0)).r - ww3Fetch(uWw3PhiTex, cell - vec3(0.0, 1.0, 0.0)).r,
      ww3Fetch(uWw3PhiTex, cell + vec3(0.0, 0.0, 1.0)).r - ww3Fetch(uWw3PhiTex, cell - vec3(0.0, 0.0, 1.0)).r
    ) * 0.5;
    float len = length(g);
    return len < 1e-9 ? vec3(0.0) : g / len;
  }

  vec3 gWw3SpawnVel;

  // Probes this slot's hashed 3D candidate cell for this tick.
  // Returns the surface-projected birth position in xyz and
  // 1.0 in w on a spawn; gWw3SpawnVel then holds the birth
  // velocity (grid PIC + normal pop + hash spread).
  vec4 findWw3Spawn(float wwIdx, float time) {
    float tick = floor(time * 60.0);
    vec3 cell = vec3(
      floor(ww3Hash(wwIdx * 3.71 + tick * 13.13) * uWw3GridN),
      floor(ww3Hash(wwIdx * 7.93 + tick * 5.37) * uWw3GridN),
      floor(ww3Hash(wwIdx * 13.71 + tick * 7.37) * uWw3GridN));
    vec2 phiChi = ww3Fetch(uWw3PhiTex, cell).rg;
    float factor = 0.0;
    if (abs(phiChi.r) <= 1.5 && phiChi.g >= 0.5) {
      float src = length(ww3Curl(cell)) + max(0.0, -ww3Divergence(cell));
      factor = clamp((src - uWwThreshold) / max(uWwThreshold, 0.001), 0.0, 1.0);
    }
    float gate = ww3Hash(wwIdx * 11.17 + tick * 7.71);
    if (gate >= clamp(factor * uWwAmount, 0.0, 1.0)) {
      return vec4(0.0, 0.0, 0.0, 0.0);
    }
    float extent = uBounceRadius * uFluidScale;
    float cellWorld = 2.0 * extent / uWw3GridN;
    vec3 normal = ww3Normal(cell);
    vec3 world = ((cell + 0.5) / uWw3GridN - 0.5) * 2.0 * extent
      - normal * phiChi.r * cellWorld;
    world += ww3Hash3(wwIdx * 1.93 + tick) * cellWorld;
    vec3 gv = ww3Fetch(uWw3VelTex, cell).xyz * uWw3VelScale;
    float pop = (0.25 + 0.75 * ww3Hash(wwIdx * 9.31 + tick)) * 5.0;
    gWw3SpawnVel = gv + normal * pop + ww3Hash3(wwIdx * 2.57 + tick) * 4.0;
    return vec4(world, 1.0);
  }
`;

// ── Whitewater 3D velocity pass ──
export const WW3_VEL_FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D uWwPosTex;
  uniform sampler2D uWwVelTex;
  uniform float uDelta;
  uniform float uTime;
  uniform float uWwLife;
  varying vec2 vUv;
  ${WW3_SPAWN_GLSL}

  float ww3HashLocal(float n) { vec3 p3 = fract(vec3(n) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yxz + 33.33); return fract((p3.x + p3.y) * p3.z); }

  void main() {
    vec4 wwPos = texture2D(uWwPosTex, vUv);
    vec4 wwVel = texture2D(uWwVelTex, vUv);
    float wwIdx = floor(vUv.y * 64.0) * 64.0 + floor(vUv.x * 64.0);
    float age = wwPos.w;
    float life = wwVel.w;
    if (age >= life) {
      vec4 sp = findWw3Spawn(wwIdx, uTime);
      if (sp.w > 0.5) {
        float newLife = uWwLife * (0.6 + 0.8 * ww3HashLocal(wwIdx * 11.3 + floor(uTime * 60.0)));
        gl_FragColor = vec4(gWw3SpawnVel, newLife);
        return;
      }
      gl_FragColor = vec4(0.0, 0.0, 0.0, life);
      return;
    }
    vec3 vel = wwVel.xyz;
    // Carried by the 3D grid: relax toward the trilinear grid
    // velocity at the foam particle's own position (all three
    // components — the grid solves y motion too).
    float extent = uBounceRadius * uFluidScale;
    vec3 cellPos = (wwPos.xyz / (2.0 * extent) + 0.5) * uWw3GridN - 0.5;
    if (cellPos.x > -1.0 && cellPos.y > -1.0 && cellPos.z > -1.0
        && cellPos.x < uWw3GridN && cellPos.y < uWw3GridN && cellPos.z < uWw3GridN) {
      vec3 gv = ww3Sample(uWw3VelTex, cellPos).xyz * uWw3VelScale;
      vel = mix(vel, gv, clamp(uDelta * 4.0, 0.0, 1.0));
    }
    float spd = length(vel);
    if (spd > 350.0) vel *= 350.0 / spd;
    gl_FragColor = vec4(vel, life);
  }
`;

// ── Whitewater 3D position pass ──
export const WW3_POS_FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D uWwPosTex;
  uniform sampler2D uWwVelTex;
  uniform sampler2D uWwVelOutTex;
  uniform float uDelta;
  uniform float uTime;
  varying vec2 vUv;
  ${WW3_SPAWN_GLSL}

  void main() {
    vec4 wwPos = texture2D(uWwPosTex, vUv);
    vec4 wwVelIn = texture2D(uWwVelTex, vUv);
    vec4 wwVel = texture2D(uWwVelOutTex, vUv);
    float wwIdx = floor(vUv.y * 64.0) * 64.0 + floor(vUv.x * 64.0);
    float age = wwPos.w;
    float life = wwVelIn.w;
    if (age >= life) {
      vec4 sp = findWw3Spawn(wwIdx, uTime);
      if (sp.w > 0.5) {
        gl_FragColor = vec4(sp.xyz, 0.0);
        return;
      }
      gl_FragColor = vec4(wwPos.xyz, age);
      return;
    }
    vec3 pos = wwPos.xyz + wwVel.xyz * uDelta * 60.0;
    // No sheet clamp in 3D: only the domain cube bounds the foam.
    float extent = uBounceRadius * uFluidScale;
    pos = clamp(pos, vec3(-extent), vec3(extent));
    gl_FragColor = vec4(pos, age + uDelta);
  }
`;
