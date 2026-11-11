import * as THREE from 'three';
import type { FiberProfile } from './sceneFiberFieldSystemTypes';

export const FIBER_VERTEX_SHADER = `
  attribute float fiberMix;
  varying float vFiberMix;
  varying vec3 vWorldPos;
  void main() {
    vFiberMix = fiberMix;
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPos.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

export const FIBER_FRAGMENT_SHADER = `
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uPulse;
  uniform float uMaterialStyle;
  uniform float uGlow;
  uniform float uBandFrequency;
  uniform float uBandMix;
  uniform float uPrismAmount;
  uniform float uGateAmount;
  uniform float uShimmerScale;
  uniform float uPulseMix;
  uniform float uAlphaMul;
  uniform float uCharAmount;
  varying float vFiberMix;
  varying vec3 vWorldPos;
  void main() {
    float tip = smoothstep(0.0, 1.0, vFiberMix);
    vec3 color = uColor;
    float alpha = uOpacity * mix(1.0, 0.08, tip) * uAlphaMul;
    float shimmer = 0.5 + 0.5 * sin(vWorldPos.y * (0.06 * uShimmerScale + 0.02) + vWorldPos.x * 0.03 + uPulse * uPulseMix * 10.0);
    float band = 0.5 + 0.5 * sin(vWorldPos.y * (0.08 + uBandFrequency * 0.04) - vWorldPos.x * (0.03 + uBandFrequency * 0.02) + vWorldPos.z * 0.02 + uPulse * 6.0);
    float gate = 0.5 + 0.5 * sin(vWorldPos.x * (0.06 + uBandFrequency * 0.03) + vWorldPos.z * 0.05 + uPulse * 8.0);
    alpha *= mix(1.0, smoothstep(0.2, 0.85, gate), clamp(uGateAmount, 0.0, 1.0));
    color *= 0.58 + shimmer * (0.28 + uGlow * 0.14);
    color = mix(color, color * (0.78 + band * (0.42 + uGlow * 0.12)), clamp(uBandMix, 0.0, 1.0));
    if (uPrismAmount > 0.001) {
      vec3 prismColor = vec3(
        color.r * (1.0 + 0.25 * band),
        color.g * (0.84 + 0.24 * shimmer),
        color.b * (1.06 + 0.2 * (1.0 - band))
      );
      color = mix(color, prismColor, clamp(uPrismAmount * 0.75, 0.0, 1.0));
    }
    if (uCharAmount > 0.001) {
      float ember = smoothstep(0.58, 1.0, band) * (0.45 + shimmer * 0.55);
      color = mix(color, vec3(0.1, 0.08, 0.06), clamp(uCharAmount * 0.42, 0.0, 1.0));
      color += vec3(0.65, 0.24, 0.06) * ember * uCharAmount * 0.42;
    }
    if (uMaterialStyle > 0.5 && uMaterialStyle < 1.5) {
      color = mix(color, vec3(0.92, 0.97, 1.0), 0.22);
      alpha *= 0.8;
    } else if (uMaterialStyle > 1.5 && uMaterialStyle < 2.5) {
      color = mix(color, vec3(0.18, 0.94, 1.0), 0.5);
      alpha *= 1.08;
    } else if (uMaterialStyle > 2.5 && uMaterialStyle < 3.5) {
      float chromeBand = 0.5 + 0.5 * sin(vWorldPos.y * 0.12 - vWorldPos.x * 0.06 + uBandFrequency * 0.2);
      color = mix(vec3(0.2), vec3(1.0), chromeBand) * mix(uColor, vec3(1.0), 0.45);
    } else if (uMaterialStyle > 3.5) {
      float halftoneGate = step(0.25, fract(vWorldPos.y * 0.06 + vWorldPos.x * 0.03));
      alpha *= mix(0.38, 1.0, halftoneGate);
      color *= 0.5 + halftoneGate * 0.5;
    }
    gl_FragColor = vec4(color, alpha);
  }
`;

export function createFiberUniforms(profile: FiberProfile) {
  return {
    uColor: { value: new THREE.Color('#ffffff') },
    uOpacity: { value: 0.35 },
    uPulse: { value: 0 },
    uMaterialStyle: { value: 0 },
    uGlow: { value: profile.glow },
    uBandFrequency: { value: profile.bandFrequency },
    uBandMix: { value: profile.bandMix },
    uPrismAmount: { value: profile.prismAmount },
    uGateAmount: { value: profile.gateAmount },
    uShimmerScale: { value: profile.shimmerScale },
    uPulseMix: { value: profile.pulseMix },
    uAlphaMul: { value: profile.alphaMul },
    uCharAmount: { value: profile.charAmount },
  };
}
