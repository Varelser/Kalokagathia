// Kaleidoscope / mirror pass: folds the frame around the center in polar
// space — the angle is wrapped into one wedge of `segments` slices and
// mirrored inside the wedge, so the scene repeats radially with mirror
// symmetry. Stateless (no history buffer): a pure spatial fold of the
// current frame. Aspect-corrected so the fold stays circular.

import { Pass } from 'postprocessing';
import * as THREE from 'three';

// Matches postprocessing's shared fullscreen vertex shader convention (see
// feedbackPass.ts): vUv is derived from clip-space position.
const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 1.0, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform sampler2D tDiffuse;
uniform float uSegments;
uniform float uRotation;
uniform float uAspect;
varying vec2 vUv;

void main() {
  vec2 uv = vUv - 0.5;
  uv.x *= uAspect;
  float radius = length(uv);
  float angle = atan(uv.y, uv.x) + uRotation;
  float wedge = 6.28318530718 / max(uSegments, 1.0);
  angle = mod(angle, wedge);
  angle = abs(angle - wedge * 0.5);
  vec2 folded = vec2(cos(angle), sin(angle)) * radius;
  folded.x /= uAspect;
  vec2 sampleUv = folded + 0.5;
  vec3 color = texture2D(tDiffuse, clamp(sampleUv, 0.0, 1.0)).rgb;
  gl_FragColor = vec4(color, 1.0);
}
`;

export class KaleidoscopePass extends Pass {
  segments = 6;

  rotation = 0;

  private material: THREE.ShaderMaterial;

  constructor() {
    super('KaleidoscopePass');
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        tDiffuse: { value: null },
        uSegments: { value: this.segments },
        uRotation: { value: this.rotation },
        uAspect: { value: 1 },
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
    this.material.uniforms.uSegments.value = this.segments;
    this.material.uniforms.uRotation.value = this.rotation;
    renderer.setRenderTarget(this.renderToScreen ? null : outputBuffer);
    renderer.render(this.scene, this.camera);
  }

  override setSize(width: number, height: number): void {
    (this.material.uniforms.uAspect.value as number) = height > 0 ? width / height : 1;
  }

  override dispose(): void {
    this.material.dispose();
    super.dispose();
  }
}
