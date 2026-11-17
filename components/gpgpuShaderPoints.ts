import { PARTICLE_SHAPE_GLSL } from './particleShapeGlsl';

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
export const DRAW_VERT = /* glsl */ `
  precision highp float;
  uniform sampler2D uPosTex;
  uniform sampler2D uVelTex;
  uniform sampler2D uSortTex;
  uniform bool      uSortEnabled;
  uniform float uSize;
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
  attribute vec2 aTexCoord;
  varying float vSpeed;
  varying float vNormAge;
  varying float vPhaseMix;
  varying float vPlBright;
  varying float vSeed;
  varying vec3 vWorldPos;
  varying float vLightMul;
  varying float vShadowMul;

  ${AGE_CURVE_GLSL}

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
    return fract(sin(n * 127.1 + 311.7) * 43758.5453123);
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
    vSeed    = fract(sin(dot(aTexCoord, vec2(127.1, 311.7))) * 43758.5453123);
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
    vec4 mvPos = modelViewMatrix * vec4(worldPos, 1.0);
    float dist = -mvPos.z;
    gl_PointSize = max(0.5, uSize * sizeMul * (dist > 0.5 ? min(4.0, 500.0 / dist) : 1.0));
    gl_Position  = projectionMatrix * mvPos;
  }
`;

// ── Draw fragment ──
export const DRAW_FRAG = /* glsl */ `
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
  // through the LUT — terrain-style height shading).
  uniform bool      uGradEnabled;
  uniform int       uGradDriver;
  uniform sampler2D uGradLut;
  uniform float     uGradSpatialScale;
  uniform float     uGradTime;
  uniform sampler2D uGradImageTex;
  uniform bool      uGradImageReady;
  uniform float     uGradImageScale;
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
  varying float vSpeed;
  varying float vNormAge;
  varying float vPhaseMix;
  varying float vPlBright;
  varying float vSeed;
  varying vec3 vWorldPos;
  varying float vLightMul;
  varying float vShadowMul;

  ${PARTICLE_SHAPE_GLSL}

  ${AGE_CURVE_GLSL}

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
    vec2 pc = gl_PointCoord - 0.5;
    float d = length(pc);
    if (d > 0.5) discard;

    vec3 col = uColor;
    if (uAgeColorEnabled) {
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
        }
        col = texture2D(uGradLut, vec2(gt, 0.5)).rgb;
      }
    }
    // Particle Life: species differ ONLY by brightness (monochrome).
    if (uParticleLifeEnabled) {
      col *= vPlBright;
    }
    // 3D light (Phase T): brightness from the light object, computed
    // per-particle in the vertex shader from the world position.
    // vLightMul is exactly 1.0 while the light is disabled (or the
    // particle sits outside its radius), so this multiply is a
    // bit-exact identity on the legacy path.
    col *= vLightMul;
    // Occlusion-map shadow (Phase Z): exactly 1.0 while the
    // shadow is disabled or strength is 0, so this multiply is a
    // bit-exact identity on the legacy path.
    col *= vShadowMul;

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
      shapeAlpha = texture2D(uSpriteImageTex, vec2(gl_PointCoord.x, 1.0 - gl_PointCoord.y)).r;
      if (shapeAlpha < 0.01) discard;
    } else if (uPointShape == 0) {
      shapeAlpha = smoothstep(0.5, 0.12, d);
    } else {
      vec2 pq = (gl_PointCoord - 0.5) * 2.0;
      pq.y = -pq.y;
      shapeAlpha = particleShapeMask(uPointShape, pq, vSeed);
      if (shapeAlpha < 0.01) discard;
    }

    gl_FragColor = vec4(col, shapeAlpha * uOpacity * opacityMul * vPhaseMix);
  }
`;

