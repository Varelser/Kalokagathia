import React from 'react';
import type * as THREE from 'three';
import { AppScene } from './AppScene';
import { CpuFallbackScene } from './CpuFallbackScene';
import { setCpuFallbackSetting, useCpuFallback } from '../lib/cpuFallback';
import { bootSafeMode, resetSafeMode, useSafeMode } from '../lib/safeMode';
import { FLIP3D_GRAINS_DOWNGRADE_NOTICE, useFlip3dGrainsDowngrade } from '../lib/flip3dAtlasDowngrade';
import { AppComparePreview } from './AppComparePreview';
import { AppExecutionDiagnosticsOverlay } from './AppExecutionDiagnosticsOverlay';
import { CanvasStreamWidget } from './canvasStreamWidget';
import { getInterLayerContactAmount } from '../lib/appState';
import type { ParticleConfig } from '../types';
import type { ComparePreviewOrientation, ControlPanelProps } from './controlPanelTypes';

// Phase DK step A: the control panel code is split out of the initial
// bundle. The lazy load is triggered from the panelReady effect below
// (first frame rendered, then the first idle window, hard cap 800ms —
// the same scheduling as lib/lazyStarterLibrary).
const ControlPanel = React.lazy(() =>
  import('./ControlPanel').then((m) => ({ default: m.ControlPanel })),
);
import type { PointCloudCaptureState } from '../lib/pointCloudExport';
import type { AudioLevels } from '../lib/audioControllerTypes';

export type AppRootLayoutProps = {
  audioRef: React.MutableRefObject<AudioLevels>;
  compareConfig: ParticleConfig | null;
  comparePreviewEnabled: boolean;
  comparePreviewOrientation: ComparePreviewOrientation;
  comparePreviewSlotIndex: number;
  config: ParticleConfig;
  controlPanelProps: ControlPanelProps;
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
  // mounts after the first frame plus an idle window (Phase DK step A),
  // so its large DOM tree — and now its code chunk as well — stays out
  // of the first-paint task. All panel state lives in App, and the deck
  // is a fixed overlay (the canvas is absolute inset-0), so the swap
  // causes no layout shift.
  const [panelReady, setPanelReady] = React.useState(false);
  React.useEffect(() => {
    // Phase DK step A: the panel now mounts only after the scene has
    // rendered its first frame ('kalokagathia:first-frame', dispatched by
    // both the WebGL scene and the CPU fallback) and an idle window opens
    // (hard cap 800ms, mirroring lib/lazyStarterLibrary). Mounting renders
    // the React.lazy ControlPanel, which starts the chunk download at
    // that point instead of in the initial bundle.
    let cancelled = false;
    let idleId = 0;
    let timer = 0;
    const schedule = () => {
      const win = window as unknown as {
        requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
        cancelIdleCallback?: (id: number) => void;
      };
      if (typeof win.requestIdleCallback === 'function') {
        idleId = win.requestIdleCallback(() => { if (!cancelled) setPanelReady(true); }, { timeout: 800 });
      } else {
        timer = window.setTimeout(() => { if (!cancelled) setPanelReady(true); }, 250);
      }
    };
    window.addEventListener('kalokagathia:first-frame', schedule, { once: true });
    return () => {
      cancelled = true;
      window.removeEventListener('kalokagathia:first-frame', schedule);
      const win = window as unknown as { cancelIdleCallback?: (id: number) => void };
      if (idleId) win.cancelIdleCallback?.(idleId);
      if (timer) window.clearTimeout(timer);
    };
  }, []);
  // CPU fallback (2026-11-15): on software renderers / missing WebGL
  // (or when forced manually / via ?cpu=1) the WebGL canvas is not
  // mounted at all and the Canvas 2D degraded renderer takes its place.
  // The deck, shelf and transport below are untouched either way.
  const cpuFallback = useCpuFallback();
  // Safe mode (Phase 15, Abyssal B): boot the crash-flag ladder
  // once per page load (idempotent). A previous session that never
  // reached its survival point advances the ladder one step.
  bootSafeMode();
  const safeMode = useSafeMode();
  const flip3dGrainsDowngrade = useFlip3dGrainsDowngrade();
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
    style={config.backgroundHex ? { backgroundColor: config.backgroundHex } : undefined}
    className={`mg-root relative w-full h-screen ${config.backgroundColor === 'white' ? 'bg-white' : 'bg-black'}${cinema ? ' mg-cinema' : ''}${cinema && cursorIdle ? ' cursor-none' : ''}`}>
    {flip3dGrainsDowngrade.active && (
      <div
        className="absolute left-1/2 z-[999] flex -translate-x-1/2 items-center gap-3 rounded border border-sky-300/40 bg-black/85 px-3 py-1.5 text-[11px] text-sky-200"
        style={{ top: safeMode.level > 0 ? 44 : 8 }}
      >
        <span>{FLIP3D_GRAINS_DOWNGRADE_NOTICE}</span>
      </div>
    )}
    {safeMode.level > 0 && (
      <div className="absolute left-1/2 top-2 z-[999] flex -translate-x-1/2 items-center gap-3 rounded border border-amber-300/40 bg-black/85 px-3 py-1.5 text-[11px] text-amber-200">
        <span>
          {safeMode.crashedLastTime ? '前回のセッションが異常終了したため、' : ''}セーフモード（段階 {safeMode.level}/3: {safeMode.step.name}）で起動しています
        </span>
        <button
          type="button"
          className="underline"
          onClick={() => { resetSafeMode(); window.location.reload(); }}
        >
          通常モードに戻す
        </button>
      </div>
    )}
    <div className="absolute inset-0">
      {cpuFallback.active || safeMode.step.fallback ? (
        <CpuFallbackScene
          config={displayConfig}
          isPlaying={isPlaying}
          reason={cpuFallback.active ? cpuFallback.reason : 'safe-mode'}
          onExit={cpuFallback.active
            ? (cpuFallback.reason === 'query' ? null : () => setCpuFallbackSetting('off'))
            : () => { resetSafeMode(); window.location.reload(); }}
        />
      ) : (
        <AppScene
          dynResEnabled
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
      )}
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
    {panelReady && (
      <React.Suspense fallback={null}>
        <ControlPanel {...controlPanelProps} />
      </React.Suspense>
    )}
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
