import * as THREE from 'three';

/**
 * Contact pass (Grammar 2.0 stage 1, the slice-1B follow-up
 * item) — the supply behind the live rule condition
 * variables `hit` (the most recent position step's contact
 * flag, 0/1) and `hits` (the accumulated contact count of
 * the particle's current life). The fixed plan is
 * STAGE1_1B_IMPL_RECORD.md's; the implementation record is
 * STAGE1_HIT_IMPL_RECORD.md.
 *
 * Why a replay: the position pass computes the contact
 * judgments (Phase 15's collisionContact: sphere shell /
 * analytic SDF / mesh SDF / floor / terrain) but its output
 * channels are fully owned (xyz = position, w = age), so the
 * flag cannot leave the pass. This pass REPLAYS the five
 * judgments — same expressions, same order, same local
 * push-outs — from the frame-start position (posIn) and the
 * fresh velocity (velOut), inside runSimulationPasses right
 * before the position pass renders. It writes nothing the
 * sim reads; it only records, into its own ping-pong pair:
 *
 *   .r = hits (accumulated count, saturating at 255)
 *   .g = hit  (this step's contact, 0/1 — no decay: the
 *        value is exactly the latest step's flag)
 *   .b = the age this step saw (the next step's reset test)
 *   .a = 0 (spare)
 *
 * Accumulation reset (fixed semantics): a respawn restarts
 * the age at the replica base, so an age DROP against the
 * previous step's stored age means the particle was reborn
 * during the previous position step; the count restarts
 * from that step's contact. The reset is detected one step
 * after the respawn — the respawning step's own contact
 * still counts toward the old life, exactly as the position
 * pass's own collision life-loss prices it there. With age
 * advance disabled the age channel is frozen by the
 * position pass itself and later respawns may go undetected
 * (documented limitation, STAGE1_HIT_IMPL_RECORD.md).
 *
 * Parked particles (the spawn gate's / true-kill's park
 * form, y = -99999) never reach the position tail, so the
 * replay early-outs on the park form: hit = 0, the count
 * carried frozen. A particle that activates (or is
 * true-killed) on this very step is still parked / not yet
 * parked at frame start, so its activation / death step
 * reports the frame-start state's result — a one-step
 * divergence on those two transition steps only.
 *
 * Resolution (CPU side, fixed): the pass runs its replay
 * only while the position step it mirrors is the plain
 * Euler step — Verlet integration, the Grains position
 * projection, Vellum and Rigid each replace or pre-correct
 * that step, so under any of them the runner calls
 * suppress() instead and the REP reads the zero texture
 * (hit = 0, hits = 0, fixed). DEM needs no handling here:
 * the DEM plan is consumed only by the WebGPU step, and
 * live rules route such configs to WebGL, where DEM never
 * engages and the REP (and this pass) live. The Grains pile
 * iterations run AFTER the position pass and never feed its
 * collisionContact, so they do not suppress the replay.
 *
 * Lifecycle mirrors the REP's: the scene builds the pass
 * only while a live REP fragment reads hit / hits, and the
 * runner drives it every frame (run or suppress), so the
 * texture the REP binds is always the latest step's record
 * or the zero texture — never a stale frame.
 */

const CONTACT_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const CONTACT_INIT_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
void main() {
  gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0);
}
`;

/**
 * The replay fragment. The five judgment blocks are the
 * position pass's own (components/
 * gpgpuShaderSimulationPosition.ts, POS_FRAG_TAIL), copied
 * verbatim except that the Phase 15 bookkeeping flag is the
 * local `contact` (always tracked here) and the push-outs
 * mutate only the local predicted position.
 */
export const CONTACT_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uPosTex;
  uniform sampler2D uVelTex;
  uniform sampler2D uPrevTex;
  uniform float uDelta;
  uniform float uSpeed;
  uniform float uBounceRadius;
  // Forced restart of the accumulation (first step, or the
  // first step after a suppression): the previous record is
  // ignored and the count starts from this step's contact.
  uniform float uContactReset;
  uniform bool  uSdfEnabled;
  uniform int   uSdfShape;
  uniform float uSdfX;
  uniform float uSdfY;
  uniform float uSdfZ;
  uniform float uSdfSize;
  // Mesh SDF collider (Phase BY): the position pass's own
  // declarations and query copies, verbatim.
  uniform bool  uMeshSdfEnabled;
  uniform sampler3D uMeshSdfTex;
  uniform vec3  uMeshSdfOrigin;
  uniform float uMeshSdfDomainWorld;
  uniform float uMeshSdfScale;
  uniform float uMeshSdfVoxelWorld;
  uniform bool  uFloorEnabled;
  uniform float uFloorY;
  // Terrain collider (Phase AI): the position pass's own
  // declarations and decoder copy, verbatim.
  uniform bool  uTerrainColliderEnabled;
  uniform sampler2D uTerrainColliderTex;
  uniform float uTerrainExtent;
  uniform float uTerrainHeightWorld;
  uniform float uTerrainGradScale;
  uniform float uTerrainTexSize;

  // Gyroid SDF (B3) — identical formulation to the position
  // shader's copy.
  float gyroidField(vec3 p, vec3 sc, float size) {
    vec3 q = (p - sc) * (3.14159265 / max(size, 1.0));
    return sin(q.x) * cos(q.y) + sin(q.y) * cos(q.z) + sin(q.z) * cos(q.x);
  }
  vec3 gyroidNormal(vec3 p, vec3 sc, float size) {
    vec3 q = (p - sc) * (3.14159265 / max(size, 1.0));
    vec3 g = vec3(
      cos(q.x) * cos(q.y) - sin(q.z) * sin(q.x),
      cos(q.y) * cos(q.z) - sin(q.x) * sin(q.y),
      cos(q.z) * sin(q.x) - sin(q.y) * sin(q.z)
    );
    return normalize(g + vec3(0.0001));
  }

  // Mesh SDF (Phase BY): identical copy of the position
  // pass's baked-grid query (negative = inside, world
  // units, degenerate normal = +Y; outside the domain cube
  // the query is +1e6, no collision).
  float meshSdfDistance(vec3 p) {
    vec3 q = (p - uMeshSdfOrigin) / uMeshSdfDomainWorld;
    if (q.x < 0.0 || q.x > 1.0 || q.y < 0.0 || q.y > 1.0 || q.z < 0.0 || q.z > 1.0) return 1.0e6;
    return texture2D(uMeshSdfTex, q).r * uMeshSdfScale;
  }
  vec3 meshSdfNormal(vec3 p) {
    float e = uMeshSdfVoxelWorld * 0.5;
    vec3 g = vec3(
      meshSdfDistance(p + vec3(e, 0.0, 0.0)) - meshSdfDistance(p - vec3(e, 0.0, 0.0)),
      meshSdfDistance(p + vec3(0.0, e, 0.0)) - meshSdfDistance(p - vec3(0.0, e, 0.0)),
      meshSdfDistance(p + vec3(0.0, 0.0, e)) - meshSdfDistance(p - vec3(0.0, 0.0, e)));
    float gl = length(g);
    return gl > 0.0001 ? g / gl : vec3(0.0, 1.0, 0.0);
  }

  // Terrain collider sampling (Phase AI): identical copy of
  // the position pass's decoder (manual bilinear over the
  // packed 16-bit height). This pass uses .x only.
  vec3 terrainColliderSample(vec2 uv) {
    vec2 gridPos = uv * uTerrainTexSize - 0.5;
    vec2 base = floor(gridPos);
    vec2 f = clamp(gridPos - base, 0.0, 1.0);
    vec2 i00 = clamp(base, vec2(0.0), vec2(uTerrainTexSize - 1.0));
    vec2 i10 = clamp(base + vec2(1.0, 0.0), vec2(0.0), vec2(uTerrainTexSize - 1.0));
    vec2 i01 = clamp(base + vec2(0.0, 1.0), vec2(0.0), vec2(uTerrainTexSize - 1.0));
    vec2 i11 = clamp(base + vec2(1.0, 1.0), vec2(0.0), vec2(uTerrainTexSize - 1.0));
    vec4 t00 = texture2D(uTerrainColliderTex, (i00 + 0.5) / uTerrainTexSize);
    vec4 t10 = texture2D(uTerrainColliderTex, (i10 + 0.5) / uTerrainTexSize);
    vec4 t01 = texture2D(uTerrainColliderTex, (i01 + 0.5) / uTerrainTexSize);
    vec4 t11 = texture2D(uTerrainColliderTex, (i11 + 0.5) / uTerrainTexSize);
    float h00 = (t00.r * 255.0 * 256.0 + t00.g * 255.0) / 65535.0;
    float h10 = (t10.r * 255.0 * 256.0 + t10.g * 255.0) / 65535.0;
    float h01 = (t01.r * 255.0 * 256.0 + t01.g * 255.0) / 65535.0;
    float h11 = (t11.r * 255.0 * 256.0 + t11.g * 255.0) / 65535.0;
    float h = mix(mix(h00, h10, f.x), mix(h01, h11, f.x), f.y);
    vec2 g = mix(mix(t00.ba, t10.ba, f.x), mix(t01.ba, t11.ba, f.x), f.y) * 2.0 - 1.0;
    return vec3((h * 2.0 - 1.0) * uTerrainHeightWorld, g * uTerrainGradScale);
  }

  void main() {
    vec4 posData = texture2D(uPosTex, vUv);
    vec3 vel = texture2D(uVelTex, vUv).xyz;
    float age = posData.w;
    vec4 prev = texture2D(uPrevTex, vUv);
    float prevHits = prev.r;
    float prevAge = prev.b;

    // Parked particles (spawn gate / live true-kill park
    // form) return before the position tail, so they never
    // contact: carry the count frozen, hit = 0.
    if (posData.y < -90000.0) {
      gl_FragColor = vec4(prevHits, 0.0, age, 0.0);
      return;
    }

    // The position pass's Euler integration, verbatim (the
    // Verlet branch is a suppression configuration — the
    // replay never runs under it).
    vec3 pos = posData.xyz + vel * uDelta * uSpeed * 60.0;

    // The five contact judgments, in the position tail's
    // order, with its local push-outs (later judgments see
    // the pushed position, exactly as there).
    bool contact = false;

    float dist = length(pos);
    if (dist > uBounceRadius * 1.05) {
      pos = normalize(pos) * uBounceRadius * 1.05;
      contact = true;
    }

    // SDF Collider — position push-out
    if (uSdfEnabled) {
      vec3 sc = vec3(uSdfX, uSdfY, uSdfZ);
      float sd; vec3 sn;
      if (uSdfShape == 0) {
        sd = length(pos - sc) - uSdfSize;
        sn = normalize(pos - sc + vec3(0.0001));
      } else if (uSdfShape == 1) {
        vec3 q = abs(pos - sc) - vec3(uSdfSize);
        sd = length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
        vec3 dq = pos - sc; vec3 aq = abs(dq); vec3 dd = aq - vec3(uSdfSize);
        if (max(dd.x, max(dd.y, dd.z)) > 0.0) sn = normalize(max(dd, 0.0) * sign(dq));
        else if (dd.x > dd.y && dd.x > dd.z) sn = vec3(sign(dq.x), 0.0, 0.0);
        else if (dd.y > dd.z) sn = vec3(0.0, sign(dq.y), 0.0);
        else sn = vec3(0.0, 0.0, sign(dq.z));
      } else if (uSdfShape == 2) {
        vec3 lp = pos - sc; float r2 = uSdfSize * 0.35;
        float ringD = length(lp.xz) - uSdfSize;
        sd = length(vec2(ringD, lp.y)) - r2;
        float lxz = length(lp.xz) + 0.001;
        sn = normalize(vec3(lp.x / lxz * ringD, lp.y, lp.z / lxz * ringD));
      } else if (uSdfShape == 4) {
        sd = gyroidField(pos, sc, uSdfSize) * uSdfSize * 0.227;
        sn = gyroidNormal(pos, sc, uSdfSize);
      } else {
        float yc = clamp(pos.y - sc.y, -uSdfSize, uSdfSize);
        vec3 dp = vec3(pos.x - sc.x, pos.y - sc.y - yc, pos.z - sc.z);
        sd = length(dp) - uSdfSize * 0.4;
        sn = normalize(dp + vec3(0.0001));
      }
      if (sd < 0.0) {
        pos -= sn * sd;
        contact = true;
      }
    }

    // Mesh SDF Collider (Phase BY) — position push-out.
    if (uMeshSdfEnabled) {
      float msd = meshSdfDistance(pos);
      if (msd < 0.0) {
        pos -= meshSdfNormal(pos) * msd;
        contact = true;
      }
    }

    // Floor clamp (B3).
    if (uFloorEnabled && pos.y < uFloorY) {
      pos.y = uFloorY + (uFloorY - pos.y) * 0.1;
      contact = true;
    }

    // Terrain clamp (Phase AI).
    if (uTerrainColliderEnabled) {
      vec2 tcUv = pos.xz / (2.0 * max(uTerrainExtent, 0.001)) + 0.5;
      if (tcUv.x >= 0.0 && tcUv.x <= 1.0 && tcUv.y >= 0.0 && tcUv.y <= 1.0) {
        float tcH = terrainColliderSample(tcUv).x;
        if (pos.y < tcH) {
          pos.y = tcH;
          contact = true;
        }
      }
    }

    // Accumulation: an age drop against the previous step's
    // stored age means the particle respawned during the
    // previous position step — the count restarts from this
    // step's contact. Saturates at 255 (the fixed plan).
    float base = (uContactReset > 0.5 || age < prevAge - 0.001) ? 0.0 : prevHits;
    float hits = min(base + (contact ? 1.0 : 0.0), 255.0);
    gl_FragColor = vec4(hits, contact ? 1.0 : 0.0, age, 0.0);
  }
`;

/** The solver resolutions under which the replay is unfaithful. */
export interface ContactReplayResolution {
  /** Verlet integration replaces the Euler step. */
  verletEnabled: boolean;
  /** Grains position projection pre-corrects the tail input. */
  grainsProjection: boolean;
  /** Vellum solver owns the lifecycle (fixed plan, slice 1B). */
  vellum: boolean;
  /** Rigid bodies replace the position step outright. */
  rigid: boolean;
}

/**
 * Is the contact replay faithful for this resolution? Only
 * the plain Euler position step replays exactly; each named
 * solver replaces or pre-corrects it. While this is false
 * the runner suppresses the pass and hit / hits read 0.
 */
export function contactReplayEnabled(resolution: ContactReplayResolution): boolean {
  return !resolution.verletEnabled
    && !resolution.grainsProjection
    && !resolution.vellum
    && !resolution.rigid;
}

/** One particle's contact record (the contact target's .r/.g/.b). */
export interface ContactRecord {
  hits: number;
  hit: number;
  prevAge: number;
}

/**
 * CPU twin of one contact step (the fragment's accumulation
 * semantics, for tests / editor照合): parked particles
 * carry the count frozen with hit = 0; a forced reset or an
 * age drop restarts the count from this step's contact;
 * the count saturates at 255.
 */
export function contactStepTwin(
  prev: ContactRecord,
  input: { contact: boolean; age: number; parked?: boolean; reset?: boolean },
): ContactRecord {
  if (input.parked) {
    return { hits: prev.hits, hit: 0, prevAge: input.age };
  }
  const base = input.reset || input.age < prev.prevAge - 0.001 ? 0 : prev.hits;
  return {
    hits: Math.min(base + (input.contact ? 1 : 0), 255),
    hit: input.contact ? 1 : 0,
    prevAge: input.age,
  };
}

export interface GpgpuContactBindings {
  /** Frame-start position target texture (posIn). */
  posTex: THREE.Texture;
  /** This frame's velocity output texture (velOut). */
  velTex: THREE.Texture;
  delta: number;
  speed: number;
  bounceRadius: number;
  /** Analytic SDF collider bundle (the position pass's own
   *  resolved values). Null = collider off. */
  sdf?: {
    enabled: boolean;
    shape: number;
    x: number;
    y: number;
    z: number;
    size: number;
  } | null;
  /** Mesh SDF bundle, resolved exactly as the position
   *  material's. Null = collider off / not baked. */
  meshSdf?: {
    texture: THREE.Texture;
    origin: THREE.Vector3;
    domainWorld: number;
    scale: number;
    voxelWorld: number;
  } | null;
  floor?: { enabled: boolean; y: number } | null;
  /** Terrain collider bundle, resolved exactly as the
   *  position material's. Null = collider off. */
  terrain?: {
    texture: THREE.Texture;
    extent: number;
    heightWorld: number;
    gradScale: number;
    texSize: number;
  } | null;
}

function makeTarget(texSize: number): THREE.WebGLRenderTarget {
  return new THREE.WebGLRenderTarget(texSize, texSize, {
    type: THREE.FloatType,
    format: THREE.RGBAFormat,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    depthBuffer: false,
    stencilBuffer: false,
  });
}

export class GpgpuContactPass {
  private rtA: THREE.WebGLRenderTarget;
  private rtB: THREE.WebGLRenderTarget;
  private mat: THREE.ShaderMaterial;
  private initMat: THREE.ShaderMaterial;
  private scene = new THREE.Scene();
  private cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private geo: THREE.PlaneGeometry;
  private mesh: THREE.Mesh;
  /** The target holding the latest step's record. */
  private current: THREE.WebGLRenderTarget;
  private initialised = false;
  /** While suppressed the REP reads the zero texture. */
  private suppressed = false;
  /** The next run restarts the accumulation (first run, or
   *  the first run after a reset / suppression). */
  private stale = true;
  private zeroTex: THREE.DataTexture;

  constructor(texSize: number) {
    this.rtA = makeTarget(texSize);
    this.rtB = makeTarget(texSize);
    this.current = this.rtA;
    this.zeroTex = new THREE.DataTexture(new Float32Array(4), 1, 1, THREE.RGBAFormat, THREE.FloatType);
    this.zeroTex.minFilter = THREE.NearestFilter;
    this.zeroTex.magFilter = THREE.NearestFilter;
    this.zeroTex.needsUpdate = true;
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uPosTex: { value: null as THREE.Texture | null },
        uVelTex: { value: null as THREE.Texture | null },
        uPrevTex: { value: null as THREE.Texture | null },
        uDelta: { value: 0 },
        uSpeed: { value: 1 },
        uBounceRadius: { value: 1 },
        uContactReset: { value: 1 },
        uSdfEnabled: { value: false },
        uSdfShape: { value: 0 },
        uSdfX: { value: 0 },
        uSdfY: { value: 0 },
        uSdfZ: { value: 0 },
        uSdfSize: { value: 0 },
        uMeshSdfEnabled: { value: false },
        uMeshSdfTex: { value: null as THREE.Texture | null },
        uMeshSdfOrigin: { value: new THREE.Vector3() },
        uMeshSdfDomainWorld: { value: 1 },
        uMeshSdfScale: { value: 0 },
        uMeshSdfVoxelWorld: { value: 0 },
        uFloorEnabled: { value: false },
        uFloorY: { value: 0 },
        uTerrainColliderEnabled: { value: false },
        uTerrainColliderTex: { value: null as THREE.Texture | null },
        uTerrainExtent: { value: 1 },
        uTerrainHeightWorld: { value: 0 },
        uTerrainGradScale: { value: 0 },
        uTerrainTexSize: { value: 1 },
      },
      vertexShader: CONTACT_VERT,
      fragmentShader: CONTACT_FRAG,
      depthTest: false,
      depthWrite: false,
    });
    this.initMat = new THREE.ShaderMaterial({
      uniforms: {},
      vertexShader: CONTACT_VERT,
      fragmentShader: CONTACT_INIT_FRAG,
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

  /** Zero both targets; the next run restarts the count. */
  reset(gl: THREE.WebGLRenderer): void {
    this.renderTo(gl, this.rtA, this.initMat);
    this.renderTo(gl, this.rtB, this.initMat);
    this.current = this.rtA;
    this.initialised = true;
    this.suppressed = false;
    this.stale = true;
  }

  /**
   * The texture the REP binds: the latest step's record, or
   * the zero texture while suppressed (hit / hits read 0 —
   * the fixed solver-configuration semantics).
   */
  get texture(): THREE.Texture {
    return this.suppressed ? this.zeroTex : this.current.texture;
  }

  /** Gate measurement support (2026-11-27 re-gate): the render
   *  target holding the latest step's record, for the ?diag=1
   *  hook's readback. Mirrors GpgpuRuleEvalPass.currentTarget. */
  get currentTarget(): THREE.WebGLRenderTarget {
    return this.current;
  }

  /** Whether the pass is currently suppressed (the REP then
   *  binds the zero texture; hit / hits read 0). */
  get isSuppressed(): boolean {
    return this.suppressed;
  }

  /** Mark the pass suppressed (a solver configuration the
   *  replay cannot mirror). No GPU work; the accumulation
   *  restarts on the next run. */
  suppress(): void {
    this.suppressed = true;
    this.stale = true;
  }

  /**
   * Replay one position step: read the previous record,
   * write the other target, and return the texture holding
   * the new record.
   */
  run(gl: THREE.WebGLRenderer, bindings: GpgpuContactBindings): THREE.Texture {
    if (!this.initialised) this.reset(gl);
    const read = this.current;
    const write = read === this.rtA ? this.rtB : this.rtA;
    const u = this.mat.uniforms;
    u.uPosTex.value = bindings.posTex;
    u.uVelTex.value = bindings.velTex;
    u.uDelta.value = bindings.delta;
    u.uSpeed.value = bindings.speed;
    u.uBounceRadius.value = bindings.bounceRadius;
    u.uContactReset.value = this.stale ? 1 : 0;
    if (bindings.sdf) {
      u.uSdfEnabled.value = bindings.sdf.enabled;
      u.uSdfShape.value = bindings.sdf.shape;
      u.uSdfX.value = bindings.sdf.x;
      u.uSdfY.value = bindings.sdf.y;
      u.uSdfZ.value = bindings.sdf.z;
      u.uSdfSize.value = bindings.sdf.size;
    } else {
      u.uSdfEnabled.value = false;
    }
    if (bindings.meshSdf) {
      u.uMeshSdfEnabled.value = true;
      u.uMeshSdfTex.value = bindings.meshSdf.texture;
      (u.uMeshSdfOrigin.value as THREE.Vector3).copy(bindings.meshSdf.origin);
      u.uMeshSdfDomainWorld.value = bindings.meshSdf.domainWorld;
      u.uMeshSdfScale.value = bindings.meshSdf.scale;
      u.uMeshSdfVoxelWorld.value = bindings.meshSdf.voxelWorld;
    } else {
      u.uMeshSdfEnabled.value = false;
      u.uMeshSdfTex.value = null;
    }
    if (bindings.floor) {
      u.uFloorEnabled.value = bindings.floor.enabled;
      u.uFloorY.value = bindings.floor.y;
    } else {
      u.uFloorEnabled.value = false;
    }
    if (bindings.terrain) {
      u.uTerrainColliderEnabled.value = true;
      u.uTerrainColliderTex.value = bindings.terrain.texture;
      u.uTerrainExtent.value = bindings.terrain.extent;
      u.uTerrainHeightWorld.value = bindings.terrain.heightWorld;
      u.uTerrainGradScale.value = bindings.terrain.gradScale;
      u.uTerrainTexSize.value = bindings.terrain.texSize;
    } else {
      u.uTerrainColliderEnabled.value = false;
      u.uTerrainColliderTex.value = null;
    }
    u.uPrevTex.value = read.texture;
    this.renderTo(gl, write, this.mat);
    this.current = write;
    this.suppressed = false;
    this.stale = false;
    return write.texture;
  }

  dispose(): void {
    this.rtA.dispose();
    this.rtB.dispose();
    this.mat.dispose();
    this.initMat.dispose();
    this.geo.dispose();
    this.zeroTex.dispose();
  }
}
