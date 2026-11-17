// Pixel sort pass (Phase AM): within the luminance span
// [low, high] of the input frame, pixels along each row (or
// column) are rearranged toward ascending luminance order by
// odd-even transposition compare-exchange passes iterated in
// an internal ping-pong — the classic pixel-sort streaks.
// Pixels outside the span never move and act as barriers. The
// sort is a pure function of the input frame (state lives
// only inside one render call), so deterministic renders
// reproduce it exactly. The stage only exists while
// postPixelSortEnabled is on. The compare-exchange grammar is
// the GLSL twin of lib/pixelSort.ts.

import { Pass } from 'postprocessing';
import * as THREE from 'three';

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 1.0, 1.0);
}
`;

const STEP_FRAG = /* glsl */ `
uniform sampler2D tDiffuse;
uniform vec2 uTexel;
uniform float uParity;
uniform float uLow;
uniform float uHigh;
uniform float uVertical;
varying vec2 vUv;

float luma(vec3 c) {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

bool inSpan(float l) {
  return l >= uLow && l <= uHigh;
}

void main() {
  vec2 stepUv = uVertical > 0.5 ? vec2(0.0, uTexel.y) : vec2(uTexel.x, 0.0);
  float size = uVertical > 0.5 ? (uTexel.y > 0.0 ? 1.0 / uTexel.y : 1.0) : (uTexel.x > 0.0 ? 1.0 / uTexel.x : 1.0);
  float coord = uVertical > 0.5 ? vUv.y : vUv.x;
  float idx = floor(coord * size + 0.0001);
  vec3 selfC = texture2D(tDiffuse, vUv).rgb;
  float selfL = luma(selfC);
  bool pairStart = mod(idx + uParity, 2.0) < 0.5;
  vec3 outC = selfC;
  if (pairStart) {
    if (idx + 1.0 < size) {
      vec3 nextC = texture2D(tDiffuse, vUv + stepUv).rgb;
      float nextL = luma(nextC);
      if (inSpan(selfL) && inSpan(nextL) && selfL > nextL) outC = nextC;
    }
  } else {
    vec3 prevC = texture2D(tDiffuse, vUv - stepUv).rgb;
    float prevL = luma(prevC);
    if (inSpan(prevL) && inSpan(selfL) && prevL > selfL) outC = prevC;
  }
  gl_FragColor = vec4(outC, 1.0);
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
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    depthBuffer: false,
    stencilBuffer: false,
  });
}

export class PixelSortPass extends Pass {
  direction: 'horizontal' | 'vertical' = 'horizontal';

  low = 0.25;

  high = 0.85;

  passes = 24;

  private readTarget: THREE.WebGLRenderTarget;

  private writeTarget: THREE.WebGLRenderTarget;

  private stepMaterial: THREE.ShaderMaterial;

  private copyMaterial: THREE.ShaderMaterial;

  constructor() {
    super('PixelSortPass');
    this.readTarget = makeTarget(1, 1);
    this.writeTarget = makeTarget(1, 1);
    this.stepMaterial = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: STEP_FRAG,
      uniforms: {
        tDiffuse: { value: null },
        uTexel: { value: new THREE.Vector2(1, 1) },
        uParity: { value: 0 },
        uLow: { value: this.low },
        uHigh: { value: this.high },
        uVertical: { value: 0 },
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
    // 1. Copy the input frame into the read target.
    this.copyMaterial.uniforms.tDiffuse.value = inputBuffer.texture;
    this.fullscreenMaterial = this.copyMaterial;
    renderer.setRenderTarget(this.readTarget);
    renderer.render(this.scene, this.camera);

    // 2. Odd-even compare-exchange passes, ping-ponging.
    const stepUniforms = this.stepMaterial.uniforms;
    stepUniforms.uLow.value = this.low;
    stepUniforms.uHigh.value = this.high;
    stepUniforms.uVertical.value = this.direction === 'vertical' ? 1 : 0;
    this.fullscreenMaterial = this.stepMaterial;
    const count = Math.max(1, Math.min(64, Math.round(this.passes)));
    for (let k = 0; k < count; k++) {
      stepUniforms.tDiffuse.value = this.readTarget.texture;
      stepUniforms.uParity.value = k % 2;
      renderer.setRenderTarget(this.writeTarget);
      renderer.render(this.scene, this.camera);
      const swap = this.readTarget;
      this.readTarget = this.writeTarget;
      this.writeTarget = swap;
    }

    // 3. Present the sorted frame.
    this.copyMaterial.uniforms.tDiffuse.value = this.readTarget.texture;
    this.fullscreenMaterial = this.copyMaterial;
    renderer.setRenderTarget(this.renderToScreen ? null : outputBuffer);
    renderer.render(this.scene, this.camera);
  }

  override setSize(width: number, height: number): void {
    this.readTarget.setSize(width, height);
    this.writeTarget.setSize(width, height);
    (this.stepMaterial.uniforms.uTexel.value as THREE.Vector2).set(
      width > 0 ? 1 / width : 1,
      height > 0 ? 1 / height : 1,
    );
  }

  override dispose(): void {
    this.readTarget.dispose();
    this.writeTarget.dispose();
    this.stepMaterial.dispose();
    this.copyMaterial.dispose();
    super.dispose();
  }
}
