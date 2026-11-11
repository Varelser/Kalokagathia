export const FRAGMENT_SHADER = `
  precision highp float;
  varying float vAlpha;
  varying vec2 vUv;
  varying float vLife;
  varying float vVelocity;
  varying float vSpriteMode;
  varying float vVariant;
  varying float vBurst;
  uniform vec3 uColor;
  uniform float uContrast;
  uniform float uInkMode;
  uniform float uSoftness;
  uniform float uGlow;
  uniform float uVelocityGlow;
  uniform float uVelocityAlpha;
  uniform float uTime;
  uniform float uFlickerAmount;
  uniform float uFlickerSpeed;
  uniform float uHueShift;
  uniform int uSdfShape;
  uniform float uSdfEnabled;
  uniform vec2 uSdfLight;
  uniform float uSdfSpecular;
  uniform float uSdfShininess;
  uniform float uSdfAmbient;

  // SDF shape functions (uv in [0,1] x [0,1], return signed dist; negative = inside)
  float sdfCircle(vec2 p, float r) {
    return length(p) - r;
  }
  float sdfRing(vec2 p, float r, float thickness) {
    return abs(length(p) - r) - thickness;
  }
  float sdfStar(vec2 p, float r) {
    // 5-pointed star
    float angle = atan(p.y, p.x) - 1.5707963;
    float slice = 6.28318530718 / 5.0;
    float a = mod(angle, slice) - slice * 0.5;
    float d = length(p);
    float x = cos(a) * d - r;
    float y = abs(sin(a) * d) - r * 0.4;
    return max(x, y) * 0.85;
  }
  float sdfHexagon(vec2 p, float r) {
    const vec2 k = vec2(-0.866025404, 0.5);
    vec2 q = abs(p);
    q -= 2.0 * min(dot(k, q), 0.0) * k;
    q -= vec2(clamp(q.x, -k.y * r, k.y * r), r);
    return length(q) * sign(q.y);
  }

  vec3 rgb2hsv(vec3 c) {
    vec4 K = vec4(0.0, -1.0/3.0, 2.0/3.0, -1.0);
    vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
    vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
    float d = q.x - min(q.w, q.y);
    float e = 1.0e-10;
    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
  }
  vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
  }

  void main() {
    float dist = length(vUv - 0.5);
    if (dist > 0.5) discard;
    float contrast = max(0.05, uContrast);
    float softness = clamp(uSoftness, 0.0, 1.0);
    float glow = max(0.0, uGlow);
    float innerEdge = mix(0.26, 0.08, softness);
    float outerEdge = mix(0.44, 0.62, softness);
    float edge = pow(clamp(1.0 - smoothstep(innerEdge, outerEdge, dist), 0.0, 1.0), 1.0 / contrast);
    float velocityGlow = 1.0 + vVelocity * uVelocityGlow;
    float halo = pow(clamp(1.0 - smoothstep(0.12, 0.5, dist), 0.0, 1.0), mix(2.8, 1.2, clamp(glow, 0.0, 1.0)));
    halo *= velocityGlow;
    float spriteAlpha = edge;
    if (vSpriteMode > 0.5 && vSpriteMode < 1.5) {
      float ringCenter = mix(0.22, 0.34, clamp(vLife, 0.0, 1.0));
      float ringWidth = mix(0.12, 0.05, softness);
      float ring = 1.0 - smoothstep(ringWidth, ringWidth + 0.08, abs(dist - ringCenter));
      float core2 = 1.0 - smoothstep(0.0, 0.12, dist);
      spriteAlpha = max(ring, core2 * 0.35);
    } else if (vSpriteMode >= 1.5) {
      vec2 centered = vUv - 0.5;
      float spokeA = 1.0 - smoothstep(0.01, 0.09 + (1.0 - vVelocity) * 0.06, abs(centered.x) + abs(centered.y) * 0.42);
      float spokeB = 1.0 - smoothstep(0.01, 0.09 + (1.0 - vVelocity) * 0.06, abs(centered.y) + abs(centered.x) * 0.42);
      float ember = 1.0 - smoothstep(0.08, 0.42, dist);
      spriteAlpha = max(max(spokeA, spokeB) * (0.55 + vVelocity * 0.75), ember * 0.4);
    }
    float velocityAlpha = 1.0 + vVelocity * uVelocityAlpha;
    float flickerPhase = uTime * max(0.05, uFlickerSpeed) * (2.6 + vVelocity * 1.8) + vVariant * 13.7 + vLife * 9.0;
    float flicker = mix(1.0, 0.55 + 0.45 * sin(flickerPhase), clamp(uFlickerAmount, 0.0, 1.0));
    flicker = mix(flicker, 1.0, clamp(vBurst, 0.0, 1.0) * 0.22);
    float baseAlpha = clamp(vAlpha * spriteAlpha * mix(0.8, 1.25, clamp((contrast - 0.5) / 1.5, 0.0, 1.0)) * velocityAlpha * flicker, 0.0, 1.0);
    baseAlpha = clamp(baseAlpha + vAlpha * halo * glow * 0.45, 0.0, 1.0);
    float core = 1.0 - smoothstep(0.0, mix(0.3, 0.18, softness), dist);
    float body = 1.0 - smoothstep(0.05, mix(0.5, 0.35, softness), dist);
    float inkAlpha = clamp(vAlpha * (0.45 + core * 1.15 + body * 0.9 + halo * glow * 0.35 + spriteAlpha * 0.45) * max(1.0, contrast * 0.9) * velocityAlpha * flicker, 0.0, 1.0);
    float alpha = mix(baseAlpha, inkAlpha, uInkMode);
    vec3 finalColor = uColor;
    if (abs(uHueShift) > 0.001) {
      vec3 hsv = rgb2hsv(finalColor);
      hsv.x = fract(hsv.x + uHueShift);
      finalColor = hsv2rgb(hsv);
    }
    // Ink mode: invert color so white particles become black on white background
    finalColor = mix(finalColor, vec3(1.0) - finalColor, uInkMode);

    // SDF shape + pseudo-3D lighting
    if (uSdfEnabled > 0.5) {
      vec2 p = vUv - 0.5; // [-0.5, 0.5]
      float sdfDist;
      if (uSdfShape == 1) {
        // ring
        sdfDist = sdfRing(p, 0.28, 0.08);
      } else if (uSdfShape == 2) {
        // star
        sdfDist = sdfStar(p, 0.38);
      } else if (uSdfShape == 3) {
        // hexagon
        sdfDist = sdfHexagon(p, 0.38);
      } else {
        // sphere (default)
        sdfDist = sdfCircle(p, 0.42);
      }
      float shapeEdge = 1.0 - smoothstep(-0.02, 0.02, sdfDist);
      if (shapeEdge < 0.01) discard;
      // pseudo-3D lighting for sphere only
      float lighting = 1.0;
      if (uSdfShape == 0) {
        // reconstruct hemisphere normal from UV
        vec2 np = p / 0.42;
        float nz2 = max(0.0, 1.0 - dot(np, np));
        vec3 N = normalize(vec3(np.x, np.y, sqrt(nz2)));
        vec3 L = normalize(vec3(uSdfLight.x, uSdfLight.y, 0.7));
        float diffuse = max(0.0, dot(N, L));
        vec3 V = vec3(0.0, 0.0, 1.0);
        vec3 H = normalize(L + V);
        float specular = pow(max(0.0, dot(N, H)), uSdfShininess) * uSdfSpecular;
        lighting = clamp(uSdfAmbient + diffuse * (1.0 - uSdfAmbient) + specular, 0.0, 2.0);
      }
      alpha = clamp(vAlpha * shapeEdge * velocityAlpha * flicker, 0.0, 1.0);
      finalColor = finalColor * lighting;
    }

    gl_FragColor = vec4(finalColor, alpha);
  }
`;
