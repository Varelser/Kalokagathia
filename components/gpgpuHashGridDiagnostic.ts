// Hash-grid diagnostic sampler (Phase DM gate support) — evaluates
// the production position-pass hash1 over a full G x G grid of texel
// centres and reads the values back synchronously, so the DM gate
// can compare the old and new hash families statistically on the
// real GPU (256-bin histogram / chi-square, duplicate count, lag-1
// autocorrelation). The hash1 body below is a verbatim copy of the
// production definition in gpgpuShaderSimulationPosition.ts; the
// gate's old-family build carries the pre-DM body in this same file.
//
// Isolation contract (same as DA3 path B): the only entry point is
// the window hook registered by sceneGpgpuSystem when the page URL
// carries ?diag=1; without that parameter nothing here is
// constructed. Renderer state (target, clear color) is saved and
// restored around the offscreen pass.

import * as THREE from 'three';

const HASH_GRID_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const HASH_GRID_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
float dmHash11(float n) {
  vec3 p3 = fract(vec3(n) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float hash1(vec2 p) {
  return dmHash11(p.x * 127.1 + p.y * 311.7);
}
void main() {
  gl_FragColor = vec4(hash1(vUv), 0.0, 0.0, 1.0);
}
`;

export interface HashGridStats {
  /** Storage the values were read back through: 'float' (full
   *  precision) or 'byte' (8-bit quantized; used on stacks without
   *  float-render-target readback, e.g. SwiftShader, for the
   *  cross-vendor shape check). */
  storage?: 'float' | 'byte';
  gridSize: number;
  n: number;
  /** 256-bin histogram over [0, 1). */
  bins: number[];
  /** Chi-square against the uniform expectation, df = 255. */
  chi2: number;
  /** Number of values whose exact bit pattern occurs more than once. */
  duplicateValues: number;
  /** Lag-1 autocorrelation along x (row-major neighbours). */
  lag1rX: number;
  /** Lag-1 autocorrelation along y (column neighbours). */
  lag1rY: number;
  /** max(|lag1rX|, |lag1rY|) — the grid's value per the DM judgment. */
  lag1Abs: number;
  min: number;
  max: number;
}

export class HashGridSampler {
  private geo: THREE.BufferGeometry;
  private mat: THREE.ShaderMaterial;
  private mesh: THREE.Mesh;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private rt: THREE.WebGLRenderTarget | null = null;
  private rtSize = 0;
  private rtType: THREE.TextureDataType = THREE.FloatType;

  constructor() {
    // Fullscreen triangle.
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3),
    );
    this.mat = new THREE.ShaderMaterial({
      vertexShader: HASH_GRID_VERT,
      fragmentShader: HASH_GRID_FRAG,
      depthTest: false,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
  }

  sample(gl: THREE.WebGLRenderer, gridSize: number): HashGridStats {
    return this.sampleTyped(gl, gridSize, 'float');
  }

  /** Byte-storage variant for stacks where float render targets
   *  cannot be read back (SwiftShader): the hash is still computed
   *  in-shader at full precision; only the storage is quantized. */
  sampleBytes(gl: THREE.WebGLRenderer, gridSize: number): HashGridStats {
    return this.sampleTyped(gl, gridSize, 'byte');
  }

  private sampleTyped(gl: THREE.WebGLRenderer, gridSize: number, storage: 'float' | 'byte'): HashGridStats {
    const wantType = storage === 'float' ? THREE.FloatType : THREE.UnsignedByteType;
    if (!this.rt || this.rtSize !== gridSize || this.rtType !== wantType) {
      this.rt?.dispose();
      this.rt = new THREE.WebGLRenderTarget(gridSize, gridSize, {
        type: wantType,
        format: THREE.RGBAFormat,
        minFilter: THREE.NearestFilter,
        magFilter: THREE.NearestFilter,
        depthBuffer: false,
        stencilBuffer: false,
      });
      this.rtSize = gridSize;
      this.rtType = wantType;
    }
    const prevTarget = gl.getRenderTarget();
    const prevClear = new THREE.Color();
    gl.getClearColor(prevClear);
    const prevClearAlpha = gl.getClearAlpha();
    const raw: Float32Array | Uint8Array = storage === 'float'
      ? new Float32Array(gridSize * gridSize * 4)
      : new Uint8Array(gridSize * gridSize * 4);
    try {
      gl.setRenderTarget(this.rt);
      gl.setClearColor(0x000000, 1);
      gl.clear(true, false, false);
      gl.render(this.scene, this.camera);
      gl.readRenderTargetPixels(this.rt, 0, 0, gridSize, gridSize, raw);
    } finally {
      gl.setRenderTarget(prevTarget);
      gl.setClearColor(prevClear, prevClearAlpha);
    }
    const buf = new Float32Array(gridSize * gridSize * 4);
    if (storage === 'float') {
      buf.set(raw as Float32Array);
    } else {
      const bytes = raw as Uint8Array;
      for (let i = 0; i < buf.length; i++) buf[i] = bytes[i] / 255;
    }
    const n = gridSize * gridSize;
    const bins = new Array<number>(256).fill(0);
    const seen = new Set<number>();
    let duplicates = 0;
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < n; i++) {
      const v = buf[i * 4];
      if (v < min) min = v;
      if (v > max) max = v;
      const b = Math.min(255, Math.max(0, Math.floor(v * 256)));
      bins[b]++;
      const bits = new Uint32Array(new Float32Array([v]).buffer)[0];
      if (seen.has(bits)) duplicates++;
      else seen.add(bits);
    }
    const expected = n / 256;
    let chi2 = 0;
    for (let i = 0; i < 256; i++) {
      const d = bins[i] - expected;
      chi2 += (d * d) / expected;
    }
    // Lag-1 autocorrelation: Pearson over adjacent pairs, measured
    // in both directions; the grid's value is the larger |r|.
    const pearson = (pairs: Array<[number, number]>): number => {
      const m = pairs.length;
      let sx = 0;
      let sy = 0;
      let sxx = 0;
      let syy = 0;
      let sxy = 0;
      for (const [a, b] of pairs) {
        sx += a;
        sy += b;
        sxx += a * a;
        syy += b * b;
        sxy += a * b;
      }
      const cov = sxy / m - (sx / m) * (sy / m);
      const varX = sxx / m - (sx / m) * (sx / m);
      const varY = syy / m - (sy / m) * (sy / m);
      return varX > 0 && varY > 0 ? cov / Math.sqrt(varX * varY) : 0;
    };
    const pairsX: Array<[number, number]> = [];
    const pairsY: Array<[number, number]> = [];
    for (let y = 0; y < gridSize; y++) {
      for (let x = 0; x < gridSize; x++) {
        const i = y * gridSize + x;
        if (x !== gridSize - 1) pairsX.push([buf[i * 4], buf[(i + 1) * 4]]);
        if (y !== gridSize - 1) pairsY.push([buf[i * 4], buf[(i + gridSize) * 4]]);
      }
    }
    const lag1rX = pearson(pairsX);
    const lag1rY = pearson(pairsY);
    const lag1Abs = Math.max(Math.abs(lag1rX), Math.abs(lag1rY));
    return { gridSize, n, bins, chi2, duplicateValues: duplicates, lag1rX, lag1rY, lag1Abs, min, max, storage };
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
    this.rt?.dispose();
  }
}
