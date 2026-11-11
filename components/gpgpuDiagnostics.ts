import type { MutableRefObject, RefObject } from 'react';
import * as THREE from 'three';
import type { GpgpuFrameRouting } from './gpgpuExecutionRouting';

export type GpgpuFrameDiagnosticSnapshot = {
  backend: string;
  requestedBackend: string;
  path: string;
  reason: string;
  capabilityFlags: string[];
  notes: string[];
  features: string[];
  unsupportedFeatures: string[];
  readbackMode: GpgpuFrameRouting['readbackMode'];
};

export function createGpgpuFrameDiagnosticSnapshot(
  routing: GpgpuFrameRouting,
): GpgpuFrameDiagnosticSnapshot {
  return {
    backend: routing.execution.resolvedEngine,
    requestedBackend: routing.execution.requestedEngine,
    path: routing.execution.path,
    reason: routing.execution.reason,
    capabilityFlags: routing.execution.capabilityFlags,
    notes: routing.execution.notes,
    features: routing.foundation.features,
    unsupportedFeatures: routing.foundation.unsupportedFeatures,
    readbackMode: routing.readbackMode,
  };
}

export function readbackParticlePositions(args: {
  routing: GpgpuFrameRouting;
  gl: THREE.WebGLRenderer;
  posOut: THREE.WebGLRenderTarget;
  texSize: number;
  posReadbackRef?: RefObject<Float32Array | null>;
  /** Serve a one-shot capture (point-cloud export) even when the
   *  continuous readback mode is off. WebGPU frames are exempt: their
   *  positions do not pass through this WebGL target. */
  force?: boolean;
}): void {
  const { routing, gl, posOut, texSize, posReadbackRef, force } = args;
  if (!posReadbackRef) return;
  if (routing.readbackMode !== 'webgl-readback' && !(force && routing.readbackMode !== 'webgpu-skip')) return;

  const count = texSize * texSize;
  if (!posReadbackRef.current || posReadbackRef.current.length !== count * 4) {
    (posReadbackRef as MutableRefObject<Float32Array | null>).current = new Float32Array(count * 4);
  }
  gl.readRenderTargetPixels(posOut, 0, 0, texSize, texSize, posReadbackRef.current!);
}
