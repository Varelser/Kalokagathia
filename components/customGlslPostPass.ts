// Custom GLSL post pass (Phase BX): a fullscreen shader pass
// whose fragment is generated from the user's snippet by
// lib/customPostGlsl.ts (buildCustomPostGlslFragment). It sits
// immediately before 'output-grade' in every stack profile, so
// the grade stage still has the final word.
//
// The pass starts as a bit-identical passthrough; the composer
// component swaps in a generated fragment only after the snippet
// passes the token scan AND the harness compile check, and keeps
// the previously working fragment on any failure (the
// custom-force fallback rule). The stage itself is only inserted
// while an enabled, statically valid snippet is set
// (lib/postFxStack.ts), so the defaults never build this pass
// into the chain at all.
//
// uTime comes from the pass's own frame counter (the GlitchPass
// idiom), so a deterministic render reproduces time-dependent
// snippets frame for frame; live, the counter advances once per
// rendered frame (~60/s).

import { Pass } from 'postprocessing';
import * as THREE from 'three';
import { buildCustomPostGlslFragment } from '../lib/customPostGlsl';

// Matches postprocessing's shared fullscreen vertex shader convention
// (see feedbackPass.ts): vUv is derived from clip-space position.
const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 1.0, 1.0);
}
`;

const PASSTHROUGH_FRAG = /* glsl */ `
uniform sampler2D tDiffuse;
varying vec2 vUv;
void main() {
  gl_FragColor = vec4(texture2D(tDiffuse, vUv).rgb, 1.0);
}
`;

export class CustomGlslPostPass extends Pass {
  lumaLock = false;

  private material: THREE.ShaderMaterial;

  private frameCount = 0;

  constructor() {
    super('CustomGlslPostPass');
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: PASSTHROUGH_FRAG,
      uniforms: {
        tDiffuse: { value: null },
        uTime: { value: 0 },
        uResolution: { value: new THREE.Vector2(1, 1) },
        uLumaLock: { value: 0 },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.fullscreenMaterial = this.material;
    this.needsSwap = true;
  }

  // Swap in the fragment generated for a compile-checked
  // snippet, or back to the passthrough when code is null
  // (snippet cleared). Callers own the fallback policy: on a
  // failed check they simply do not call this, and the previous
  // fragment keeps rendering.
  setUserCode(code: string | null): void {
    this.material.fragmentShader = code ? buildCustomPostGlslFragment(code) : PASSTHROUGH_FRAG;
    this.material.needsUpdate = true;
  }

  override render(
    renderer: THREE.WebGLRenderer,
    inputBuffer: THREE.WebGLRenderTarget,
    outputBuffer: THREE.WebGLRenderTarget,
  ): void {
    this.frameCount += 1;
    this.material.uniforms.tDiffuse.value = inputBuffer.texture;
    this.material.uniforms.uTime.value = this.frameCount / 60;
    (this.material.uniforms.uResolution.value as THREE.Vector2).set(
      Math.max(1, inputBuffer.width),
      Math.max(1, inputBuffer.height),
    );
    this.material.uniforms.uLumaLock.value = this.lumaLock ? 1 : 0;
    renderer.setRenderTarget(this.renderToScreen ? null : outputBuffer);
    renderer.render(this.scene, this.camera);
  }

  override dispose(): void {
    this.material.dispose();
    super.dispose();
  }
}
