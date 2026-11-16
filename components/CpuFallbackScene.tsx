import React from 'react';
import type { ParticleConfig } from '../types';
import { generateParticleData, getRigidParticlePosition } from './particleData';
import {
  createCpuParticleState,
  cpuShapeSignature,
  resolveCpuParticleCount,
  stepCpuParticles,
  type CpuParticleState,
} from '../lib/cpuParticleSim';
import { reportCpuRendererStats, type CpuFallbackReason } from '../lib/cpuFallback';
import { scaleFrameDelta } from '../lib/playbackTime';

// CPU fallback renderer (2026-11-15): a Canvas 2D degraded view of the
// current config for machines where WebGL is effectively unusable.
// Particles integrate on the CPU (lib/cpuParticleSim.ts, capped at
// 4,000), are projected with a slow global rotation, and are drawn
// additively over a translucent fade so motion leaves trails. Display
// only — deterministic export and the WebGL scene are unaffected.

interface CpuFallbackSceneProps {
  config: ParticleConfig;
  isPlaying: boolean;
  reason: CpuFallbackReason;
  onExit: (() => void) | null;
}

const REASON_LABELS: Record<string, string> = {
  software: 'ソフトウェア描画の環境のため、軽量な CPU 表示に切り替えました',
  'no-webgl': 'WebGL が使えない環境のため、軽量な CPU 表示に切り替えました',
  manual: 'CPU フォールバックが手動で有効になっています',
  query: 'CPU フォールバック（テスト指定）',
};

/** World-space homes from the existing CPU layout generator (layer 1). */
function computeLayoutHomes(config: ParticleConfig, count: number): Float32Array | null {
  try {
    const data = generateParticleData(config, 1);
    if (!data || data.count <= 0) return null;
    const radius = Math.max(1, config.sphereRadius || 50);
    const homes = new Float32Array(count * 3);
    const stride = Math.max(1, Math.floor(data.count / count));
    for (let i = 0; i < count; i += 1) {
      const sourceIndex = Math.min(data.count - 1, i * stride);
      const p = getRigidParticlePosition(data, sourceIndex, radius);
      homes[i * 3] = p.x; homes[i * 3 + 1] = p.y; homes[i * 3 + 2] = p.z;
    }
    return homes;
  } catch {
    return null;
  }
}

export const CpuFallbackScene: React.FC<CpuFallbackSceneProps> = ({
  config,
  isPlaying,
  reason,
  onExit,
}) => {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const configRef = React.useRef(config);
  configRef.current = config;
  const playingRef = React.useRef(isPlaying);
  playingRef.current = isPlaying;
  const [stats, setStats] = React.useState<{ fps: number; count: number } | null>(null);
  const [layoutNote, setLayoutNote] = React.useState(false);

  const signature = cpuShapeSignature(config);
  const signatureRef = React.useRef(signature);
  signatureRef.current = signature;

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;

    let state: CpuParticleState | null = null;
    let gradientCache: { key: string; grad: CanvasGradient | null } = { key: '', grad: null };
    let stateSignature = '';
    let width = 0;
    let height = 0;
    let raf = 0;
    let firstFrameSent = false;
    let lastTs = performance.now();
    let simTime = 0;
    let frames = 0;
    let statsWindowStart = lastTs;
    let disposed = false;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = Math.max(2, Math.floor(rect.width));
      height = Math.max(2, Math.floor(rect.height));
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
    };
    resize();
    const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
    if (resizeObserver && canvas.parentElement) resizeObserver.observe(canvas.parentElement);
    window.addEventListener('resize', resize);

    const ensureState = () => {
      const cfg = configRef.current;
      const sig = signatureRef.current;
      if (state && sig === stateSignature) return;
      stateSignature = sig;
      const homes = computeLayoutHomes(cfg, resolveCpuParticleCount(cfg));
      setLayoutNote(homes === null);
      state = createCpuParticleState(cfg, homes);
    };

    ensureState();

    const draw = (now: number) => {
      if (disposed) return;
      raf = requestAnimationFrame(draw);
      const cfg = configRef.current;
      ensureState();
      if (!state || width < 4 || height < 4) return;
      const rawDt = Math.min(0.1, Math.max(0, (now - lastTs) / 1000));
      lastTs = now;
      frames += 1;
      if (now - statsWindowStart >= 500) {
        const fps = Math.round((frames * 1000) / (now - statsWindowStart));
        frames = 0;
        statsWindowStart = now;
        setStats({ fps, count: state.count });
        reportCpuRendererStats(fps, state.count);
      }

      const playing = playingRef.current;
      const speed = cfg.gpgpuEnabled ? Math.max(0.05, cfg.gpgpuSpeed || 1) : 1;
      if (playing) {
        // Global time scale (B3): the CPU sim integrates forward only,
        // so a negative scale freezes its step (the WebGL systems run
        // backwards); positive scales apply as-is.
        const scaledDt = scaleFrameDelta(rawDt * speed, cfg);
        simTime += scaledDt;
        stepCpuParticles(state, cfg, scaledDt, simTime);
      }

      const whiteBg = cfg.backgroundColor === 'white';
      const persistence = Math.max(0, Math.min(1, cfg.screenPersistenceIntensity || 0));
      const fadeAlpha = playing ? Math.max(0.1, 0.62 - persistence * 0.45) : 1;
      // Kinetix Color (B2): an arbitrary backgroundHex tints the fade
      // fill too; tone-driven choices (particle colour, composite op)
      // still follow backgroundColor.
      const hexBg = /^#[0-9a-fA-F]{6}$/.test(cfg.backgroundHex || '') ? cfg.backgroundHex : '';
      const bgRgb = hexBg
        ? `${parseInt(hexBg.slice(1, 3), 16)},${parseInt(hexBg.slice(3, 5), 16)},${parseInt(hexBg.slice(5, 7), 16)}`
        : whiteBg ? '255,255,255' : '0,0,0';
      ctx.globalCompositeOperation = 'source-over';
      // Horizon background (Phase I): gradient mode paints the fade
      // fill as the same linear / radial gradient (cached per size +
      // colours). Image mode keeps the solid fade — the CPU view is
      // a degraded display path and does not decode the image.
      if (cfg.backgroundMode === 'gradient') {
        const cacheKey = `${width}x${height}|${cfg.backgroundGradientColorA}|${cfg.backgroundGradientColorB}|${cfg.backgroundGradientType}|${cfg.backgroundGradientAngle}`;
        if (gradientCache.key !== cacheKey) {
          let grad: CanvasGradient;
          if (cfg.backgroundGradientType === 'radial') {
            grad = ctx.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, Math.hypot(width, height) / 2);
          } else {
            const rad = ((cfg.backgroundGradientAngle || 0) * Math.PI) / 180;
            const dx = Math.cos(rad);
            const dy = -Math.sin(rad);
            grad = ctx.createLinearGradient(
              width / 2 - (dx * width) / 2, height / 2 - (dy * height) / 2,
              width / 2 + (dx * width) / 2, height / 2 + (dy * height) / 2,
            );
          }
          grad.addColorStop(0, cfg.backgroundGradientColorA || '#000000');
          grad.addColorStop(1, cfg.backgroundGradientColorB || '#232830');
          gradientCache = { key: cacheKey, grad };
        }
        ctx.globalAlpha = fadeAlpha;
        if (gradientCache.grad) ctx.fillStyle = gradientCache.grad;
        ctx.fillRect(0, 0, width, height);
        ctx.globalAlpha = 1;
      } else {
        ctx.fillStyle = `rgba(${bgRgb},${fadeAlpha})`;
        ctx.fillRect(0, 0, width, height);
      }

      // Slow global rotation (config rotation speeds + a gentle idle
      // turn), applied as a 2D projection of the 3D state.
      const rotY = (cfg.manualRotationY || 0) + simTime * (0.12 + Math.abs(cfg.rotationSpeedY || 0) * 0.6);
      const rotX = (cfg.manualRotationX || 0) * 0.6 + Math.sin(simTime * 0.11) * 0.18;
      const cosY = Math.cos(rotY); const sinY = Math.sin(rotY);
      const cosX = Math.cos(rotX); const sinX = Math.sin(rotX);
      const cx = width / 2;
      const cy = height / 2;
      const viewScale = Math.min(width, height) * 0.40;
      const divisor = state.attractorMode ? state.attractorRenderDivisor : 1;
      const baseSize = cfg.gpgpuEnabled && cfg.gpgpuAttractorEnabled
        ? Math.max(0.7, (cfg.gpgpuSize || 1.5) * 0.62)
        : Math.max(0.7, (cfg.baseSize || 2) * 0.8);
      const opacity = Math.max(0.05, Math.min(1, cfg.opacity || 1));
      const particleColor = whiteBg ? '10,10,12' : '235,238,245';

      ctx.globalCompositeOperation = whiteBg ? 'source-over' : 'lighter';
      ctx.fillStyle = `rgb(${particleColor})`;
      const { pos, sizeMul, count } = state;
      for (let i = 0; i < count; i += 1) {
        const i3 = i * 3;
        let x = pos[i3] / divisor;
        let y = pos[i3 + 1] / divisor;
        let z = pos[i3 + 2] / divisor;
        // Rotate around Y, then X.
        const rx = x * cosY - z * sinY;
        const rz = x * sinY + z * cosY;
        const ry = y * cosX - rz * sinX;
        const rz2 = y * sinX + rz * cosX;
        x = rx; y = ry; z = rz2;
        const perspective = 1 / (1 + (z + 1.4) * 0.16);
        const sx = cx + x * viewScale * perspective;
        const sy = cy - y * viewScale * perspective;
        if (sx < -8 || sx > width + 8 || sy < -8 || sy > height + 8) continue;
        const size = Math.max(0.5, baseSize * sizeMul[i] * perspective);
        const depthAlpha = Math.max(0.12, Math.min(1, 0.85 - z * 0.3));
        // Soft halo + core: the WebGL points have a glow falloff that a
        // single hard square lacks; two rects approximate it cheaply.
        ctx.globalAlpha = opacity * depthAlpha * 0.16;
        const halo = size * 2.8;
        ctx.fillRect(sx - halo / 2, sy - halo / 2, halo, halo);
        ctx.globalAlpha = opacity * depthAlpha;
        ctx.fillRect(sx - size / 2, sy - size / 2, size, size);
      }
      ctx.globalAlpha = 1;
      if (!firstFrameSent) {
        firstFrameSent = true;
        // Release index.html's first-visit poster, which otherwise
        // waits forever for the WebGL scene's first-frame signal
        // (AppScene's StartupFrameSignals never mounts in CPU mode).
        window.dispatchEvent(new Event('kalokagathia:first-frame'));
      }
    };

    raf = requestAnimationFrame(draw);
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      if (resizeObserver) resizeObserver.disconnect();
      reportCpuRendererStats(null, null);
    };
    // The loop reads config/playing through refs; it is mounted once.
  }, []);

  return (
    <div className="absolute inset-0" data-testid="cpu-fallback-scene">
      <canvas ref={canvasRef} className="block h-full w-full" />
      <div className="pointer-events-none absolute left-1/2 top-3 z-[80] flex -translate-x-1/2 flex-col items-center gap-2">
        <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-amber-200/30 bg-black/70 px-4 py-2 text-[11px] tracking-wide text-amber-100/90 backdrop-blur-md">
          <span>
            CPUフォールバック表示中（軽量・劣化版）
            {reason ? ` — ${REASON_LABELS[reason] ?? ''}` : ''}
            {layoutNote ? ' ※レイアウトは簡易分布で代替中' : ''}
          </span>
          {onExit && (
            <button
              type="button"
              onClick={onExit}
              className="shrink-0 rounded-full border border-white/25 bg-white/10 px-3 py-1 text-[10px] font-bold text-white/85 transition hover:bg-white/20"
            >
              通常表示に戻す
            </button>
          )}
        </div>
        {stats && (
          <div className="rounded-full bg-black/50 px-3 py-1 font-mono text-[10px] text-white/55">
            CPU {stats.fps} fps · {stats.count.toLocaleString()} 粒子
          </div>
        )}
      </div>
    </div>
  );
};
