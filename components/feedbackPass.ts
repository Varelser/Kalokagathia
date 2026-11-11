// GPU feedback pass: the composited frame is written into a persistent
// render target and fed back into the next frame — sampled with a small
// zoom/rotation transform, softened by a 4-tap blur and decayed — so bright
// structures leave trails that swirl, grow or shrink and slowly fade. This
// is true screen-space feedback (the previous frame really is re-read),
// unlike the synthetic screen-persistence overlay. Two targets ping-pong so
// the shader never samples the texture it is rendering into.

import { Pass } from 'postprocessing';
import * as THREE from 'three';

// Matches postprocessing's shared fullscreen vertex shader: the Pass base
// class renders its own fullscreen-triangle scene, whose positions span
// clip space, so vUv is derived from position rather than a uv attribute.
const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 1.0, 1.0);
}
`;

const COMPOSITE_FRAG = /* glsl */ `
uniform sampler2D tDiffuse;
uniform sampler2D tFeedback;
uniform float uDecay;
uniform float uZoom;
uniform float uRotation;
uniform vec2 uTexel;
varying vec2 vUv;

vec3 samplePrev(vec2 uv) {
  vec3 c = texture2D(tFeedback, uv).rgb * 0.4;
  c += texture2D(tFeedback, uv + vec2(uTexel.x, 0.0)).rgb * 0.15;
  c += texture2D(tFeedback, uv - vec2(uTexel.x, 0.0)).rgb * 0.15;
  c += texture2D(tFeedback, uv + vec2(0.0, uTexel.y)).rgb * 0.15;
  c += texture2D(tFeedback, uv - vec2(0.0, uTexel.y)).rgb * 0.15;
  return c;
}

void main() {
  vec2 centered = vUv - 0.5;
  float cs = cos(uRotation);
  float sn = sin(uRotation);
  vec2 rotated = mat2(cs, -sn, sn, cs) * centered;
  vec2 prevUv = rotated / max(uZoom, 0.0001) + 0.5;
  vec3 prev = vec3(0.0);
  if (prevUv.x >= 0.0 && prevUv.x <= 1.0 && prevUv.y >= 0.0 && prevUv.y <= 1.0) {
    prev = samplePrev(prevUv) * uDecay;
  }
  vec3 current = texture2D(tDiffuse, vUv).rgb;
  gl_FragColor = vec4(max(current, prev), 1.0);
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

export class FeedbackPass extends Pass {
  decay = 0.85;

  zoom = 1;

  rotation = 0;

  private readTarget: THREE.WebGLRenderTarget;

  private writeTarget: THREE.WebGLRenderTarget;

  private compositeMaterial: THREE.ShaderMaterial;

  private copyMaterial: THREE.ShaderMaterial;

  constructor() {
    super('FeedbackPass');
    this.readTarget = makeTarget(1, 1);
    this.writeTarget = makeTarget(1, 1);
    this.compositeMaterial = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: COMPOSITE_FRAG,
      uniforms: {
        tDiffuse: { value: null },
        tFeedback: { value: null },
        uDecay: { value: this.decay },
        uZoom: { value: this.zoom },
        uRotation: { value: this.rotation },
        uTexel: { value: new THREE.Vector2(1, 1) },
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
    // 1. Composite the current frame with the decayed previous composite
    //    into the write target.
    const compositeUniforms = this.compositeMaterial.uniforms;
    compositeUniforms.tDiffuse.value = inputBuffer.texture;
    compositeUniforms.tFeedback.value = this.readTarget.texture;
    compositeUniforms.uDecay.value = this.decay;
    compositeUniforms.uZoom.value = this.zoom;
    compositeUniforms.uRotation.value = this.rotation;
    this.fullscreenMaterial = this.compositeMaterial;
    renderer.setRenderTarget(this.writeTarget);
    renderer.render(this.scene, this.camera);

    // 2. Present the composite: copy the write target into the output
    //    buffer (or the screen when this is the final pass).
    this.copyMaterial.uniforms.tDiffuse.value = this.writeTarget.texture;
    this.fullscreenMaterial = this.copyMaterial;
    renderer.setRenderTarget(this.renderToScreen ? null : outputBuffer);
    renderer.render(this.scene, this.camera);

    // 3. The composite becomes next frame's feedback source.
    const swap = this.readTarget;
    this.readTarget = this.writeTarget;
    this.writeTarget = swap;
  }

  override setSize(width: number, height: number): void {
    this.readTarget.setSize(width, height);
    this.writeTarget.setSize(width, height);
    (this.compositeMaterial.uniforms.uTexel.value as THREE.Vector2).set(
      width > 0 ? 1 / width : 1,
      height > 0 ? 1 / height : 1,
    );
  }

  override dispose(): void {
    this.readTarget.dispose();
    this.writeTarget.dispose();
    this.compositeMaterial.dispose();
    this.copyMaterial.dispose();
    super.dispose();
  }
}
