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
    vec3 vel      = texture2D(uVelTex, particleUv).xyz;
    vSpeed   = clamp(length(vel) / 80.0, 0.0, 1.0);
    vNormAge = uAgeEnabled ? clamp(posData.w / max(uAgeMax, 0.001), 0.0, 1.0) : 0.5;
    float sizeMul = uAgeSizeEnabled ? mix(uAgeSizeStart, uAgeSizeEnd, vNormAge) : 1.0;
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
  varying float vSpeed;
  varying float vNormAge;
  varying float vPhaseMix;
  varying float vPlBright;

  vec3 hsv2rgb(float h, float s, float v) {
    vec3 p = abs(fract(vec3(h) + vec3(1.0, 2.0/3.0, 1.0/3.0)) * 6.0 - 3.0);
    return v * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), s);
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
    // Particle Life: species differ ONLY by brightness (monochrome).
    if (uParticleLifeEnabled) {
      col *= vPlBright;
    }

    float ageFade = 1.0;
    if (uAgeEnabled) {
      ageFade  = smoothstep(0.0, uAgeFadeIn, vNormAge);
      ageFade *= smoothstep(1.0, 1.0 - uAgeFadeOut, vNormAge);
    }

    gl_FragColor = vec4(col, smoothstep(0.5, 0.12, d) * uOpacity * ageFade * vPhaseMix);
  }
`;

