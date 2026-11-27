import { PARTICLE_SHAPE_GLSL } from './particleShapeGlsl';
import { LIGHT_SHADOW_GLSL } from '../lib/lightShadowMap';

// Sprite sheet (Phase AD): GLSL twins of lib/spriteSheet.ts
// (spriteFrameIndex / spriteSheetUv — same formulas, so the
// unit tests pin the shader too). Mode: 0 age, 1 fps, 2 random.
const SPRITE_SHEET_GLSL = /* glsl */ `
  float kaloSpriteFrame(float cols, float rows, float mode, float fps, bool loop, float normAge, float timeSeconds, float seed) {
    float total = cols * rows;
    if (total <= 1.0) return 0.0;
    if (mode > 1.5) {
      return floor(clamp(seed, 0.0, 0.999999) * total);
    }
    float raw;
    if (mode > 0.5) {
      raw = floor(max(timeSeconds, 0.0) * fps);
    } else {
      raw = floor(clamp(normAge, 0.0, 1.0) * total);
    }
    if (loop) return mod(raw, total);
    return min(raw, total - 1.0);
  }
  vec2 kaloSpriteSheetUv(vec2 pointCoord, float cols, float rows, float frame) {
    float col = mod(frame, cols);
    float row = floor(frame / cols);
    return vec2((col + pointCoord.x) / cols, 1.0 - (row + pointCoord.y) / rows);
  }
`;

// Phase U shared helpers: the 5-point age curve (GLSL twin of
// lib/ageCurve.ts evaluateAgeCurve — same knots at t = 0/.25/.5/.75/1,
// same piecewise-linear blend, so an all-ones curve is exactly 1.0)
// and the per-property Layer Map factor (mix(1, luma, amount): 0 is
// identity, 1 makes the sampled luminance the multiplier itself).
const AGE_CURVE_GLSL = /* glsl */ `
  float kaloEvalCurve5(float t, float p0, float p1, float p2, float p3, float p4) {
    float x = clamp(t, 0.0, 1.0) * 4.0;
    float v = p0;
    v = mix(v, p1, clamp(x, 0.0, 1.0));
    v = mix(v, p2, clamp(x - 1.0, 0.0, 1.0));
    v = mix(v, p3, clamp(x - 2.0, 0.0, 1.0));
    v = mix(v, p4, clamp(x - 3.0, 0.0, 1.0));
    return v;
  }
  float kaloMapFactor(sampler2D tex, vec2 worldXy, float scale, float amount) {
    vec2 mapUv = clamp(worldXy * scale + 0.5, 0.0, 1.0);
    float luma = dot(texture2D(tex, mapUv).rgb, vec3(0.2126, 0.7152, 0.0722));
    return mix(1.0, luma, amount);
  }
  // Raw map luminance at a world position (Phase X: displacement
  // and the fragment mask clip share the map UV rule).
  float kaloMapLuma(sampler2D tex, vec2 worldXy, float scale) {
    vec2 mapUv = clamp(worldXy * scale + 0.5, 0.0, 1.0);
    return dot(texture2D(tex, mapUv).rgb, vec3(0.2126, 0.7152, 0.0722));
  }
`;

// Noise field map (Phase AY): the engine's scalar noise field as
// a map source. hash3 / vnoise are copied verbatim from the
// velocity pass helpers, so the map reads the SAME field the curl
// force is built from; kaloNoiseMap01 maps it to [0, 1] at
// worldPos * scale + the evolution offset (direction * evolve *
// time — evolve 0 is a static field). The field is a pure
// function of (position, time), so the deterministic render
// reproduces it exactly. TS twin: lib/noiseFieldMap.ts
// (sampleNoiseField01).
// Phase BJ: the field carries a kind (0 perlin / 1 turbulence /
// 2 ridge — the octave reading) and an fBm octave count (loop
// capped at 5, cut by the octaves uniform), the same definition
// as the TS twin. Kind 0 with 1 octave reduces to the Phase AY
// expression above exactly (one term, amplitude sum 1, identity
// reading, the perlin 0.5 + 0.5 * v mapping).
const NOISE_MAP_GLSL = /* glsl */ `
  float dmHash11(float n) {
    vec3 p3 = fract(vec3(n) * vec3(0.1031, 0.1030, 0.0973));
    p3 += dot(p3, p3.yxz + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
  vec3 kaloNoiseHash3(vec3 p) {
    p = vec3(dot(p,vec3(127.1,311.7,74.7)),dot(p,vec3(269.5,183.3,246.1)),dot(p,vec3(113.5,271.9,124.6)));
    return -1.0 + 2.0 * vec3(dmHash11(p.x), dmHash11(p.y), dmHash11(p.z));
  }
  float kaloNoiseValue(vec3 p) {
    vec3 i = floor(p); vec3 f = fract(p); vec3 u = f*f*(3.0-2.0*f);
    return mix(mix(mix(dot(kaloNoiseHash3(i),f),dot(kaloNoiseHash3(i+vec3(1,0,0)),f-vec3(1,0,0)),u.x),
                   mix(dot(kaloNoiseHash3(i+vec3(0,1,0)),f-vec3(0,1,0)),dot(kaloNoiseHash3(i+vec3(1,1,0)),f-vec3(1,1,0)),u.x),u.y),
               mix(mix(dot(kaloNoiseHash3(i+vec3(0,0,1)),f-vec3(0,0,1)),dot(kaloNoiseHash3(i+vec3(1,0,1)),f-vec3(1,0,1)),u.x),
                   mix(dot(kaloNoiseHash3(i+vec3(0,1,1)),f-vec3(0,1,1)),dot(kaloNoiseHash3(i+vec3(1,1,1)),f-vec3(1,1,1)),u.x),u.y),u.z);
  }
  float kaloNoiseOctave(float v, float kind) {
    if (kind > 1.5) return 1.0 - abs(v);
    if (kind > 0.5) return abs(v);
    return v;
  }
  float kaloNoiseMap01(vec3 worldPos, float scale, float evolve, float time, float kind, float octaves) {
    vec3 p = worldPos * scale + vec3(0.31, 0.47, 0.19) * (evolve * max(time, 0.0));
    float sum = 0.0;
    float ampSum = 0.0;
    float amp = 1.0;
    float freq = 1.0;
    for (int i = 0; i < 5; i++) {
      if (float(i) >= octaves) break;
      sum += amp * kaloNoiseOctave(kaloNoiseValue(p * freq), kind);
      ampSum += amp;
      amp *= 0.5;
      freq *= 2.0;
    }
    float v = sum / ampSum;
    if (kind < 0.5) v = 0.5 + 0.5 * v;
    return clamp(v, 0.0, 1.0);
  }
`;

// 3D light (Phase T): GLSL twins of lib/gpgpuLight.ts — the same
// falloff ((1-(d/R)^2)^2 inside the radius, 0 outside) and the same
// cone feather (smoothstep from the half angle out to 1.25x it,
// clamped at 180 degrees), so the JS reference and the shader agree
// value for value. The multiplier is 1 + intensity * falloff *
// cone: exactly 1 at / beyond the radius, so unlit particles are
// untouched.
const LIGHT_GLSL = /* glsl */ `
  float kaloLightFalloff(float d, float radius) {
    if (radius <= 0.0 || d >= radius) return 0.0;
    float x = 1.0 - (d / radius) * (d / radius);
    return x * x;
  }
  float kaloLightConeFactor(float cosAngle, float halfAngleDeg) {
    if (halfAngleDeg <= 0.0) return cosAngle >= 1.0 ? 1.0 : 0.0;
    if (halfAngleDeg >= 180.0) return 1.0;
    float inner = cos(radians(halfAngleDeg));
    float outer = cos(radians(min(halfAngleDeg * 1.25, 180.0)));
    return smoothstep(outer, inner, cosAngle);
  }
  float kaloLightMultiplier(vec3 worldPos, vec3 lightPos, float intensity, float radius, bool coneEnabled, float coneAngleDeg, vec3 coneDir) {
    vec3 toP = worldPos - lightPos;
    float d = length(toP);
    float f = kaloLightFalloff(d, radius);
    if (coneEnabled && d > 0.0) {
      f *= kaloLightConeFactor(dot(toP / d, coneDir), coneAngleDeg);
    }
    return 1.0 + intensity * f;
  }
`;

// ── Draw vertex (main points) ──
const DRAW_VERT_HEAD = /* glsl */ `
  precision highp float;
  uniform sampler2D uPosTex;
  uniform sampler2D uVelTex;
  uniform sampler2D uSortTex;
  uniform bool      uSortEnabled;
  uniform float uSize;
  // Ring (attractor space mode): draw-side -z offset of the
  // sampled position; 0 unless ring is active.
  uniform float uRingOffsetZ;
  uniform bool  uAgeEnabled;
  uniform float uAgeMax;
  uniform bool  uAgeSizeEnabled;
  uniform int   uAgeSizeCurve;
  uniform bool  uKuramotoEnabled;
  uniform float uKuramotoInfluence;
  uniform float uAgeSizeStart;
  uniform float uAgeSizeEnd;
  // Age curve (Phase U): size multiplier over normalised age.
  uniform bool  uAgeCurveSizeEnabled;
  uniform float uAgeCurveSize[5];
  // Layer Map (Phase U): the gradient image sampled by particle
  // position (same uniforms the fragment's image driver uses).
  uniform sampler2D uGradImageTex;
  uniform bool      uGradImageReady;
  uniform float     uGradImageScale;
  uniform float     uMapSizeAmount;
  // Per-property map + displacement (Phase X): when the size map
  // has its own source its texture is ready here and takes priority
  // over the common gradient image; displacement samples its own
  // (or the fallback common) texture and offsets the point radially
  // by (luma - 0.5) * amount * radius. Amount 0 / not ready keeps
  // the legacy position bit-exact.
  uniform sampler2D uMapSizeTex;
  uniform bool      uMapSizeReady;
  uniform sampler2D uMapDisplaceTex;
  uniform bool      uMapDisplaceReady;
  uniform float     uMapDisplaceAmount;
  uniform float     uMapDisplaceRadius;
  // Noise field map (Phase AY): the field as a source for size
  // and displacement. Amounts 0 (defaults) skip the evaluation
  // entirely, so the legacy draw is bit-identical; the field
  // parameters are shared with the fragment's gradient driver.
  uniform float     uNoiseMapScale;
  uniform float     uNoiseMapEvolve;
  uniform float     uNoiseMapTime;
  uniform float     uNoiseMapSizeAmount;
  uniform float     uNoiseMapDisplaceAmount;
  uniform float     uNoiseMapKind;
  uniform float     uNoiseMapOctaves;
  // 3D light (Phase T): brightness multiplier from the light object.
  uniform bool  uLightEnabled;
  uniform vec3  uLightPos;
  uniform float uLightIntensity;
  uniform float uLightRadius;
  uniform bool  uLightConeEnabled;
  uniform float uLightConeAngleDeg;
  uniform vec3  uLightConeDir;
  // Occlusion-map shadow (Phase Z): the baked occlusion grid
  // (lib/shadowOcclusion.ts) sampled by world XZ; the G channel
  // holds the baked surface height so the vertex can attenuate
  // the occlusion by height above the surface — the same formula
  // as shadowHeightAttenuation / bakedShadowMultiplier in the TS
  // reference. Disabled / strength 0 yields exactly 1.0.
  uniform bool      uShadowEnabled;
  uniform float     uShadowStrength;
  uniform sampler2D uShadowMap;
  uniform bool      uShadowReady;
  uniform float     uShadowExtent;
  uniform float     uShadowHeightScale;
  uniform bool  uParticleLifeEnabled;
  uniform int   uParticleLifeSpecies;
  uniform float uTexSizeF;
  // Named attributes (Phase AK): the static attribute texture
  // (lib/gpgpuAttributes.ts) in the global texel layout. The
  // passes resolve uAttrEnabled off unless the texture exists
  // and a draw drive is active, so the default draw is
  // bit-identical (vAttrBright stays exactly 1.0).
  uniform sampler2D uAttrTex;
  uniform bool      uAttrEnabled;
  uniform int       uAttrSizeSlot;
  uniform float     uAttrSizeAmount;
  uniform int       uAttrBrightSlot;
  uniform float     uAttrBrightAmount;
  // Colour drive (Phase CL): the three colour slots hold the
  // RAW colorR / colorG / colorB values (resolved CPU-side from
  // the slot names); disabled leaves vAttrColor at exactly
  // vec3(1.0), so the fragment's multiply is a bit-exact
  // identity on the legacy path.
  uniform bool      uAttrColorEnabled;
  uniform int       uAttrColorSlotR;
  uniform int       uAttrColorSlotG;
  uniform int       uAttrColorSlotB;
  // Group colour gating (Phase DG): the named group referenced
  // by the Gate Group gates the colour drive — members keep the
  // attribute colour, non-members stay at exactly vec3(1.0).
  // Same uniforms the velocity force gate uses.
  uniform bool      uGroupColorEnabled;
  uniform int       uGroupSlot;
  uniform int       uGroupMode;
  uniform float     uGroupLow;
  uniform float     uGroupHigh;
  uniform bool      uGroupInvert;
  // Density compensation (Phase DN, DA6): alpha multiplier that
  // keeps the apparent coverage at the target density rho when
  // the count / point size / viewport change. Disabled yields
  // exactly 1.0 (bit-identical legacy draw). TS twin:
  // lib/densityComp.ts (densityCompMultiplier).
  uniform bool      uDensityCompEnabled;
  uniform float     uDensityTarget;
  uniform float     uDensityCount;
  uniform vec2      uViewportSizePx;
`;
const DRAW_VERT_CRACK_UNIFORMS = /* glsl */ `  // Vellum crack visualisation (Phase 19 stage 3): while the
  // tear gap is on, texels touching a dead structural link are
  // flagged in the vertex (vCrack) — the fragment darkens them
  // and the point grows slightly, giving the torn seam a
  // visible thickness. Disabled (the default) leaves vCrack at
  // exactly 0 and the draw bit-identical.
  uniform bool      uVellumCrackEnabled;
  uniform sampler2D uVellumStateTex;
  uniform int       uVellumMode;
`;
const DRAW_VERT_CLUSTER_UNIFORMS = /* glsl */ `  // Rigid cluster colouring (Phase 20 stage 1): while on, the
  // particle's body index comes from the rigid cell texture
  // (.w, the same texture the position pass consumes) and the
  // per-body cluster colour from the 64x1 LUT (row = body
  // index). The fragment replaces the base colour with it —
  // age / velocity colour and the gradient still win over it,
  // in the legacy priority order.
  uniform bool      uClusterColorEnabled;
  uniform sampler2D uClusterCellTex;
  uniform sampler2D uClusterColorLutTex;
`;
const DRAW_VERT_SHADOWTUNNEL_UNIFORMS = /* glsl */ `  // Tunnel occlusion bake (Round 83/84 gap 7): the Phase Z
  // occlusion grid baked over the tunnel surface instead of
  // the plane (lib/shadowOcclusion.ts bakeTunnelShadowOcclusionMap).
  // Present only in the tunnel variant; the stock strings never
  // declare these, so tunnel-off draws stay byte-identical.
  uniform sampler2D uShadowTunnelMap;
  uniform bool      uShadowTunnelReady;
`;
const DRAW_VERT_MID_A = /* glsl */ `  attribute vec2 aTexCoord;
  varying float vSpeed;
  varying float vNormAge;
  // Sprite rotation (Phase AX): the raw particle age, for the
  // fragment's age-driven sprite angle (lib/spriteRotation.ts).
  varying float vAge;
  varying float vPhaseMix;
  varying float vPlBright;
  varying float vAttrBright;
  varying vec3 vAttrColor;
  varying float vSeed;
  varying vec3 vWorldPos;
  varying float vLightMul;
  varying float vShadowMul;
  varying float vDensityMul;
`;
const DRAW_VERT_CRACK_VARYING = /* glsl */ `  varying float vCrack;
`;
const DRAW_VERT_CLUSTER_VARYING = /* glsl */ `  varying vec3 vClusterColor;
  varying float vClusterOn;
`;
const DRAW_VERT_SHADOWMAP_VARYING = /* glsl */ `  // True shadow map (Phase 23, wiring stage 2): the raw
  // light-viewpoint depth factor at the particle's world
  // position (1 = lit, also 1 while the capture is not ready
  // or the particle is outside the shadow frustum). The
  // fragment unions it with the Phase Z occlusion factor.
  varying float vShadowMapMul;
`;
const DRAW_VERT_SHADOWTUNNEL_FN = /* glsl */ `  // Tunnel shadow sample (Round 83/84 gap 7): the twin of
  // bakedTunnelShadowMultiplier in lib/shadowOcclusion.ts.
  // Returns the tunnel-bake multiplier when the point is inside
  // the tube region (radial distance <= extent + half the
  // height scale, |z| <= extent), or -1.0 when the plane bake
  // result (already in vShadowMul) must be kept. The inverse
  // transform is theta normalised into [0, 1) by fract (the
  // bake's theta = u * 2*pi) and z into [0, 1]; the height
  // attenuation runs radially outward from the baked wall
  // surface radius. uShadowExtent is the tunnel radius and
  // uShadowHeightScale is 2 * amplitude * worldScale, exactly
  // as in the plane path.
  float kaloShadowTunnelMultiplier(vec3 worldPos) {
    float rho = length(worldPos.xy);
    if (rho > uShadowExtent + uShadowHeightScale * 0.5 || abs(worldPos.z) > uShadowExtent) return -1.0;
    float u = fract(atan(worldPos.y, worldPos.x) / 6.28318530718);
    float v = clamp(worldPos.z / (2.0 * uShadowExtent) + 0.5, 0.0, 1.0);
    vec4 baked = texture2D(uShadowTunnelMap, vec2(u, v));
    float surfaceH = (baked.g - 0.5) * uShadowHeightScale;
    float rSurface = uShadowExtent - surfaceH;
    float above = max(rho - rSurface, 0.0);
    float atten = exp(-above / max(1.0, uShadowExtent * 0.35));
    return 1.0 - uShadowStrength * baked.r * atten;
  }
`;
const DRAW_VERT_MID_B = /* glsl */ `
  ${AGE_CURVE_GLSL}

  ${NOISE_MAP_GLSL}

  // Attribute channel picker (Phase AK): identical to the
  // velocity pass's copy — R/G/B/A are attribute slots 0/1/2/3
  // (buildAttributeData in lib/gpgpuAttributes.ts).
  float kaloAttrChannel(vec4 a, int slot) {
    if (slot == 0) return a.r;
    if (slot == 1) return a.g;
    if (slot == 2) return a.b;
    return a.a;
  }

  // Group membership (Phase AK): identical copy of the velocity
  // pass helper — inclusive boundaries composed from step(), so
  // it matches groupMembership in lib/gpgpuAttributes.ts exactly.
  // Modes: 0 below (av <= high), 1 above (av >= low), 2 band.
  float kaloGroupMembership(float av, int mode, float low, float high, bool invert) {
    float m;
    if (mode == 0) m = step(av, high);
    else if (mode == 1) m = step(low, av);
    else m = step(low, av) * step(av, high);
    return invert ? 1.0 - m : m;
  }

  ${LIGHT_GLSL}

  // Phase Z shadow sample: occlusion from the bake, attenuated
  // by height above the baked terrain surface.
  float kaloShadowMultiplier(vec3 worldPos) {
    if (!uShadowEnabled || !uShadowReady || uShadowStrength <= 0.0) return 1.0;
    vec2 uv = clamp(worldPos.xz / (2.0 * uShadowExtent) + 0.5, 0.0, 1.0);
    vec4 baked = texture2D(uShadowMap, uv);
    float surfaceH = (baked.g - 0.5) * uShadowHeightScale;
    float above = max(worldPos.y - surfaceH, 0.0);
    float atten = exp(-above / max(1.0, uShadowExtent * 0.35));
    return 1.0 - uShadowStrength * baked.r * atten;
  }

  // Particle Life species helpers — must match the velocity sim exactly.
  float plHash(float n) {
    return dmHash11(n * 3.71 + 17.17);
  }
  int plSpecies(vec2 uv) {
    float idx = floor(uv.y * uTexSizeF) * uTexSizeF + floor(uv.x * uTexSizeF);
    float h = plHash(idx + 17.17);
    return int(min(floor(h * float(uParticleLifeSpecies)), float(uParticleLifeSpecies - 1)));
  }
  float plBrightness(int s) {
    if (s == 0) return 0.45;
    if (s == 1) return 0.65;
    if (s == 2) return 0.85;
    if (s == 3) return 1.0;
    if (s == 4) return 0.55;
    return 0.75;
  }
  float plSizeMul(int s) {
    if (s == 0) return 1.3;
    if (s == 1) return 1.0;
    if (s == 2) return 0.8;
    if (s == 3) return 1.15;
    if (s == 4) return 0.9;
    return 1.05;
  }
  void main() {
    vec2 particleUv = uSortEnabled ? texture2D(uSortTex, aTexCoord).xy : aTexCoord;
    vec4 posData  = texture2D(uPosTex, particleUv);
    vec3 worldPos = posData.xyz;
    worldPos.z -= uRingOffsetZ;
    // Displacement map (Phase X): the baked point is pushed along
    // its own radial direction by the displacement map's luminance
    // at its position — the map-space twin of the media relief the
    // bake applies to text/image targets. Gated on amount > 0 and a
    // ready texture, so the default path is untouched.
    if (uMapDisplaceAmount > 0.0 && uMapDisplaceReady) {
      float dLuma = kaloMapLuma(uMapDisplaceTex, worldPos.xy, uGradImageScale);
      float rLen = length(worldPos);
      if (rLen > 0.0001) {
        worldPos += (worldPos / rLen) * ((dLuma - 0.5) * uMapDisplaceAmount * uMapDisplaceRadius);
      }
    } else if (uNoiseMapDisplaceAmount > 0.0) {
      // Noise field displacement (Phase AY): while the texture
      // displacement path is inactive, the field value at the
      // particle's own position takes the luminance's place in
      // the same Phase X formula (radial, same radius). A ready
      // texture map keeps priority, mirroring the size map rule.
      float nLuma = kaloNoiseMap01(worldPos, uNoiseMapScale, uNoiseMapEvolve, uNoiseMapTime, uNoiseMapKind, uNoiseMapOctaves);
      float rLen = length(worldPos);
      if (rLen > 0.0001) {
        worldPos += (worldPos / rLen) * ((nLuma - 0.5) * uNoiseMapDisplaceAmount * uMapDisplaceRadius);
      }
    }
    vWorldPos = worldPos;
    // 3D light (Phase T): a pure function of the world position —
    // the simulation is never touched. Disabled means exactly 1.0,
    // so the fragment's multiply is a bit-exact identity.
    vLightMul = uLightEnabled
      ? kaloLightMultiplier(worldPos, uLightPos, uLightIntensity, uLightRadius, uLightConeEnabled, uLightConeAngleDeg, uLightConeDir)
      : 1.0;
    vShadowMul = kaloShadowMultiplier(worldPos);
    vec3 vel      = texture2D(uVelTex, particleUv).xyz;
    vSpeed   = clamp(length(vel) / 80.0, 0.0, 1.0);
    vNormAge = uAgeEnabled ? clamp(posData.w / max(uAgeMax, 0.001), 0.0, 1.0) : 0.5;
    vAge = posData.w;
    vSeed    = dmHash11(dot(aTexCoord, vec2(127.1, 311.7)));
    // Size over lifetime: curve 0 is the legacy linear start->end mix;
    // curve 1 is the Kinetix 'bell' (B1b): end -> start -> end following
    // sin(pi * t), so particles grow after birth and shrink before death.
    float sizeMul = 1.0;
    if (uAgeSizeEnabled) {
      sizeMul = uAgeSizeCurve == 1
        ? mix(uAgeSizeEnd, uAgeSizeStart, sin(3.14159265 * vNormAge))
        : mix(uAgeSizeStart, uAgeSizeEnd, vNormAge);
    }
    // Age curve (Phase U): a multiplier layered on the legacy size
    // path — flat (all-ones) points keep the legacy size bit-exact.
    if (uAgeCurveSizeEnabled) {
      sizeMul *= kaloEvalCurve5(vNormAge, uAgeCurveSize[0], uAgeCurveSize[1], uAgeCurveSize[2], uAgeCurveSize[3], uAgeCurveSize[4]);
    }
    // Named attributes (Phase AK): the size / brightness drives
    // read the particle's own texel of the attribute texture
    // (particleUv — the post-sort texel, like every other
    // per-particle read above). The factor form is mix(1, attr,
    // amount): amount 0 or slot -1 is resolved off CPU-side, and
    // vAttrBright is exactly 1.0 while the drive is off.
    vAttrBright = 1.0;
    vAttrColor = vec3(1.0);
    if (uAttrEnabled) {
      vec4 attrData = texture2D(uAttrTex, particleUv);
      if (uAttrSizeSlot >= 0) {
        sizeMul *= mix(1.0, kaloAttrChannel(attrData, uAttrSizeSlot), uAttrSizeAmount);
      }
      if (uAttrBrightSlot >= 0) {
        vAttrBright = mix(1.0, kaloAttrChannel(attrData, uAttrBrightSlot), uAttrBrightAmount);
      }
      if (uAttrColorEnabled) {
        vAttrColor = vec3(
          kaloAttrChannel(attrData, uAttrColorSlotR),
          kaloAttrChannel(attrData, uAttrColorSlotG),
          kaloAttrChannel(attrData, uAttrColorSlotB));
        // Group colour gating (Phase DG): non-members fall back
        // to the exact legacy identity, so only members are
        // tinted by the attribute colour.
        if (uGroupColorEnabled) {
          float grp = kaloGroupMembership(kaloAttrChannel(attrData, uGroupSlot), uGroupMode, uGroupLow, uGroupHigh, uGroupInvert);
          if (grp < 0.5) vAttrColor = vec3(1.0);
        }
      }
    }
    // Layer Map (Phase U): size modulated by the gradient image's
    // luminance at the particle's own position. Amount 0 (default)
    // skips the fetch entirely, so the legacy path is untouched.
    // Phase X: a dedicated size map, when ready, replaces the
    // common image for this property only.
    if (uMapSizeAmount > 0.0) {
      if (uMapSizeReady) {
        sizeMul *= kaloMapFactor(uMapSizeTex, worldPos.xy, uGradImageScale, uMapSizeAmount);
      } else if (uGradImageReady) {
        sizeMul *= kaloMapFactor(uGradImageTex, worldPos.xy, uGradImageScale, uMapSizeAmount);
      }
    }
    // Noise field map (Phase AY): size modulated by the field
    // value at the particle's own position — the Layer Map
    // factor form with the field as the source. Layers on top of
    // the image map (both may apply); amount 0 skips it.
    if (uNoiseMapSizeAmount > 0.0) {
      sizeMul *= mix(1.0, kaloNoiseMap01(worldPos, uNoiseMapScale, uNoiseMapEvolve, uNoiseMapTime, uNoiseMapKind, uNoiseMapOctaves), uNoiseMapSizeAmount);
    }
    vPhaseMix = 1.0;
    vPlBright = 1.0;
    if (uParticleLifeEnabled) {
      int sp = plSpecies(particleUv);
      sizeMul *= plSizeMul(sp);
      vPlBright = plBrightness(sp);
    }
    if (uKuramotoEnabled) {
      float kPulse = 0.5 + 0.5 * sin(texture2D(uVelTex, particleUv).w);
      sizeMul *= mix(1.0, 0.45 + 1.0 * kPulse, uKuramotoInfluence);
      vPhaseMix = mix(1.0, 0.25 + 0.75 * kPulse, uKuramotoInfluence);
    }
`;
const DRAW_VERT_CRACK_COMPUTE = /* glsl */ `    // Crack flag: any dead structural link touching this
    // texel (own right/up, or the left/down neighbours' owned
    // links). State .r/.g are the survival channels.
    vCrack = 0.0;
    if (uVellumCrackEnabled) {
      vec2 tc = floor(particleUv * uTexSizeF);
      vec2 ts = vec2(uTexSizeF);
      float dead = 0.0;
      dead = max(dead, 1.0 - texture2D(uVellumStateTex, particleUv).r);
      dead = max(dead, 1.0 - texture2D(uVellumStateTex, particleUv).g);
      vec2 leftUv = (tc + vec2(-1.0, 0.0) + 0.5) / ts;
      vec2 downUv = (tc + vec2(0.0, -1.0) + 0.5) / ts;
      if (uVellumMode == 1) leftUv.x = fract(leftUv.x);
      if (tc.x > 0.5 || uVellumMode == 1) dead = max(dead, 1.0 - texture2D(uVellumStateTex, leftUv).r);
      if (tc.y > 0.5) dead = max(dead, 1.0 - texture2D(uVellumStateTex, downUv).g);
      vCrack = dead;
      sizeMul *= 1.0 + 0.35 * vCrack;
    }
`;
const DRAW_VERT_CLUSTER_COMPUTE = /* glsl */ `    // Cluster colour (Phase 20 stage 1): body index from the
    // rigid cell texture at the post-sort texel (particleUv,
    // like every other per-particle read above), then the
    // per-body LUT row. vClusterOn stays 0 while the supply is
    // off, and the fragment keeps the legacy base colour.
    vClusterColor = vec3(1.0);
    vClusterOn = 0.0;
    if (uClusterColorEnabled) {
      float bodyIndex = texture2D(uClusterCellTex, particleUv).w;
      vec4 lutEntry = texture2D(uClusterColorLutTex, vec2((bodyIndex + 0.5) / 256.0, 0.5)); // divisor = RIGID_CLUSTER_COLOR_COUNT (LUT width)
      vClusterColor = lutEntry.rgb;
      vClusterOn = 1.0;
    }
`;
const DRAW_VERT_SHADOWMAP_COMPUTE = /* glsl */ `    // True shadow map (Phase 23, wiring stage 2): sample the
    // light-viewpoint depth at the same worldPos the Phase Z
    // factor above read (nothing moves worldPos in between).
    vShadowMapMul = kaloShadowFactor(worldPos);
`;
const DRAW_VERT_SHADOWTUNNEL_COMPUTE = /* glsl */ `    // Tunnel occlusion (Round 83/84 gap 7): inside the tube
    // region the tunnel bake replaces the plane factor the
    // Phase Z call above produced; outside it the plane
    // factor stands (the function returns -1.0 there).
    if (uShadowEnabled && uShadowTunnelReady && uShadowStrength > 0.0) {
      float tunnelMul = kaloShadowTunnelMultiplier(worldPos);
      if (tunnelMul >= 0.0) vShadowMul = tunnelMul;
    }
`;
const DRAW_VERT_TAIL = /* glsl */ `    vec4 mvPos = modelViewMatrix * vec4(worldPos, 1.0);
    float dist = -mvPos.z;
    gl_PointSize = max(0.5, uSize * sizeMul * (dist > 0.5 ? min(4.0, 500.0 / dist) : 1.0));
    // Density compensation (Phase DN): use the FINAL pixel size
    // (distance attenuation and sizeMul included) so near-large
    // and far-small points are compensated individually. The
    // clamp caps at 1.0: compensation only lowers alpha.
    vDensityMul = uDensityCompEnabled
      ? clamp(uDensityTarget * (uViewportSizePx.x * uViewportSizePx.y) / (max(uDensityCount, 1.0) * gl_PointSize * gl_PointSize), 0.0, 1.0)
      : 1.0;
    gl_Position  = projectionMatrix * mvPos;
  }
`;

// ── Phase 19 gate fix: string-level shader variants ──
// On the target GPU, ANY code-text change in these shaders
// breaks bit-identity with v2.00 — even code gated off by a
// false uniform (measured, see PHASE19_GATE_DIAGNOSIS). The
// Phase 19 additions therefore sit behind builder options:
// the default exports below are byte-identical to v2.00 and
// the *_PHASE19 exports are byte-identical to the Phase 19
// strings (both pinned by scripts/phase18-shader-hash.mjs).
export interface DrawShaderVariantOptions {
  vellumCrack?: boolean;
  /** Rigid cluster colouring (Phase 20 stage 1): splices the
   *  cell-texture → LUT lookup into the vertex and the base-
   *  colour replacement into the fragment. Off (the default)
   *  assembles the Phase 19 strings byte-identically. */
  clusterColor?: boolean;
  /** True shadow map (Phase 23, wiring stage 2): splices the
   *  LIGHT_SHADOW_GLSL chunk (lib/lightShadowMap.ts) into the
   *  vertex, computes kaloShadowFactor(worldPos) there and
   *  passes it to the fragment as vShadowMapMul, which unions
   *  it with the Phase Z occlusion factor. Off (the default)
   *  assembles the Phase 20 strings byte-identically — the
   *  chunk is never part of the stock strings. */
  shadowMap?: boolean;
  /** Tunnel occlusion bake (Round 83/84 gap 7): splices the
   *  tunnel-bake uniforms + sampler function into the vertex
   *  and overrides the Phase Z factor inside the tube region.
   *  Off (the default) assembles the stock strings
   *  byte-identically — no tunnel uniform appears. */
  shadowTunnel?: boolean;
}

export function buildDrawVert(options?: DrawShaderVariantOptions): string {
  const crack = !!options?.vellumCrack;
  const cluster = !!options?.clusterColor;
  const shadowMap = !!options?.shadowMap;
  const shadowTunnel = !!options?.shadowTunnel;
  return DRAW_VERT_HEAD
    + (crack ? DRAW_VERT_CRACK_UNIFORMS : '')
    + (cluster ? DRAW_VERT_CLUSTER_UNIFORMS : '')
    + (shadowTunnel ? DRAW_VERT_SHADOWTUNNEL_UNIFORMS : '')
    + DRAW_VERT_MID_A
    + (crack ? DRAW_VERT_CRACK_VARYING : '')
    + (cluster ? DRAW_VERT_CLUSTER_VARYING : '')
    + (shadowMap ? DRAW_VERT_SHADOWMAP_VARYING : '')
    + (shadowMap ? LIGHT_SHADOW_GLSL : '')
    + (shadowTunnel ? DRAW_VERT_SHADOWTUNNEL_FN : '')
    + DRAW_VERT_MID_B
    + (crack ? DRAW_VERT_CRACK_COMPUTE : '')
    + (cluster ? DRAW_VERT_CLUSTER_COMPUTE : '')
    + (shadowMap ? DRAW_VERT_SHADOWMAP_COMPUTE : '')
    + (shadowTunnel ? DRAW_VERT_SHADOWTUNNEL_COMPUTE : '')
    + DRAW_VERT_TAIL;
}

export const DRAW_VERT = buildDrawVert();
export const DRAW_VERT_PHASE19 = buildDrawVert({ vellumCrack: true });
export const DRAW_VERT_PHASE20 = buildDrawVert({ clusterColor: true });
export const DRAW_VERT_PHASE23 = buildDrawVert({ shadowMap: true });
export const DRAW_VERT_SHADOW_TUNNEL = buildDrawVert({ shadowTunnel: true });

// ── Draw fragment ──
const DRAW_FRAG_HEAD = /* glsl */ `
  precision highp float;
  uniform vec3  uColor;
  uniform float uOpacity;
  uniform bool  uVelColorEnabled;
  uniform float uVelColorHueMin;
  uniform float uVelColorHueMax;
  uniform float uVelColorSaturation;
  uniform bool  uAgeEnabled;
  uniform float uAgeFadeIn;
  uniform float uAgeFadeOut;
  uniform bool  uAgeColorEnabled;
  uniform vec3  uAgeColorYoung;
  uniform vec3  uAgeColorOld;
  uniform bool  uParticleLifeEnabled;
  uniform int   uPointShape;
  // Kinetix Color gradient (B2): 3-stop LUT + driver. Driver ids:
  // 0 life, 1 velocity, 2 spatial, 3 prism, 4 image (samples the
  // user image by particle position; life LUT fallback while no
  // image is ready), 5 blackbody, 6 height (Phase L: world Y mapped
  // through the LUT — terrain-style height shading), 7 noise
  // (Phase AY: the noise field value at the particle position —
  // colour decided by the field, not by age or a random seed).
  uniform bool      uGradEnabled;
  uniform int       uGradDriver;
  uniform sampler2D uGradLut;
  uniform float     uGradSpatialScale;
  uniform float     uGradTime;
  uniform sampler2D uGradImageTex;
  uniform bool      uGradImageReady;
  uniform float     uGradImageScale;
  // Noise field map (Phase AY): shared field parameters (the
  // vertex consumes the same field for size / displacement).
  uniform float     uNoiseMapScale;
  uniform float     uNoiseMapEvolve;
  uniform float     uNoiseMapTime;
  uniform float     uNoiseMapKind;
  uniform float     uNoiseMapOctaves;
  // Age curve (Phase U): opacity multiplier over normalised age.
  uniform bool      uAgeCurveOpacityEnabled;
  uniform float     uAgeCurveOpacity[5];
  // Layer Map (Phase U): opacity modulated by the gradient image.
  uniform float     uMapOpacityAmount;
  // Per-property opacity map + raster mask clip (Phase X): the
  // opacity map replaces the common image for opacity when ready;
  // the mask clip discards fragments whose position falls in a
  // rejected mask region (mode 1 = clip; mode 2 = shape is baked
  // into placement and needs no fragment action).
  uniform sampler2D uMapOpacityTex;
  uniform bool      uMapOpacityReady;
  uniform sampler2D uMaskTex;
  uniform bool      uMaskReady;
  uniform int       uMaskMode;
  uniform float     uMaskThreshold;
  uniform bool      uMaskInvert;
  // Sprite image (Phase U): when ready, the sprite's shape comes
  // from the user image (luminance baked into the texture) instead
  // of the procedural point shapes.
  uniform sampler2D uSpriteImageTex;
  uniform bool      uSpriteImageReady;
  // Sprite sheet (Phase AD): cols x rows flipbook over the sprite
  // image. Mode 0 = age, 1 = fps clock (uGradTime), 2 = per-
  // particle seed. At 1x1 the frame is 0 and the UV remap is the
  // exact identity (see SPRITE_SHEET_GLSL below).
  uniform float     uSpriteSheetCols;
  uniform float     uSpriteSheetRows;
  uniform float     uSpriteSheetMode;
  uniform float     uSpriteSheetFps;
  uniform bool      uSpriteSheetLoop;
  // Sprite rotation (Phase AX): angle = initial + speed · seedMul
  // · ∫exp(−damping·a)da over the particle age (vAge). Initial /
  // speed arrive in radians (converted at the uniform site). Both
  // 0 (the defaults) skip the rotation entirely — the legacy
  // sampling below is then verbatim. TS twin: lib/spriteRotation.ts.
  uniform float     uSpriteRotInitial;
  uniform float     uSpriteRotSpeed;
  uniform float     uSpriteRotDamping;
  uniform float     uSpriteRotRandom;
  varying float vSpeed;
  varying float vNormAge;
  varying float vAge;
  varying float vPhaseMix;
  varying float vPlBright;
  varying float vAttrBright;
  varying vec3 vAttrColor;
  varying float vSeed;
  varying vec3 vWorldPos;
  varying float vLightMul;
  varying float vShadowMul;
  varying float vDensityMul;
`;
const DRAW_FRAG_CRACK_VARYING = /* glsl */ `  varying float vCrack;
`;
const DRAW_FRAG_CLUSTER_VARYING = /* glsl */ `  varying vec3 vClusterColor;
  varying float vClusterOn;
`;
const DRAW_FRAG_SHADOWMAP_VARYING = /* glsl */ `  // True shadow map (Phase 23, wiring stage 2): the vertex
  // factor (lib/lightShadowMap.ts kaloShadowFactor) and the
  // strength it is mixed by. The remaining shadow-map
  // uniforms live in the vertex only (the factor is computed
  // there); this stage declares just what the union below
  // consumes.
  varying float vShadowMapMul;
  uniform float uShadowMapStrength;
`;
const DRAW_FRAG_MID_A = /* glsl */ `
  ${PARTICLE_SHAPE_GLSL}

  ${AGE_CURVE_GLSL}

  ${NOISE_MAP_GLSL}

  ${SPRITE_SHEET_GLSL}

  vec3 hsv2rgb(float h, float s, float v) {
    vec3 p = abs(fract(vec3(h) + vec3(1.0, 2.0/3.0, 1.0/3.0)) * 6.0 - 3.0);
    return v * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), s);
  }

  vec3 hsl2rgb(float h, float s, float l) {
    vec3 rgb = clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
    return l + s * (rgb - 0.5) * (1.0 - abs(2.0 * l - 1.0));
  }

  // Kinetix blackbody ramp (B2): heat falls as the particle ages and
  // rises with speed; the five stops are Kinetix's smoke / soot /
  // crimson / orange / white-hot values, re-implemented as GLSL.
  vec3 blackbodyColor(float tNorm, float speedNorm) {
    float heat = clamp((1.0 - tNorm) * 0.78 + speedNorm * 0.45, 0.0, 1.0);
    vec3 smoke   = vec3(0.08, 0.09, 0.11);
    vec3 soot    = vec3(0.22, 0.16, 0.18);
    vec3 crimson = vec3(0.84, 0.14, 0.04);
    vec3 orange  = vec3(1.0, 0.56, 0.08);
    vec3 white   = vec3(1.0, 0.96, 0.86);
    if (heat > 0.72) return mix(orange, white, (heat - 0.72) / 0.28);
    if (heat > 0.42) return mix(crimson, orange, (heat - 0.42) / 0.30);
    if (heat > 0.16) return mix(soot, crimson, (heat - 0.16) / 0.26);
    return mix(smoke, soot, heat / 0.16);
  }

  void main() {
    // Sprite rotation (Phase AX): rotate the point coord around
    // the sprite centre by the age-driven angle. Length is
    // rotation-invariant, so the discard circle is unchanged;
    // angle 0 (defaults) skips the rotation verbatim.
    float spriteRotAngle = 0.0;
    if (uSpriteRotInitial != 0.0 || uSpriteRotSpeed != 0.0) {
      float seedMul = 1.0 + (vSeed * 2.0 - 1.0) * uSpriteRotRandom;
      float ageInt = uSpriteRotDamping > 0.0
        ? (1.0 - exp(-uSpriteRotDamping * max(vAge, 0.0))) / uSpriteRotDamping
        : max(vAge, 0.0);
      spriteRotAngle = uSpriteRotInitial + uSpriteRotSpeed * seedMul * ageInt;
    }
    vec2 pc = gl_PointCoord - 0.5;
    if (spriteRotAngle != 0.0) {
      float ca = cos(spriteRotAngle);
      float sa = sin(spriteRotAngle);
      pc = mat2(ca, -sa, sa, ca) * pc;
    }
    float d = length(pc);
    if (d > 0.5) discard;

    vec3 col = uColor;
`;
const DRAW_FRAG_CLUSTER_ASSIGN = /* glsl */ `    // Rigid cluster colouring (Phase 20 stage 1): the cluster
    // colour replaces the BASE colour — the age / velocity
    // paths below and the gradient above them still win, in
    // the legacy priority order. vClusterOn is 0 unless the
    // vertex resolved a cluster colour for this particle.
    if (vClusterOn > 0.5) col = vClusterColor;
`;
const DRAW_FRAG_MID_B = /* glsl */ `    if (uAgeColorEnabled) {
      col = mix(uAgeColorYoung, uAgeColorOld, vNormAge);
    } else if (uVelColorEnabled) {
      float hue = mix(uVelColorHueMin, uVelColorHueMax, vSpeed) / 360.0;
      col = hsv2rgb(hue, uVelColorSaturation, 1.0);
    }
    // Kinetix Color gradient sits above the legacy colour paths: when
    // enabled it replaces the colour with the 3-stop LUT (or the prism
    // / blackbody procedural ramps). Kinetix driver semantics:
    // life t = age fraction; velocity t = 1 - normalised speed (fast
    // particles take the start colour); spatial t = distance from the
    // origin scaled; height t = world Y centred and scaled; prism =
    // HSL wheel over age + per-particle seed + time; blackbody = heat
    // ramp above.
    if (uGradEnabled) {
      if (uGradDriver == 3) {
        float hue = fract(vNormAge * 0.65 + vSeed * 0.35 + uGradTime * 0.06);
        col = hsl2rgb(hue, 0.85, 0.6);
      } else if (uGradDriver == 5) {
        col = blackbodyColor(vNormAge, vSpeed);
      } else if (uGradDriver == 4 && uGradImageReady) {
        // Image driver: the particle takes the colour of the user
        // image at its own position — world XY mapped over the
        // bounce sphere (uGradImageScale = 1 / (2 * bounceRadius)),
        // clamped at the edges. Mirrors Kinetix's image colour mode
        // (colour comes from the image, not from a gradient ramp).
        vec2 imageUv = clamp(vWorldPos.xy * uGradImageScale + 0.5, 0.0, 1.0);
        col = texture2D(uGradImageTex, imageUv).rgb;
      } else {
        float gt = vNormAge;
        if (uGradDriver == 1) {
          gt = 1.0 - vSpeed;
        } else if (uGradDriver == 2) {
          gt = clamp(length(vWorldPos) * uGradSpatialScale, 0.0, 1.0);
        } else if (uGradDriver == 6) {
          // Height driver (Phase L): world Y centred on 0, scaled by
          // the same slider the spatial driver uses — valleys take
          // the start colour, peaks the end colour.
          gt = clamp(0.5 + vWorldPos.y * uGradSpatialScale, 0.0, 1.0);
        } else if (uGradDriver == 7) {
          // Noise field driver (Phase AY): the LUT input is the
          // noise field value at the particle's own position —
          // the field is the ramp's data source (map source), and
          // with evolve > 0 the colours drift as the field evolves.
          gt = kaloNoiseMap01(vWorldPos, uNoiseMapScale, uNoiseMapEvolve, uNoiseMapTime, uNoiseMapKind, uNoiseMapOctaves);
        }
        col = texture2D(uGradLut, vec2(gt, 0.5)).rgb;
      }
    }
    // Particle Life: species differ ONLY by brightness (monochrome).
    if (uParticleLifeEnabled) {
      col *= vPlBright;
    }
`;
const DRAW_FRAG_CRACK_DARKEN = /* glsl */ `    // Vellum crack (Phase 19 stage 3): torn-seam texels read
    // darker (a cut face in shadow, monochrome as ever). vCrack
    // is exactly 0 unless the crack flag was computed.
    col *= 1.0 - 0.45 * vCrack;
`;
const DRAW_FRAG_SHADOWMAP_APPLY = /* glsl */ `    // True shadow map (Phase 23, wiring stage 2): union with
    // the Phase Z occlusion factor. Writing a = 1 - vShadowMul
    // (Phase Z shadow amount) and b = 1 - smapLit (shadow-map
    // amount, strength-mixed), the union shadow amount is
    // 1 - (1-a)(1-b), so the combined brightness is
    // (1-a)(1-b) = vShadowMul * smapLit. The vShadowMul half is
    // applied by the tail's multiplier chain right below; this
    // chunk applies the shadow-map half. smapLit is exactly
    // 1.0 at strength 0 or while the capture is not ready, so
    // this multiply is then a bit-exact identity.
    col *= mix(1.0, vShadowMapMul, uShadowMapStrength);
`;
const DRAW_FRAG_TAIL = /* glsl */ `    // 3D light (Phase T): brightness from the light object, computed
    // per-particle in the vertex shader from the world position.
    // vLightMul is exactly 1.0 while the light is disabled (or the
    // particle sits outside its radius), so this multiply is a
    // bit-exact identity on the legacy path.
    col *= vLightMul;
    // Occlusion-map shadow (Phase Z): exactly 1.0 while the
    // shadow is disabled or strength is 0, so this multiply is a
    // bit-exact identity on the legacy path.
    col *= vShadowMul;
    // Named attributes (Phase AK): the brightness drive —
    // exactly 1.0 while the drive is off, so this multiply is a
    // bit-exact identity on the legacy path.
    col *= vAttrBright;
    // Colour drive (Phase CL): the per-point colour tint —
    // exactly vec3(1.0) while the drive is off, so this multiply
    // is a bit-exact identity on the legacy path. It sits in the
    // multiplier chain (with brightness / light / shadow) rather
    // than at the colour's assignment, so it tints whichever
    // colour source won instead of being overwritten by it.
    col *= vAttrColor;

    float ageFade = 1.0;
    if (uAgeEnabled) {
      ageFade  = smoothstep(0.0, uAgeFadeIn, vNormAge);
      ageFade *= smoothstep(1.0, 1.0 - uAgeFadeOut, vNormAge);
    }
    // Age curve (Phase U): a multiplier layered on the legacy fade —
    // flat (all-ones) points keep the legacy alpha bit-exact.
    float opacityMul = ageFade;
    if (uAgeCurveOpacityEnabled) {
      opacityMul *= kaloEvalCurve5(vNormAge, uAgeCurveOpacity[0], uAgeCurveOpacity[1], uAgeCurveOpacity[2], uAgeCurveOpacity[3], uAgeCurveOpacity[4]);
    }
    // Layer Map (Phase U): opacity modulated by the gradient image's
    // luminance at the particle's own position. Phase X: a
    // dedicated opacity map, when ready, replaces the common image
    // for this property only.
    if (uMapOpacityAmount > 0.0) {
      if (uMapOpacityReady) {
        opacityMul *= kaloMapFactor(uMapOpacityTex, vWorldPos.xy, uGradImageScale, uMapOpacityAmount);
      } else if (uGradImageReady) {
        opacityMul *= kaloMapFactor(uGradImageTex, vWorldPos.xy, uGradImageScale, uMapOpacityAmount);
      }
    }
    // Raster mask clip (Phase X): live positions in rejected mask
    // regions are discarded, complementing the bake-time relocation
    // (particles move, so the mask is enforced where they are now).
    if (uMaskMode == 1 && uMaskReady) {
      float mLuma = kaloMapLuma(uMaskTex, vWorldPos.xy, uGradImageScale);
      if (uMaskInvert) mLuma = 1.0 - mLuma;
      if (mLuma < uMaskThreshold) discard;
    }

    // Point shape: a ready sprite image (Phase U) takes priority —
    // its baked luminance IS the shape. Otherwise 0 keeps the legacy
    // soft disc exactly; kinds 1..11 use the shared shape masks
    // (Kinetix integration B1b), the same set the layer point shader
    // exposes through sdfShape.
    float shapeAlpha;
    if (uSpriteImageReady) {
      // gl_PointCoord y grows downward; the sprite texture holds the
      // image top at v=1, so v = 1 - y draws the image upright.
      // Phase AD: the sheet remap generalises that UV — at 1x1 it
      // is exactly the legacy expression (frame 0, (0+x)/1,
      // 1-(0+y)/1), so single-image sprites are bit-identical.
      float spriteFrame = kaloSpriteFrame(uSpriteSheetCols, uSpriteSheetRows, uSpriteSheetMode, uSpriteSheetFps, uSpriteSheetLoop, vNormAge, uGradTime, vSeed);
      shapeAlpha = texture2D(uSpriteImageTex, kaloSpriteSheetUv(pc + 0.5, uSpriteSheetCols, uSpriteSheetRows, spriteFrame)).r;
      if (shapeAlpha < 0.01) discard;
    } else if (uPointShape == 0) {
      shapeAlpha = smoothstep(0.5, 0.12, d);
    } else {
      vec2 pq = pc * 2.0;
      pq.y = -pq.y;
      shapeAlpha = particleShapeMask(uPointShape, pq, vSeed);
      if (shapeAlpha < 0.01) discard;
    }

    gl_FragColor = vec4(col, shapeAlpha * uOpacity * opacityMul * vPhaseMix * vDensityMul);
  }
`;

// ── Phase 19 gate fix: string-level shader variants ──
// On the target GPU, ANY code-text change in these shaders
// breaks bit-identity with v2.00 — even code gated off by a
// false uniform (measured, see PHASE19_GATE_DIAGNOSIS). The
// Phase 19 additions therefore sit behind builder options:
// the default exports below are byte-identical to v2.00 and
// the *_PHASE19 exports are byte-identical to the Phase 19
// strings (both pinned by scripts/phase18-shader-hash.mjs).
export function buildDrawFrag(options?: DrawShaderVariantOptions): string {
  const crack = !!options?.vellumCrack;
  const cluster = !!options?.clusterColor;
  const shadowMap = !!options?.shadowMap;
  return DRAW_FRAG_HEAD
    + (crack ? DRAW_FRAG_CRACK_VARYING : '')
    + (cluster ? DRAW_FRAG_CLUSTER_VARYING : '')
    + (shadowMap ? DRAW_FRAG_SHADOWMAP_VARYING : '')
    + DRAW_FRAG_MID_A
    + (cluster ? DRAW_FRAG_CLUSTER_ASSIGN : '')
    + DRAW_FRAG_MID_B
    + (crack ? DRAW_FRAG_CRACK_DARKEN : '')
    + (shadowMap ? DRAW_FRAG_SHADOWMAP_APPLY : '')
    + DRAW_FRAG_TAIL;
}

export const DRAW_FRAG = buildDrawFrag();
export const DRAW_FRAG_PHASE19 = buildDrawFrag({ vellumCrack: true });
export const DRAW_FRAG_PHASE20 = buildDrawFrag({ clusterColor: true });
export const DRAW_FRAG_PHASE23 = buildDrawFrag({ shadowMap: true });

