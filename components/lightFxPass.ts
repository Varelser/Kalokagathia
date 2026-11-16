// LightFX pass (Phase D): Trapcode Shine / Starglow / Lux
// equivalents as ONE post stage, following the same Pass shape as
// radialBlurPass.ts / outputGradePass.ts. The stage is only inserted
// when at least one sub-effect is enabled (see lib/postFxStack.ts),
// so with the defaults the composer output is unchanged.
//
// - Shine: screen-space light rays. Highlights are extracted with a
//   bright-pass and accumulated along the ray from the shared light
//   position through each pixel (extended past the pixel by the
//   length control with exponential falloff), which smears bright
//   objects into rays emanating from the light source.
// - Starglow: star glints. The same bright-pass is streak-blurred
//   along the horizontal and vertical axes (plus the two diagonals
//   when enabled), producing 4- or 8-point glints on highlights.
// - Lux: the light source made visible — a neutral-white gaussian
//   glow disc with a hot core at the light position, plus an
//   optional screen-space cone (angle / spread / length) for the
//   spotlight look.
//
// Scope decision (Phase D brief): the Lux source position is the
// shared manual UV position keys (postLightX / postLightY), NOT a
// projection of the GPGPU attractor/well positions. The wells live
// in simulation time inside the GPGPU shaders; the post chain has no
// access to that time base (deterministic renders step it
// independently), so a projected position could silently disagree
// with the simulation. A manual position is exact, works in
// deterministic renders, and matches the existing sdfLightX/Y
// precedent. An image-derived centroid was also rejected: a correct
// global centroid needs a reduction pass, against the
// minimal-new-passes principle.
//
// Shimmer (Phase M): the Starglow glints can twinkle over time.
// The time base is a FRAME COUNTER incremented once per render()
// call of this pass — never a wall clock (no Date.now, no
// THREE.Clock). Deterministic renders step frames one by one, so a
// given frame number always produces the same shimmer phase, and
// two renders of the same job agree bit-for-bit in this pass; live
// playback simply advances one phase step per rAF frame. The
// modulation is per-direction and per-position-hash, so glints
// twinkle independently instead of the whole frame blinking, and
// at amount 0 the factor is exactly 1 (legacy output).
//
// Colour discipline: streaks and glints are extracted from the
// frame itself, so they inherit whatever colour the existing paths
// produced (monochrome stays monochrome; gradient / brand colour
// tints them consistently). Only the Lux source adds neutral white,
// which is what a visible light source is. Stateless and
// time-independent, so deterministic renders stay reproducible.

import { Pass } from 'postprocessing';
import * as THREE from 'three';

// Matches postprocessing's shared fullscreen vertex shader convention
// (see feedbackPass.ts): vUv is derived from clip-space position.
const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 1.0, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform sampler2D tDiffuse;
uniform float uAspect;
uniform vec2 uLightPos;
uniform float uShineEnabled;
uniform float uShineIntensity;
uniform float uShineLength;
uniform float uShineThreshold;
uniform float uStarEnabled;
uniform float uStarIntensity;
uniform float uStarLength;
uniform float uStarThreshold;
uniform float uStarDiagonal;
uniform float uStarShimmer;
uniform float uStarShimmerPhase;
uniform float uLuxEnabled;
uniform float uLuxIntensity;
uniform float uLuxSize;
uniform float uLuxConeLength;
uniform float uLuxConeAngle;
uniform float uLuxConeSpread;
varying vec2 vUv;

// Deterministic 2D hash for the shimmer phase field (position ->
// pseudo-random phase in [0,1)); pure function of the UV cell, so
// every frame and every machine agrees.
float shimmerHash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

vec3 highlightAt(vec2 uv, float threshold) {
  vec3 c = texture2D(tDiffuse, clamp(uv, 0.001, 0.999)).rgb;
  // Luminance-weighted extraction (the Bloom convention): the colour
  // vector is scaled, never channel-clipped, so hue is preserved
  // exactly — a per-channel subtraction would push near-threshold
  // colours toward their dominant channel (found in the Phase D
  // gate: a pale-blue star produced saturated blue streaks).
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float w = smoothstep(threshold, threshold + 0.25, l);
  return c * w;
}

void main() {
  vec3 base = texture2D(tDiffuse, vUv).rgb;
  vec2 posAc = vec2(vUv.x * uAspect, vUv.y);
  vec2 lightAc = vec2(uLightPos.x * uAspect, uLightPos.y);
  vec3 add = vec3(0.0);

  if (uShineEnabled > 0.5) {
    vec2 toPix = posAc - lightAc;
    float dist = length(toPix);
    vec2 dir = dist > 0.0001 ? toPix / dist : vec2(0.0, 1.0);
    float reach = uShineLength * uAspect;
    float maxS = dist + reach;
    vec3 acc = vec3(0.0);
    for (int i = 0; i < 16; i++) {
      float s = (float(i) / 15.0) * maxS;
      vec2 suv = (lightAc + dir * s) / vec2(uAspect, 1.0);
      float w = s <= dist ? 1.0 : exp(-(s - dist) / max(reach, 0.001));
      acc += highlightAt(suv, uShineThreshold) * w;
    }
    // Rays fade gently with distance from the source so a highlight
    // near the edge does not light the whole frame at full strength.
    add += (acc / 16.0) * exp(-dist * 0.30) * uShineIntensity * 2.4;
  }

  if (uStarEnabled > 0.5) {
    // Shimmer (Phase M): one twinkle factor per streak direction,
    // phase-shifted by a position hash of the glint centre so
    // neighbouring glints are out of phase. shimmerFactor is
    // exactly 1.0 when the amount is 0 (the sin term is multiplied
    // by the amount before the mix), keeping the legacy sum
    // bit-identical. The streak accumulation below is unchanged;
    // the factors are applied per direction group after the loop.
    float shimPh = shimmerHash(floor(vUv * vec2(48.0, 27.0))) * 6.2831853;
    float shimBase = uStarShimmerPhase + shimPh;
    float shimH = mix(1.0, 0.55 + 0.45 * sin(shimBase), uStarShimmer);
    float shimV = mix(1.0, 0.55 + 0.45 * sin(shimBase + 2.094), uStarShimmer);
    float shimD = mix(1.0, 0.55 + 0.45 * sin(shimBase + 4.189), uStarShimmer);
    float stepLen = uStarLength * 0.30 / 8.0;
    vec3 accH = vec3(0.0);
    vec3 accV = vec3(0.0);
    vec3 accD = vec3(0.0);
    float wSumH = 0.0;
    float wSumV = 0.0;
    float wSumD = 0.0;
    for (int k = -8; k <= 8; k++) {
      float fk = float(k);
      float w = exp(-abs(fk) * 0.45);
      vec2 offH = vec2(fk * stepLen / uAspect, 0.0);
      accH += highlightAt(vUv + offH, uStarThreshold) * w;
      wSumH += w;
      if (k != 0) {
        vec2 offV = vec2(0.0, fk * stepLen);
        accV += highlightAt(vUv + offV, uStarThreshold) * w;
        wSumV += w;
        if (uStarDiagonal > 0.5) {
          vec2 offD1 = vec2(fk * stepLen / uAspect, fk * stepLen);
          vec2 offD2 = vec2(fk * stepLen / uAspect, -fk * stepLen);
          accD += highlightAt(vUv + offD1, uStarThreshold) * w;
          accD += highlightAt(vUv + offD2, uStarThreshold) * w;
          wSumD += w * 2.0;
        }
      }
    }
    // The denominator stays the LEGACY weight sum (unmodulated):
    // modulating it too would cancel the twinkle whenever the
    // directional streak averages are similar. With shimmer amount
    // 0 every factor is 1.0 and this is the legacy
    // (accH + accV + accD) / (wSumH + wSumV + wSumD) exactly — the
    // centre tap (k = 0) belongs to the horizontal group, as it did
    // to the single legacy accumulator.
    vec3 acc = accH * shimH + accV * shimV + accD * shimD;
    float wSum = wSumH + wSumV + wSumD;
    add += (acc / max(wSum, 0.001)) * uStarIntensity;
  }

  if (uLuxEnabled > 0.5) {
    vec2 dv = posAc - lightAc;
    float d = length(dv);
    float sigma = max(uLuxSize * 0.30, 0.01);
    float glow = exp(-(d * d) / (2.0 * sigma * sigma));
    float coreSigma = sigma * 0.22;
    float core = exp(-(d * d) / (2.0 * coreSigma * coreSigma));
    add += vec3(1.0) * (glow * 0.55 + core * 0.85) * uLuxIntensity;
    if (uLuxConeLength > 0.001 && d > 0.0001) {
      float coneLen = uLuxConeLength * uAspect;
      float rad = radians(uLuxConeAngle);
      vec2 cdir = vec2(cos(rad), sin(rad));
      float axial = dot(dv, cdir);
      if (axial > 0.0) {
        float cosAng = clamp(dot(dv / d, cdir), -1.0, 1.0);
        float ang = degrees(acos(cosAng));
        float aFade = smoothstep(uLuxConeSpread, uLuxConeSpread * 0.35, ang);
        float dFade = exp(-axial / coneLen * 1.8) * smoothstep(coneLen * 1.15, coneLen * 0.5, d);
        add += vec3(1.0) * aFade * dFade * uLuxIntensity * 0.7;
      }
    }
  }

  gl_FragColor = vec4(base + add, 1.0);
}
`;

export class LightFxPass extends Pass {
  lightPos = new THREE.Vector2(0.5, 0.5);

  shineEnabled = false;

  shineIntensity = 1.0;

  shineLength = 0.5;

  shineThreshold = 0.6;

  starglowEnabled = false;

  starglowIntensity = 1.0;

  starglowLength = 0.35;

  starglowThreshold = 0.6;

  starglowDiagonal = false;

  starglowShimmer = 0;

  starglowShimmerSpeed = 1;

  // Deterministic time base (Phase M): frames rendered by this
  // pass instance. Incremented once per render() call.
  private frameCount = 0;

  luxEnabled = false;

  luxIntensity = 1.0;

  luxSize = 0.35;

  luxConeLength = 0;

  luxConeAngle = 270;

  luxConeSpread = 32;

  private material: THREE.ShaderMaterial;

  constructor() {
    super('LightFxPass');
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        tDiffuse: { value: null },
        uAspect: { value: 1 },
        uLightPos: { value: new THREE.Vector2(0.5, 0.5) },
        uShineEnabled: { value: 0 },
        uShineIntensity: { value: 1 },
        uShineLength: { value: 0.5 },
        uShineThreshold: { value: 0.6 },
        uStarEnabled: { value: 0 },
        uStarIntensity: { value: 1 },
        uStarLength: { value: 0.35 },
        uStarThreshold: { value: 0.6 },
        uStarDiagonal: { value: 0 },
        uStarShimmer: { value: 0 },
        uStarShimmerPhase: { value: 0 },
        uLuxEnabled: { value: 0 },
        uLuxIntensity: { value: 1 },
        uLuxSize: { value: 0.35 },
        uLuxConeLength: { value: 0 },
        uLuxConeAngle: { value: 270 },
        uLuxConeSpread: { value: 32 },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.fullscreenMaterial = this.material;
    this.needsSwap = true;
  }

  override render(
    renderer: THREE.WebGLRenderer,
    inputBuffer: THREE.WebGLRenderTarget,
    outputBuffer: THREE.WebGLRenderTarget,
  ): void {
    const u = this.material.uniforms;
    u.tDiffuse.value = inputBuffer.texture;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    u.uAspect.value = size.y > 0 ? size.x / size.y : 1;
    (u.uLightPos.value as THREE.Vector2).copy(this.lightPos);
    u.uShineEnabled.value = this.shineEnabled ? 1 : 0;
    u.uShineIntensity.value = this.shineIntensity;
    u.uShineLength.value = this.shineLength;
    u.uShineThreshold.value = this.shineThreshold;
    u.uStarEnabled.value = this.starglowEnabled ? 1 : 0;
    u.uStarIntensity.value = this.starglowIntensity;
    u.uStarLength.value = this.starglowLength;
    u.uStarThreshold.value = this.starglowThreshold;
    u.uStarDiagonal.value = this.starglowDiagonal ? 1 : 0;
    u.uStarShimmer.value = this.starglowShimmer;
    // Phase advances by speed * (2pi / 48) per rendered frame: a
    // full twinkle cycle every 48 frames at speed 1 (0.8 s at the
    // deterministic renderer's 60 fps), purely a function of the
    // frame count.
    u.uStarShimmerPhase.value = this.frameCount * this.starglowShimmerSpeed * 0.1308997;
    this.frameCount += 1;    u.uLuxEnabled.value = this.luxEnabled ? 1 : 0;
    u.uLuxIntensity.value = this.luxIntensity;
    u.uLuxSize.value = this.luxSize;
    u.uLuxConeLength.value = this.luxConeLength;
    u.uLuxConeAngle.value = this.luxConeAngle;
    u.uLuxConeSpread.value = this.luxConeSpread;
    renderer.setRenderTarget(this.renderToScreen ? null : outputBuffer);
    renderer.render(this.scene, this.camera);
  }

  override dispose(): void {
    this.material.dispose();
    super.dispose();
  }
}
