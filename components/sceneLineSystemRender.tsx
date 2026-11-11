import React from 'react';
import * as THREE from 'three';
import type { ParticleConfig } from '../types';
import type { LineData } from './sceneLineSystemShared';
import { BRUSH_LINE_FRAGMENT_SHADER, BRUSH_LINE_VERTEX_SHADER, getLineBlendMode, LINE_FRAGMENT_SHADER, LINE_VERTEX_SHADER } from './sceneLineSystemShared';
import { createBrushLineUniforms, createClassicLineUniforms } from './sceneLineSystemMaterial';
import type { ShaderUniformMap } from './sceneShared';

export const LineSystemRender: React.FC<{ config: ParticleConfig; lineData: LineData; layerConnectionStyle: ParticleConfig['layer2ConnectionStyle']; uniforms: ShaderUniformMap; lineRef: React.RefObject<THREE.LineSegments | null>; brushRef: React.RefObject<THREE.Mesh | null>; }> = ({ config, lineData, layerConnectionStyle, uniforms, lineRef, brushRef }) => {
  if (layerConnectionStyle !== 'classic') return (
    <mesh ref={brushRef}>
      <bufferGeometry>
        <bufferAttribute args={[lineData.brush.aPosA, 3]} attach="attributes-position" count={lineData.brush.count} array={lineData.brush.aPosA} itemSize={3} />
        <bufferAttribute args={[lineData.brush.aPosA, 3]} attach="attributes-aPosA" count={lineData.brush.count} array={lineData.brush.aPosA} itemSize={3} />
        <bufferAttribute args={[lineData.brush.aOffA, 3]} attach="attributes-aOffA" count={lineData.brush.count} array={lineData.brush.aOffA} itemSize={3} />
        <bufferAttribute args={[lineData.brush.aData1A, 4]} attach="attributes-aData1A" count={lineData.brush.count} array={lineData.brush.aData1A} itemSize={4} />
        <bufferAttribute args={[lineData.brush.aData2A, 4]} attach="attributes-aData2A" count={lineData.brush.count} array={lineData.brush.aData2A} itemSize={4} />
        <bufferAttribute args={[lineData.brush.aData3A, 4]} attach="attributes-aData3A" count={lineData.brush.count} array={lineData.brush.aData3A} itemSize={4} />
        <bufferAttribute args={[lineData.brush.aPosB, 3]} attach="attributes-aPosB" count={lineData.brush.count} array={lineData.brush.aPosB} itemSize={3} />
        <bufferAttribute args={[lineData.brush.aOffB, 3]} attach="attributes-aOffB" count={lineData.brush.count} array={lineData.brush.aOffB} itemSize={3} />
        <bufferAttribute args={[lineData.brush.aData1B, 4]} attach="attributes-aData1B" count={lineData.brush.count} array={lineData.brush.aData1B} itemSize={4} />
        <bufferAttribute args={[lineData.brush.aData2B, 4]} attach="attributes-aData2B" count={lineData.brush.count} array={lineData.brush.aData2B} itemSize={4} />
        <bufferAttribute args={[lineData.brush.aData3B, 4]} attach="attributes-aData3B" count={lineData.brush.count} array={lineData.brush.aData3B} itemSize={4} />
        <bufferAttribute args={[lineData.brush.aLineCoord, 2]} attach="attributes-aLineCoord" count={lineData.brush.count} array={lineData.brush.aLineCoord} itemSize={2} />
      </bufferGeometry>
      <shaderMaterial vertexShader={BRUSH_LINE_VERTEX_SHADER} fragmentShader={BRUSH_LINE_FRAGMENT_SHADER} uniforms={createBrushLineUniforms(config, uniforms, layerConnectionStyle)} key={`brush-line-mat-${config.backgroundColor}-${layerConnectionStyle}`} transparent={true} depthWrite={false} side={THREE.DoubleSide} blending={getLineBlendMode(config.backgroundColor)} />
    </mesh>
  );
  return (
    <lineSegments ref={lineRef}>
      <bufferGeometry>
        <bufferAttribute args={[lineData.classic.aPosA, 3]} attach="attributes-position" count={lineData.classic.count * 2} array={lineData.classic.aPosA} itemSize={3} />
        <bufferAttribute args={[lineData.classic.aPosA, 3]} attach="attributes-aPosA" count={lineData.classic.count * 2} array={lineData.classic.aPosA} itemSize={3} />
        <bufferAttribute args={[lineData.classic.aOffA, 3]} attach="attributes-aOffA" count={lineData.classic.count * 2} array={lineData.classic.aOffA} itemSize={3} />
        <bufferAttribute args={[lineData.classic.aData1A, 4]} attach="attributes-aData1A" count={lineData.classic.count * 2} array={lineData.classic.aData1A} itemSize={4} />
        <bufferAttribute args={[lineData.classic.aData2A, 4]} attach="attributes-aData2A" count={lineData.classic.count * 2} array={lineData.classic.aData2A} itemSize={4} />
        <bufferAttribute args={[lineData.classic.aData3A, 4]} attach="attributes-aData3A" count={lineData.classic.count * 2} array={lineData.classic.aData3A} itemSize={4} />
        <bufferAttribute args={[lineData.classic.aPosB, 3]} attach="attributes-aPosB" count={lineData.classic.count * 2} array={lineData.classic.aPosB} itemSize={3} />
        <bufferAttribute args={[lineData.classic.aOffB, 3]} attach="attributes-aOffB" count={lineData.classic.count * 2} array={lineData.classic.aOffB} itemSize={3} />
        <bufferAttribute args={[lineData.classic.aData1B, 4]} attach="attributes-aData1B" count={lineData.classic.count * 2} array={lineData.classic.aData1B} itemSize={4} />
        <bufferAttribute args={[lineData.classic.aData2B, 4]} attach="attributes-aData2B" count={lineData.classic.count * 2} array={lineData.classic.aData2B} itemSize={4} />
        <bufferAttribute args={[lineData.classic.aData3B, 4]} attach="attributes-aData3B" count={lineData.classic.count * 2} array={lineData.classic.aData3B} itemSize={4} />
        <bufferAttribute args={[lineData.classic.aMix, 1]} attach="attributes-aMix" count={lineData.classic.count * 2} array={lineData.classic.aMix} itemSize={1} />
      </bufferGeometry>
      <shaderMaterial vertexShader={LINE_VERTEX_SHADER} fragmentShader={LINE_FRAGMENT_SHADER} uniforms={createClassicLineUniforms(uniforms)} key={`line-mat-${config.backgroundColor}`} transparent={true} depthWrite={false} blending={getLineBlendMode(config.backgroundColor)} />
    </lineSegments>
  );
};
