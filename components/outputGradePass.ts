// Output grade pass (Kinetix integration B2): final-stage exposure
// multiplier plus an optional ACES filmic tone curve, mirroring the
// Kinetix output stage (ACESFilmicToneMapping + exposure on the
// renderer). Implemented as a shader pass instead of touching the
// renderer so the stage only exists when the user opts in — with the
// defaults (exposure 1.0, 'legacy') the stage is inactive and the
// composer output is unchanged. The ACES curve is the standard
// Narkowicz fit, re-implemented here.

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
uniform float uExposure;
uniform float uAces;
varying vec2 vUv;

vec3 acesFilmic(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

void main() {
  vec3 color = texture2D(tDiffuse, vUv).rgb * uExposure;
  if (uAces > 0.5) {
    color = acesFilmic(color);
  }
  gl_FragColor = vec4(color, 1.0);
}
`;

export class OutputGradePass extends Pass {
  exposure = 1.0;

  aces = false;

  private material: THREE.ShaderMaterial;

  constructor() {
    super('OutputGradePass');
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        tDiffuse: { value: null },
        uExposure: { value: this.exposure },
        uAces: { value: 0 },
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
    this.material.uniforms.uExposure.value = this.exposure;
    this.material.uniforms.uAces.value = this.aces ? 1 : 0;
    renderer.setRenderTarget(this.renderToScreen ? null : outputBuffer);
    renderer.render(this.scene, this.camera);
  }

  override dispose(): void {
    this.material.dispose();
    super.dispose();
  }
}
