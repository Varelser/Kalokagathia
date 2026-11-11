import { useSyncExternalStore } from 'react';
import { getGpuTierInfo, subscribeGpuTier, type GpuTierInfo } from './gpuTier';

/** React binding for the GPU tier store (lib/gpuTier.ts). */
export function useGpuTierInfo(): GpuTierInfo {
  return useSyncExternalStore(subscribeGpuTier, getGpuTierInfo, getGpuTierInfo);
}
