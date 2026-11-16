import React from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import {
  registerDeterministicRenderHandler,
  resolveDeterministicBackgroundMode,
  resolveWarmupFrames,
  type DeterministicLoopMeasurement,
  type DeterministicRenderJob,
  type DeterministicRenderProgress,
} from '../lib/deterministicRender';
import { applyUnmultToImageData } from '../lib/unmult';
import { setCameraDeterminismLocked } from '../lib/cameraDeterminism';
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
// Phase C resolution presets (job.width / job.height): when a job
// requests a capture size, the renderer is resized through R3F's
// setSize with the pixel ratio pinned to 1 — so the drawing buffer is
// exactly the requested pixel size and the camera aspect and the
// PostFx composer's targets follow through the normal size state —
// and the previous size / ratio are restored in the finally block.
// Without a requested size nothing is touched and capture proceeds at
// the canvas's current size, exactly as before.
//
// Phase C loop measurement (job.loopMode): frame 0 and the last
// frame's pixels are snapshotted after background processing; after
// the capture loop one probe frame is stepped at exactly one period
// after frame 0 (step warmup + frames + 1) and captured the same way.
// The probe is diffed against frame 0 (drift: did the scene return to
// its start?) and the last frame is diffed against frame 0 (jump: the
// visible wrap discontinuity). The probe is never emitted as a frame.
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
function diffLoopPixels(
  first: Uint8ClampedArray,
  other: Uint8ClampedArray,
): { meanAbsDiff: number; mismatchRatio: number; maxAbsDiff: number } {
  const pixelCount = Math.floor(first.length / 4);
  let sum = 0;
  let mismatched = 0;
  let maxAbsDiff = 0;
  for (let p = 0; p < pixelCount; p += 1) {
    const o = p * 4;
    let pixelMax = 0;
    for (let c = 0; c < 4; c += 1) {
      const d = Math.abs(first[o + c] - other[o + c]);
      sum += d;
      if (d > pixelMax) pixelMax = d;
    }
    if (pixelMax > 8) mismatched += 1;
    if (pixelMax > maxAbsDiff) maxAbsDiff = pixelMax;
  }
  return {
    meanAbsDiff: pixelCount > 0 ? sum / (pixelCount * 4) : 0,
    mismatchRatio: pixelCount > 0 ? mismatched / pixelCount : 0,
    maxAbsDiff,
  };
}

export const DeterministicRenderManager: React.FC = () => {
  const advance = useThree((state) => state.advance);
  const setFrameloop = useThree((state) => state.setFrameloop);
  const setSize = useThree((state) => state.setSize);
  const setDpr = useThree((state) => state.setDpr);
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
          // Camera pin (Phase G): the impulse rig's ambient drift reads
          // the wall-clock-driven R3F clock, so without this lock the
          // camera distance — and therefore the whole framing — differed
          // between identical exports.
          setCameraDeterminismLocked(true);
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
          // Phase C resolution preset: resize before the scene remount
          // so every stepped frame (warmup included) renders at the
          // requested size. The restore runs in the finally block.
          let restoreSize: (() => void) | null = null;
          const wantWidth = job.width !== undefined && Number.isFinite(job.width) ? Math.floor(job.width) : 0;
          const wantHeight = job.height !== undefined && Number.isFinite(job.height) ? Math.floor(job.height) : 0;
          if (wantWidth > 0 && wantHeight > 0 && (gl.domElement.width !== wantWidth || gl.domElement.height !== wantHeight)) {
            const prevSize = new THREE.Vector2();
            gl.getSize(prevSize);
            const prevDpr = gl.getPixelRatio();
            const prevStyleWidth = gl.domElement.style.width;
            const prevStyleHeight = gl.domElement.style.height;
            setDpr(1);
            setSize(wantWidth, wantHeight);
            const sizeDeadline = Date.now() + 5000;
            while ((gl.domElement.width !== wantWidth || gl.domElement.height !== wantHeight) && Date.now() < sizeDeadline) {
              await new Promise((resolve) => {
                setTimeout(resolve, 50);
              });
            }
            if (gl.domElement.width !== wantWidth || gl.domElement.height !== wantHeight) {
              throw new Error(`resolution resize to ${wantWidth}x${wantHeight} did not apply`);
            }
            // R3F's size subscription also rewrites the canvas CSS
            // size; pin it back to the on-screen size so the page
            // layout does not jump while the buffer is at the preset
            // resolution. Only the drawing buffer changes.
            gl.domElement.style.width = prevStyleWidth;
            gl.domElement.style.height = prevStyleHeight;
            // Let the size-driven effects (camera aspect, PostFx
            // composer targets) commit before the first stepped frame.
            await new Promise((resolve) => {
              setTimeout(resolve, 120);
            });
            restoreSize = () => {
              setSize(prevSize.x, prevSize.y);
              setDpr(prevDpr);
              gl.domElement.style.width = prevStyleWidth;
              gl.domElement.style.height = prevStyleHeight;
            };
          }
          const loopEnabled = job.loopMode === true;
          let firstFramePixels: Uint8ClampedArray | null = null;
          let lastFramePixels: Uint8ClampedArray | null = null;
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
              if (loopEnabled && (index === 0 || index === job.frames - 1)) {
                // Snapshot the exact pixels about to be encoded
                // (getImageData returns a fresh buffer per call).
                const snapshot = context.getImageData(0, 0, copy.width, copy.height).data;
                if (index === 0) firstFramePixels = snapshot;
                if (index === job.frames - 1) lastFramePixels = snapshot;
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
            // Phase C loop probe: step the frame that would play
            // immediately after the last captured frame in a loop —
            // exactly one period after frame 0 — and diff it against
            // frame 0. The probe is measured only, never captured.
            let loop: DeterministicLoopMeasurement | null = null;
            if (loopEnabled && firstFramePixels && lastFramePixels) {
              const probeStep = warmupFrames + job.frames + 1;
              if (job.applyAt) {
                job.applyAt(probeStep * dt);
                await new Promise((resolve) => {
                  setTimeout(resolve, 30);
                });
              }
              applyUnmultBlack();
              advance(probeStep * dt);
              context.drawImage(source, 0, 0);
              if (backgroundMode === 'transparent') {
                captureTransparentFrame();
              } else if (backgroundMode === 'unmult') {
                const imageData = context.getImageData(0, 0, copy.width, copy.height);
                applyUnmultToImageData(imageData);
                context.putImageData(imageData, 0, 0);
              }
              const probePixels = context.getImageData(0, 0, copy.width, copy.height).data;
              const drift = diffLoopPixels(firstFramePixels, probePixels);
              const jump = diffLoopPixels(firstFramePixels, lastFramePixels);
              loop = {
                periodFrames: job.frames,
                periodSeconds: job.frames / job.fps,
                seamDriftMeanAbsDiff: drift.meanAbsDiff,
                seamDriftMismatchRatio: drift.mismatchRatio,
                seamJumpMeanAbsDiff: jump.meanAbsDiff,
                seamJumpMismatchRatio: jump.mismatchRatio,
                seamMaxAbsDiff: drift.maxAbsDiff,
              };
            }
            return {
              frames: blobs,
              width: copy.width,
              height: copy.height,
              warmupFrames,
              loop,
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
            if (restoreSize) {
              restoreSize();
            }
            setPositionFeedbackSuppressed(false);
            setTimeScaleLocked(false);
            setCameraDeterminismLocked(false);
            setFrameloop('always');
          }
        },
      ),
    [advance, camera, clock, gl, scene, setDpr, setFrameloop, setSize],
  );

  return null;
};
