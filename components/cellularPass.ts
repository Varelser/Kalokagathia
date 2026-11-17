// Cellular automaton pass (Phase AM): a discrete B/S-rule
// cellular automaton on a low-resolution state texture that
// ping-pongs across frames — one generation per frame. The
// state seeds from the current frame's luminance (cells at or
// above the seed threshold start alive) whenever the host
// calls requestSeed() — on enable, and on rule / cell-size /
// threshold changes. The presented frame mixes the input with
// the automaton's monochrome state. The stage only exists
// while postCellularEnabled is on; while disabled no state is
// kept (the pass is removed from the stack and disposed by
// the host's pass lifecycle). The rule grammar is the GLSL
// twin of lib/cellularRules.ts (Moore neighbourhood, wrapped
// edges).

import { Pass } from 'postprocessing';
import * as THREE from 'three';
import {
  cellularCountMask,
  resolveCellularRule,
  type CellularRuleName,
} from '../lib/cellularRules';

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 1.0, 1.0);
}
`;

const SEED_FRAG = /* glsl */ `
uniform sampler2D tDiffuse;
uniform float uThreshold;
varying vec2 vUv;
void main() {
  float l = dot(texture2D(tDiffuse, vUv).rgb, vec3(0.2126, 0.7152, 0.0722));
  gl_FragColor = vec4(vec3(l >= uThreshold ? 1.0 : 0.0), 1.0);
}
`;

const STEP_FRAG = /* glsl */ `
uniform sampler2D tState;
uniform vec2 uTexel;
uniform float uBirthMask;
uniform float uSurviveMask;
varying vec2 vUv;

float maskBit(float mask, float n) {
  return mod(floor(mask / pow(2.0, n)), 2.0);
}

float aliveAt(vec2 offset) {
  vec2 uv = fract(vUv + offset * uTexel);
  return texture2D(tState, uv).r > 0.5 ? 1.0 : 0.0;
}

void main() {
  float n = 0.0;
  n += aliveAt(vec2(-1.0, -1.0));
  n += aliveAt(vec2(0.0, -1.0));
  n += aliveAt(vec2(1.0, -1.0));
  n += aliveAt(vec2(-1.0, 0.0));
  n += aliveAt(vec2(1.0, 0.0));
  n += aliveAt(vec2(-1.0, 1.0));
  n += aliveAt(vec2(0.0, 1.0));
  n += aliveAt(vec2(1.0, 1.0));
  float selfAlive = texture2D(tState, vUv).r > 0.5 ? 1.0 : 0.0;
  float next = selfAlive > 0.5 ? maskBit(uSurviveMask, n) : maskBit(uBirthMask, n);
  gl_FragColor = vec4(vec3(next), 1.0);
}
`;

const PRESENT_FRAG = /* glsl */ `
uniform sampler2D tDiffuse;
uniform sampler2D tState;
uniform float uMix;
varying vec2 vUv;
void main() {
  vec3 frame = texture2D(tDiffuse, vUv).rgb;
  float state = texture2D(tState, vUv).r;
  gl_FragColor = vec4(mix(frame, vec3(state), clamp(uMix, 0.0, 1.0)), 1.0);
}
`;

function makeStateTarget(width: number, height: number) {
  return new THREE.WebGLRenderTarget(width, height, {
    type: THREE.UnsignedByteType,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    depthBuffer: false,
    stencilBuffer: false,
  });
}

export class CellularPass extends Pass {
  rule: CellularRuleName = 'life';

  cellSize = 4;

  seedThreshold = 0.5;

  mixAmount = 1;

  private readTarget: THREE.WebGLRenderTarget;

  private writeTarget: THREE.WebGLRenderTarget;

  private seedMaterial: THREE.ShaderMaterial;

  private stepMaterial: THREE.ShaderMaterial;

  private presentMaterial: THREE.ShaderMaterial;

  private fullWidth = 1;

  private fullHeight = 1;

  private stateCellSize = 0;

  private seedRequested = true;

  constructor() {
    super('CellularPass');
    this.readTarget = makeStateTarget(1, 1);
    this.writeTarget = makeStateTarget(1, 1);
    this.seedMaterial = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: SEED_FRAG,
      uniforms: {
        tDiffuse: { value: null },
        uThreshold: { value: this.seedThreshold },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.stepMaterial = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: STEP_FRAG,
      uniforms: {
        tState: { value: null },
        uTexel: { value: new THREE.Vector2(1, 1) },
        uBirthMask: { value: 8 },
        uSurviveMask: { value: 12 },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.presentMaterial = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: PRESENT_FRAG,
      uniforms: {
        tDiffuse: { value: null },
        tState: { value: null },
        uMix: { value: this.mixAmount },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.needsSwap = true;
  }

  /** Ask for a re-seed from the next input frame (the host
   *  calls this on enable and on rule / size / threshold
   *  changes). */
  requestSeed(): void {
    this.seedRequested = true;
  }

  private stateSize(): { w: number; h: number } {
    const cell = Math.max(1, Math.round(this.cellSize));
    return {
      w: Math.max(1, Math.ceil(this.fullWidth / cell)),
      h: Math.max(1, Math.ceil(this.fullHeight / cell)),
    };
  }

  private syncStateSize(): void {
    const cell = Math.max(1, Math.round(this.cellSize));
    const { w, h } = this.stateSize();
    if (this.readTarget.width !== w || this.readTarget.height !== h || this.stateCellSize !== cell) {
      this.readTarget.setSize(w, h);
      this.writeTarget.setSize(w, h);
      (this.stepMaterial.uniforms.uTexel.value as THREE.Vector2).set(1 / w, 1 / h);
      this.stateCellSize = cell;
      this.seedRequested = true;
    }
  }

  override render(
    renderer: THREE.WebGLRenderer,
    inputBuffer: THREE.WebGLRenderTarget,
    outputBuffer: THREE.WebGLRenderTarget,
  ): void {
    this.syncStateSize();
    if (this.seedRequested) {
      this.seedMaterial.uniforms.tDiffuse.value = inputBuffer.texture;
      this.seedMaterial.uniforms.uThreshold.value = this.seedThreshold;
      this.fullscreenMaterial = this.seedMaterial;
      renderer.setRenderTarget(this.writeTarget);
      renderer.render(this.scene, this.camera);
      const swap = this.readTarget;
      this.readTarget = this.writeTarget;
      this.writeTarget = swap;
      this.seedRequested = false;
    } else {
      const rule = resolveCellularRule(this.rule);
      this.stepMaterial.uniforms.tState.value = this.readTarget.texture;
      this.stepMaterial.uniforms.uBirthMask.value = cellularCountMask(rule.birth);
      this.stepMaterial.uniforms.uSurviveMask.value = cellularCountMask(rule.survive);
      this.fullscreenMaterial = this.stepMaterial;
      renderer.setRenderTarget(this.writeTarget);
      renderer.render(this.scene, this.camera);
      const swap = this.readTarget;
      this.readTarget = this.writeTarget;
      this.writeTarget = swap;
    }
    this.presentMaterial.uniforms.tDiffuse.value = inputBuffer.texture;
    this.presentMaterial.uniforms.tState.value = this.readTarget.texture;
    this.presentMaterial.uniforms.uMix.value = this.mixAmount;
    this.fullscreenMaterial = this.presentMaterial;
    renderer.setRenderTarget(this.renderToScreen ? null : outputBuffer);
    renderer.render(this.scene, this.camera);
  }

  override setSize(width: number, height: number): void {
    this.fullWidth = Math.max(1, width);
    this.fullHeight = Math.max(1, height);
    this.syncStateSize();
  }

  override dispose(): void {
    this.readTarget.dispose();
    this.writeTarget.dispose();
    this.seedMaterial.dispose();
    this.stepMaterial.dispose();
    this.presentMaterial.dispose();
    super.dispose();
  }
}
