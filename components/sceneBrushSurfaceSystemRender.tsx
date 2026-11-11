import React from 'react';
import * as THREE from 'three';
import { BRUSH_FRAGMENT_SHADER, BRUSH_VERTEX_SHADER, type BrushPlane, type BrushSettings } from './sceneBrushSurfaceSystemShared';

export function renderBrushSurfaceMeshes(args: {
  planes: BrushPlane[];
  materialRefs: React.MutableRefObject<THREE.ShaderMaterial[]>;
  settings: BrushSettings;
}) {
  const { planes, materialRefs, settings } = args;
  return planes.map((plane, index) => (
    <mesh key={plane.key} geometry={plane.geometry}>
      <shaderMaterial
        ref={(instance) => {
          if (instance) materialRefs.current[index] = instance;
        }}
        transparent={true}
        depthWrite={false}
        side={THREE.DoubleSide}
        blending={THREE.AdditiveBlending}
        vertexShader={BRUSH_VERTEX_SHADER}
        fragmentShader={BRUSH_FRAGMENT_SHADER}
        uniforms={{
          uColor: { value: new THREE.Color(settings.color) },
          uOpacity: { value: settings.opacity },
          uTime: { value: 0 },
          uJitter: { value: settings.jitter },
          uPulse: { value: 0 },
          uAudioReactive: { value: settings.audioReactive },
          uTrailShear: { value: 0.18 },
          uVeilCurve: { value: 0.16 },
          uBleedWarp: { value: 0.14 },
          uEdgeSoftness: { value: 0.88 },
          uStreakFreq: { value: 120 },
          uTearFreq: { value: 36 },
          uBandFreq: { value: 24 },
          uAlphaMul: { value: 1 },
          uMaterialStyle: { value: 0 },
        }}
      />
    </mesh>
  ));
}
