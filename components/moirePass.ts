// Moire pass (Phase AW): multiplies the frame by the moire
// interference field of two regular patterns (grid / rings /
// lines) — the second rotated by Angle and shifted by Phase —
// mixed by Mix. A pure function of pixel position (stateless),
// following the same Pass shape as fractalPass.ts. The shader
// math mirrors lib/moirePattern.ts expression-for-expression.
// Mix 0 keeps the input frame bit-identical, and the stage only
// exists in the stack while postMoireEnabled is on. Monochrome
// by construction: the field only scales the frame's own values.

import { Pass } from 'postprocessing';
import * as THREE from 'three';

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 1.0, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform sampler2D tDiffuse;
uniform float uPattern;
uniform float uSpacing;
uniform float uAngle;
uniform float uPhase;
uniform float uMix;
uniform vec2 uResolution;
varying vec2 vUv;

float wave(float v, float phase) {
  return 0.5 + 0.5 * cos(6.283185307179586 / uSpacing * v + phase);
}

float patternValue(vec2 p, float phase, vec2 center) {
  if (uPattern > 1.5) {
    // lines
    return wave(p.x, phase);
  }
  if (uPattern > 0.5) {
    // rings
    return wave(length(p - center), phase);
  }
  // grid
  return wave(p.x, phase) * wave(p.y, 0.0);
}

void main() {
  vec4 src = texture2D(tDiffuse, vUv);
  vec2 p = gl_FragCoord.xy;
  vec2 center = uResolution * 0.5;
  float a = patternValue(p, 0.0, center);
  float rad = uAngle * 3.141592653589793 / 180.0;
  float ca = cos(rad);
  float sa = sin(rad);
  vec2 d = p - center;
  vec2 rp = center + vec2(d.x * ca - d.y * sa, d.x * sa + d.y * ca);
  float b = patternValue(rp, uPhase, center);
  float f = a * b;
  vec3 outColor = src.rgb * (1.0 - uMix + uMix * f);
  gl_FragColor = vec4(outColor, src.a);
}
`;

const PATTERN_IDS: Record<string, number> = { grid: 0, rings: 1, lines: 2 };

export class MoirePass extends Pass {
  pattern: 'grid' | 'rings' | 'lines' = 'grid';
  spacing = 6;
  angle = 4;
  phase = 0;
  mixAmount = 0.35;

  private readonly material: THREE.ShaderMaterial;
  private width = 1;
  private height = 1;

  constructor() {
    super('MoirePass');
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        tDiffuse: { value: null },
        uPattern: { value: 0 },
        uSpacing: { value: 6 },
        uAngle: { value: 4 },
        uPhase: { value: 0 },
        uMix: { value: 0.35 },
        uResolution: { value: new THREE.Vector2(1, 1) },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.fullscreenMaterial = this.material;
    this.needsSwap = true;
  }

  override setSize(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
  }

  override render(
    renderer: THREE.WebGLRenderer,
    inputBuffer: THREE.WebGLRenderTarget,
    outputBuffer: THREE.WebGLRenderTarget,
  ): void {
    const tex = inputBuffer.texture as THREE.Texture & { image?: { width?: number; height?: number } };
    if (tex.image?.width) this.width = tex.image.width;
    if (tex.image?.height) this.height = tex.image.height;
    const u = this.material.uniforms;
    u.tDiffuse.value = inputBuffer.texture;
    u.uPattern.value = PATTERN_IDS[this.pattern] ?? 0;
    u.uSpacing.value = Math.min(64, Math.max(2, this.spacing));
    u.uAngle.value = this.angle;
    u.uPhase.value = this.phase;
    u.uMix.value = Math.min(1, Math.max(0, this.mixAmount));
    (u.uResolution.value as THREE.Vector2).set(this.width, this.height);
    renderer.setRenderTarget(this.renderToScreen ? null : outputBuffer);
    renderer.render(this.scene, this.camera);
  }

  override dispose(): void {
    this.material.dispose();
    super.dispose();
  }
}
