import * as THREE from 'three';

/**
 * Rule evaluation pass (REP) — Grammar 2.0 stage 1, slice 1A.
 *
 * The live sibling of the dynamic attribute pass (Phase BO):
 * a fullscreen pass whose fragment is generated from the live
 * rule list (lib/gpgpuParticleRulesLive.ts buildRuleEvalFragment)
 * and which writes the aggregate live mask into a DEDICATED
 * ping-pong pair of RGBA float targets (design
 * STAGE1_GRAMMAR2_DESIGN.md section 1):
 *
 *   .r action mask / .g state id (/255) / .b previous-frame
 *   condition bits / .a display override (slice 1C: 1 + size
 *   of a matched display rule, 0 = no override)
 *
 * Unlike the dyn pass the REP is STATEFUL: each evaluation
 * reads the previous output (the state id and the condition
 * bits live there) and writes the other target, so the pair
 * alternates. Both targets are initialised to the fixed
 * initial state (mask = full permit 24351 — the five G10
 * permits plus the four slice-1C extension permits plus the
 * custom-force permit (bit 12, external-force general form)
 * plus the Meander permit (bit 14, stage 2 B7),
 * no kill / true-kill / fracture bits — state 0, bits 0, display 0) —
 * with the same initial state and the same input sequence the
 * evaluation reproduces (design section 8). Slice 1B: the
 * fragment may also read the analytic SDF collider bundle
 * (the `sdf` condition variable) and write state transitions
 * into the .g channel; the pass itself only gains the SDF
 * uniform bundle below. The contact follow-up (slice 1B's
 * cut-off item) adds the uHitTex binding below: the contact
 * pass's record, read only when a live condition uses
 * `hit` / `hits`.
 *
 * The wiring (sceneGpgpuSystem) owns the lifecycle exactly as
 * for the dyn pass: the pass is built only while the generated
 * fragment is non-null (at least one live-classified rule with
 * a consumed action), rebuilt when its signature changes, and
 * disposed otherwise. While no live rule exists the pass never
 * exists and no consumer reads a live mask.
 */
const RULE_EVAL_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const RULE_EVAL_INIT_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
void main() {
  // Full permit (LIVE_RULE_MASK_FULL_PERMIT = 31 + 3840 +
  // 4096 + 16384): every force permitted, no kill /
  // true-kill / fracture, state 0, condition bits 0, no
  // display override.
  gl_FragColor = vec4(24351.0, 0.0, 0.0, 0.0);
}
`;

export interface GpgpuRuleEvalBindings {
  /** Current attribute texture (post dyn / feedback values). */
  attrTex: THREE.Texture;
  /** Ext bake texture (slots 4..7), sampled only when the
   *  fragment declares uExtTex. */
  extTex?: THREE.Texture | null;
  /** Sim state textures for vel / age / rad, sampled only
   *  when the fragment declares them. */
  posTex?: THREE.Texture | null;
  velTex?: THREE.Texture | null;
  ageDenom?: number;
  radiusDenom?: number;
  /** Density supply, sampled only when the fragment declares
   *  uDenTex (a live condition reads `den`). */
  denTex?: THREE.Texture | null;
  /** Contact supply (the contact pass's latest record, or
   *  its zero texture while suppressed), sampled only when
   *  the fragment declares uHitTex (a live condition reads
   *  `hit` / `hits`). */
  hitTex?: THREE.Texture | null;
  /** Predation hold supply (the hold pass's latest record),
   *  sampled only when the fragment declares uPredHoldTex
   *  (a live condition reads `predhold`, stage 2 B6
   *  follow-up). */
  holdTex?: THREE.Texture | null;
  /** Analytic SDF collider bundle (slice 1B): the velocity
   *  pass's own SDF uniforms, supplied to the REP as well;
   *  sampled only when the fragment declares them (a live
   *  condition reads `sdf`). Shape is the numeric shape id
   *  (SDF_SHAPE_IDS). */
  sdf?: {
    enabled: boolean;
    shape: number;
    x: number;
    y: number;
    z: number;
    size: number;
  } | null;
  /** Neighbourhood supply (stage 2 slice B6): the species
   *  count and encounter range for the `prey` / `pred`
   *  condition variables, read only when the fragment
   *  declares them (a live condition reads prey / pred).
   *  Resolved by lib/gpgpuPredation.ts (vision range with
   *  the interaction-radius fallback). */
  predation?: {
    species: number;
    range: number;
    /** Sim time at which the current predation rule set was
     *  (re)activated; the `predage` supply (stage 2 B6
     *  follow-up) reads uTime - this value. Read only when
     *  the fragment declares uPredActivationTime. */
    activationTime?: number;
  } | null;
  time: number;
}

function makeTarget(texSize: number, height: number): THREE.WebGLRenderTarget {
  const rt = new THREE.WebGLRenderTarget(texSize, height, {
    type: THREE.FloatType,
    format: THREE.RGBAFormat,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    depthBuffer: false,
    stencilBuffer: false,
  });
  if (height > texSize) {
    // Merged supply (stage 2 texture-unit follow-up): the
    // target is taller than the live region; the evaluation
    // renders only into the bottom texSize rows (the strip
    // above them carries the blitted column data). The
    // viewport restriction keeps the fragment's vUv spanning
    // exactly the live square, so the generated fragment —
    // and every consumer's live read, scaled by
    // texSize / height — is unchanged in form.
    rt.viewport.set(0, 0, texSize, texSize);
    rt.scissor.set(0, 0, texSize, texSize);
    rt.scissorTest = true;
  }
  return rt;
}

/**
 * Column blit fragment (merged supply): copy the column
 * data texture into the strip above the live region, packed
 * linearly in the column layout's texel order — destination
 * texel (dx, dy) of the strip takes source texel
 * (lin mod colWidth, lin div colWidth) with
 * lin = dy * mergedWidth + dx, exactly the remap the merged
 * kaloColFetch performs on the read side. Texels past the
 * column texel count write zero.
 */
const RULE_EVAL_BLIT_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D uColTex;
uniform float uMergedWidthF;
uniform float uStripRowsF;
uniform float uColWidthF;
uniform float uColHeightF;
uniform float uColTexelCountF;
void main() {
  float dx = floor(vUv.x * uMergedWidthF);
  float dy = floor(vUv.y * uStripRowsF);
  float lin = dy * uMergedWidthF + dx;
  if (lin >= uColTexelCountF) {
    gl_FragColor = vec4(0.0);
    return;
  }
  float sx = mod(lin, uColWidthF);
  float sy = floor(lin / uColWidthF);
  gl_FragColor = texture2D(uColTex, vec2((sx + 0.5) / uColWidthF, (sy + 0.5) / uColHeightF));
}
`;

export class GpgpuRuleEvalPass {
  private rtA: THREE.WebGLRenderTarget;
  private rtB: THREE.WebGLRenderTarget;
  private mat: THREE.ShaderMaterial;
  private initMat: THREE.ShaderMaterial;
  private blitMat: THREE.ShaderMaterial | null = null;
  private scene = new THREE.Scene();
  private cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private geo: THREE.PlaneGeometry;
  private mesh: THREE.Mesh;
  /** True while rtA holds the latest evaluation. */
  private pingA = true;
  private initialised = false;
  /** The target the latest run wrote (null before any run). */
  private lastWrite: THREE.WebGLRenderTarget | null = null;
  /** Merged supply: the live square's size and the column
   *  strip's height above it (0 = no merged supply, targets
   *  are the plain squares they always were). */
  private readonly texSize: number;
  private readonly stripRows: number;

  constructor(texSize: number, fragmentShader: string, stripRows = 0) {
    this.texSize = texSize;
    this.stripRows = stripRows;
    const totalHeight = texSize + stripRows;
    this.rtA = makeTarget(texSize, totalHeight);
    this.rtB = makeTarget(texSize, totalHeight);
    if (stripRows > 0) {
      this.blitMat = new THREE.ShaderMaterial({
        uniforms: {
          uColTex: { value: null as THREE.Texture | null },
          uMergedWidthF: { value: texSize },
          uStripRowsF: { value: stripRows },
          uColWidthF: { value: 1 },
          uColHeightF: { value: 1 },
          uColTexelCountF: { value: 0 },
        },
        vertexShader: RULE_EVAL_VERT,
        fragmentShader: RULE_EVAL_BLIT_FRAG,
        depthTest: false,
        depthWrite: false,
      });
    }
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uAttrTex: { value: null as THREE.Texture | null },
        uExtTex: { value: null as THREE.Texture | null },
        uPosTex: { value: null as THREE.Texture | null },
        uVelTex: { value: null as THREE.Texture | null },
        uAgeDenom: { value: 1 },
        uRadiusDenom: { value: 1 },
        uDenTex: { value: null as THREE.Texture | null },
        uHitTex: { value: null as THREE.Texture | null },
        uPredHoldTex: { value: null as THREE.Texture | null },
        uPredActivationTime: { value: 0 },
        uSdfEnabled: { value: false },
        uSdfShape: { value: 0 },
        uSdfX: { value: 0 },
        uSdfY: { value: 0 },
        uSdfZ: { value: 0 },
        uSdfSize: { value: 0 },
        uPrevTex: { value: null as THREE.Texture | null },
        uPreyTexSizeF: { value: texSize },
        uPreySpecies: { value: 4 },
        uPreyRange: { value: 120 },
        uTime: { value: 0 },
      },
      vertexShader: RULE_EVAL_VERT,
      fragmentShader,
      depthTest: false,
      depthWrite: false,
    });
    this.initMat = new THREE.ShaderMaterial({
      uniforms: {},
      vertexShader: RULE_EVAL_VERT,
      fragmentShader: RULE_EVAL_INIT_FRAG,
      depthTest: false,
      depthWrite: false,
    });
    this.geo = new THREE.PlaneGeometry(2, 2);
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
  }

  private renderTo(gl: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget, mat: THREE.ShaderMaterial): void {
    this.mesh.material = mat;
    const prev = gl.getRenderTarget();
    gl.setRenderTarget(target);
    gl.render(this.scene, this.cam);
    gl.setRenderTarget(prev);
    this.mesh.material = this.mat;
  }

  /** Write the fixed initial state into both targets. */
  reset(gl: THREE.WebGLRenderer): void {
    this.renderTo(gl, this.rtA, this.initMat);
    this.renderTo(gl, this.rtB, this.initMat);
    this.pingA = true;
    this.initialised = true;
  }

  /**
   * Merged supply: blit the column data texture into the
   * strip of BOTH ping-pong targets (either may be read
   * next). The wiring calls this when the pass is built and
   * whenever the column supply object changes; the strip is
   * outside the evaluation viewport, so evaluations and
   * resets never disturb it. No-op without a strip.
   */
  blitColumn(gl: THREE.WebGLRenderer, colTex: THREE.Texture, colWidth: number, colHeight: number): void {
    if (!this.blitMat || this.stripRows <= 0) return;
    const u = this.blitMat.uniforms;
    u.uColTex.value = colTex;
    u.uColWidthF.value = colWidth;
    u.uColHeightF.value = colHeight;
    u.uColTexelCountF.value = colWidth * colHeight;
    for (const target of [this.rtA, this.rtB]) {
      target.viewport.set(0, this.texSize, this.texSize, this.stripRows);
      target.scissor.set(0, this.texSize, this.texSize, this.stripRows);
      this.renderTo(gl, target, this.blitMat);
      target.viewport.set(0, 0, this.texSize, this.texSize);
      target.scissor.set(0, 0, this.texSize, this.texSize);
    }
  }

  /**
   * Evaluate once: read the previous output, write the other
   * target, and return the texture holding the new aggregate
   * (stable until the next evaluation — the wiring holds it
   * between interval frames).
   *
   * Two-phase evaluations (same-evaluation designation,
   * stage 5 S5 follow-up) call this twice back to back with
   * the same bindings: the second call reads the first
   * call's output as its previous state, so two calls return
   * the ping-pong parity to where it stood before the pair,
   * and the pair's result is the second call's texture.
   */
  run(gl: THREE.WebGLRenderer, bindings: GpgpuRuleEvalBindings): THREE.Texture {
    if (!this.initialised) this.reset(gl);
    const read = this.pingA ? this.rtA : this.rtB;
    const write = this.pingA ? this.rtB : this.rtA;
    const u = this.mat.uniforms;
    u.uAttrTex.value = bindings.attrTex;
    u.uExtTex.value = bindings.extTex ?? null;
    u.uPosTex.value = bindings.posTex ?? null;
    u.uVelTex.value = bindings.velTex ?? null;
    if (typeof bindings.ageDenom === 'number') u.uAgeDenom.value = bindings.ageDenom;
    if (typeof bindings.radiusDenom === 'number') u.uRadiusDenom.value = bindings.radiusDenom;
    u.uDenTex.value = bindings.denTex ?? null;
    u.uHitTex.value = bindings.hitTex ?? null;
    u.uPredHoldTex.value = bindings.holdTex ?? null;
    if (bindings.sdf) {
      u.uSdfEnabled.value = bindings.sdf.enabled;
      u.uSdfShape.value = bindings.sdf.shape;
      u.uSdfX.value = bindings.sdf.x;
      u.uSdfY.value = bindings.sdf.y;
      u.uSdfZ.value = bindings.sdf.z;
      u.uSdfSize.value = bindings.sdf.size;
    }
    if (bindings.predation) {
      u.uPreySpecies.value = bindings.predation.species;
      u.uPreyRange.value = bindings.predation.range;
      if (typeof bindings.predation.activationTime === 'number') {
        u.uPredActivationTime.value = bindings.predation.activationTime;
      }
    }
    u.uPrevTex.value = read.texture;
    u.uTime.value = bindings.time;
    this.renderTo(gl, write, this.mat);
    this.pingA = !this.pingA;
    this.lastWrite = write;
    return write.texture;
  }

  /**
   * The render target the latest run wrote into (null before
   * any run). Exposed for the live fracture consumption: the
   * scene reads the aggregate mask back from this target on
   * evaluation frames while a live fracture rule exists
   * (lib/gpgpuLiveFracture.ts). Reading it never disturbs the
   * ping-pong — the next run reads the OTHER target's pair
   * mate through the texture, exactly as before. On a
   * two-phase evaluation this is the SECOND run's target:
   * the readback sees the evaluation's final aggregate.
   */
  get currentTarget(): THREE.WebGLRenderTarget | null {
    return this.lastWrite;
  }

  dispose(): void {
    this.rtA.dispose();
    this.rtB.dispose();
    this.mat.dispose();
    this.initMat.dispose();
    this.blitMat?.dispose();
    this.geo.dispose();
  }
}
