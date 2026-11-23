import React from 'react';
import { Canvas, extend, useFrame } from '@react-three/fiber';
import { OrbitControls, OrthographicCamera, PerspectiveCamera } from '@react-three/drei';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { ScreenOverlay, ScreenshotManager } from './scenePrimitives';
import { DeterministicRenderManager } from './DeterministicRenderManager';
import { noteSceneGenerationMounted, useSceneGeneration } from '../lib/sceneGeneration';
import { useSafeMode } from '../lib/safeMode';
import { installBenchSurface, pushBenchFrame } from '../lib/benchPack';

/**
 * Bench probe (Phase 15, Abyssal C): under ?diag=1 only, feeds
 * frame times to the shared bench collector and installs the
 * window.__kaloBench evidence surface. Inert otherwise.
 */
const BenchProbe: React.FC = () => {
  const active = React.useMemo(() => {
    try {
      return new URLSearchParams(window.location.search).get('diag') === '1';
    } catch {
      return false;
    }
  }, []);
  React.useEffect(() => {
    if (active) installBenchSurface();
  }, [active]);
  useFrame((_, delta) => {
    if (active) pushBenchFrame(delta * 1000);
  });
  return null;
};
import { CameraImpulseRig, getAdaptiveDprRange, SceneBackgroundSync, SceneEnvironmentSync, shouldUseAntialias } from './AppSceneCameraRig';
import { HorizonBackground } from './HorizonBackground';
import { TerrainMesh } from './TerrainMesh';
import { ObjMesh } from './ObjMesh';
import { isHorizonActive, isHorizonSuppressed } from '../lib/horizonBackground';
import { AppSceneLayerContent } from './AppSceneLayerContent';
import { EMPTY_PYRO_GRID_FOG_FEED, type PyroGridFogFeed } from '../lib/pyroGrid';
import { AppScenePostFx } from './AppScenePostFx';
import { SceneDepthCapture } from './SceneDepthCapture';
import { DynResController } from './DynResController';
import { useAppSceneTemporalConfig } from './useAppSceneTemporalConfig';
import type { AppSceneProps } from './AppSceneTypes';

// Perf stage 5: startup milestones from inside the render loop. The first
// rendered frame releases index.html's static poster (crossfade), and a
// few frames later the parent mounts PostFx — the first paint skips the
// EffectComposer cost entirely, and its compile hitch lands while the
// poster is still fading out.
const StartupFrameSignals: React.FC<{ onFxReady: () => void }> = ({ onFxReady }) => {
  const framesRef = React.useRef(0);
  const firstSentRef = React.useRef(false);
  const fxSentRef = React.useRef(false);
  useFrame(() => {
    framesRef.current += 1;
    if (!firstSentRef.current) {
      firstSentRef.current = true;
      window.dispatchEvent(new Event('kalokagathia:first-frame'));
    }
    if (!fxSentRef.current && framesRef.current >= 8) {
      fxSentRef.current = true;
      onFxReady();
    }
  });
  return null;
};

extend({
  InstancedMesh: THREE.InstancedMesh,
  ShaderMaterial: THREE.ShaderMaterial,
  Group: THREE.Group,
  LineSegments: THREE.LineSegments,
  PlaneGeometry: THREE.PlaneGeometry,
  BufferGeometry: THREE.BufferGeometry,
});

export const AppScene: React.FC<AppSceneProps> = React.memo(({
  audioRef,
  config,
  interLayerContactAmount,
  isPlaying,
  isSequencePlaying,
  rendererRef,
  saveTrigger,
  sequenceStepProgress,
  pointCloudCaptureRef,
  transparentBackground = false,
  backgroundOverrideColor,
  dynResEnabled = false,
}) => {
  const controlsRef = React.useRef<OrbitControlsImpl | null>(null);
  const isInteractingRef = React.useRef(false);
  const metaballPosRef = React.useRef<Float32Array | null>(null);
  // Phase CB: Pyro grid fog feed — written by the GPGPU system,
  // read by the volume-fog layers (both live below in
  // AppSceneLayerContent).
  const pyroFeedRef = React.useRef<PyroGridFogFeed>(EMPTY_PYRO_GRID_FOG_FEED);

  const effectiveConfig = useAppSceneTemporalConfig(config, isPlaying, audioRef, isSequencePlaying);
  const sceneGeneration = useSceneGeneration();
  React.useEffect(() => {
    noteSceneGenerationMounted(sceneGeneration);
  }, [sceneGeneration]);
  const safeMode = useSafeMode();
  const adaptiveDpr = React.useMemo(() => {
    const range = getAdaptiveDprRange(effectiveConfig);
    // Safe mode (Phase 15): the ladder's pixel cap scales the
    // range maximum down; level 0 leaves the range untouched.
    if (safeMode.step.pixCap >= 1) return range;
    return [range[0], Math.max(0.5, range[1] * safeMode.step.pixCap)] as [number, number];
  }, [effectiveConfig, safeMode.step.pixCap]);
  const antialias = React.useMemo(() => shouldUseAntialias(effectiveConfig), [effectiveConfig]);
  // Perf stage 5: PostFx mounts only after the first frames have rendered
  // without it (see StartupFrameSignals).
  const [fxReady, setFxReady] = React.useState(false);
  const handleFxReady = React.useCallback(() => {
    setFxReady(true);
    window.dispatchEvent(new Event('kalokagathia:fx-ready'));
  }, []);

  // Stream chroma variants key against this colour everywhere the
  // config tone would normally show (background, clear, fog tint);
  // undefined in every other mode, where the config tone rules.
  // Kinetix Color (B2): a non-empty backgroundHex overrides the tone
  // for the rendered surface only; tone logic elsewhere (contrast
  // normalisation, blend selection) still follows backgroundColor.
  const sceneBackgroundColor = backgroundOverrideColor ?? (effectiveConfig.backgroundHex || effectiveConfig.backgroundColor);
  // Horizon background (Phase I): gradient / image backgrounds own
  // scene.background (as a texture) while active. Stream surfaces
  // suppress Horizon entirely — the transparent variant must stay a
  // clean matte and the solid variants key against their override
  // colour. With the default 'solid' mode this is always false and
  // the background wiring below is the legacy path exactly.
  const horizonActive = !isHorizonSuppressed(transparentBackground, backgroundOverrideColor) && isHorizonActive(effectiveConfig);

  return (
    <Canvas
      gl={{ preserveDrawingBuffer: true, antialias, alpha: transparentBackground, powerPreference: 'high-performance' }}
      dpr={adaptiveDpr}
      onCreated={({ gl }) => {
        if (transparentBackground) {
          gl.setClearColor(0x000000, 0);
        } else {
          gl.setClearColor(new THREE.Color(sceneBackgroundColor));
        }
        rendererRef.current = gl;
      }}
    >
      <BenchProbe />
      <SceneEnvironmentSync config={effectiveConfig} />
      {/* Scene depth base (Phase 16 stage 1): mounted only while
          the depth occlusion strength is positive; at the default
          0 nothing is captured and the render is unchanged. */}
      {effectiveConfig.gpgpuDepthOcclusion > 0 && <SceneDepthCapture />}
      <SceneBackgroundSync
        backgroundColor={effectiveConfig.backgroundColor}
        transparentBackground={transparentBackground}
        backgroundOverrideColor={backgroundOverrideColor ?? (effectiveConfig.backgroundHex || undefined)}
        horizonActive={horizonActive}
      />
      {!transparentBackground && !horizonActive && <color attach="background" args={[sceneBackgroundColor]} />}
      <HorizonBackground
        config={effectiveConfig}
        legacyColor={sceneBackgroundColor}
        transparentBackground={transparentBackground}
        backgroundOverrideColor={backgroundOverrideColor}
      />
      {effectiveConfig.depthFogEnabled && (
        <fog attach="fog" args={[sceneBackgroundColor, config.depthFogNear, config.depthFogFar]} />
      )}
      {effectiveConfig.viewMode === 'orthographic' ? (
        <OrthographicCamera
          key={`ortho-${effectiveConfig.cameraDistance}`}
          makeDefault
          position={[0, 0, 500]}
          zoom={Math.max(1, 1500 / Math.max(10, effectiveConfig.cameraDistance))}
          far={5000}
          near={0.1}
        />
      ) : (
        <PerspectiveCamera
          key={`cam-${effectiveConfig.cameraDistance}-${effectiveConfig.perspective}`}
          makeDefault
          position={[0, 0, effectiveConfig.cameraDistance + 200]}
          fov={effectiveConfig.perspective / 20}
          far={10000}
          near={0.1}
        />
      )}
      <CameraImpulseRig
        key={`rig-${sceneGeneration}`}
        audioRef={audioRef}
        config={effectiveConfig}
        controlsRef={controlsRef}
        isInteractingRef={isInteractingRef}
        isPlaying={isPlaying}
      />
      <ScreenshotManager config={effectiveConfig} saveTrigger={saveTrigger} />
      <DeterministicRenderManager />
      {dynResEnabled && <DynResController config={effectiveConfig} isPlaying={isPlaying} />}
      <StartupFrameSignals onFxReady={handleFxReady} />
      <OrbitControls
        key={`controls-${effectiveConfig.cameraDistance}`}
        ref={controlsRef}
        enabled={effectiveConfig.cameraControlMode !== 'auto'}
        enablePan={effectiveConfig.cameraControlMode !== 'auto'}
        enableZoom={effectiveConfig.cameraControlMode !== 'auto'}
        enableRotate={effectiveConfig.cameraControlMode !== 'auto'}
        onStart={() => { isInteractingRef.current = true; }}
        onEnd={() => { isInteractingRef.current = false; }}
      />
      {/* Terrain Mesh (Phase P): mounts only when enabled in the
          config; with the default off it returns null and the scene
          is exactly the legacy one. Keyed by scene generation
          (Phase V) so a deterministic render job remounts it and
          the tunnel cruise phase restarts from 0 with the job. */}
      <TerrainMesh key={`terrain-${sceneGeneration}`} config={effectiveConfig} isPlaying={isPlaying} />
      {/* OBJ Mesh (Phase V): the polygon face of the imported OBJ;
          mounts only when enabled with a usable source. */}
      <ObjMesh config={effectiveConfig} />
      <AppSceneLayerContent
        key={`layers-${sceneGeneration}`}
        audioRef={audioRef}
        config={effectiveConfig}
        interLayerContactAmount={interLayerContactAmount}
        isPlaying={isPlaying}
        metaballPosRef={metaballPosRef}
        pointCloudCaptureRef={pointCloudCaptureRef}
        pyroFeedRef={pyroFeedRef}
      />
      <ScreenOverlay
        audioRef={audioRef}
        config={effectiveConfig}
        isPlaying={isPlaying}
        contactAmount={interLayerContactAmount}
        isSequencePlaying={isSequencePlaying}
        sequenceStepProgress={sequenceStepProgress}
      />
      {/* Stream transparent variant: PostFx never mounts — the custom
          passes force alpha to 1.0, which would destroy the matte
          (lib/streamMode.ts). Solid stream variants keep it. */}
      {fxReady && !transparentBackground && <AppScenePostFx config={effectiveConfig} />}
    </Canvas>
  );
});
AppScene.displayName = 'AppScene';
