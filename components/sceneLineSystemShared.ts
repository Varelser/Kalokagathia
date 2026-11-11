import type { ParticleConfig } from '../types';
import type { ParticleData } from './particleData';
import type { ShaderUniformMap } from './sceneShared';

export type LineSystemProps = {
  config: ParticleConfig;
  layerIndex: 2 | 3;
  particleData: ParticleData;
  uniforms: ShaderUniformMap;
  globalRadius: number;
  connectionDistance: number;
  connectionOpacity: number;
  contactAmount: number;
  isPlaying: boolean;
};

export type LineProfile = {
  searchMul: number;
  budgetMul: number;
  sampleMul: number;
  neighborBonus: number;
  planarBias: number;
  radialBias: number;
  gateFreq: number;
  gateThreshold: number;
  dropout: number;
  widthMul: number;
  softnessMul: number;
  opacityMul: number;
  glowMul: number;
  alphaMul: number;
  pulseMul: number;
  shimmerMul: number;
  flickerMul: number;
  hueShiftAdd: number;
};

export type LineData = {
  classic: {
    aPosA: Float32Array;
    aOffA: Float32Array;
    aData1A: Float32Array;
    aData2A: Float32Array;
    aData3A: Float32Array;
    aPosB: Float32Array;
    aOffB: Float32Array;
    aData1B: Float32Array;
    aData2B: Float32Array;
    aData3B: Float32Array;
    aMix: Float32Array;
    count: number;
  };
  brush: {
    aPosA: Float32Array;
    aOffA: Float32Array;
    aData1A: Float32Array;
    aData2A: Float32Array;
    aData3A: Float32Array;
    aPosB: Float32Array;
    aOffB: Float32Array;
    aData1B: Float32Array;
    aData2B: Float32Array;
    aData3B: Float32Array;
    aLineCoord: Float32Array;
    count: number;
  };
};

export type { ParticleConfig } from '../types';
export { BRUSH_LINE_FRAGMENT_SHADER, BRUSH_LINE_VERTEX_SHADER, LINE_FRAGMENT_SHADER, LINE_VERTEX_SHADER } from './sceneShaders';
export { getLineBlendMode } from './sceneShared';
