import * as THREE from "three";
import type { ParticleConfig } from "../types";

export function makeRT(size: number): THREE.WebGLRenderTarget {
  return new THREE.WebGLRenderTarget(size, size, {
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    format: THREE.RGBAFormat,
    type: THREE.FloatType,
    depthBuffer: false,
    stencilBuffer: false,
  });
}

export type UseGpgpuAssetsArgs = {
  config: ParticleConfig;
  texSize: number;
  simScene: THREE.Scene;
  simGeo: THREE.PlaneGeometry;
};
