import React from 'react';
import type * as THREE from 'three';
import { ControlPanel } from './ControlPanel';
import { AppScene } from './AppScene';
import { AppComparePreview } from './AppComparePreview';
import { AppExecutionDiagnosticsOverlay } from './AppExecutionDiagnosticsOverlay';
import { CanvasStreamWidget } from './canvasStreamWidget';
import { getInterLayerContactAmount } from '../lib/appState';
import type { ParticleConfig } from '../types';
import type { ComparePreviewOrientation } from './controlPanelTypes';
import type { PointCloudCaptureState } from '../lib/pointCloudExport';
import type { AudioLevels } from '../lib/audioControllerTypes';

export type AppRootLayoutProps = {
  audioRef: React.MutableRefObject<AudioLevels>;
  compareConfig: ParticleConfig | null;
  comparePreviewEnabled: boolean;
  comparePreviewOrientation: ComparePreviewOrientation;
  comparePreviewSlotIndex: number;
  config: ParticleConfig;
  controlPanelProps: React.ComponentProps<typeof ControlPanel>;
  displayConfig: ParticleConfig;
  isPlaying: boolean;
  isSequencePlaying: boolean;
  rendererRef: React.MutableRefObject<THREE.WebGLRenderer | null>;
  saveTrigger: number;
  sequenceStepProgress: number;
  pointCloudCaptureRef: React.RefObject<PointCloudCaptureState>;
};

export const AppRootLayout: React.FC<AppRootLayoutProps> = ({
  audioRef,
  compareConfig,
  comparePreviewEnabled,
  comparePreviewOrientation,
  comparePreviewSlotIndex,
  config,
  controlPanelProps,
  displayConfig,
  isPlaying,
  isSequencePlaying,
  rendererRef,
  saveTrigger,
  sequenceStepProgress,
  pointCloudCaptureRef,
}) => {
  // Perf stage 4: two-phase mount. The scene canvas mounts and paints
  // first; the control deck (top bar / rail / shelf / sheet / transport)
  // mounts two animation frames later, so its large DOM tree stays out
  // of the first-paint task. All panel state lives in App, and the deck
  // is a fixed overlay (the canvas is absolute inset-0), so the swap
  // causes no layout shift.
  const [panelReady, setPanelReady] = React.useState(false);
  React.useEffect(() => {
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setPanelReady(true));
    });
    return () => {
      cancelAnimationFrame(first);
      if (second) cancelAnimationFrame(second);
    };
  }, []);
  const [cinema, setCinema] = React.useState(false);
  const [hint, setHint] = React.useState(false);
  const [cursorIdle, setCursorIdle] = React.useState(false);
  const idleTimer = React.useRef<number | null>(null);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        setCinema(false);
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return;
      if (event.key.toLowerCase() === 'h') {
        if (!cinema) {
          setHint(true);
          window.setTimeout(() => setHint(false), 2600);
          setCursorIdle(false);
        }
        setCinema(!cinema);
      } else if (event.key === 'Escape') {
        setCinema(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [cinema]);

  // Mobile/touch (item 9): cinema mode was keyboard-only (H key), which a
  // touch device cannot send. The deck's 鑑賞 button dispatches this event;
  // while in cinema on a small screen, tapping the canvas exits (the hint
  // text says so), since every overlay is pointer-events:none then.
  React.useEffect(() => {
    const onToggleCinema = () => {
      if (!cinema) {
        setHint(true);
        window.setTimeout(() => setHint(false), 2600);
        setCursorIdle(false);
      }
      setCinema(!cinema);
    };
    window.addEventListener('kalokagathia:toggle-cinema', onToggleCinema);
    return () => window.removeEventListener('kalokagathia:toggle-cinema', onToggleCinema);
  }, [cinema]);

  React.useEffect(() => {
    if (!cinema) return undefined;
    const arm = () => {
      if (idleTimer.current) window.clearTimeout(idleTimer.current);
      idleTimer.current = window.setTimeout(() => setCursorIdle(true), 2500);
    };
    const onMove = () => {
      setCursorIdle(false);
      arm();
    };
    arm();
    window.addEventListener('mousemove', onMove);
    return () => {
      window.removeEventListener('mousemove', onMove);
      if (idleTimer.current) window.clearTimeout(idleTimer.current);
    };
  }, [cinema]);

  return (
  <div
    onClick={() => {
      // Tap-to-exit cinema on small screens only (desktop keeps H / Esc and
      // click-through orbiting exactly as before).
      if (cinema && window.matchMedia('(max-width: 640px)').matches) setCinema(false);
    }}
    className={`mg-root relative w-full h-screen ${config.backgroundColor === 'white' ? 'bg-white' : 'bg-black'}${cinema ? ' mg-cinema' : ''}${cinema && cursorIdle ? ' cursor-none' : ''}`}>
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
    <AppComparePreview
      audioRef={audioRef}
      compareConfig={compareConfig}
      comparePreviewEnabled={comparePreviewEnabled}
      comparePreviewOrientation={comparePreviewOrientation}
      comparePreviewSlotIndex={comparePreviewSlotIndex}
      isPlaying={isPlaying}
      isSequencePlaying={isSequencePlaying}
      sequenceStepProgress={sequenceStepProgress}
    />
    {panelReady && <ControlPanel {...controlPanelProps} />}
    <CanvasStreamWidget rendererRef={rendererRef} />
    <AppExecutionDiagnosticsOverlay config={config} />
    {cinema && hint && (
      <div className="mg-cinema-hint pointer-events-none absolute bottom-6 left-1/2 z-[90] -translate-x-1/2 rounded-full border border-white/20 bg-black/55 px-4 py-2 text-[11px] tracking-wider text-white/85 backdrop-blur-md">
        鑑賞モード — H / Esc（モバイルは画面タップ）でUIを戻す
      </div>
    )}
  </div>
  );
};
