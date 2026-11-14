import React from 'react';
import type * as THREE from 'three';
import { AppScene } from './AppScene';
import { getInterLayerContactAmount } from '../lib/appState';
import type { StreamBackground } from '../lib/streamMode';
import type { ParticleConfig } from '../types';
import type { PointCloudCaptureState } from '../lib/pointCloudExport';
import type { AudioLevels } from '../lib/audioControllerTypes';

/**
 * Stream player (Phase 8): the pure-picture layout used when the app
 * boots with ?stream=1, built to be loaded as an OBS Browser Source.
 * ONLY the scene canvas mounts — unlike the embed player there is no
 * control cluster, credit link or exit hint at all: the surface is a
 * live visual that a compositor overlays or keys, so any DOM chrome
 * would end up on air. AppRootLayout / ControlPanel, the compare
 * preview and the diagnostics overlay never mount.
 *
 * Variants (lib/streamMode):
 *  - transparent (default): the canvas renders onto an alpha matte
 *    (renderer alpha, clear alpha 0, no scene background, PostFx
 *    bypassed — the custom post passes force alpha 1.0) and the PAGE
 *    itself is made transparent below, because OBS composites the
 *    browser page, not the WebGL canvas alone: index.html paints the
 *    body #000, which would otherwise back the matte with black.
 *  - solid (bg=key / bg=black): the full PostFx chain over a solid
 *    keyable colour, for OBS's Chroma Key filter or a plain backdrop.
 *
 * Playback is forced on, like kiosk: a stream visual must move even
 * if the shared ui.isPlaying state was left paused.
 */
export type AppStreamPlayerProps = {
  audioRef: React.MutableRefObject<AudioLevels>;
  background: StreamBackground;
  config: ParticleConfig;
  displayConfig: ParticleConfig;
  isSequencePlaying: boolean;
  rendererRef: React.MutableRefObject<THREE.WebGLRenderer | null>;
  saveTrigger: number;
  sequenceStepProgress: number;
  pointCloudCaptureRef: React.RefObject<PointCloudCaptureState>;
};

export const AppStreamPlayer: React.FC<AppStreamPlayerProps> = ({
  audioRef,
  background,
  displayConfig,
  isSequencePlaying,
  rendererRef,
  saveTrigger,
  sequenceStepProgress,
  pointCloudCaptureRef,
}) => {
  const transparent = background.kind === 'transparent';
  const solidColor = background.kind === 'solid' ? background.color : undefined;

  // Page-level backdrop: OBS (CEF) composites the whole page, so the
  // html/body background must match the variant — transparent for the
  // alpha variant, the key colour for solid ones. Inline styles win
  // over index.html's `body { background: #000 }` boot paint. Restored
  // on unmount (in practice the player never unmounts).
  React.useEffect(() => {
    const pageBackground = transparent ? 'transparent' : (solidColor ?? 'transparent');
    const html = document.documentElement;
    const body = document.body;
    const prevHtml = html.style.background;
    const prevBody = body.style.background;
    html.style.background = pageBackground;
    body.style.background = pageBackground;
    return () => {
      html.style.background = prevHtml;
      body.style.background = prevBody;
    };
  }, [solidColor, transparent]);

  return (
    <div
      data-testid="stream-player"
      data-stream-bg={transparent ? 'transparent' : background.kind === 'solid' ? background.name : undefined}
      className="relative h-screen w-full"
      style={{ background: transparent ? 'transparent' : solidColor }}
    >
      <div className="absolute inset-0">
        <AppScene
          audioRef={audioRef}
          config={displayConfig}
          interLayerContactAmount={getInterLayerContactAmount(displayConfig)}
          isPlaying
          isSequencePlaying={isSequencePlaying}
          rendererRef={rendererRef}
          saveTrigger={saveTrigger}
          sequenceStepProgress={sequenceStepProgress}
          pointCloudCaptureRef={pointCloudCaptureRef}
          transparentBackground={transparent}
          backgroundOverrideColor={solidColor}
        />
      </div>
    </div>
  );
};
