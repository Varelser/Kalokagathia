// Radial Blur pass (Kinetix integration B2): CinemaLens-style radial
// zoom blur as a standalone post stage. Mirrors the Kinetix lens
// shader's radial term — samples are taken backwards along the unit
// radial direction from the frame centre in fixed steps of
// strength * 0.032 UV and averaged — re-implemented as a
// postprocessing Pass in the same shape as kaleidoscopePass.ts.
// Stateless: a pure spatial resample of the current frame.

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
uniform float uStrength;
varying vec2 vUv;

void main() {
  vec2 toCenter = vUv - 0.5;
  float dist = length(toCenter);
  vec2 dir = dist > 0.0001 ? toCenter / dist : vec2(0.0);
  vec2 stepUv = dir * (uStrength * 0.032);
  vec3 acc = texture2D(tDiffuse, vUv).rgb;
  for (int s = 1; s <= 5; s++) {
    acc += texture2D(tDiffuse, clamp(vUv - stepUv * float(s), 0.001, 0.999)).rgb;
  }
  gl_FragColor = vec4(acc / 6.0, 1.0);
}
`;

export class RadialBlurPass extends Pass {
  strength = 0.25;

  private material: THREE.ShaderMaterial;

  constructor() {
    super('RadialBlurPass');
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        tDiffuse: { value: null },
        uStrength: { value: this.strength },
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
    this.material.uniforms.tDiffuse.value = inputBuffer.texture;
    this.material.uniforms.uStrength.value = this.strength;
    renderer.setRenderTarget(this.renderToScreen ? null : outputBuffer);
    renderer.render(this.scene, this.camera);
  }

  override dispose(): void {
    this.material.dispose();
    super.dispose();
  }
}
