// ── Volumetric sphere sprite vertex ──
export const VOLUMETRIC_VERT = /* glsl */ `
  precision highp float;
  attribute vec2 aTexCoord;
  uniform sampler2D uPosTex;
  uniform float uRadius;
  varying vec3 vWorldCenter;
  varying vec3 vQuadPos;
  void main() {
    vec3 center = texture2D(uPosTex, aTexCoord).xyz;
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
export const GEOM_VERT = /* glsl */ `
  precision highp float;
  attribute vec2 aTexCoord;
  uniform sampler2D uPosTex;
  uniform sampler2D uVelTex;
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
  varying vec3 vNormal;
  // Image-based lighting (Phase AL): world-space normal / position
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
    gl_Position = projectionMatrix * modelViewMatrix * vec4(instancePos + local, 1.0);
  }
`;

// ── Instanced geometry fragment (Lambert + specular) ──
export const GEOM_FRAG = /* glsl */ `
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
  varying vec3 vNormal;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPos;

  vec3 kaloIblRotYaw(vec3 d, float yaw) {
    float c = cos(yaw);
    float s = sin(yaw);
    return vec3(c * d.x + s * d.z, d.y, -s * d.x + c * d.z);
  }
  vec2 kaloEquirectUv(vec3 dir) {
    float v = asin(clamp(dir.y, -1.0, 1.0)) * 0.31830988618 + 0.5;
    float u = atan(dir.z, dir.x) * 0.15915494309 + 0.5;
    return vec2(u, v);
  }

  void main() {
    vec3 N = normalize(vNormal);
    vec3 L = normalize(vec3(0.5, 1.0, 0.8));
    float diff = max(0.0, dot(N, L)) * 0.7 + 0.3;
    vec3 V = vec3(0.0, 0.0, 1.0);
    vec3 H = normalize(L + V);
    float spec = pow(max(0.0, dot(N, H)), 24.0) * 0.35;
    vec3 col = uColor * diff + spec;
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
    gl_FragColor = vec4(col, uOpacity);
  }
`;

