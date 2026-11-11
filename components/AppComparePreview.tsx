import React from 'react';
import type { ComparePreviewOrientation } from './controlPanelTypes';
import type { SceneAudioRef } from './AppSceneTypes';
import type { ParticleConfig } from '../types';
import { AppScene } from './AppScene';
import { getInterLayerContactAmount } from '../lib/appState';

interface AppComparePreviewProps {
  audioRef: SceneAudioRef;
  compareConfig: ParticleConfig | null;
  comparePreviewEnabled: boolean;
  comparePreviewOrientation: ComparePreviewOrientation;
  comparePreviewSlotIndex: number;
  isPlaying: boolean;
  isSequencePlaying: boolean;
  sequenceStepProgress: number;
}

export const AppComparePreview: React.FC<AppComparePreviewProps> = ({
  audioRef,
  compareConfig,
  comparePreviewEnabled,
  comparePreviewOrientation,
  comparePreviewSlotIndex,
  isPlaying,
  isSequencePlaying,
  sequenceStepProgress,
}) => {
  if (!comparePreviewEnabled || !compareConfig) return null;
  return (
    <>
      <div
        className="pointer-events-none absolute inset-0 overflow-hidden border-white/15"
        style={comparePreviewOrientation === 'vertical'
          ? { clipPath: 'inset(0 0 0 50%)' }
          : { clipPath: 'inset(50% 0 0 0)' }}
      >
        <AppScene
          audioRef={audioRef}
          config={compareConfig}
          interLayerContactAmount={getInterLayerContactAmount(compareConfig)}
          isPlaying={isPlaying}
          isSequencePlaying={isSequencePlaying}
          rendererRef={{ current: null }}
          saveTrigger={0}
          sequenceStepProgress={sequenceStepProgress}
        />
      </div>
      <div
        className="pointer-events-none absolute bg-white/25"
        style={comparePreviewOrientation === 'vertical'
          ? { top: 0, bottom: 0, left: '50%', width: 1 }
          : { left: 0, right: 0, top: '50%', height: 1 }}
      />
      <div className="pointer-events-none absolute left-4 top-4 rounded border border-white/15 bg-black/45 px-2 py-1 text-[10px] uppercase tracking-widest text-white/70">Live</div>
      <div
        className="pointer-events-none absolute rounded border border-cyan-300/25 bg-black/45 px-2 py-1 text-[10px] uppercase tracking-widest text-cyan-100/80"
        style={comparePreviewOrientation === 'vertical' ? { right: 16, top: 16 } : { right: 16, bottom: 16 }}
      >
        Compare {String.fromCharCode(65 + comparePreviewSlotIndex)}
      </div>
    </>
  );
};
