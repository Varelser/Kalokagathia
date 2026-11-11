import React from 'react';
import type { Layer2Type, ParticleConfig } from '../types';
import { normalizeParticleContrast } from '../lib/appState';
import { type ScreenFxPreset } from './controlPanelParts';

type LayerLockState = { layer1: boolean; layer2: boolean; layer3: boolean };

type UseControlPanelConfigHelpersArgs = {
  isPublicLibrary: boolean;
  layerLockState?: LayerLockState;
  setConfig: React.Dispatch<React.SetStateAction<ParticleConfig>>;
};

const inferLockedLayer = (key: keyof ParticleConfig): keyof LayerLockState | null => {
  const name = String(key);
  if (name.startsWith('layer1')) return 'layer1';
  if (name.startsWith('layer2')) return 'layer2';
  if (name.startsWith('layer3')) return 'layer3';
  return null;
};

export function useControlPanelConfigHelpers({
  isPublicLibrary,
  layerLockState = { layer1: false, layer2: false, layer3: false },
  setConfig,
}: UseControlPanelConfigHelpersArgs) {
  const lockedPanelClass = isPublicLibrary ? 'pointer-events-none opacity-45 select-none' : '';

  const updateConfig = <K extends keyof ParticleConfig>(key: K, value: ParticleConfig[K]) => {
    if (isPublicLibrary) {
      return;
    }
    const lockedLayer = inferLockedLayer(key);
    if (lockedLayer && layerLockState[lockedLayer]) {
      return;
    }
    setConfig((prev) => {
      const next = { ...prev, [key]: value } as ParticleConfig;

      if (key === 'layer2Enabled' && value === true) {
        if (next.layer2Count <= 0) next.layer2Count = 2400;
        if (next.layer2BaseSize <= 0.1) next.layer2BaseSize = 1.4;
        if (next.layer2RadiusScale <= 0.1) next.layer2RadiusScale = 0.9;
        if (next.layer2FlowAmplitude <= 0) next.layer2FlowAmplitude = 22;
        if (next.layer2FlowFrequency <= 0) next.layer2FlowFrequency = 1.1;
        if (next.layer2Type === 'curl' && prev.layer2Count <= 0) next.layer2Type = 'orbit';
        if (prev.layer2Count <= 0) next.layer2Source = 'sphere';
        next.layer2Trail = Math.max(next.layer2Trail, 0.08);
      }

      if (key === 'layer3Enabled' && value === true) {
        if (next.layer3Count <= 0) next.layer3Count = 1800;
        if (next.layer3BaseSize <= 0.1) next.layer3BaseSize = 1.1;
        if (next.layer3RadiusScale <= 0.1) next.layer3RadiusScale = 0.9;
        if (next.layer3FlowAmplitude <= 0) next.layer3FlowAmplitude = 18;
        if (next.layer3FlowFrequency <= 0) next.layer3FlowFrequency = 0.9;
        if (next.layer3Type === 'lorenz' && !prev.layer3Enabled) next.layer3Type = 'orbit';
        if (!prev.layer3Enabled) next.layer3Source = 'sphere';
        next.layer3Trail = Math.max(next.layer3Trail, 0.06);
      }

      if (key === 'particleColor' || key === 'backgroundColor') {
        const normalized = normalizeParticleContrast({
          particleColor: key === 'particleColor' ? (value as ParticleConfig['particleColor']) : next.particleColor,
          backgroundColor: key === 'backgroundColor' ? (value as ParticleConfig['backgroundColor']) : next.backgroundColor,
        });
        next.particleColor = normalized.particleColor;
        next.backgroundColor = normalized.backgroundColor;
      }

      return next;
    });
  };

  const applyScreenFxPreset = (preset: ScreenFxPreset) => {
    if (isPublicLibrary) {
      return;
    }
    setConfig((prev) => ({ ...prev, ...preset.values }));
  };

  const applyPerformancePreset = (mode: 'editing' | 'balanced' | 'cinematic') => {
    if (isPublicLibrary) {
      return;
    }
    setConfig((prev) => {
      if (mode === 'editing') {
        return {
          ...prev,
          renderQuality: 'draft',
          screenPersistenceIntensity: Math.min(prev.screenPersistenceIntensity, 0.06),
          screenPersistenceLayers: 1,
          layer2ConnectionEnabled: false,
          layer3ConnectionEnabled: false,
          screenNoiseIntensity: Math.min(prev.screenNoiseIntensity, 0.08),
          screenInterferenceIntensity: Math.min(prev.screenInterferenceIntensity, 0.05),
          layer1Count: Math.min(prev.layer1Count, 12000),
          layer2Count: Math.min(prev.layer2Count, 24000),
          layer3Count: Math.min(prev.layer3Count, 6000),
          ambientCount: Math.min(prev.ambientCount, 1800),
          layer2AuxEnabled: false,
          layer3AuxEnabled: false,
          layer2SparkEnabled: false,
          layer3SparkEnabled: false,
          layer2AuxCount: Math.min(prev.layer2AuxCount, 5000),
          layer3AuxCount: Math.min(prev.layer3AuxCount, 2500),
          layer2SparkCount: Math.min(prev.layer2SparkCount, 4000),
          layer3SparkCount: Math.min(prev.layer3SparkCount, 2500),
          layer2Fidelity: Math.min(prev.layer2Fidelity, 2),
          layer3Fidelity: Math.min(prev.layer3Fidelity, 2),
          interLayerCollisionEnabled: false,
          depthFogEnabled: false,
        };
      }
      if (mode === 'cinematic') {
        return {
          ...prev,
          renderQuality: 'cinematic',
          layer2Fidelity: Math.max(prev.layer2Fidelity, 4),
          layer3Fidelity: Math.max(prev.layer3Fidelity, 4),
        };
      }
      return {
        ...prev,
        renderQuality: 'balanced',
      };
    });
  };

  const updateMotionArray = (layer: 'layer2Motions' | 'layer3Motions', index: number, value: Layer2Type) => {
    if (isPublicLibrary) {
      return;
    }
    if ((layer === 'layer2Motions' && layerLockState.layer2) || (layer === 'layer3Motions' && layerLockState.layer3)) {
      return;
    }
    setConfig((prev) => {
      const newArr = [...(prev[layer] || [])];
      while (newArr.length <= index) {
        newArr.push('flow');
      }
      newArr[index] = value;
      return { ...prev, [layer]: newArr };
    });
  };

  const updatePositionArray = (
    layer: 'layer2SourcePositions' | 'layer3SourcePositions' | 'layer1SourcePositions',
    index: number,
    axis: 'x' | 'y' | 'z',
    value: number,
  ) => {
    if (isPublicLibrary) {
      return;
    }
    if ((layer === 'layer2SourcePositions' && layerLockState.layer2) || (layer === 'layer3SourcePositions' && layerLockState.layer3) || (layer === 'layer1SourcePositions' && layerLockState.layer1)) {
      return;
    }
    setConfig((prev) => {
      const newArr = [...(prev[layer] || [])];
      while (newArr.length <= index) {
        newArr.push({ x: 0, y: 0, z: 0 });
      }
      newArr[index] = { ...newArr[index], [axis]: value };
      return { ...prev, [layer]: newArr };
    });
  };

  const updateLayerArray = (
    key: 'layer2Counts' | 'layer2Sizes' | 'layer2RadiusScales' | 'layer2FlowSpeeds' | 'layer2FlowAmps' | 'layer2FlowFreqs' |
         'layer3Counts' | 'layer3Sizes' | 'layer3RadiusScales' | 'layer3FlowSpeeds' | 'layer3FlowAmps' | 'layer3FlowFreqs',
    index: number,
    value: number,
    baseCountKey: 'layer2Count' | 'layer3Count',
    sourceCount: number,
  ) => {
    if (isPublicLibrary) {
      return;
    }
    if ((String(key).startsWith('layer2') && layerLockState.layer2) || (String(key).startsWith('layer3') && layerLockState.layer3)) {
      return;
    }
    setConfig((prev) => {
      const newArr = [...(prev[key] || [])];
      while (newArr.length <= index) {
        newArr.push(1.0);
      }
      newArr[index] = value;

      const nextState = { ...prev, [key]: newArr } as ParticleConfig;
      if (key.includes('Counts')) {
        nextState[baseCountKey] = newArr.slice(0, sourceCount).reduce((a, b) => a + b, 0);
      }

      return nextState;
    });
  };

  const updateLayer1Array = (
    key: 'layer1Radii' | 'layer1Volumes' | 'layer1Jitters' | 'layer1Counts' | 'layer1Sizes' | 'layer1PulseSpeeds' | 'layer1PulseAmps',
    index: number,
    value: number,
  ) => {
    if (isPublicLibrary) {
      return;
    }
    if (layerLockState.layer1) {
      return;
    }
    setConfig((prev) => {
      const newArr = [...(prev[key] || [])];
      while (newArr.length <= index) {
        if (key === 'layer1Counts') {
          newArr.push(prev.layer1Count / (prev.layer1SourceCount || 1));
        } else {
          newArr.push(1.0);
        }
      }
      newArr[index] = value;

      const nextState = { ...prev, [key]: newArr } as ParticleConfig;
      if (key === 'layer1Counts') {
        nextState.layer1Count = newArr.slice(0, prev.layer1SourceCount).reduce((a, b) => a + b, 0);
      }

      return nextState;
    });
  };

  const formatPresetDate = (value: string) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return '--';
    }
    return date.toLocaleString('ja-JP', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return {
    applyPerformancePreset,
    applyScreenFxPreset,
    formatPresetDate,
    lockedPanelClass,
    updateConfig,
    updateLayer1Array,
    updateLayerArray,
    updateMotionArray,
    updatePositionArray,
  };
}
