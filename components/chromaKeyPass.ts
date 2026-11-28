// Chroma key pass (Phase 15, TD §6): the final delivery stage.
// Computes an alpha matte from the finished frame's colour
// distance to a key colour and suppresses key spill, so the
// frame can be exported with transparency (deterministic PNG
// sequences / transparent captures) or composited downstream.
// It sits after every other stage including 'edge-capture'
// (which must keep reading the finished, un-keyed frame), and
// it exists only while enabled — disabled means the stage is
// absent and the composer output is bit-identical.
//
// The matte itself is the Core / Edge separation in
// lib/chromaKeyMath.ts (which also holds the CPU twin): the
// legacy single smoothstep keyed the particles' fringe away
// with the background (Layer 1 confirmation gate item 12), so
// the fragment now takes max(core, edge) — the edge matte is
// the legacy loose clip kept verbatim, the core matte is a
// strong clip derived from the same authored parameters with
// the keyed-out region eroded by one texel — and runs the
// despill as a separate stage with luminance compensation.

import { Pass } from 'postprocessing';
import * as THREE from 'three';
import { CHROMA_KEY_FRAGMENT } from '../lib/chromaKeyMath';

// Matches postprocessing's shared fullscreen vertex shader
// convention (see outputGradePass.ts).
const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 1.0, 1.0);
}
`;

export class ChromaKeyPass extends Pass {
  keyColor = new THREE.Color('#00ff00');

  similarity = 0.08;

  smoothness = 0.04;

  spill = 0.5;

  private width = 1;

  private height = 1;

  private material: THREE.ShaderMaterial;

  constructor() {
    super('ChromaKeyPass');
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: CHROMA_KEY_FRAGMENT,
      uniforms: {
        tDiffuse: { value: null },
        uKeyColor: { value: new THREE.Color('#00ff00') },
        uSimilarity: { value: this.similarity },
        uSmoothness: { value: this.smoothness },
        uSpill: { value: this.spill },
        uTexelSize: { value: new THREE.Vector2(1, 1) },
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
    this.material.uniforms.tDiffuse.value = inputBuffer.texture;
    const tex = inputBuffer.texture as THREE.Texture & { image?: { width?: number; height?: number } };
    const w = tex.image?.width ?? this.width;
    const h = tex.image?.height ?? this.height;
    (this.material.uniforms.uTexelSize.value as THREE.Vector2).set(1 / Math.max(1, w), 1 / Math.max(1, h));
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
