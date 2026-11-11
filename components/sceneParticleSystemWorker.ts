import { generateParticleData } from './particleData';
import type { AuxMode, ParticleData } from './particleData';
import type { ParticleConfig } from '../types';
import ParticleDataWorker from '../workers/particleDataWorker?worker';

let sharedWorkerInstance: Worker | null = null;
let sharedWorkerRequestId = 0;
const sharedWorkerCallbacks = new Map<number, (data: ParticleData | null) => void>();

function getSharedWorker(): Worker {
  if (!sharedWorkerInstance) {
    sharedWorkerInstance = new ParticleDataWorker();
    sharedWorkerInstance.onmessage = (e: MessageEvent<{ id: number; data: ParticleData | null }>) => {
      const callback = sharedWorkerCallbacks.get(e.data.id);
      if (callback) {
        sharedWorkerCallbacks.delete(e.data.id);
        callback(e.data.data);
      }
    };
  }
  return sharedWorkerInstance;
}

export function generateParticleDataAsync(
  config: ParticleConfig,
  layerIndex: 1 | 2 | 3 | 4,
  isAux: boolean,
  auxMode: AuxMode,
): Promise<ParticleData | null> {
  return new Promise((resolve) => {
    const id = ++sharedWorkerRequestId;
    sharedWorkerCallbacks.set(id, resolve);
    try {
      getSharedWorker().postMessage({ id, config, layerIndex, isAux, auxMode });
    } catch {
      sharedWorkerCallbacks.delete(id);
      resolve(generateParticleData(config, layerIndex, isAux, auxMode));
    }
  });
}
