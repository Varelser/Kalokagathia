import React from 'react';
import { Canvas, extend } from '@react-three/fiber';
import { OrbitControls, OrthographicCamera, PerspectiveCamera } from '@react-three/drei';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { ScreenOverlay, ScreenshotManager } from './scenePrimitives';
import { DeterministicRenderManager } from './DeterministicRenderManager';
import { noteSceneGenerationMounted, useSceneGeneration } from '../lib/sceneGeneration';
import { CameraImpulseRig, getAdaptiveDprRange, SceneBackgroundSync, shouldUseAntialias } from './AppSceneCameraRig';
import { AppSceneLayerContent } from './AppSceneLayerContent';
import { AppScenePostFx } from './AppScenePostFx';
import { useAppSceneTemporalConfig } from './useAppSceneTemporalConfig';
import type { AppSceneProps } from './AppSceneTypes';

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
}) => {
  const controlsRef = React.useRef<OrbitControlsImpl | null>(null);
  const isInteractingRef = React.useRef(false);
  const metaballPosRef = React.useRef<Float32Array | null>(null);

  const effectiveConfig = useAppSceneTemporalConfig(config, isPlaying, audioRef);
  const sceneGeneration = useSceneGeneration();
  React.useEffect(() => {
    noteSceneGenerationMounted(sceneGeneration);
  }, [sceneGeneration]);
  const adaptiveDpr = React.useMemo(() => getAdaptiveDprRange(effectiveConfig), [effectiveConfig]);
  const antialias = React.useMemo(() => shouldUseAntialias(effectiveConfig), [effectiveConfig]);

  return (
    <Canvas
      gl={{ preserveDrawingBuffer: true, antialias, alpha: false, powerPreference: 'high-performance' }}
      dpr={adaptiveDpr}
      onCreated={({ gl }) => {
        gl.setClearColor(new THREE.Color(effectiveConfig.backgroundColor));
        rendererRef.current = gl;
      }}
    >
      <SceneBackgroundSync backgroundColor={effectiveConfig.backgroundColor} />
      <color attach="background" args={[effectiveConfig.backgroundColor]} />
      {effectiveConfig.depthFogEnabled && (
        <fog attach="fog" args={[effectiveConfig.backgroundColor, config.depthFogNear, config.depthFogFar]} />
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
      <AppSceneLayerContent
        key={`layers-${sceneGeneration}`}
        audioRef={audioRef}
        config={effectiveConfig}
        interLayerContactAmount={interLayerContactAmount}
        isPlaying={isPlaying}
        metaballPosRef={metaballPosRef}
        pointCloudCaptureRef={pointCloudCaptureRef}
      />
      <ScreenOverlay
        audioRef={audioRef}
        config={effectiveConfig}
        isPlaying={isPlaying}
        contactAmount={interLayerContactAmount}
        isSequencePlaying={isSequencePlaying}
        sequenceStepProgress={sequenceStepProgress}
      />
      <AppScenePostFx config={effectiveConfig} />
    </Canvas>
  );
});
AppScene.displayName = 'AppScene';
