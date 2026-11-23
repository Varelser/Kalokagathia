// Phase 19 stage 4 — Pyro volume raymarch shaders.
//
// The new render path for the Pyro grid's density field: a
// single box mesh over the grid domain, marched per fragment
// through the solver's scalar atlas (density .r / temperature
// .g) with Beer-Lambert accumulation. The atlas sampling and
// the world<->cell mapping are the solver's own shared chunks
// (PYRO_GRID_SAMPLING / PYRO_GRID_WORLD) — the solver files
// are NOT modified by this stage; this shader only reads the
// atlas the existing PyroGridFogFeed publishes.
//
// The accumulation structure follows VOLUMETRIC_FRAG
// (components/gpgpuShaderVolumes.ts) — ray interval, then
// alpha = 1 - exp(-sum sigma * segLen) front-to-back — with
// two changes the design requires: the interval is against
// the domain CUBE (not a sphere) and the density is sampled
// from the atlas (not the analytic exp(-d^2 * 4)). The CPU
// twins of both halves live in lib/pyroVolumeMath.ts (ray /
// accumulation) and lib/shadowOcclusion.ts
// (cubeSampleTransmittance, self-shadow march).
//
// Density normalisation: sigma = density * uPyroVolumeDensity
// / (2 * halfExtent), so a full domain crossing at density 1
// and scale 1 accumulates optical depth 1. The grid's raw
// density is unbounded (the fog path clamps it at 24); the
// march clamps each sample the same way before scaling.

import { PYRO_GRID_SAMPLING, PYRO_GRID_UNIFORMS, PYRO_GRID_WORLD } from './gpgpuShaderPyroGrid';
import { SCENE_DEPTH_GLSL } from '../lib/sceneDepth';

export const PYRO_VOLUME_VERT = /* glsl */ `
varying vec3 vWorldPos;
void main() {
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldPos = worldPos.xyz;
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

export const PYRO_VOLUME_FRAG = /* glsl */ `
precision highp float;
varying vec3 vWorldPos;
uniform sampler2D uPyroAtlas;
${PYRO_GRID_UNIFORMS}
${PYRO_GRID_SAMPLING}
${PYRO_GRID_WORLD}
uniform float uPyroVolumeDensity;
uniform float uPyroVolumeSteps;
uniform float uPyroVolumeShadowSteps;
uniform vec3 uPyroVolumeLightDir;
uniform float uPyroTempAmount;
uniform vec3 uColor;
uniform float uOpacity;
uniform sampler2D uSceneDepth;
uniform float uDepthReady;
uniform float uCamNear;
uniform float uCamFar;
uniform vec3 uCamForward;
uniform vec2 uResolution;
${SCENE_DEPTH_GLSL}

// Ray x domain-cube interval (slab method), the GLSL twin of
// rayBoxInterval in lib/pyroVolumeMath.ts. Returns
// vec2(t0, t1) with t0 clamped to 0 for an inside origin, or
// vec2(-1.0) on a miss.
vec2 pyroVolumeBoxInterval(vec3 ro, vec3 rd, vec3 center, float halfExtent) {
  vec3 bmin = center - vec3(halfExtent);
  vec3 bmax = center + vec3(halfExtent);
  vec3 inv = 1.0 / rd;
  vec3 ta = (bmin - ro) * inv;
  vec3 tb = (bmax - ro) * inv;
  vec3 tmin = min(ta, tb);
  vec3 tmax = max(ta, tb);
  float t0 = max(max(tmin.x, tmin.y), tmin.z);
  float t1 = min(min(tmax.x, tmax.y), tmax.z);
  if (t1 < max(t0, 0.0)) return vec2(-1.0);
  return vec2(max(t0, 0.0), t1);
}

// Deterministic per-pixel jitter in [0, 1): same integer hash
// family as pyroVolumeJitter in lib/pyroVolumeMath.ts. Fixed
// per pixel, so the march offset never flickers frame to frame.
float pyroVolumeJitter(vec2 fragCoord) {
  float h = fract(sin(dot(fragCoord, vec2(127.1, 311.7))) * 43758.5453);
  return h;
}

float pyroVolumeDensityAt(vec3 worldPos) {
  vec3 cell = pyroCellOfWorld(worldPos);
  vec4 s = pyroSample(uPyroAtlas, cell);
  return min(s.r, 24.0) * pyroDomainFade(cell);
}

void main() {
  vec3 ro = cameraPosition;
  vec3 rd = normalize(vWorldPos - cameraPosition);
  vec2 interval = pyroVolumeBoxInterval(ro, rd, uPyroGridBounds.xyz, uPyroGridBounds.w);
  if (interval.y < 0.0) discard;
  float t0 = interval.x;
  float t1 = interval.y;
  // Scene-depth clamp (Phase 16 depth base): when a depth
  // source is bound, the march stops at the first opaque
  // surface along the ray, so smoke never draws over geometry
  // in front of it. Unbound (the default) = no clamp, exactly
  // the un-occluded march.
  if (uDepthReady > 0.5) {
    vec2 depthUv = gl_FragCoord.xy / max(uResolution, vec2(1.0));
    float rawDepth = texture2D(uSceneDepth, depthUv).x;
    float viewDepth = kaloViewDepthFromBuffer(rawDepth, uCamNear, uCamFar);
    float forward = max(dot(rd, uCamForward), 1e-4);
    t1 = min(t1, viewDepth / forward);
    if (t1 <= t0) discard;
  }
  int steps = int(clamp(uPyroVolumeSteps, 8.0, 64.0) + 0.5);
  float segLen = (t1 - t0) / float(steps);
  float norm = uPyroVolumeDensity / max(2.0 * uPyroGridBounds.w, 1e-4);
  float jitter = pyroVolumeJitter(gl_FragCoord.xy);
  int shadowSteps = int(clamp(uPyroVolumeShadowSteps, 0.0, 8.0) + 0.5);
  float transmittance = 1.0;
  vec3 colorAcc = vec3(0.0);
  for (int i = 0; i < 64; i++) {
    if (i >= steps) break;
    float t = t0 + (float(i) + jitter) * segLen;
    vec3 p = ro + rd * t;
    vec3 cell = pyroCellOfWorld(p);
    vec4 s = pyroSample(uPyroAtlas, cell);
    float fade = pyroDomainFade(cell);
    float dens = min(s.r, 24.0) * fade;
    if (dens > 0.001) {
      float shade = 1.0;
      if (shadowSteps > 0) {
        // Self-shadow: secondary march toward the light over
        // the remaining in-box distance (cubeSampleTransmittance
        // twin in lib/shadowOcclusion.ts).
        vec2 lightInterval = pyroVolumeBoxInterval(p, uPyroVolumeLightDir, uPyroGridBounds.xyz, uPyroGridBounds.w);
        float lightLen = lightInterval.y > 0.0 ? lightInterval.y : 0.0;
        if (lightLen > 0.0) {
          float lSeg = lightLen / float(shadowSteps);
          float lTrans = 1.0;
          for (int j = 0; j < 8; j++) {
            if (j >= shadowSteps) break;
            vec3 lp = p + uPyroVolumeLightDir * ((float(j) + 0.5) * lSeg);
            lTrans *= exp(-pyroVolumeDensityAt(lp) * norm * lSeg);
          }
          shade = mix(1.0, lTrans, 0.65);
        }
      }
      float a = 1.0 - exp(-dens * norm * segLen);
      vec3 sampleColor = uColor * (0.35 + 0.65 * shade)
        + uColor * min(s.g * fade, 3.0) * uPyroTempAmount;
      colorAcc += transmittance * a * sampleColor;
      transmittance *= 1.0 - a;
      if (transmittance < 0.02) break; // early termination
    }
  }
  float alpha = 1.0 - transmittance;
  if (alpha <= 0.003) discard;
  vec3 color = colorAcc / max(alpha, 1e-4);
  gl_FragColor = vec4(color, alpha * uOpacity);
}
`;
