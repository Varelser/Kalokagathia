import React from 'react';
import * as THREE from 'three';
import { Maximize, Minimize, Pause, Play } from 'lucide-react';
import { AppScene } from './AppScene';
import { getInterLayerContactAmount } from '../lib/appState';
import { toggleFullscreen } from '../lib/platformFeatures';
import { buildFullAppUrl } from '../lib/embedMode';
import type { ParticleConfig } from '../types';
import type { PointCloudCaptureState } from '../lib/pointCloudExport';
import type { AudioLevels } from '../lib/audioControllerTypes';

/**
 * Embed player (ultimate Wave 3): the chrome-free layout used when the
 * app boots with ?embed=1. ONLY the scene canvas plus a minimal control
 * cluster (play/pause, fullscreen, credit link to the full app) mounts
 * here — AppRootLayout / ControlPanel (four-edge deck, preset shelf, AI
 * tab, sync, BYOK prompts), the compare preview, the stream widget and
 * the diagnostics overlay are never mounted in this mode, so none of
 * their DOM, effects or lazy panel chunks run inside the iframe.
 *
 * All state still comes from App (config, share-link resolution,
 * playback), so a #p= / #c= hash applies exactly as in the full app;
 * with no hash the default scene plays.
 */
export type AppEmbedPlayerProps = {
  audioRef: React.MutableRefObject<AudioLevels>;
  config: ParticleConfig;
  displayConfig: ParticleConfig;
  isPlaying: boolean;
  isSequencePlaying: boolean;
  onTogglePlay: () => void;
  rendererRef: React.MutableRefObject<THREE.WebGLRenderer | null>;
  saveTrigger: number;
  sequenceStepProgress: number;
  pointCloudCaptureRef: React.RefObject<PointCloudCaptureState>;
};

export const AppEmbedPlayer: React.FC<AppEmbedPlayerProps> = ({
  audioRef,
  config,
  displayConfig,
  isPlaying,
  isSequencePlaying,
  onTogglePlay,
  rendererRef,
  saveTrigger,
  sequenceStepProgress,
  pointCloudCaptureRef,
}) => {
  const [isFullscreen, setIsFullscreen] = React.useState(false);
  React.useEffect(() => {
    const onFullscreenChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFullscreenChange);
    onFullscreenChange();
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

  // Credit link: the full app on the same preset — keep the current
  // share hash, drop the embed query. Computed once at mount: the hash
  // is what the share effect consumed, and it does not change in embed
  // mode (no UI here can navigate).
  const fullAppUrl = React.useMemo(
    () => buildFullAppUrl(window.location.origin, window.location.hash),
    [],
  );

  const buttonClass =
    'flex items-center justify-center rounded-full p-2 text-white/80 transition-colors hover:bg-white/15 hover:text-white';

  return (
    <div
      data-testid="embed-player"
      className={`relative h-screen w-full ${config.backgroundColor === 'white' ? 'bg-white' : 'bg-black'}`}
    >
      <div className="absolute inset-0">
        <AppScene
          audioRef={audioRef}
          config={displayConfig}
          interLayerContactAmount={getInterLayerContactAmount(displayConfig)}
          isPlaying={isPlaying}
          isSequencePlaying={isSequencePlaying}
          rendererRef={rendererRef}
          saveTrigger={saveTrigger}
          sequenceStepProgress={sequenceStepProgress}
          pointCloudCaptureRef={pointCloudCaptureRef}
        />
      </div>
      <div className="absolute bottom-3 right-3 z-[90] flex items-center gap-1 rounded-full border border-white/15 bg-black/55 px-1.5 py-1 backdrop-blur-md">
        <button
          type="button"
          data-testid="embed-play-toggle"
          onClick={onTogglePlay}
          aria-label={isPlaying ? 'Pause' : 'Play'}
          title={isPlaying ? 'Pause' : 'Play'}
          className={buttonClass}
        >
          {isPlaying ? <Pause size={15} /> : <Play size={15} />}
        </button>
        <button
          type="button"
          data-testid="embed-fullscreen"
          onClick={toggleFullscreen}
          aria-pressed={isFullscreen}
          aria-label={isFullscreen ? '全画面を終了' : '全画面表示'}
          title={isFullscreen ? '全画面を終了' : '全画面表示'}
          className={buttonClass}
        >
          {isFullscreen ? <Minimize size={15} /> : <Maximize size={15} />}
        </button>
        <a
          data-testid="embed-credit"
          href={fullAppUrl}
          target="_blank"
          rel="noreferrer"
          className="px-2 text-[10px] font-light uppercase tracking-[0.2em] text-white/70 transition-colors hover:text-white"
          title="Kalokagathia をフルアプリで開く"
        >
          Kalokagathia
        </a>
      </div>
    </div>
  );
};
