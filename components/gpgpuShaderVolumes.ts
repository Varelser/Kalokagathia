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
      accumulated += exp(-d * d * 4.0) * segLen;
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
  uniform float uMeshStretch;
  varying vec3 vNormal;

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
    float phase = fract(sin(dot(aTexCoord, vec2(127.1, 311.7))) * 43758.5453123);
    float spinAng = uSpinSpeed == 0.0 ? 0.0 : uTime * uSpinSpeed + phase * 6.2831853;
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
    gl_Position = projectionMatrix * modelViewMatrix * vec4(instancePos + local, 1.0);
  }
`;

// ── Instanced geometry fragment (Lambert + specular) ──
export const GEOM_FRAG = /* glsl */ `
  precision highp float;
  uniform vec3  uColor;
  uniform float uOpacity;
  uniform float uEnvReflect;
  varying vec3 vNormal;
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
    gl_FragColor = vec4(col, uOpacity);
  }
`;

