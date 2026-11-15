import { PARTICLE_SHAPE_GLSL } from './particleShapeGlsl';

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
    vWorldPos = worldPos;
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
  // image is ready), 5 blackbody.
  uniform bool      uGradEnabled;
  uniform int       uGradDriver;
  uniform sampler2D uGradLut;
  uniform float     uGradSpatialScale;
  uniform float     uGradTime;
  uniform sampler2D uGradImageTex;
  uniform bool      uGradImageReady;
  uniform float     uGradImageScale;
  varying float vSpeed;
  varying float vNormAge;
  varying float vPhaseMix;
  varying float vPlBright;
  varying float vSeed;
  varying vec3 vWorldPos;

  ${PARTICLE_SHAPE_GLSL}

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
    // origin scaled; prism = HSL wheel over age + per-particle seed +
    // time; blackbody = heat ramp above.
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
        }
        col = texture2D(uGradLut, vec2(gt, 0.5)).rgb;
      }
    }
    // Particle Life: species differ ONLY by brightness (monochrome).
    if (uParticleLifeEnabled) {
      col *= vPlBright;
    }

    float ageFade = 1.0;
    if (uAgeEnabled) {
      ageFade  = smoothstep(0.0, uAgeFadeIn, vNormAge);
      ageFade *= smoothstep(1.0, 1.0 - uAgeFadeOut, vNormAge);
    }

    // Point shape: 0 keeps the legacy soft disc exactly; kinds 1..11
    // use the shared shape masks (Kinetix integration B1b), the same
    // set the layer point shader exposes through sdfShape.
    float shapeAlpha;
    if (uPointShape == 0) {
      shapeAlpha = smoothstep(0.5, 0.12, d);
    } else {
      vec2 pq = (gl_PointCoord - 0.5) * 2.0;
      pq.y = -pq.y;
      shapeAlpha = particleShapeMask(uPointShape, pq, vSeed);
      if (shapeAlpha < 0.01) discard;
    }

    gl_FragColor = vec4(col, shapeAlpha * uOpacity * ageFade * vPhaseMix);
  }
`;

