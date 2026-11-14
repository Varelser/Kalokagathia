import React from 'react';
import type * as THREE from 'three';
import { AppScene } from './AppScene';
import { getInterLayerContactAmount } from '../lib/appState';
import type { ParticleConfig } from '../types';
import type { PointCloudCaptureState } from '../lib/pointCloudExport';
import type { AudioLevels } from '../lib/audioControllerTypes';

/**
 * Kiosk player (ultimate Wave 5): the exhibition layout used when the
 * app boots with ?kiosk=1. ONLY the scene canvas mounts — no control
 * cluster at all (unlike the embed player): AppRootLayout / ControlPanel,
 * the compare preview, the stream widget and the diagnostics overlay
 * never mount, so an unattended terminal shows nothing but the piece.
 *
 * The single affordance is the exit hint: a tiny pill that appears at
 * boot for a few seconds and again on pointer movement, then fades
 * (visibility is driven by useKioskMode). Clicking it — or pressing
 * Esc — exits kiosk to the normal app in the same tab. Rotation,
 * pause/resume, wake lock and the first-gesture fullscreen request are
 * all owned by useKioskMode in App; this component is presentational.
 *
 * Playback is forced on: an exhibition piece must move even if the
 * shared ui.isPlaying state was left paused.
 */
export type AppKioskPlayerProps = {
  audioRef: React.MutableRefObject<AudioLevels>;
  config: ParticleConfig;
  displayConfig: ParticleConfig;
  hintVisible: boolean;
  onExitKiosk: () => void;
  paused: boolean;
  rendererRef: React.MutableRefObject<THREE.WebGLRenderer | null>;
  rotationReady: boolean;
  saveTrigger: number;
  sequenceStepProgress: number;
  pointCloudCaptureRef: React.RefObject<PointCloudCaptureState>;
};

export const AppKioskPlayer: React.FC<AppKioskPlayerProps> = ({
  audioRef,
  config,
  displayConfig,
  hintVisible,
  onExitKiosk,
  paused,
  rendererRef,
  rotationReady,
  saveTrigger,
  sequenceStepProgress,
  pointCloudCaptureRef,
}) => (
  <div
    data-testid="kiosk-player"
    className={`relative h-screen w-full ${config.backgroundColor === 'white' ? 'bg-white' : 'bg-black'}`}
  >
    <div className="absolute inset-0">
      <AppScene
        audioRef={audioRef}
        config={displayConfig}
        interLayerContactAmount={getInterLayerContactAmount(displayConfig)}
        isPlaying
        isSequencePlaying={rotationReady && !paused}
        rendererRef={rendererRef}
        saveTrigger={saveTrigger}
        sequenceStepProgress={sequenceStepProgress}
        pointCloudCaptureRef={pointCloudCaptureRef}
      />
    </div>
    <button
      type="button"
      data-testid="kiosk-exit-hint"
      data-kiosk-hint
      onClick={onExitKiosk}
      aria-hidden={!hintVisible}
      tabIndex={hintVisible ? 0 : -1}
      className={`absolute bottom-5 left-1/2 z-[90] -translate-x-1/2 rounded-full border border-white/20 bg-black/55 px-4 py-2 text-[11px] tracking-wider text-white/85 backdrop-blur-md transition-opacity duration-500 hover:bg-black/75 hover:text-white ${
        hintVisible ? 'opacity-100' : 'pointer-events-none opacity-0'
      }`}
      title="キオスクモードを終了して通常画面に戻る"
    >
      キオスクモード — Esc / クリックで終了
    </button>
  </div>
);
