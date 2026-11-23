// Chroma key pass (Phase 15, TD §6): the final delivery stage.
// Computes an alpha matte from the finished frame's colour
// distance to a key colour and suppresses key spill, so the
// frame can be exported with transparency (deterministic PNG
// sequences / transparent captures) or composited downstream.
// It sits after every other stage including 'edge-capture'
// (which must keep reading the finished, un-keyed frame), and
// it exists only while enabled — disabled means the stage is
// absent and the composer output is bit-identical.

import { Pass } from 'postprocessing';
import * as THREE from 'three';

// Matches postprocessing's shared fullscreen vertex shader
// convention (see outputGradePass.ts).
const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 1.0, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform sampler2D tDiffuse;
uniform vec3 uKeyColor;
uniform float uSimilarity;
uniform float uSmoothness;
uniform float uSpill;
varying vec2 vUv;

void main() {
  vec3 color = texture2D(tDiffuse, vUv).rgb;
  float dist = distance(color, uKeyColor);
  float alpha = smoothstep(uSimilarity, uSimilarity + max(uSmoothness, 0.0001), dist);
  // Spill suppression: remove the colour's excess along the key
  // hue direction relative to its own grey level, weighted by
  // how key-like the pixel is (fully kept pixels are untouched,
  // fully keyed ones are invisible anyway — the fringe between
  // them is what this cleans).
  vec3 kd = normalize(uKeyColor + vec3(0.00001));
  float grey = dot(color, vec3(0.3333333));
  float excess = max(dot(color, kd) - grey * dot(vec3(1.0), kd), 0.0);
  color -= kd * excess * uSpill * (1.0 - alpha);
  gl_FragColor = vec4(color, alpha);
}
`;

export class ChromaKeyPass extends Pass {
  keyColor = new THREE.Color('#00ff00');

  similarity = 0.08;

  smoothness = 0.04;

  spill = 0.5;

  private material: THREE.ShaderMaterial;

  constructor() {
    super('ChromaKeyPass');
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        tDiffuse: { value: null },
        uKeyColor: { value: new THREE.Color('#00ff00') },
        uSimilarity: { value: this.similarity },
        uSmoothness: { value: this.smoothness },
        uSpill: { value: this.spill },
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
    (this.material.uniforms.uKeyColor.value as THREE.Color).copy(this.keyColor);
    this.material.uniforms.uSimilarity.value = this.similarity;
    this.material.uniforms.uSmoothness.value = this.smoothness;
    this.material.uniforms.uSpill.value = this.spill;
    renderer.setRenderTarget(this.renderToScreen ? null : outputBuffer);
    renderer.render(this.scene, this.camera);
  }

  override dispose(): void {
    this.material.dispose();
    super.dispose();
  }
}
