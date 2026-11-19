// Phase CA: capability gate for the Pyro grid solver. The grid's
// render targets need float colour buffers (RGBA32F / R32F), and
// the fast sampling path needs linear filtering of float textures.
// Diagnostics are collected exactly once, on first request, through
// the same collectGpuDiagnostics() the Play-tab panel uses; until
// the result lands the support state stays 'unknown' and the
// runtime keeps the grid unallocated (the solver simply does not
// exist yet — identical to disabled). Consumers subscribe instead
// of polling.

import { collectGpuDiagnostics } from './gpuDiagnostics';

export type PyroGridSupport = {
  status: 'unknown' | 'ready';
  // EXT_color_buffer_float (or equivalent) — required to render
  // into the grid targets at all.
  colorBufferFloat: boolean;
  // OES_texture_float_linear — selects the hardware trilinear path;
  // without it the shaders fall back to manual 8-tap trilinear.
  floatLinearFiltering: boolean;
};

let support: PyroGridSupport = {
  status: 'unknown',
  colorBufferFloat: false,
  floatLinearFiltering: false,
};

let started = false;
const listeners = new Set<() => void>();

export function getPyroGridSupport(): PyroGridSupport {
  return support;
}

export function subscribePyroGridSupport(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function ensurePyroGridSupport(): void {
  if (started) return;
  started = true;
  void collectGpuDiagnostics()
    .then((diag) => {
      support = {
        status: 'ready',
        colorBufferFloat: diag.colorBufferFloat === true,
        floatLinearFiltering: diag.floatLinearFiltering === true,
      };
    })
    .catch(() => {
      // Diagnostics failed: report ready-but-unsupported so the
      // grid stays off instead of retrying forever.
      support = { status: 'ready', colorBufferFloat: false, floatLinearFiltering: false };
    })
    .finally(() => {
      for (const listener of Array.from(listeners)) listener();
    });
}
