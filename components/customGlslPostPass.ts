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
// Layer 1 WP11 phase D1: the stored document may author several
// custom stages (lib/customPostGlsl.ts). This one stack stage
// then runs them as an internal chain — stage 1 reads the
// composer's input, each later stage reads the previous stage's
// output (which is also what its `color` / tDiffuse mean), and
// the last stage writes to the composer's output. Intermediate
// results ping-pong between two half-float targets owned by
// this pass, so the stack, the profile orders and the anchor
// position are untouched: from the composer's side there is
// still exactly one 'custom-glsl-post' stage. A single-stage
// document renders exactly as Phase BX did (one material, no
// intermediate targets).
//
// uTime comes from the pass's own frame counter (the GlitchPass
// idiom), so a deterministic render reproduces time-dependent
// snippets frame for frame; live, the counter advances once per
// rendered frame (~60/s). Every stage in a chain shares the
// same frame counter value within a frame.

import { Pass } from 'postprocessing';
import * as THREE from 'three';
import {
  buildCustomPostStageFragment,
  parseCustomPostStages,
  type CustomPostStage,
} from '../lib/customPostGlsl';

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

  private materials: THREE.ShaderMaterial[] = [];

  private rtA: THREE.WebGLRenderTarget | null = null;

  private rtB: THREE.WebGLRenderTarget | null = null;

  private frameCount = 0;

  constructor() {
    super('CustomGlslPostPass');
    this.materials = [this.createMaterial(PASSTHROUGH_FRAG)];
    this.fullscreenMaterial = this.materials[0];
    this.needsSwap = true;
  }

  private createMaterial(fragmentShader: string): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader,
      uniforms: {
        tDiffuse: { value: null },
        uTime: { value: 0 },
        uResolution: { value: new THREE.Vector2(1, 1) },
        uLumaLock: { value: 0 },
      },
      depthTest: false,
      depthWrite: false,
    });
  }

  // Swap in the fragments generated for a compile-checked
  // document (one material per authored stage, in document
  // order), or back to the passthrough when code is null
  // (snippet cleared). Callers own the fallback policy: on a
  // failed check they simply do not call this, and the previous
  // stage set keeps rendering.
  setUserCode(code: string | null): void {
    const parsed = code ? parseCustomPostStages(code) : null;
    this.setUserStages(parsed && parsed.ok ? parsed.stages : null);
  }

  // Swap in already-resolved stages (Layer 1 WP11 phase C:
  // the composer component resolves the shared snippet
  // definitions per stage before the compile check, and hands
  // the resolved stages over here). Null (or an empty list)
  // returns to the passthrough.
  setUserStages(stages: readonly CustomPostStage[] | null): void {
    const fragments = stages && stages.length > 0
      ? stages.map((stage) => buildCustomPostStageFragment(stage))
      : [PASSTHROUGH_FRAG];
    this.replaceMaterials(fragments);
  }

  // Swap in one whole fragment (Layer 1 WP11 phases D2/C: the
  // full-fragment replacement form — the fragment was
  // assembled and compile-checked by the caller under the
  // slot's contract). Null returns to the passthrough.
  setUserFragment(fragment: string | null): void {
    this.replaceMaterials(fragment ? [fragment] : [PASSTHROUGH_FRAG]);
  }

  private replaceMaterials(fragments: string[]): void {
    for (const material of this.materials) material.dispose();
    this.materials = fragments.map((fragment) => this.createMaterial(fragment));
    this.fullscreenMaterial = this.materials[0];
  }

  private ensureTargets(width: number, height: number): void {
    if (!this.rtA || !this.rtB) {
      const options: THREE.RenderTargetOptions = { type: THREE.HalfFloatType };
      this.rtA = new THREE.WebGLRenderTarget(width, height, options);
      this.rtB = new THREE.WebGLRenderTarget(width, height, options);
      return;
    }
    if (this.rtA.width !== width || this.rtA.height !== height) {
      this.rtA.setSize(width, height);
      this.rtB.setSize(width, height);
    }
  }

  override render(
    renderer: THREE.WebGLRenderer,
    inputBuffer: THREE.WebGLRenderTarget,
    outputBuffer: THREE.WebGLRenderTarget,
  ): void {
    this.frameCount += 1;
    const time = this.frameCount / 60;
    const width = Math.max(1, inputBuffer.width);
    const height = Math.max(1, inputBuffer.height);
    const count = this.materials.length;
    if (count > 1) this.ensureTargets(width, height);
    let readTexture: THREE.Texture = inputBuffer.texture;
    for (let i = 0; i < count; i += 1) {
      const material = this.materials[i];
      const isLast = i === count - 1;
      material.uniforms.tDiffuse.value = readTexture;
      material.uniforms.uTime.value = time;
      (material.uniforms.uResolution.value as THREE.Vector2).set(width, height);
      material.uniforms.uLumaLock.value = this.lumaLock ? 1 : 0;
      this.fullscreenMaterial = material;
      const target = isLast
        ? (this.renderToScreen ? null : outputBuffer)
        : (i % 2 === 0 ? this.rtA : this.rtB);
      renderer.setRenderTarget(target);
      renderer.render(this.scene, this.camera);
      if (!isLast) readTexture = (target as THREE.WebGLRenderTarget).texture;
    }
  }

  override dispose(): void {
    for (const material of this.materials) material.dispose();
    this.rtA?.dispose();
    this.rtB?.dispose();
    super.dispose();
  }
}
