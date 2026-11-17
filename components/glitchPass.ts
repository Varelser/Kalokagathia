// Glitch pass (Phase AM): horizontal bands of the frame
// displaced sideways by a deterministic hash of (band, time
// quantum), plus a fine per-row jitter — the block-displacement
// / scanline-slice grammar (the data-mosh part of the audit
// row, frame-to-frame motion transfer, is out of scope). The
// time quantum comes from the pass's own frame counter, so a
// deterministic render reproduces the pattern frame for frame.
// Amount 0 makes every shift exactly 0 (the sampled UV is the
// identity), and the stage only exists while
// postGlitchEnabled is on. The hash grammar is the GLSL twin
// of lib/glitchField.ts.

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
uniform float uAmount;
uniform float uBands;
uniform float uQuantum;
uniform float uHeight;
varying vec2 vUv;

float hash1(float x) {
  return fract(sin(x) * 43758.5453);
}

void main() {
  float band = floor(vUv.y * uBands);
  float h = hash1(band * 12.9898 + uQuantum * 78.233);
  float gate = hash1(band * 39.425 + uQuantum * 11.135 + 7.77);
  float shift = gate > 0.55 ? (h * 2.0 - 1.0) * uAmount : 0.0;
  float row = floor(vUv.y * uHeight);
  shift += (hash1(row * 3.717 + uQuantum * 51.31) * 2.0 - 1.0) * uAmount * 0.12;
  vec2 uv = vec2(fract(vUv.x + shift), vUv.y);
  gl_FragColor = vec4(texture2D(tDiffuse, uv).rgb, 1.0);
}
`;

export class GlitchPass extends Pass {
  amount = 0.08;

  bands = 24;

  /** Steps per second; the quantum advances at this rate. */
  rate = 8;

  private frameCount = 0;

  private material: THREE.ShaderMaterial;

  constructor() {
    super('GlitchPass');
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        tDiffuse: { value: null },
        uAmount: { value: this.amount },
        uBands: { value: this.bands },
        uQuantum: { value: 0 },
        uHeight: { value: 1 },
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
    this.frameCount += 1;
    // The deterministic renderer assumes ~60 fps; the quantum
    // is a pure function of the pass's own frame count.
    const quantum = Math.floor((this.frameCount * this.rate) / 60);
    this.material.uniforms.tDiffuse.value = inputBuffer.texture;
    this.material.uniforms.uAmount.value = this.amount;
    this.material.uniforms.uBands.value = this.bands;
    this.material.uniforms.uQuantum.value = quantum;
    renderer.setRenderTarget(this.renderToScreen ? null : outputBuffer);
    renderer.render(this.scene, this.camera);
  }

  override setSize(_width: number, height: number): void {
    this.material.uniforms.uHeight.value = Math.max(1, height);
  }

  override dispose(): void {
    this.material.dispose();
    super.dispose();
  }
}
