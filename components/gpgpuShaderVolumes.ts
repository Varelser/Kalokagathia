import {
  validateGeomCustomFragmentGlslCode,
  validateGeomCustomVertexGlslCode,
} from "../lib/geomCustomGlsl";
import { IBL_GLSL_HELPERS } from "../lib/iblGlsl";

// ── Volumetric sphere sprite vertex ──
export const VOLUMETRIC_VERT = /* glsl */ `
  precision highp float;
  attribute vec2 aTexCoord;
  uniform sampler2D uPosTex;
  uniform float uRadius;
  uniform float uRingOffsetZ;
  varying vec3 vWorldCenter;
  varying vec3 vQuadPos;
  void main() {
    vec3 center = texture2D(uPosTex, aTexCoord).xyz;
    center.z -= uRingOffsetZ;
    vWorldCenter = center;
    // Billboard: derive camera axes from cameraPosition
    vec3 toCamera = normalize(cameraPosition - center);
    vec3 up       = abs(toCamera.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
    vec3 right    = normalize(cross(toCamera, up));
    up            = normalize(cross(right, toCamera));
    vec3 worldPos = center + (right * position.x + up * position.y) * uRadius;
    vQuadPos      = worldPos;
    gl_Position   = projectionMatrix * modelViewMatrix * vec4(worldPos, 1.0);
  }
`;

// ── Volumetric sphere sprite fragment (ray-marched density) ──
export const VOLUMETRIC_FRAG = /* glsl */ `
  precision highp float;
  uniform vec3  uColor;
  uniform float uRadius;
  uniform float uDensity;
  uniform float uOpacity;
  uniform float uSteps;
  // Fog self-shadow (Phase Z): secondary march from each sample
  // toward the Phase T light position through the same analytic
  // density — the GLSL twin of fogSampleTransmittance /
  // fogSelfShadowFactor in lib/shadowOcclusion.ts. Strength 0
  // skips the march entirely (legacy bit-identical).
  uniform float uFogSelfShadow;
  uniform float uFogShadowSteps;
  uniform vec3  uLightPos;
  varying vec3 vWorldCenter;
  varying vec3 vQuadPos;
  void main() {
    vec3 rayDir = normalize(vQuadPos - cameraPosition);
    vec3 oc = cameraPosition - vWorldCenter;
    float b    = dot(oc, rayDir);
    float c    = dot(oc, oc) - uRadius * uRadius;
    float disc = b * b - c;
    if (disc < 0.0) discard;
    float sqrtD = sqrt(disc);
    float t0 = max(-b - sqrtD, 0.0);
    float t1 = -b + sqrtD;
    if (t1 < 0.0) discard;
    int nSteps   = int(uSteps);
    float segLen = (t1 - t0) / uSteps;
    float accumulated = 0.0;
    for (int i = 0; i < 32; i++) {
      if (i >= nSteps) break;
      float t   = t0 + (float(i) + 0.5) * segLen;
      vec3 p    = cameraPosition + rayDir * t;
      float d   = length(p - vWorldCenter) / uRadius;
      float w   = exp(-d * d * 4.0);
      if (uFogSelfShadow > 0.0) {
        vec3 toLightW = uLightPos - p;
        float ll = length(toLightW);
        vec3 toLight = ll > 0.0001 ? toLightW / ll : vec3(0.0, 1.0, 0.0);
        vec3 sampleN = (p - vWorldCenter) / uRadius;
        int nShadow = int(uFogShadowSteps);
        float seg2 = 1.0 / uFogShadowSteps;
        float acc2 = 0.0;
        for (int j = 0; j < 16; j++) {
          if (j >= nShadow) break;
          vec3 q = sampleN + toLight * ((float(j) + 0.5) * seg2);
          acc2 += exp(-dot(q, q) * 4.0) * seg2;
        }
        float tr = exp(-acc2 * uDensity);
        float mixed = mix(1.0, tr, min(uFogSelfShadow, 1.0));
        float factor = uFogSelfShadow > 1.0 ? mixed * pow(tr, uFogSelfShadow - 1.0) : mixed;
        w *= factor;
      }
      accumulated += w * segLen;
    }
    float alpha = (1.0 - exp(-accumulated * uDensity)) * uOpacity;
    if (alpha < 0.005) discard;
    gl_FragColor = vec4(uColor, alpha);
  }
`;

// ── Instanced geometry vertex ──
const GEOM_VERT_HEAD = /* glsl */ `
  precision highp float;
  attribute vec2 aTexCoord;
  uniform sampler2D uPosTex;
  uniform sampler2D uVelTex;
  uniform float uRingOffsetZ;
  uniform float uGeomScale;
  uniform float uVelocityAlign;
  uniform float uTime;
  uniform float uSpinSpeed;
  // Spin random range (Phase AH): per-instance speed multiplier in
  // [1 - r, 1 + r] from a second texel hash. 0 = multiplier exactly
  // 1 (the hash is skipped), so the default spin is bit-identical.
  // TS twin: lib/gpgpuSpinRandom.ts.
  uniform float uSpinRandom;
  uniform float uMeshStretch;
  // Rotation over Lifetime (Phase AC): the age curve multiplies
  // the spin RATE; the angle is the curve's closed-form integral
  // over the particle's age (see kaloCurveIntegral5 below and the
  // TS twin integrateAgeCurve in lib/ageCurve.ts). The passes
  // suppress an all-ones curve, so a flat curve is the legacy spin.
  uniform bool  uAgeEnabled;
  uniform float uAgeMax;
  uniform bool  uAgeCurveRotationEnabled;
  uniform float uAgeCurveRotation[5];
  // Density compensation (Phase DN, DA6): same formula as the
  // points draw; the per-instance pixel size is estimated from
  // the projected scale (see estimateSolidSizePx in
  // lib/densityComp.ts). Disabled yields exactly 1.0.
  uniform bool  uDensityCompEnabled;
  uniform float uDensityTarget;
  uniform float uDensityCount;
  uniform vec2  uViewportSizePx;
`;
const GEOM_VERT_CRACK_UNIFORMS = /* glsl */ `  // Vellum crack visualisation (Phase 19 stage 3): same flag
  // rule as the points draw — dead-link texels darken. Off
  // (default) leaves vCrack at exactly 0.
  uniform bool  uVellumCrackEnabled;
  uniform sampler2D uVellumStateTex;
  uniform int   uVellumMode;
  uniform float uTexSizeF;
`;
const GEOM_VERT_MID_A = /* glsl */ `  varying vec3 vNormal;
  varying float vDensityMul;
`;
const GEOM_VERT_CRACK_VARYING = /* glsl */ `  varying float vCrack;
`;
const GEOM_VERT_MID_B = /* glsl */ `  // Image-based lighting (Phase AL): world-space normal / position
  // for the equirect sampling in GEOM_FRAG. Written always, read
  // only inside the IBL branch, so the legacy look is untouched.
  varying vec3 vWorldNormal;
  varying vec3 vWorldPos;

  // Closed-form integral of the 5-point age curve from 0 to t
  // (trapezoids + the exact quadratic on the partial segment).
  float kaloCurveIntegral5(float t, float p0, float p1, float p2, float p3, float p4) {
    float x = clamp(t, 0.0, 1.0);
    float h = 0.25;
    float a0 = h * (p0 + p1) * 0.5;
    float a1 = h * (p1 + p2) * 0.5;
    float a2 = h * (p2 + p3) * 0.5;
    if (x <= h) { float f = x / h; return h * (p0 * f + (p1 - p0) * f * f * 0.5); }
    if (x <= 2.0 * h) { float f = (x - h) / h; return a0 + h * (p1 * f + (p2 - p1) * f * f * 0.5); }
    if (x <= 3.0 * h) { float f = (x - 2.0 * h) / h; return a0 + a1 + h * (p2 * f + (p3 - p2) * f * f * 0.5); }
    float f = (x - 3.0 * h) / h;
    return a0 + a1 + a2 + h * (p3 * f + (p4 - p3) * f * f * 0.5);
  }
  // The plain 5-point curve value (same blend as everywhere else).
  float kaloEvalCurve5(float t, float p0, float p1, float p2, float p3, float p4) {
    float x = clamp(t, 0.0, 1.0) * 4.0;
    float v = p0;
    v = mix(v, p1, clamp(x, 0.0, 1.0));
    v = mix(v, p2, clamp(x - 1.0, 0.0, 1.0));
    v = mix(v, p3, clamp(x - 2.0, 0.0, 1.0));
    v = mix(v, p4, clamp(x - 3.0, 0.0, 1.0));
    return v;
  }

  mat3 lookRot(vec3 dir) {
    vec3 up = abs(dir.y) < 0.99 ? vec3(0,1,0) : vec3(1,0,0);
    vec3 r  = normalize(cross(dir, up));
    vec3 u  = cross(r, dir);
    return mat3(r, u, dir);
  }

  mat3 rotYMat(float a) {
    float c = cos(a);
    float s = sin(a);
    return mat3(c, 0.0, s, 0.0, 1.0, 0.0, -s, 0.0, c);
  }

  void main() {
    vec3 instancePos = texture2D(uPosTex, aTexCoord).xyz;
    instancePos.z -= uRingOffsetZ;
    vec3 vel         = texture2D(uVelTex, aTexCoord).xyz;
    float spd = length(vel);
    // Self-rotation (Kinetix integration B1b): each instance spins
    // around its local Y with a per-instance phase so the swarm does
    // not rotate in lockstep. spinSpeed == 0 yields angle 0 exactly,
    // i.e. the legacy un-rotated geometry.
    vec3 phaseP3 = fract(vec3(aTexCoord.x * 127.1 + aTexCoord.y * 311.7) * vec3(0.1031, 0.1030, 0.0973));
    phaseP3 += dot(phaseP3, phaseP3.yxz + 33.33);
    float phase = fract((phaseP3.x + phaseP3.y) * phaseP3.z);
    // Spin random range (Phase AH): fold the per-instance
    // multiplier into the speed once, so the plain path and the
    // age-curve integral path below both consume the same
    // effective speed. uSpinRandom == 0 keeps effSpin == uSpinSpeed
    // exactly (multiplier branch skipped).
    float effSpin = uSpinSpeed;
    if (uSpinRandom > 0.0) {
      vec3 spinP3 = fract(vec3((aTexCoord.x + 19.19) * 127.1 + (aTexCoord.y + 7.77) * 311.7) * vec3(0.1031, 0.1030, 0.0973));
      spinP3 += dot(spinP3, spinP3.yxz + 33.33);
      float spinHash2 = fract((spinP3.x + spinP3.y) * spinP3.z);
      effSpin = uSpinSpeed * mix(1.0 - uSpinRandom, 1.0 + uSpinRandom, spinHash2);
    }
    float spinAng = effSpin == 0.0 ? 0.0 : uTime * effSpin + phase * 6.2831853;
    if (effSpin != 0.0 && uAgeCurveRotationEnabled) {
      if (uAgeEnabled) {
        // Integrate the rate over the particle's own age: the
        // angle is spinSpeed × [ageMax × C(age/ageMax)] plus the
        // tail beyond max age at the final point's rate. A forced
        // age reset (kill/respawn) restarts the angle — the spin
        // phase jumps there, by design of an age-driven rate.
        float ageSec = texture2D(uPosTex, aTexCoord).w;
        float ageMax = max(uAgeMax, 0.001);
        float whole = ageMax * kaloCurveIntegral5(1.0, uAgeCurveRotation[0], uAgeCurveRotation[1], uAgeCurveRotation[2], uAgeCurveRotation[3], uAgeCurveRotation[4]);
        float integ = ageSec <= ageMax
          ? ageMax * kaloCurveIntegral5(ageSec / ageMax, uAgeCurveRotation[0], uAgeCurveRotation[1], uAgeCurveRotation[2], uAgeCurveRotation[3], uAgeCurveRotation[4])
          : whole + (ageSec - ageMax) * uAgeCurveRotation[4];
        spinAng = effSpin * integ + phase * 6.2831853;
      } else {
        // Age tracking off: the midpoint value as a constant rate
        // multiplier (the points shader's 0.5 convention).
        spinAng = uTime * effSpin * kaloEvalCurve5(0.5, uAgeCurveRotation[0], uAgeCurveRotation[1], uAgeCurveRotation[2], uAgeCurveRotation[3], uAgeCurveRotation[4]) + phase * 6.2831853;
      }
    }
    mat3 spin = rotYMat(spinAng);
    // Velocity stretch (meshStretch, B1b): elongates the geometry
    // along its local Z (the axis velocity alignment points along the
    // velocity) in proportion to speed. 0 disables it entirely.
    vec3 scaled = position * uGeomScale;
    if (uMeshStretch > 0.001) {
      scaled.z *= 1.0 + min(spd * 0.02, 3.0) * uMeshStretch;
    }
    mat3 rot = mat3(1.0);
    if (uVelocityAlign > 0.5 || uMeshStretch > 0.001) {
      if (spd > 0.01) rot = lookRot(vel / spd);
    }
    mat3 totalRot = rot * spin;
    vec3 local = totalRot * scaled;
    vNormal = normalize(normalMatrix * totalRot * normal);
    vWorldNormal = totalRot * normal;
    vWorldPos = instancePos + local;
    // Density compensation (Phase DN): projected pixel diameter
    // of the instance. pixels-per-world-unit comes from the
    // projection matrix (m[1][1] = 1/tan(fov/2)); the world
    // diameter is uGeomScale (base geometries are ~unit size).
    if (uDensityCompEnabled) {
      vec4 mvC = modelViewMatrix * vec4(instancePos, 1.0);
      float distC = max(-mvC.z, 0.001);
      float sizePx = uGeomScale * (uViewportSizePx.y * 0.5 * projectionMatrix[1][1] / distC);
      sizePx = max(sizePx, 0.001);
      vDensityMul = clamp(uDensityTarget * (uViewportSizePx.x * uViewportSizePx.y) / (max(uDensityCount, 1.0) * sizePx * sizePx), 0.0, 1.0);
    } else {
      vDensityMul = 1.0;
    }
`;
const GEOM_VERT_CRACK_COMPUTE = /* glsl */ `    vCrack = 0.0;
    if (uVellumCrackEnabled) {
      vec2 tc = floor(aTexCoord * uTexSizeF);
      float dead = 0.0;
      dead = max(dead, 1.0 - texture2D(uVellumStateTex, aTexCoord).r);
      dead = max(dead, 1.0 - texture2D(uVellumStateTex, aTexCoord).g);
      vec2 leftUv = (tc + vec2(-1.0, 0.0) + 0.5) / uTexSizeF;
      vec2 downUv = (tc + vec2(0.0, -1.0) + 0.5) / uTexSizeF;
      if (uVellumMode == 1) leftUv.x = fract(leftUv.x);
      if (tc.x > 0.5 || uVellumMode == 1) dead = max(dead, 1.0 - texture2D(uVellumStateTex, leftUv).r);
      if (tc.y > 0.5) dead = max(dead, 1.0 - texture2D(uVellumStateTex, downUv).g);
      vCrack = dead;
    }
`;
const GEOM_VERT_TAIL = /* glsl */ `    gl_Position = projectionMatrix * modelViewMatrix * vec4(instancePos + local, 1.0);
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
export interface GeomShaderVariantOptions {
  vellumCrack?: boolean;
}

export function buildGeomVertShader(options?: GeomShaderVariantOptions): string {
  const crack = !!options?.vellumCrack;
  return GEOM_VERT_HEAD
    + (crack ? GEOM_VERT_CRACK_UNIFORMS : '')
    + GEOM_VERT_MID_A
    + (crack ? GEOM_VERT_CRACK_VARYING : '')
    + GEOM_VERT_MID_B
    + (crack ? GEOM_VERT_CRACK_COMPUTE : '')
    + GEOM_VERT_TAIL;
}

export const GEOM_VERT = buildGeomVertShader();
export const GEOM_VERT_PHASE19 = buildGeomVertShader({ vellumCrack: true });

// ── Instanced geometry fragment (Lambert + specular) ──
const GEOM_FRAG_HEAD = /* glsl */ `
  precision highp float;
  uniform vec3  uColor;
  uniform float uOpacity;
  uniform float uEnvReflect;
  // Image-based lighting (Phase AL): equirect environment sampled
  // as diffuse + reflection light. Single-tap approximation (no
  // roughness mip chain — recorded in the phase report). The
  // direction -> UV mapping is the three.js equirect convention,
  // TS twin equirectUvForDirection in lib/iblEnvironment.ts.
  uniform sampler2D uIblMap;
  uniform float uIblIntensity;
  uniform float uIblYaw;
  // PBR grammar (Phase 16 stage 2): F0 / specular width only.
  // Defaults uMetalness 0 / uRoughness 1 take the legacy fallback
  // branch below and reproduce pow(ndh, 24) * 0.35 exactly.
  // TS twin: geomSpecular in lib/materialGrammar.ts.
  uniform float uMetalness;
  uniform float uRoughness;
  varying vec3 vNormal;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPos;
  varying float vDensityMul;
`;
const GEOM_FRAG_CRACK_VARYING = /* glsl */ `  varying float vCrack;
`;
const GEOM_FRAG_MID = IBL_GLSL_HELPERS + /* glsl */ `
  void main() {
    vec3 N = normalize(vNormal);
    vec3 L = normalize(vec3(0.5, 1.0, 0.8));
    float diff = max(0.0, dot(N, L)) * 0.7 + 0.3;
    vec3 V = vec3(0.0, 0.0, 1.0);
    vec3 H = normalize(L + V);
    float ndh = max(0.0, dot(N, H));
    vec3 col;
    if (uMetalness <= 0.001 && uRoughness >= 0.999) {
      // Legacy fallback (defaults): bit-identical v1.97.0 specular.
      float spec = pow(ndh, 24.0) * 0.35;
      col = uColor * diff + spec;
    } else {
      vec3 F0 = mix(vec3(0.04), uColor, clamp(uMetalness, 0.0, 1.0));
      float r = clamp(uRoughness, 0.05, 1.0);
      float specExp = min(24.0 / (r * r), 256.0);
      vec3 specCol = pow(ndh, specExp) * 0.35 * (F0 / 0.04);
      col = uColor * diff + specCol;
    }
    // Procedural environment reflection (Kinetix integration B1b):
    // approximates the PMREM environment that gives Kinetix's
    // 'crystal' geometry its look — a vertical gradient environment
    // weighted by fresnel, so silhouette faces pick up bright rims.
    // uEnvReflect == 0 (default) keeps the legacy Lambert look exactly.
    if (uEnvReflect > 0.001) {
      float fres = pow(1.0 - abs(dot(N, V)), 3.0);
      float envGrad = 0.5 + 0.5 * N.y;
      vec3 envCol = mix(vec3(0.04, 0.05, 0.07), vec3(1.0), envGrad);
      col += uEnvReflect * envCol * (0.2 + 0.8 * fres);
    }
    // Image-based lighting (Phase AL): the actual background —
    // equirect image, or the horizon gradient baked as an equirect
    // — sampled by the world normal (diffuse) and the view
    // reflection (fresnel-weighted). uIblIntensity == 0 (default)
    // skips the branch entirely: legacy look, bit-identical.
    if (uIblIntensity > 0.001) {
      vec3 WN = normalize(vWorldNormal);
      vec3 WV = normalize(cameraPosition - vWorldPos);
      vec3 R = reflect(-WV, WN);
      vec3 iblDiff = texture2D(uIblMap, kaloEquirectUv(kaloIblRotYaw(WN, uIblYaw))).rgb;
      vec3 iblRefl = texture2D(uIblMap, kaloEquirectUv(kaloIblRotYaw(R, uIblYaw))).rgb;
      float fresI = pow(1.0 - abs(dot(WN, WV)), 3.0);
      col += uIblIntensity * (iblDiff * uColor * 0.6 + iblRefl * (0.15 + 0.85 * fresI));
    }
`;
const GEOM_FRAG_CRACK_DARKEN = /* glsl */ `    // Vellum crack (Phase 19 stage 3): torn-seam instances
    // darken like the points draw. vCrack is 0 unless flagged.
    col *= 1.0 - 0.45 * vCrack;
`;
const GEOM_FRAG_TAIL = /* glsl */ `    gl_FragColor = vec4(col, uOpacity * vDensityMul);
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
export function buildGeomFragShader(options?: GeomShaderVariantOptions): string {
  const crack = !!options?.vellumCrack;
  return GEOM_FRAG_HEAD
    + (crack ? GEOM_FRAG_CRACK_VARYING : '')
    + GEOM_FRAG_MID
    + (crack ? GEOM_FRAG_CRACK_DARKEN : '')
    + GEOM_FRAG_TAIL;
}

export const GEOM_FRAG = buildGeomFragShader();
export const GEOM_FRAG_PHASE19 = buildGeomFragShader({ vellumCrack: true });

// ── GEOM custom GLSL builders (Phase 16 stage 4) ──
//
// buildGeomVert / buildGeomFrag splice a validated user snippet
// into the stock GEOM shaders at their seams (vertex: right
// after the world position is determined; fragment: right after
// the lighting sum, before the final write). The identity rule
// is byte-level: an empty, whitespace-only or statically invalid
// snippet returns the stock string object unchanged, so the
// default render is bit-identical. (The compile check against a
// live GL context happens in useGpgpuMeshAssets before a valid
// snippet ever reaches these builders; the validate re-check
// here is the last line of defence.)

const GEOM_VERT_SEAM_ANCHOR = '    vWorldPos = instancePos + local;\n';
const GEOM_FRAG_SEAM_ANCHOR = '    gl_FragColor = vec4(col, uOpacity * vDensityMul);';

export function buildGeomVert(customVertCode: string, options?: GeomShaderVariantOptions): string {
  // Phase 19 gate fix: the splice base is the requested string
  // variant (default = the v2.00 string; vellumCrack = the Phase
  // 19 string). An empty or invalid snippet returns that base
  // unchanged, exactly as the stock string was returned before.
  const base = buildGeomVertShader(options);
  const code = customVertCode ?? '';
  if (!code.trim()) return base;
  if (!validateGeomCustomVertexGlslCode(code).ok) return base;
  const block = `    { // geom vertex (user GLSL)
    vec3 worldPos = vWorldPos;
    vec3 normal = vWorldNormal;
    vec3 disp = vec3(0.0);
${code}
    local += disp;
    vWorldPos += disp;
    }
`;
  return base.replace(GEOM_VERT_SEAM_ANCHOR, GEOM_VERT_SEAM_ANCHOR + block);
}

export function buildGeomFrag(customFragCode: string, options?: GeomShaderVariantOptions): string {
  const base = buildGeomFragShader(options);
  const code = customFragCode ?? '';
  if (!code.trim()) return base;
  if (!validateGeomCustomFragmentGlslCode(code).ok) return base;
  const block = `    { // geom fragment (user GLSL)
${code}
    }
`;
  return base.replace(GEOM_FRAG_SEAM_ANCHOR, block + GEOM_FRAG_SEAM_ANCHOR);
}

