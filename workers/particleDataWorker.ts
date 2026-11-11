// workers/particleDataWorker.ts
// Runs generateParticleData in a dedicated Worker thread to avoid blocking main thread.
// Vite handles bundling via the `?worker` import suffix.

import { generateParticleData } from '../components/particleData';
import type { ParticleConfig } from '../types';
import type { AuxMode } from '../components/particleData';

interface WorkerRequest {
  id: number;
  config: ParticleConfig;
  layerIndex: 1 | 2 | 3 | 4;
  isAux: boolean;
  auxMode: AuxMode;
}

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const { id, config, layerIndex, isAux, auxMode } = e.data;
  const data = generateParticleData(config, layerIndex, isAux, auxMode);
  if (data) {
    // Transfer ArrayBuffers zero-copy back to main thread
    (self as unknown as Worker).postMessage(
      { id, data },
      [data.pos.buffer, data.off.buffer, data.d1.buffer, data.d2.buffer, data.d3.buffer],
    );
  } else {
    (self as unknown as Worker).postMessage({ id, data: null });
  }
};
