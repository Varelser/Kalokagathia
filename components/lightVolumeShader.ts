// Light volume shader strings + the fragment builder
// (Phase Y strings, moved verbatim from
// components/LightVolume.tsx in Layer 1 WP7 Phase B so the
// variant assembly is unit-testable without importing React;
// the strings themselves are unchanged by the move).
//
// Variant discipline: buildLightVolumeFragment(false) returns
// VOLUME_FRAGMENT itself — the stock string byte for byte,
// including the Phase 16 depth-occlusion block in its legacy
// runtime-gated form. The depth-intersection form (true)
// splices exactly three things into a copy: the
// uDepthIntersect uniform, the kaloVolumeDepthIntersectFade
// GLSL twin (lib/lightVolume.ts), and an extended depth block
// that keeps the legacy fade and additionally truncates the
// accumulated beam by the visible chord fraction. If a splice
// anchor ever drifts, the builder falls back to the stock
// string rather than emitting a broken one.
//
// Density variant (Layer 1 WP7 Phase D): the optional second
// argument splices the particle-density attenuation into
// whichever base the first argument produced — the density
// uniforms, the log + attenuation GLSL twins
// (lib/particleDensity.ts), and one attenuation block applied
// to the accumulated alpha just before the discard, so it
// composes with the shadow and depth terms in either base.
// Fallback is per variant: a drifted density anchor returns
// the base string (the density form simply does not stand),
// never a broken string.

import { SCENE_DEPTH_GLSL } from '../lib/sceneDepth';
import { LIGHT_VOLUME_DEPTH_INTERSECT_GLSL } from '../lib/lightVolume';
import {
  PARTICLE_DENSITY_ATTENUATION_GLSL,
  SHINE_DENSITY_GLSL,
} from '../lib/particleDensity';

export const VOLUME_VERTEX = /* glsl */ `
  varying vec3 vLocal;
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying vec3 vScene;
  uniform vec3 uSceneOrigin;
  uniform vec4 uSceneQuat;
  uniform vec3 uMeshOffset;
  uniform float uMeshFlip;
  vec3 quatRotate(vec4 q, vec3 v) {
    return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v);
  }
  void main() {
    vLocal = position;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    vNormal = normalize(mat3(modelMatrix) * normal);
    // Scene-local position (the frame the shadow bake lives in):
    // mesh flip/offset first, then the light group's quaternion,
    // then the light position. vWorld includes the scene group's
    // own rotation and cannot be used for the bake sample.
    vec3 lp = position;
    if (uMeshFlip > 0.5) lp = vec3(lp.x, -lp.y, -lp.z);
    lp += uMeshOffset;
    vScene = uSceneOrigin + quatRotate(uSceneQuat, lp);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

export const VOLUME_FRAGMENT = /* glsl */ `
  precision highp float;
  varying vec3 vLocal;
  varying vec3 vWorld;
  varying vec3 vNormal;
  uniform float uIntensity;
  uniform float uSteps;
  uniform float uSoftness;
  uniform float uLength;
  uniform float uRadius;
  uniform float uShape; // 0 = cone, 1 = sphere
  // Occlusion-map shadow (Phase Z): the volume dims where the
  // baked occlusion says the light is blocked.
  uniform sampler2D uShadowMap;
  uniform float uShadowReady;
  uniform float uShadowExtent;
  uniform float uShadowStrength;
  // Tunnel occlusion bake (Round 83/84 gap 7): while the
  // terrain is a tunnel, fragments inside the tube region read
  // the tunnel bake by the (theta, z) inverse transform
  // instead of the plane bake by world XZ.
  uniform sampler2D uShadowTunnelMap;
  uniform float uShadowTunnelReady;
  uniform float uShadowHeightScale;
  varying vec3 vScene;
  // Scene depth occlusion (Phase 16 stage 1): the shared scene
  // depth capture (lib/sceneDepth.ts). uDepthReady 0 (no texture
  // bound — always the case while gpgpuDepthOcclusion is 0, when
  // the capture never mounts) skips this block entirely and the
  // accumulation below is the legacy formula verbatim.
  uniform sampler2D uSceneDepth;
  uniform float uDepthReady;
  uniform float uDepthOcclusion;
  uniform float uCamNear;
  uniform float uCamFar;
  uniform vec2 uResolution;
  ${SCENE_DEPTH_GLSL}

  float edgeExp() { return mix(0.8, 2.2, uSoftness); }

  void main() {
    // View chord through the volume, approximated by the
    // surface normal vs view direction: 1 through the middle of
    // the silhouette, 0 at its rim. (A radial density evaluated
    // ON the mesh surface would be identically zero, so the
    // chord carries the cross-beam falloff — see lib/lightVolume.ts.)
    vec3 viewDir = normalize(cameraPosition - vWorld);
    float chord = abs(dot(normalize(vNormal), viewDir));
    float acc = 0.0;
    float n = uSteps;
    if (uShape < 0.5) {
      // Cone: local geometry space has the apex at +length/2 and
      // the base at -length/2 (ConeGeometry), so the axial
      // fraction is u = 0.5 - y / length.
      float u = clamp(0.5 - vLocal.y / uLength, 0.0, 1.0);
      for (int i = 0; i < 32; i++) {
        if (float(i) >= n) break;
        float s = u * (float(i) / n);
        acc += pow(1.0 - s, 1.3);
      }
      acc /= n;
      acc *= pow(chord, edgeExp());
    } else {
      for (int i = 0; i < 32; i++) {
        if (float(i) >= n) break;
        float f = float(i) / n;
        acc += 1.0 - f * f;
      }
      acc /= n;
      acc *= pow(chord, edgeExp()) * 1.4;
    }
    float a = clamp(uIntensity * acc, 0.0, 1.0);
    if (uShadowReady > 0.5 && uShadowStrength > 0.0) {
      float occ = 0.0;
      bool tunnelSampled = false;
      if (uShadowTunnelReady > 0.5) {
        // Inside the tube region the tunnel bake applies; the
        // region test matches bakedTunnelShadowMultiplier.
        float rho = length(vScene.xy);
        if (rho <= uShadowExtent + uShadowHeightScale * 0.5 && abs(vScene.z) <= uShadowExtent) {
          float tu = fract(atan(vScene.y, vScene.x) / 6.28318530718);
          float tv = clamp(vScene.z / (2.0 * uShadowExtent) + 0.5, 0.0, 1.0);
          occ = texture2D(uShadowTunnelMap, vec2(tu, tv)).r;
          tunnelSampled = true;
        }
      }
      if (!tunnelSampled) {
        vec2 suv = clamp(vScene.xz / (2.0 * uShadowExtent) + 0.5, 0.0, 1.0);
        occ = texture2D(uShadowMap, suv).r;
      }
      a *= 1.0 - uShadowStrength * occ * 0.8;
    }
    if (uDepthReady > 0.5 && uDepthOcclusion > 0.0) {
      // Cut / fade the volume where an opaque surface sits in
      // front of this fragment: the scene depth at this pixel vs
      // this fragment's own view depth, softened over 5% of the
      // fragment depth (min 1 world unit).
      vec2 duv = gl_FragCoord.xy / max(uResolution, vec2(1.0));
      float sceneDepth = kaloViewDepthFromBuffer(texture2D(uSceneDepth, duv).x, uCamNear, uCamFar);
      float fragDepth = -(viewMatrix * vec4(vWorld, 1.0)).z;
      float fade = kaloDepthFadeFactor(sceneDepth, fragDepth, max(fragDepth * 0.05, 1.0));
      a *= mix(1.0, fade, clamp(uDepthOcclusion, 0.0, 1.0));
    }
    if (a <= 0.001) discard;
    gl_FragColor = vec4(vec3(1.0), a);
  }
`;

const DEPTH_BLOCK_START = '    if (uDepthReady > 0.5 && uDepthOcclusion > 0.0) {';
const DEPTH_BLOCK_END = '    if (a <= 0.001) discard;';

const EXTENDED_DEPTH_BLOCK = /* glsl */ `    if (uDepthReady > 0.5 && (uDepthOcclusion > 0.0 || uDepthIntersect > 0.0)) {
      // Cut / fade the volume where an opaque surface sits in
      // front of this fragment: the scene depth at this pixel vs
      // this fragment's own view depth, softened over 5% of the
      // fragment depth (min 1 world unit).
      vec2 duv = gl_FragCoord.xy / max(uResolution, vec2(1.0));
      float sceneDepth = kaloViewDepthFromBuffer(texture2D(uSceneDepth, duv).x, uCamNear, uCamFar);
      float fragDepth = -(viewMatrix * vec4(vWorld, 1.0)).z;
      if (uDepthOcclusion > 0.0) {
        float fade = kaloDepthFadeFactor(sceneDepth, fragDepth, max(fragDepth * 0.05, 1.0));
        a *= mix(1.0, fade, clamp(uDepthOcclusion, 0.0, 1.0));
      }
      if (uDepthIntersect > 0.0) {
        // Depth intersection (Layer 1 WP7 Phase B): truncate
        // the accumulated beam where scene geometry crosses the
        // view chord — the visible fraction of the chord in
        // front of the scene surface scales the accumulation,
        // so geometry standing mid-beam dims the beam segment
        // in front of it instead of the beam drawing through
        // at full brightness (the Phase Y recorded limit).
        // Twins: lib/lightVolume.ts
        // (lightVolumeDepthIntersectFade / lightVolumeChordLength).
        float chordLen = chord * (uShape < 0.5 ? uLength : 2.0 * uLength);
        float ifade = kaloVolumeDepthIntersectFade(sceneDepth, fragDepth, chordLen, gl_FrontFacing);
        a *= mix(1.0, ifade, clamp(uDepthIntersect, 0.0, 1.0));
      }
    }
`;

const DENSITY_BLOCK = /* glsl */ `    if (uVolumeDensityReady > 0.5 && uVolumeDensity > 0.0) {
      // Particle density attenuation (Layer 1 WP7 Phase D):
      // the shared density field (lib/particleDensity.ts) at
      // this fragment's screen position scales the accumulated
      // beam — where particles crowd the screen, the volume
      // behind them dims by the field's transmittance instead
      // of drawing through at full brightness. Screen-space
      // like the field itself: an attenuation, never a shadow.
      // Twin: particleDensityAttenuation in lib/particleDensity.ts.
      vec2 duvD = gl_FragCoord.xy / max(uResolution, vec2(1.0));
      float pdRaw = texture2D(uParticleDensity, duvD).r;
      a *= kaloParticleDensityAttenuation(uVolumeDensity, pdRaw);
    }
`;

/**
 * Splice the particle-density attenuation into a base
 * fragment (stock or depth-intersection variant). Returns the
 * base unchanged when any anchor has drifted.
 */
function spliceVolumeDensity(base: string): string {
  const withUniforms = base.replace(
    '  uniform float uDepthOcclusion;\n',
    '  uniform float uDepthOcclusion;\n'
      + '  uniform sampler2D uParticleDensity;\n'
      + '  uniform float uVolumeDensity;\n'
      + '  uniform float uVolumeDensityReady;\n',
  );
  if (withUniforms === base) return base;
  const withGlsl = withUniforms.replace(
    '  float edgeExp() { return mix(0.8, 2.2, uSoftness); }',
    SHINE_DENSITY_GLSL
      + PARTICLE_DENSITY_ATTENUATION_GLSL
      + '  float edgeExp() { return mix(0.8, 2.2, uSoftness); }',
  );
  if (withGlsl === withUniforms) return base;
  const end = withGlsl.indexOf(DEPTH_BLOCK_END);
  if (end < 0) return base;
  return withGlsl.slice(0, end) + DENSITY_BLOCK + withGlsl.slice(end);
}

/**
 * The volume fragment for the material: the stock string
 * while the depth-intersection strength is 0, the extended
 * variant while it is positive; the density variant (second
 * argument) splices the particle-density attenuation into
 * either base while gpgpuLightVolumeDensity is positive.
 */
export function buildLightVolumeFragment(depthIntersect: boolean, density = false): string {
  let base = VOLUME_FRAGMENT;
  if (depthIntersect) {
    const withUniform = VOLUME_FRAGMENT.replace(
      '  uniform float uDepthOcclusion;\n',
      '  uniform float uDepthOcclusion;\n  uniform float uDepthIntersect;\n',
    );
    if (withUniform === VOLUME_FRAGMENT) return VOLUME_FRAGMENT;
    const withFade = withUniform.replace(
      '  float edgeExp() { return mix(0.8, 2.2, uSoftness); }',
      LIGHT_VOLUME_DEPTH_INTERSECT_GLSL + '  float edgeExp() { return mix(0.8, 2.2, uSoftness); }',
    );
    if (withFade === withUniform) return VOLUME_FRAGMENT;
    const start = withFade.indexOf(DEPTH_BLOCK_START);
    const end = withFade.indexOf(DEPTH_BLOCK_END);
    if (start < 0 || end < 0 || end <= start) return VOLUME_FRAGMENT;
    base = withFade.slice(0, start) + EXTENDED_DEPTH_BLOCK + withFade.slice(end);
  }
  return density ? spliceVolumeDensity(base) : base;
}
