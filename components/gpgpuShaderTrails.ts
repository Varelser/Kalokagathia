// ── Trail vertex (samples velocity for speed-based alpha) ──
export const TRAIL_VERT = /* glsl */ `
  precision highp float;
  uniform sampler2D uPosTex;
  uniform sampler2D uVelTex;
  uniform float uSize;
  uniform bool  uKuramotoEnabled;
  uniform float uKuramotoInfluence;
  attribute vec2 aTexCoord;
  varying float vSpeed;
  varying float vPhaseMix;
  void main() {
    vec3 worldPos = texture2D(uPosTex, aTexCoord).xyz;
    vec4 velData  = texture2D(uVelTex, aTexCoord);
    vec3 vel      = velData.xyz;
    vSpeed = clamp(length(vel) / 80.0, 0.0, 1.0);
    // Kuramoto readout: the particle's current phase (velocity texture .w)
    // pulses the whole trail history, same curve as the points readout.
    vPhaseMix = 1.0;
    if (uKuramotoEnabled) {
      float kPulse = 0.5 + 0.5 * sin(velData.w);
      vPhaseMix = mix(1.0, 0.25 + 0.75 * kPulse, uKuramotoInfluence);
    }
    vec4 mvPos = modelViewMatrix * vec4(worldPos, 1.0);
    float dist = -mvPos.z;
    gl_PointSize = max(0.3, uSize * (dist > 0.5 ? min(4.0, 500.0 / dist) : 1.0));
    gl_Position  = projectionMatrix * mvPos;
  }
`;

// ── Trail fragment ──
export const TRAIL_FRAG = /* glsl */ `
  precision highp float;
  uniform vec3  uColor;
  uniform float uAlpha;
  uniform float uVelocityScale;
  varying float vSpeed;
  varying float vPhaseMix;
  void main() {
    vec2 pc = gl_PointCoord - 0.5;
    float d = length(pc);
    if (d > 0.5) discard;
    float speedMul = mix(1.0, vSpeed, uVelocityScale);
    gl_FragColor = vec4(uColor, smoothstep(0.5, 0.15, d) * uAlpha * speedMul * vPhaseMix);
  }
`;

// ── Ribbon vertex (quad-strip between adjacent trail frames) ──
export const RIBBON_VERT = /* glsl */ `
  precision highp float;
  attribute vec2  aTexCoord;
  attribute float aSide;
  attribute float aIsB;
  uniform sampler2D uPosTexA;
  uniform sampler2D uPosTexB;
  uniform sampler2D uVelTex;
  uniform bool  uKuramotoEnabled;
  uniform float uKuramotoInfluence;
  uniform float uWidth;
  uniform float uMaxSegLen;
  varying float vAlpha;
  varying float vRibbonU;
  varying float vRibbonV;
  varying float vPhaseMix;
  void main() {
    vec3 posA = texture2D(uPosTexA, aTexCoord).xyz;
    vec3 posB = texture2D(uPosTexB, aTexCoord).xyz;
    vec3 pos  = mix(posA, posB, aIsB);
    vRibbonV  = aIsB;
    vRibbonU  = aSide;
    vPhaseMix = 1.0;
    if (uKuramotoEnabled) {
      float kPulse = 0.5 + 0.5 * sin(texture2D(uVelTex, aTexCoord).w);
      vPhaseMix = mix(1.0, 0.25 + 0.75 * kPulse, uKuramotoInfluence);
    }
    float segLen = length(posB - posA);
    if (segLen > uMaxSegLen) {
      vAlpha = 0.0;
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      return;
    }
    vec3 dir = segLen > 0.001 ? normalize(posB - posA) : vec3(0.0, 1.0, 0.0);
    vec3 toCamera = normalize(cameraPosition - pos);
    vec3 right = cross(dir, toCamera);
    float rLen = length(right);
    right = rLen > 0.001 ? right / rLen : vec3(1.0, 0.0, 0.0);
    pos += right * aSide * uWidth * 0.5;
    vAlpha = 1.0;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

// ── Ribbon fragment ──
export const RIBBON_FRAG = /* glsl */ `
  precision highp float;
  uniform vec3  uColor;
  uniform float uAlpha;
  uniform float uTaper;
  varying float vAlpha;
  varying float vRibbonU;
  varying float vRibbonV;
  varying float vPhaseMix;
  void main() {
    if (vAlpha < 0.01) discard;
    float edge    = smoothstep(1.0, 0.5, abs(vRibbonU));
    float ageFade = mix(1.0 - uTaper, 1.0, vRibbonV);
    gl_FragColor  = vec4(uColor, uAlpha * edge * ageFade * vPhaseMix);
  }
`;

// ── Tube vertex (8-sided circular cross-section trail) ──
export const TUBE_SIDES = 8;
export const TUBE_VERT = /* glsl */ `
  precision highp float;
  attribute vec2  aTexCoord;
  attribute float aTubeSide;
  attribute float aIsB;
  uniform sampler2D uPosTexA;
  uniform sampler2D uPosTexB;
  uniform sampler2D uVelTex;
  uniform bool  uKuramotoEnabled;
  uniform float uKuramotoInfluence;
  uniform float uTubeRadius;
  uniform float uMaxSegLen;
  varying float vAlpha;
  varying float vRibbonV;
  varying float vPhaseMix;
  const float PI2 = 6.28318530718;
  const float SIDES = ${TUBE_SIDES}.0;
  void main() {
    vec3 posA = texture2D(uPosTexA, aTexCoord).xyz;
    vec3 posB = texture2D(uPosTexB, aTexCoord).xyz;
    vec3 pos  = mix(posA, posB, aIsB);
    vRibbonV  = aIsB;
    vPhaseMix = 1.0;
    float radiusMul = 1.0;
    if (uKuramotoEnabled) {
      float kPulse = 0.5 + 0.5 * sin(texture2D(uVelTex, aTexCoord).w);
      vPhaseMix = mix(1.0, 0.25 + 0.75 * kPulse, uKuramotoInfluence);
      // Tubes also breathe in radius with the phase (same curve family as
      // the points size pulse).
      radiusMul = mix(1.0, 0.55 + 0.9 * kPulse, uKuramotoInfluence);
    }
    float segLen = length(posB - posA);
    if (segLen > uMaxSegLen) { vAlpha = 0.0; gl_Position = vec4(2.0,2.0,2.0,1.0); return; }
    vec3 dir = segLen > 0.001 ? normalize(posB - posA) : vec3(0.0, 1.0, 0.0);
    vec3 up    = abs(dir.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
    vec3 right = normalize(cross(dir, up));
    vec3 up2   = normalize(cross(right, dir));
    float angle = PI2 * aTubeSide / SIDES;
    pos += (right * cos(angle) + up2 * sin(angle)) * uTubeRadius * radiusMul;
    vAlpha = 1.0;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

// ── Tube fragment ──
export const TUBE_FRAG = /* glsl */ `
  precision highp float;
  uniform vec3  uColor;
  uniform float uAlpha;
  uniform float uTaper;
  varying float vAlpha;
  varying float vRibbonV;
  varying float vPhaseMix;
  void main() {
    if (vAlpha < 0.01) discard;
    float ageFade = mix(1.0 - uTaper, 1.0, vRibbonV);
    gl_FragColor  = vec4(uColor, uAlpha * ageFade * vPhaseMix);
  }
`;

// ── Streak vertex (velocity-direction line segments) ──
export const STREAK_VERT = /* glsl */ `
  precision highp float;
  attribute vec2  aTexCoord;
  attribute float aIsEnd;
  uniform sampler2D uPosTex;
  uniform sampler2D uVelTex;
  uniform float uStreakLength;
  uniform bool  uAgeEnabled;
  uniform float uAgeMax;
  varying float vEndAlpha;
  varying float vNormAge;
  void main() {
    vec4 posData = texture2D(uPosTex, aTexCoord);
    vec3 pos     = posData.xyz;
    vec3 vel     = texture2D(uVelTex, aTexCoord).xyz;
    float spd    = length(vel);
    vEndAlpha    = 1.0 - aIsEnd;
    vNormAge     = uAgeEnabled ? clamp(posData.w / max(uAgeMax, 0.001), 0.0, 1.0) : 0.5;
    vec3 worldPos = pos - normalize(vel + vec3(0.0001)) * aIsEnd * uStreakLength * min(spd * 0.05, 1.0);
    gl_Position   = projectionMatrix * modelViewMatrix * vec4(worldPos, 1.0);
  }
`;

// ── Streak fragment ──
export const STREAK_FRAG = /* glsl */ `
  precision highp float;
  uniform vec3  uColor;
  uniform float uOpacity;
  uniform bool  uAgeEnabled;
  uniform float uAgeFadeIn;
  uniform float uAgeFadeOut;
  varying float vEndAlpha;
  varying float vNormAge;
  void main() {
    float ageFade = 1.0;
    if (uAgeEnabled) {
      ageFade  = smoothstep(0.0, uAgeFadeIn, vNormAge);
      ageFade *= smoothstep(1.0, 1.0 - uAgeFadeOut, vNormAge);
    }
    gl_FragColor = vec4(uColor, uOpacity * vEndAlpha * ageFade);
  }
`;

