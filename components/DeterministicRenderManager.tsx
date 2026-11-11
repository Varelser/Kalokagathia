import React from 'react';
import { useThree } from '@react-three/fiber';
import {
  registerDeterministicRenderHandler,
  type DeterministicRenderJob,
  type DeterministicRenderProgress,
} from '../lib/deterministicRender';
import { setPositionFeedbackSuppressed } from '../lib/positionFeedback';
import {
  bumpSceneGeneration,
  getGpgpuBackendSettledGeneration,
  getMountedSceneGeneration,
  getSceneComposition,
} from '../lib/sceneGeneration';

// Lives inside the Canvas and serves deterministic render requests from the
// control panel. Switching the frameloop to 'never' hands the clock to us:
// R3F then derives each frame's delta from the timestamps passed to
// advance(). We additionally reset the clock fields directly (no subscriber
// runs for the reset itself, so no system ever sees a negative or irregular
// step) and advance by exactly 1/fps per captured frame.
export const DeterministicRenderManager: React.FC = () => {
  const advance = useThree((state) => state.advance);
  const setFrameloop = useThree((state) => state.setFrameloop);
  const gl = useThree((state) => state.gl);
  const clock = useThree((state) => state.clock);

  React.useEffect(
    () =>
      registerDeterministicRenderHandler(
        async (job: DeterministicRenderJob, onProgress: DeterministicRenderProgress) => {
          setFrameloop('never');
          setPositionFeedbackSuppressed(true);
          try {
            // Remount the scene systems so accumulated per-system state
            // (rotations, phases, the GPGPU sim) restarts from its initial
            // values. The frameloop is already frozen, so the fresh systems
            // cannot advance before the clock reset below.
            const targetGeneration = bumpSceneGeneration();
            const deadline = Date.now() + 10000;
            const sceneReady = () => {
              if (getMountedSceneGeneration() < targetGeneration) return false;
              const composition = getSceneComposition();
              if (composition.generation < targetGeneration) return false;
              if (composition.hasGpgpu && getGpgpuBackendSettledGeneration() < targetGeneration) return false;
              return true;
            };
            while (!sceneReady() && Date.now() < deadline) {
              await new Promise((resolve) => {
                setTimeout(resolve, 50);
              });
            }
            clock.elapsedTime = 0;
            clock.oldTime = 0;
            const dt = 1 / job.fps;
            const source = gl.domElement;
            const copy = document.createElement('canvas');
            copy.width = source.width;
            copy.height = source.height;
            const context = copy.getContext('2d');
            if (!context) {
              throw new Error('2d context unavailable for frame capture');
            }
            const blobs: Blob[] = [];
            for (let index = 0; index < job.frames; index += 1) {
              if (job.applyAt) {
                job.applyAt((index + 1) * dt);
                // Let the config state flush into the scene before stepping.
                await new Promise((resolve) => {
                  setTimeout(resolve, 30);
                });
              }
              advance((index + 1) * dt);
              // Same-task copy: the drawing buffer still holds the frame
              // that advance() just rendered.
              context.drawImage(source, 0, 0);
              const blob = await new Promise<Blob | null>((resolve) => {
                copy.toBlob(resolve, 'image/png');
              });
              if (!blob) {
                throw new Error('frame capture failed');
              }
              blobs.push(blob);
              onProgress(index + 1, job.frames);
              // Yield so progress UI can paint; the frameloop is 'never',
              // so nothing else renders meanwhile.
              await new Promise((resolve) => {
                setTimeout(resolve, 0);
              });
            }
            return blobs;
          } finally {
            setPositionFeedbackSuppressed(false);
            setFrameloop('always');
          }
        },
      ),
    [advance, clock, gl, setFrameloop],
  );

  return null;
};
