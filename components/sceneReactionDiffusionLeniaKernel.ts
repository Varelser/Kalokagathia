import * as THREE from 'three';

export type LeniaKernelPreset = 'ring' | 'double' | 'blob';
export const LENIA_KERNEL_SIZE = 31;
export const LENIA_KERNEL_RADIUS = 15;

/**
 * Build the Lenia convolution kernel as a 31x31 DataTexture.
 * Weights are generated from (preset, radius): radius scales the kernel
 * within the fixed 31x31 window. Weights are normalised to sum 1 on CPU.
 * Stored in R channel (RGBA Float for portability).
 */
export function buildLeniaKernelTexture(preset: LeniaKernelPreset, radius: number): THREE.DataTexture {
  const size = LENIA_KERNEL_SIZE;
  const half = LENIA_KERNEL_RADIUS;
  const R = Math.max(1, radius);
  const raw = new Float32Array(size * size);
  let sum = 0;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = x - half;
      const dy = y - half;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const r = dist / R; // 0 at centre, 1 at kernel edge
      let w = 0;
      if (r <= 1) {
        if (preset === 'ring') {
          // Classic Lenia single ring: Gaussian bump peaked at r=0.5
          const d = (r - 0.5) / 0.15;
          w = Math.exp(-(d * d) / 2);
        } else if (preset === 'double') {
          const d1 = (r - 0.35) / 0.12;
          const d2 = (r - 0.75) / 0.12;
          w = Math.exp(-(d1 * d1) / 2) + 0.7 * Math.exp(-(d2 * d2) / 2);
        } else {
          // blob: plain Gaussian disk
          const d = r / 0.4;
          w = Math.exp(-(d * d) / 2);
        }
      }
      raw[y * size + x] = w;
      sum += w;
    }
  }
  const data = new Float32Array(size * size * 4);
  const inv = sum > 0 ? 1 / sum : 0;
  for (let i = 0; i < size * size; i += 1) {
    data[i * 4 + 0] = raw[i] * inv;
    data[i * 4 + 1] = 0;
    data[i * 4 + 2] = 0;
    data[i * 4 + 3] = 1;
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.FloatType);
  tex.needsUpdate = true;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.minFilter = tex.magFilter = THREE.NearestFilter;
  return tex;
}
