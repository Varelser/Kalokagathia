import React from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import {
  registerDeterministicRenderHandler,
  resolveDeterministicBackgroundMode,
  resolveWarmupFrames,
  type DeterministicRenderJob,
  type DeterministicRenderProgress,
} from '../lib/deterministicRender';
import { applyUnmultToImageData } from '../lib/unmult';
import { setPositionFeedbackSuppressed } from '../lib/positionFeedback';
import { setTimeScaleLocked } from '../lib/playbackTime';
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
//
// Pro-1 v1: before capture, the job's warmup frames are stepped the same
// way (advance() only, no capture, no applyAt flush wait beyond the same
// hook call) so the scene moves past its ignition transient. Captured
// frame i is therefore at (warmup + i + 1) * dt on the reset clock. With
// warmupFrames = 0 the loop below is skipped entirely and the remaining
// sequence — remount, clock reset, per-frame applyAt / advance((i+1)*dt) /
// capture — is operation-for-operation the pre-Pro-1 behaviour, so the
// captured frame sequence is identical.
//
// When the job carries onFrame, each captured PNG is handed to it (awaited)
// and not retained, keeping long renders at one-part memory; without it the
// frames are collected and returned as before (the video encoder path).
//
// Pro-1.1 background modes (job.backgroundMode, default 'opaque'):
// 'opaque' runs the exact sequence above and captures the canvas as-is.
// 'unmult' forces a black scene background / fog tint / clear colour for
// the whole job (saved and restored afterwards) so the frame the PostFx
// chain produces is the black-background render Method B assumes, then
// converts each captured frame with lib/unmult.ts. 'transparent' is the
// conventional matte: after each stepped advance, the scene is rendered
// once more, directly into an offscreen RGBA target with no background —
// the EffectComposer never participates in that render, so no PostFx is
// applied and the target's alpha is the scene's own. The PostFx code
// itself is untouched by all three modes.
export const DeterministicRenderManager: React.FC = () => {
  const advance = useThree((state) => state.advance);
  const setFrameloop = useThree((state) => state.setFrameloop);
  const gl = useThree((state) => state.gl);
  const clock = useThree((state) => state.clock);
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);

  React.useEffect(
    () =>
      registerDeterministicRenderHandler(
        async (job: DeterministicRenderJob, onProgress: DeterministicRenderProgress) => {
          setFrameloop('never');
          setPositionFeedbackSuppressed(true);
          // Time scale lock (B3): a job always steps the legacy fixed
          // timestep — config.timeScale (including negative values) is
          // neutralised for the whole render, exports stay bit-comparable.
          setTimeScaleLocked(true);
          const backgroundMode = resolveDeterministicBackgroundMode(job);
          // UnMult black forcing: the originals are saved once, the
          // black state is (re)applied before every step (a config
          // flush from applyAt could otherwise re-attach the configured
          // background mid-job), and everything is restored in finally.
          const prevSceneBackground = scene.background;
          const prevFogColor = scene.fog ? scene.fog.color.clone() : null;
          const prevClearColor = new THREE.Color();
          gl.getClearColor(prevClearColor);
          const prevClearAlpha = gl.getClearAlpha();
          const applyUnmultBlack = () => {
            if (backgroundMode !== 'unmult') return;
            const black = new THREE.Color(0x000000);
            scene.background = black;
            if (scene.fog) scene.fog.color.copy(black);
            gl.setClearColor(black, 1);
          };
          let transparentTarget: THREE.WebGLRenderTarget | null = null;
          let transparentPixels: Uint8Array | null = null;
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
            const warmupFrames = resolveWarmupFrames(job);
            const source = gl.domElement;
            const copy = document.createElement('canvas');
            copy.width = source.width;
            copy.height = source.height;
            const context = copy.getContext('2d');
            if (!context) {
              throw new Error('2d context unavailable for frame capture');
            }
            applyUnmultBlack();
            // Conventional transparent capture: render the just-stepped
            // scene directly into an offscreen RGBA target (no scene
            // background, no EffectComposer, clear alpha 0) and read
            // the pixels back into the copy canvas, flipping rows —
            // WebGL readback is bottom-up, canvas ImageData top-down.
            const captureTransparentFrame = () => {
              if (!transparentTarget || !transparentPixels) {
                transparentTarget = new THREE.WebGLRenderTarget(copy.width, copy.height, {
                  depthBuffer: true,
                  stencilBuffer: false,
                  samples: 4,
                });
                transparentTarget.texture.colorSpace = THREE.SRGBColorSpace;
                transparentPixels = new Uint8Array(copy.width * copy.height * 4);
              }
              const target = transparentTarget;
              const pixels = transparentPixels;
              const framePrevTarget = gl.getRenderTarget();
              const framePrevBackground = scene.background;
              const framePrevClearColor = new THREE.Color();
              gl.getClearColor(framePrevClearColor);
              const framePrevClearAlpha = gl.getClearAlpha();
              const framePrevAutoClear = gl.autoClear;
              try {
                scene.background = null;
                gl.setClearColor(0x000000, 0);
                gl.autoClear = true;
                gl.setRenderTarget(target);
                camera.updateMatrixWorld();
                gl.render(scene, camera);
                gl.readRenderTargetPixels(target, 0, 0, copy.width, copy.height, pixels);
              } finally {
                gl.setRenderTarget(framePrevTarget);
                scene.background = framePrevBackground;
                gl.setClearColor(framePrevClearColor, framePrevClearAlpha);
                gl.autoClear = framePrevAutoClear;
              }
              const imageData = context.createImageData(copy.width, copy.height);
              const rowBytes = copy.width * 4;
              for (let y = 0; y < copy.height; y += 1) {
                const srcOffset = (copy.height - 1 - y) * rowBytes;
                imageData.data.set(pixels.subarray(srcOffset, srcOffset + rowBytes), y * rowBytes);
              }
              context.putImageData(imageData, 0, 0);
            };
            // Warmup: step the same fixed timestep without capturing.
            // applyAt still runs (with the stepped clock's timestamps) so
            // hook-driven state tracks the clock; the take export offsets
            // its own timeline by the warmup, so during warmup it applies
            // its initial config. The flush wait matches the capture loop.
            for (let warm = 0; warm < warmupFrames; warm += 1) {
              if (job.applyAt) {
                job.applyAt((warm + 1) * dt);
                // Let the config state flush into the scene before stepping.
                await new Promise((resolve) => {
                  setTimeout(resolve, 30);
                });
              }
              applyUnmultBlack();
              advance((warm + 1) * dt);
              await new Promise((resolve) => {
                setTimeout(resolve, 0);
              });
            }
            const blobs: Blob[] = [];
            for (let index = 0; index < job.frames; index += 1) {
              const step = warmupFrames + index + 1;
              if (job.applyAt) {
                job.applyAt(step * dt);
                // Let the config state flush into the scene before stepping.
                await new Promise((resolve) => {
                  setTimeout(resolve, 30);
                });
              }
              applyUnmultBlack();
              advance(step * dt);
              // Same-task copy: the drawing buffer still holds the frame
              // that advance() just rendered.
              context.drawImage(source, 0, 0);
              if (backgroundMode === 'transparent') {
                captureTransparentFrame();
              } else if (backgroundMode === 'unmult') {
                const imageData = context.getImageData(0, 0, copy.width, copy.height);
                applyUnmultToImageData(imageData);
                context.putImageData(imageData, 0, 0);
              }
              const blob = await new Promise<Blob | null>((resolve) => {
                copy.toBlob(resolve, 'image/png');
              });
              if (!blob) {
                throw new Error('frame capture failed');
              }
              if (job.onFrame) {
                await job.onFrame({ index, blob, width: copy.width, height: copy.height });
              } else {
                blobs.push(blob);
              }
              onProgress(index + 1, job.frames);
              // Yield so progress UI can paint; the frameloop is 'never',
              // so nothing else renders meanwhile.
              await new Promise((resolve) => {
                setTimeout(resolve, 0);
              });
            }
            return {
              frames: blobs,
              width: copy.width,
              height: copy.height,
              warmupFrames,
            };
          } finally {
            if (transparentTarget) {
              transparentTarget.dispose();
              transparentTarget = null;
              transparentPixels = null;
            }
            if (backgroundMode === 'unmult') {
              scene.background = prevSceneBackground;
              if (scene.fog && prevFogColor) scene.fog.color.copy(prevFogColor);
              gl.setClearColor(prevClearColor, prevClearAlpha);
            }
            setPositionFeedbackSuppressed(false);
            setTimeScaleLocked(false);
            setFrameloop('always');
          }
        },
      ),
    [advance, camera, clock, gl, scene, setFrameloop],
  );

  return null;
};
