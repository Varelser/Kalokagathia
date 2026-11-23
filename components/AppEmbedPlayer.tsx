import React from 'react';
import * as THREE from 'three';
import { Maximize, Minimize, Pause, Play } from 'lucide-react';
import { AppScene } from './AppScene';
import { getInterLayerContactAmount } from '../lib/appState';
import { toggleFullscreen } from '../lib/platformFeatures';
import { buildFullAppUrl } from '../lib/embedMode';
import { handleEmbedControlMessage, type EmbedControlHandlers } from '../lib/embedControl';
import { UserParametersPublicSurface } from './controlPanelUserParameters';
import { useUserParameters } from '../lib/userParameters';
import type { UpdateConfig } from './controlPanelTabsShared';
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
  /**
   * Script API handlers (Phase AO): when supplied, the player
   * answers the postMessage control protocol (PUBLIC_API.md).
   * Only the embed player ever mounts this listener — the main
   * app does not pass handlers and stays deaf to the protocol.
   */
  embedControl?: EmbedControlHandlers;
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
  embedControl,
}) => {
  // Script API (Phase AO): the handlers close over live App state,
  // so they are re-read through a ref on every message instead of
  // re-registering the listener per render.
  const embedHandlersRef = React.useRef(embedControl);
  embedHandlersRef.current = embedControl;
  // Phase 18 stage 5: bundled declarations (session overlay) drive
  // the read-only generated surface; empty = nothing rendered.
  const userParameterDeclarations = useUserParameters();
  React.useEffect(() => {
    if (!embedHandlersRef.current) return;
    const onMessage = (event: MessageEvent) => {
      const handlers = embedHandlersRef.current;
      if (!handlers) return;
      const outcome = handleEmbedControlMessage(event.data, handlers);
      if (outcome.handled && outcome.reply) {
        // Reply to the sender's own origin (never broadcast): the
        // host page that asked is the only intended reader.
        const target = event.source as Window | null;
        const origin = event.origin && event.origin !== 'null' ? event.origin : '*';
        try {
          target?.postMessage(outcome.reply, origin);
        } catch {
          // Sender gone / opaque origin: the reply is best-effort.
        }
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);
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
      {embedControl && userParameterDeclarations.length > 0 && (
        <div className="absolute left-3 top-3 z-[90] max-h-[70vh] w-64 overflow-y-auto rounded-xl border border-white/10 bg-black/55 p-1 backdrop-blur-md [&>div]:mt-0">
          <UserParametersPublicSurface
            config={config}
            updateConfig={((key: keyof ParticleConfig, value: ParticleConfig[typeof key]) =>
              embedControl.applyValue(key, value as number | boolean | string)) as UpdateConfig}
          />
        </div>
      )}
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
