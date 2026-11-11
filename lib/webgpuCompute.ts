// lib/webgpuCompute.ts
// WebGPU Compute Pipeline for GPGPU particle simulation.
// Replaces the fragment-shader ping-pong FBO with native GPU compute shaders (WGSL).
// Results are read back to CPU and uploaded to THREE.DataTexture each frame.

const VEL_WGSL = /* wgsl */ `
struct Uniforms {
  texSize : u32,
  delta   : f32,
  time    : f32,
  gravity : f32,
  turbulence : f32,
  bounceRadius : f32,
  bounce : f32,
  speed  : f32,
};

@group(0) @binding(0) var<uniform> u : Uniforms;
@group(0) @binding(1) var<storage, read>       posIn  : array<vec4f>;
@group(0) @binding(2) var<storage, read>       velIn  : array<vec4f>;
@group(0) @binding(3) var<storage, read_write> velOut : array<vec4f>;

fn hash3(p: vec3f) -> vec3f {
  var q = vec3f(dot(p, vec3f(127.1, 311.7, 74.7)),
                dot(p, vec3f(269.5, 183.3, 246.1)),
                dot(p, vec3f(113.5, 271.9, 124.6)));
  return fract(sin(q) * 43758.5453) * 2.0 - 1.0;
}
fn vnoise(p: vec3f) -> f32 {
  let i = floor(p); let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(dot(hash3(i),f),
                     dot(hash3(i+vec3f(1,0,0)),f-vec3f(1,0,0)),u.x),
                 mix(dot(hash3(i+vec3f(0,1,0)),f-vec3f(0,1,0)),
                     dot(hash3(i+vec3f(1,1,0)),f-vec3f(1,1,0)),u.x),u.y),
             mix(mix(dot(hash3(i+vec3f(0,0,1)),f-vec3f(0,0,1)),
                     dot(hash3(i+vec3f(1,0,1)),f-vec3f(1,0,1)),u.x),
                 mix(dot(hash3(i+vec3f(0,1,1)),f-vec3f(0,1,1)),
                     dot(hash3(i+vec3f(1,1,1)),f-vec3f(1,1,1)),u.x),u.y),u.z);
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let idx = gid.x;
  if (idx >= u.texSize * u.texSize) { return; }
  var pos = posIn[idx].xyz;
  var vel = velIn[idx].xyz;

  vel.y -= u.gravity * u.delta * 9.8;

  if (u.turbulence > 0.001) {
    let t = u.time * 0.25;
    let np = pos * 0.007;
    vel += vec3f(vnoise(np+vec3f(t,0,0)),
                 vnoise(np+vec3f(0,t+13.7,0)),
                 vnoise(np+vec3f(0,0,t+27.4))) * u.turbulence * 18.0 * u.delta;
  }

  let spd = length(vel);
  if (spd > 350.0) { vel *= 350.0 / spd; }
  vel *= (1.0 - 1.1 * u.delta);

  let dist = length(pos);
  if (dist > u.bounceRadius) {
    let n = pos / dist;
    let vn = dot(vel, n);
    if (vn > 0.0) { vel -= n * vn * (1.0 + u.bounce); }
  }
  velOut[idx] = vec4f(vel, 0.0);
}
`;

const POS_WGSL = /* wgsl */ `
struct Uniforms {
  texSize : u32,
  delta   : f32,
  speed   : f32,
  bounceRadius : f32,
};
@group(0) @binding(0) var<uniform>             u      : Uniforms;
@group(0) @binding(1) var<storage, read>       posIn  : array<vec4f>;
@group(0) @binding(2) var<storage, read>       velIn  : array<vec4f>;
@group(0) @binding(3) var<storage, read_write> posOut : array<vec4f>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let idx = gid.x;
  if (idx >= u.texSize * u.texSize) { return; }
  var pos = posIn[idx].xyz;
  let age = posIn[idx].w;
  let vel = velIn[idx].xyz;
  pos += vel * u.delta * u.speed * 60.0;
  let dist = length(pos);
  if (dist > u.bounceRadius * 1.05) { pos = normalize(pos) * u.bounceRadius * 1.05; }
  posOut[idx] = vec4f(pos, age);
}
`;

export type WebGPUComputeState = {
  device: GPUDevice;
  velPipeline: GPUComputePipeline;
  posPipeline: GPUComputePipeline;
  posABuf: GPUBuffer;
  posBBuf: GPUBuffer;
  velABuf: GPUBuffer;
  velBBuf: GPUBuffer;
  velUBuf: GPUBuffer;
  posUBuf: GPUBuffer;
  stagingBuf: GPUBuffer;
  texSize: number;
  /** 事前確保済みuniformバッファ（毎フレームの new Float32Array を避ける） */
  velUData: Float32Array<ArrayBuffer>;
  posUData: Float32Array<ArrayBuffer>;
  /** stagingBuf への readback mapAsync が未解決の間は true */
  readbackPending: boolean;
};

export async function initWebGPUCompute(
  texSize: number,
  initialPos: Float32Array,
  initialVel: Float32Array,
): Promise<WebGPUComputeState | null> {
  if (!navigator.gpu) return null;
  let adapter: GPUAdapter | null;
  try {
    adapter = await navigator.gpu.requestAdapter();
    if (!adapter) return null;
  } catch { return null; }
  const device = await adapter.requestDevice();

  const N = texSize * texSize;
  const byteSize = N * 4 * 4; // N * vec4f * 4 bytes

  const bufOpts: GPUBufferDescriptor = {
    size: byteSize,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
  };
  const posABuf = device.createBuffer(bufOpts);
  const posBBuf = device.createBuffer(bufOpts);
  const velABuf = device.createBuffer(bufOpts);
  const velBBuf = device.createBuffer(bufOpts);

  device.queue.writeBuffer(posABuf, 0, initialPos.buffer as ArrayBuffer, initialPos.byteOffset, initialPos.byteLength);
  device.queue.writeBuffer(velABuf, 0, initialVel.buffer as ArrayBuffer, initialVel.byteOffset, initialVel.byteLength);

  const stagingBuf = device.createBuffer({
    size: byteSize,
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
  });

  // Uniform buffers (2×32 bytes)
  const velUBuf = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const posUBuf = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

  const velModule = device.createShaderModule({ code: VEL_WGSL });
  const posModule = device.createShaderModule({ code: POS_WGSL });

  const velBGL = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
    ],
  });
  const posBGL = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
    ],
  });

  const velPipeline = device.createComputePipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [velBGL] }),
    compute: { module: velModule, entryPoint: 'main' },
  });
  const posPipeline = device.createComputePipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [posBGL] }),
    compute: { module: posModule, entryPoint: 'main' },
  });

  const velUData = new Float32Array(new ArrayBuffer(32)); // [texSize, delta, time, gravity, turbulence, bounceRadius, bounce, speed]
  const posUData = new Float32Array(new ArrayBuffer(16)); // [texSize, delta, speed, bounceRadius]

  return { device, velPipeline, posPipeline, posABuf, posBBuf, velABuf, velBBuf, velUBuf, posUBuf, stagingBuf, texSize, velUData, posUData, readbackPending: false };
}

export function stepWebGPUCompute(
  state: WebGPUComputeState,
  pingIsA: boolean,
  delta: number,
  time: number,
  gravity: number,
  turbulence: number,
  bounceRadius: number,
  bounce: number,
  speed: number,
): void {
  const { device, velPipeline, posPipeline, posABuf, posBBuf, velABuf, velBBuf, velUBuf, posUBuf, texSize } = state;
  const N = texSize * texSize;

  const posIn  = pingIsA ? posABuf : posBBuf;
  const posOut = pingIsA ? posBBuf : posABuf;
  const velIn  = pingIsA ? velABuf : velBBuf;
  const velOut = pingIsA ? velBBuf : velABuf;

  // Write vel uniforms into pre-allocated buffer (no new Float32Array per frame)
  const velU = state.velUData;
  velU[1] = delta; velU[2] = time; velU[3] = gravity;
  velU[4] = turbulence; velU[5] = bounceRadius; velU[6] = bounce; velU[7] = speed;
  new Uint32Array(velU.buffer)[0] = texSize; // texSizeはu32なのでUint32Arrayビューで書く
  device.queue.writeBuffer(velUBuf, 0, velU);

  // Write pos uniforms into pre-allocated buffer
  const posU = state.posUData;
  posU[1] = delta; posU[2] = speed; posU[3] = bounceRadius;
  new Uint32Array(posU.buffer)[0] = texSize;
  device.queue.writeBuffer(posUBuf, 0, posU);

  const enc = device.createCommandEncoder();

  // Velocity pass
  const velBG = device.createBindGroup({
    layout: velPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: velUBuf } },
      { binding: 1, resource: { buffer: posIn } },
      { binding: 2, resource: { buffer: velIn } },
      { binding: 3, resource: { buffer: velOut } },
    ],
  });
  const velPass = enc.beginComputePass();
  velPass.setPipeline(velPipeline);
  velPass.setBindGroup(0, velBG);
  velPass.dispatchWorkgroups(Math.ceil(N / 64));
  velPass.end();

  // Position pass
  const posBG = device.createBindGroup({
    layout: posPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: posUBuf } },
      { binding: 1, resource: { buffer: posIn } },
      { binding: 2, resource: { buffer: velOut } },
      { binding: 3, resource: { buffer: posOut } },
    ],
  });
  const posPass = enc.beginComputePass();
  posPass.setPipeline(posPipeline);
  posPass.setBindGroup(0, posBG);
  posPass.dispatchWorkgroups(Math.ceil(N / 64));
  posPass.end();

  // Copy posOut to staging for readback
  // mapAsync が未解決 / mapped の間は stagingBuf を触らない
  if (!state.readbackPending && state.stagingBuf.mapState === 'unmapped') {
    enc.copyBufferToBuffer(posOut, 0, state.stagingBuf, 0, N * 16);
  }
  device.queue.submit([enc.finish()]);
}

/** Async readback of position data. Returns Float32Array (RGBA per particle).
 *  lastResult: 前フレームのデータ。mapAsyncがタイムアウトした場合に返すフォールバック。
 */
export async function readbackWebGPUPositions(
  state: WebGPUComputeState,
  lastResult?: Float32Array,
): Promise<Float32Array> {
  const N = state.texSize * state.texSize;
  const TIMEOUT_MS = 100;
  const fallback = lastResult ?? new Float32Array(N * 4);

  if (state.readbackPending || state.stagingBuf.mapState !== 'unmapped') {
    return fallback;
  }

  state.readbackPending = true;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let timedOut = false;

  const mapPromise = state.stagingBuf.mapAsync(GPUMapMode.READ, 0, N * 16)
    .then(() => {
      if (timedOut) {
        if (state.stagingBuf.mapState === 'mapped') {
          state.stagingBuf.unmap();
        }
        return fallback;
      }

      const range = state.stagingBuf.getMappedRange(0, N * 16);
      const result = new Float32Array(range.slice(0));
      state.stagingBuf.unmap();
      return result;
    })
    .catch(() => fallback)
    .finally(() => {
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
      state.readbackPending = false;
    });

  const timeoutPromise = new Promise<Float32Array>((resolve) => {
    timeoutId = setTimeout(() => {
      timedOut = true;
      resolve(fallback);
    }, TIMEOUT_MS);
  });

  return Promise.race([mapPromise, timeoutPromise]);
}

export function destroyWebGPUCompute(state: WebGPUComputeState): void {
  state.posABuf.destroy();
  state.posBBuf.destroy();
  state.velABuf.destroy();
  state.velBBuf.destroy();
  state.velUBuf.destroy();
  state.posUBuf.destroy();
  state.stagingBuf.destroy();
}
