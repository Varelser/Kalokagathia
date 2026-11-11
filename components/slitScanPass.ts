// Slit-scan pass: the frame is divided into horizontal bands, and each
// band only refreshes on its own slot of a repeating frame cycle — band b
// shows the frame from the moment its slot last came around, so moving
// structures shear across time slices of the recent past. The history
// lives in a ping-pong pair of targets exactly like the feedback pass;
// during the first cycle every band refreshes (warmup) so no band starts
// black.

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

const COMPOSITE_FRAG = /* glsl */ `
uniform sampler2D tDiffuse;
uniform sampler2D tHistory;
uniform float uFrame;
uniform float uBands;
uniform float uCycle;
varying vec2 vUv;

void main() {
  vec3 current = texture2D(tDiffuse, vUv).rgb;
  float refresh = 1.0;
  if (uFrame >= uCycle) {
    float band = floor(vUv.y * uBands);
    float slot = mod(uFrame, uCycle);
    float bandSlot = mod(band, uCycle);
    refresh = 1.0 - step(0.5, abs(bandSlot - slot));
  }
  vec3 history = texture2D(tHistory, vUv).rgb;
  gl_FragColor = vec4(mix(history, current, refresh), 1.0);
}
`;

const COPY_FRAG = /* glsl */ `
uniform sampler2D tDiffuse;
varying vec2 vUv;
void main() {
  gl_FragColor = vec4(texture2D(tDiffuse, vUv).rgb, 1.0);
}
`;

function makeTarget(width: number, height: number) {
  return new THREE.WebGLRenderTarget(width, height, {
    type: THREE.HalfFloatType,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: false,
    stencilBuffer: false,
  });
}

export class SlitScanPass extends Pass {
  bands = 24;

  cycle = 24;

  private frame = 0;

  private readTarget: THREE.WebGLRenderTarget;

  private writeTarget: THREE.WebGLRenderTarget;

  private compositeMaterial: THREE.ShaderMaterial;

  private copyMaterial: THREE.ShaderMaterial;

  constructor() {
    super('SlitScanPass');
    this.readTarget = makeTarget(1, 1);
    this.writeTarget = makeTarget(1, 1);
    this.compositeMaterial = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: COMPOSITE_FRAG,
      uniforms: {
        tDiffuse: { value: null },
        tHistory: { value: null },
        uFrame: { value: 0 },
        uBands: { value: this.bands },
        uCycle: { value: this.cycle },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.copyMaterial = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: COPY_FRAG,
      uniforms: { tDiffuse: { value: null } },
      depthTest: false,
      depthWrite: false,
    });
    this.needsSwap = true;
  }

  override render(
    renderer: THREE.WebGLRenderer,
    inputBuffer: THREE.WebGLRenderTarget,
    outputBuffer: THREE.WebGLRenderTarget,
  ): void {
    const uniforms = this.compositeMaterial.uniforms;
    uniforms.tDiffuse.value = inputBuffer.texture;
    uniforms.tHistory.value = this.readTarget.texture;
    uniforms.uFrame.value = this.frame;
    uniforms.uBands.value = Math.max(1, Math.round(this.bands));
    uniforms.uCycle.value = Math.max(2, Math.round(this.cycle));
    this.fullscreenMaterial = this.compositeMaterial;
    renderer.setRenderTarget(this.writeTarget);
    renderer.render(this.scene, this.camera);

    this.copyMaterial.uniforms.tDiffuse.value = this.writeTarget.texture;
    this.fullscreenMaterial = this.copyMaterial;
    renderer.setRenderTarget(this.renderToScreen ? null : outputBuffer);
    renderer.render(this.scene, this.camera);

    const swap = this.readTarget;
    this.readTarget = this.writeTarget;
    this.writeTarget = swap;
    this.frame += 1;
  }

  override setSize(width: number, height: number): void {
    this.readTarget.setSize(width, height);
    this.writeTarget.setSize(width, height);
  }

  override dispose(): void {
    this.readTarget.dispose();
    this.writeTarget.dispose();
    this.compositeMaterial.dispose();
    this.copyMaterial.dispose();
    super.dispose();
  }
}
