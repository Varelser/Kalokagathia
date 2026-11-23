// Brush stroke accumulation pass (Phase 15, 2D section 6): the
// brush line ribbons are rendered on their own into a scratch
// target (three.js layer 1 isolation — the brush mesh enables
// layer 1 in addition to the default layer 0), accumulated into
// a dedicated ping-pong target with a per-frame decay, and
// max-blended back over the frame. Strokes therefore persist
// and build up where the brush has passed, instead of being
// redrawn analytically each frame with no history.
//
// LIVE ONLY, by construction: the deterministic renderer draws
// the scene directly and never runs the composer, so this
// history — exactly like the feedback stage's — does not appear
// in deterministic exports. The panel says so next to the toggle.

import { Pass } from 'postprocessing';
import * as THREE from 'three';

export const BRUSH_ACCUM_LAYER = 1;
export const BRUSH_ACCUM_OBJECT_NAME = 'kalo-brush-lines';

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 1.0, 1.0);
}
`;

const ACCUM_FRAG = /* glsl */ `
uniform sampler2D tLines;
uniform sampler2D tAccum;
uniform float uDecay;
varying vec2 vUv;
void main() {
  vec3 lines = texture2D(tLines, vUv).rgb;
  vec3 prev = texture2D(tAccum, vUv).rgb * uDecay;
  gl_FragColor = vec4(max(lines, prev), 1.0);
}
`;

const BLEND_FRAG = /* glsl */ `
uniform sampler2D tDiffuse;
uniform sampler2D tAccum;
uniform float uStrength;
varying vec2 vUv;
void main() {
  vec3 current = texture2D(tDiffuse, vUv).rgb;
  vec3 acc = texture2D(tAccum, vUv).rgb * uStrength;
  gl_FragColor = vec4(max(current, acc), 1.0);
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

export class BrushAccumPass extends Pass {
  decay = 0.92;

  strength = 1;

  /** Host-wired each frame: the live scene and camera. */
  sceneRoot: THREE.Scene | null = null;

  viewCamera: THREE.Camera | null = null;

  private scratchTarget: THREE.WebGLRenderTarget;

  private readTarget: THREE.WebGLRenderTarget;

  private writeTarget: THREE.WebGLRenderTarget;

  private accumMaterial: THREE.ShaderMaterial;

  private blendMaterial: THREE.ShaderMaterial;

  private brushObject: THREE.Object3D | null = null;

  constructor() {
    super('BrushAccumPass');
    this.scratchTarget = makeTarget(1, 1);
    this.readTarget = makeTarget(1, 1);
    this.writeTarget = makeTarget(1, 1);
    this.accumMaterial = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: ACCUM_FRAG,
      uniforms: {
        tLines: { value: null },
        tAccum: { value: null },
        uDecay: { value: this.decay },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.blendMaterial = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: BLEND_FRAG,
      uniforms: {
        tDiffuse: { value: null },
        tAccum: { value: null },
        uStrength: { value: this.strength },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.needsSwap = true;
  }

  private findBrushObject(): THREE.Object3D | null {
    if (!this.sceneRoot) return null;
    if (this.brushObject) {
      let node: THREE.Object3D | null = this.brushObject;
      while (node && node !== this.sceneRoot) node = node.parent;
      if (node === this.sceneRoot) return this.brushObject;
      this.brushObject = null;
    }
    this.brushObject = this.sceneRoot.getObjectByName(BRUSH_ACCUM_OBJECT_NAME) ?? null;
    return this.brushObject;
  }

  override render(
    renderer: THREE.WebGLRenderer,
    inputBuffer: THREE.WebGLRenderTarget,
    outputBuffer: THREE.WebGLRenderTarget,
  ): void {
    // 1. Lines-only render into the scratch target: restrict the
    //    camera to the brush layer, with the scene background off.
    const brush = this.findBrushObject();
    renderer.setRenderTarget(this.scratchTarget);
    if (brush && this.sceneRoot && this.viewCamera) {
      const prevBackground = this.sceneRoot.background;
      const prevMask = this.viewCamera.layers.mask;
      const prevClearColor = new THREE.Color();
      renderer.getClearColor(prevClearColor);
      const prevClearAlpha = renderer.getClearAlpha();
      try {
        this.sceneRoot.background = null;
        this.viewCamera.layers.mask = 1 << BRUSH_ACCUM_LAYER;
        renderer.setClearColor(0x000000, 0);
        renderer.render(this.sceneRoot, this.viewCamera);
      } finally {
        this.sceneRoot.background = prevBackground;
        this.viewCamera.layers.mask = prevMask;
        renderer.setClearColor(prevClearColor, prevClearAlpha);
      }
    } else {
      const prevClearColor = new THREE.Color();
      renderer.getClearColor(prevClearColor);
      const prevClearAlpha = renderer.getClearAlpha();
      renderer.setClearColor(0x000000, 0);
      renderer.clear(true, false, false);
      renderer.setClearColor(prevClearColor, prevClearAlpha);
    }

    // 2. Accumulate: max of the fresh lines and the decayed history.
    const accumUniforms = this.accumMaterial.uniforms;
    accumUniforms.tLines.value = this.scratchTarget.texture;
    accumUniforms.tAccum.value = this.readTarget.texture;
    accumUniforms.uDecay.value = this.decay;
    this.fullscreenMaterial = this.accumMaterial;
    renderer.setRenderTarget(this.writeTarget);
    renderer.render(this.scene, this.camera);

    // 3. Blend the accumulation over the current frame. The frame
    //    already contains the current stroke, so a max() cannot
    //    double it — it only lifts pixels where history is brighter.
    const blendUniforms = this.blendMaterial.uniforms;
    blendUniforms.tDiffuse.value = inputBuffer.texture;
    blendUniforms.tAccum.value = this.writeTarget.texture;
    blendUniforms.uStrength.value = this.strength;
    this.fullscreenMaterial = this.blendMaterial;
    renderer.setRenderTarget(this.renderToScreen ? null : outputBuffer);
    renderer.render(this.scene, this.camera);

    // 4. The new accumulation becomes next frame's history.
    const swap = this.readTarget;
    this.readTarget = this.writeTarget;
    this.writeTarget = swap;
  }

  override setSize(width: number, height: number): void {
    this.scratchTarget.setSize(width, height);
    this.readTarget.setSize(width, height);
    this.writeTarget.setSize(width, height);
  }

  override dispose(): void {
    this.scratchTarget.dispose();
    this.readTarget.dispose();
    this.writeTarget.dispose();
    this.accumMaterial.dispose();
    this.blendMaterial.dispose();
    super.dispose();
  }
}
