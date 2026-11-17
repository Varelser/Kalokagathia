import React from 'react';
import { LocateFixed, Network, Video } from 'lucide-react';
import type { ParticleConfig, PresetRecord } from '../types';
import { buildPresetVector, cosineSimilarity, projectPresetsTo2D } from '../lib/presetSimilarity';
import { DEFAULT_WARMUP_FRAMES, MAX_DETERMINISTIC_FRAMES, MAX_DETERMINISTIC_VIDEO_FRAMES, renderDeterministicSequence, renderDeterministicVideo, type DeterministicBackgroundMode, type DeterministicLoopMeasurement, type DeterministicSequencePart } from '../lib/deterministicRender';
import { VideoEncodeUnsupportedError, type VideoFormat } from '../lib/videoEncode';
import { PerformanceRecorder, deleteTakeFrame, frameIndexAt, parseTake, reconstructAt, reconstructInterpolatedAt, serializeTake, shiftTakeFrame, type PerformanceTake } from '../lib/performanceRecorder';
import { effectivePosition, offsetFromEffective, padToWorld, withPosition, worldToPad } from '../lib/sourceEditor';
import { Slider } from './controlPanelParts';
import type { ControlPanelContentProps } from './controlPanelTabsShared';
import { SectionTitle } from './controlPanelPlayTabShared';

// App version handed to the deterministic renderer for its render.json
// manifest. Keep in sync with package.json "version" (the renderer must
// not import package.json, so the UI supplies it — see PRO1_BRIEF.md).
export const KALOKAGATHIA_APP_VERSION = '1.30.0';

// Phase C resolution presets for the deterministic renderer. 'canvas'
// captures at the canvas's current size (the pre-Phase-C behaviour);
// the others resize the renderer for the duration of the job.
export const DETERMINISTIC_RESOLUTION_PRESETS = [
  { id: 'canvas', label: '現在のキャンバス', width: 0, height: 0 },
  { id: '1920x1080', label: '1920×1080 (16:9)', width: 1920, height: 1080 },
  { id: '3840x2160', label: '3840×2160 (4K)', width: 3840, height: 2160 },
  { id: '1080x1920', label: '1080×1920 (9:16)', width: 1080, height: 1920 },
  { id: '1080x1080', label: '1080×1080 (1:1)', width: 1080, height: 1080 },
] as const;

export type DeterministicResolutionPresetId = (typeof DETERMINISTIC_RESOLUTION_PRESETS)[number]['id'];

export const DeterministicRenderControls: React.FC<{
  config: ParticleConfig;
  updateConfig: ControlPanelContentProps['updateConfig'];
}> = ({ config, updateConfig }) => {
  const [seconds, setSeconds] = React.useState(3);
  const [fps, setFps] = React.useState(24);
  const [format, setFormat] = React.useState<'zip' | VideoFormat>('zip');
  const [resolution, setResolution] = React.useState<DeterministicResolutionPresetId>('canvas');
  const [loopMode, setLoopMode] = React.useState(false);
  const [loopReport, setLoopReport] = React.useState<DeterministicLoopMeasurement | null>(null);
  const [renderStatus, setRenderStatus] = React.useState('');
  const [rendering, setRendering] = React.useState(false);
  const resolutionPreset = DETERMINISTIC_RESOLUTION_PRESETS.find((preset) => preset.id === resolution)
    ?? DETERMINISTIC_RESOLUTION_PRESETS[0];
  const requestedFrames = Math.max(1, Math.round(seconds * fps));
  const isVideo = format !== 'zip';
  // Pro-1.1: the background mode is the deterministicBackgroundMode
  // config key (default 'opaque' = the exact legacy export). An unknown
  // persisted value is treated as 'opaque' rather than failing.
  const backgroundMode: DeterministicBackgroundMode =
    config.deterministicBackgroundMode === 'transparent' || config.deterministicBackgroundMode === 'unmult'
      ? config.deterministicBackgroundMode
      : 'opaque';
  // The video encoder has no alpha channel, so the transparent modes
  // are PNG-sequence only: the UI disables the combinations outright
  // (and renderDeterministicVideo throws as a backstop) instead of
  // silently rendering an opaque video.
  const videoBlockedByBackground = isVideo && backgroundMode !== 'opaque';
  // ZIP parts stream out of memory, so the sequence path takes the full
  // cap; the video path collects every frame for the encoder and is
  // capped lower (stated in the UI below).
  const frameCap = isVideo ? MAX_DETERMINISTIC_VIDEO_FRAMES : MAX_DETERMINISTIC_FRAMES;
  const frames = Math.min(frameCap, requestedFrames);
  const capped = frames < requestedFrames;

  const download = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 4000);
  };

  const startRender = async () => {
    if (rendering) return;
    if (videoBlockedByBackground) {
      setRenderStatus('透過系の背景モードは動画（WebM／MP4）では書き出せません。形式を PNG連番 ZIP にするか、背景を「背景あり（従来）」にしてください。');
      return;
    }
    setRendering(true);
    setLoopReport(null);
    // Phase C: resolution preset + loop measurement ride along with
    // the job. measuredLoop is kept in a local (not only in state) so
    // the completion message below can quote the figures in the same
    // tick the render finishes.
    let measuredLoop: DeterministicLoopMeasurement | null = null;
    const onLoopMeasured = (measurement: DeterministicLoopMeasurement) => {
      measuredLoop = measurement;
      setLoopReport(measurement);
    };
    const jobExtras = {
      ...(resolutionPreset.width > 0
        ? { width: resolutionPreset.width, height: resolutionPreset.height, resolutionLabel: resolutionPreset.id }
        : {}),
      loopMode,
    };
    const loopStatusText = () => (measuredLoop
      ? ` ループ継ぎ目（1周期後のプローブ vs 先頭）: 平均差分 ${measuredLoop.seamDriftMeanAbsDiff.toFixed(2)} / 不一致ピクセル ${(measuredLoop.seamDriftMismatchRatio * 100).toFixed(2)}% / 最大 ${measuredLoop.seamMaxAbsDiff}。`
      : '');
    setRenderStatus('決定的レンダリングを開始します…');
    try {
      if (format === 'zip') {
        let partTotal = 1;
        const downloadPart = (part: DeterministicSequencePart) => {
          partTotal = part.partCount;
          download(
            part.blob,
            part.partCount > 1 ? `monosphere-frames-part${part.part}-of-${part.partCount}.zip` : 'monosphere-frames.zip',
          );
          setRenderStatus(
            part.partCount > 1
              ? `パート ${part.part} / ${part.partCount} をダウンロードしました（フレーム ${part.firstFrame + 1}〜${part.firstFrame + part.frames}）。残りをレンダリング中…`
              : 'ZIP をダウンロードしました。',
          );
        };
        await renderDeterministicSequence(
          { fps, frames, warmupFrames: DEFAULT_WARMUP_FRAMES, appVersion: KALOKAGATHIA_APP_VERSION, backgroundMode, ...jobExtras },
          (done, total) => {
            setRenderStatus(`レンダリング中… ${done} / ${total} フレーム`);
          },
          downloadPart,
          onLoopMeasured,
        );
        setRenderStatus(
          partTotal > 1
            ? `${frames} フレームを ${partTotal} 個の ZIP パートに分けて書き出しました（${fps}fps 固定ステップ・ウォームアップ ${DEFAULT_WARMUP_FRAMES} フレーム）。各パートのフレーム番号は通し番号なので、同じフォルダに展開すれば1本の連番になります。ffmpeg -framerate ${fps} -i frame-%04d.png などで動画化できます。${loopStatusText()}`
            : `${frames} フレームを ZIP に書き出しました（${fps}fps 固定ステップ・ウォームアップ ${DEFAULT_WARMUP_FRAMES} フレーム）。ffmpeg -framerate ${fps} -i frame-%04d.png などで動画化できます。${loopStatusText()}`,
        );
      } else {
        const video = await renderDeterministicVideo(
          { fps, frames, warmupFrames: DEFAULT_WARMUP_FRAMES, appVersion: KALOKAGATHIA_APP_VERSION, backgroundMode, ...jobExtras },
          format,
          (done, total) => {
            setRenderStatus(`レンダリング／エンコード中… ${done} / ${total} フレーム`);
          },
          onLoopMeasured,
        );
        download(video, `monosphere-render.${format}`);
        setRenderStatus(
          `${frames} フレームを ${format.toUpperCase()} 動画に書き出しました（${fps}fps 固定ステップ・フレーム時刻ちょうど・ウォームアップ ${DEFAULT_WARMUP_FRAMES} フレーム）。${loopStatusText()}`,
        );
      }
    } catch (error) {
      if (error instanceof VideoEncodeUnsupportedError) {
        setRenderStatus('このブラウザではその動画形式のエンコード（WebCodecs）に対応していません。PNG連番（ZIP）なら書き出せます。');
      } else {
        setRenderStatus('レンダリングに失敗しました。シーンが表示されている状態でもう一度お試しください。');
      }
    } finally {
      setRendering(false);
    }
  };

  return (
    <div className="mt-5 rounded-xl border border-white/10 bg-white/5 p-3 space-y-3">
      <p className="text-[11px] font-semibold tracking-wide">Deterministic Render · 決定的レンダリング</p>
      <p className="text-[11px] leading-relaxed text-white/45">
        シーンを初期状態に組み直し、時計を 0 に戻して、1フレーム = 1/{fps} 秒の固定ステップで進めながら PNG 連番を書き出します。機械の速さに依存せず、フレーム i は常にシミュレーション時刻 (i+1)/{fps} 秒の絵になります（通常の動画書き出しは実時間録画のため再現しません）。GPGPU の初期状態はシードで決まります。時間で動くオーバーレイ（テンポラルプロファイル／モジュレーション／音反応）は再現の範囲外なので、厳密な再現が必要なときは切ってください。GPUシミュレーションの粒子単位の完全一致は GPU の浮動小数点の決定性にも依存します（ソフトウェアGL環境では形状・個数・タイミングが一致しても粒子単位で数%ずれることを確認済み）。
      </p>
      <p className="text-[11px] leading-relaxed text-white/45">
        解像度は「現在のキャンバス」かプリセット（1920×1080 / 3840×2160 / 1080×1920 / 1080×1080）から選べます。プリセット選択時はレンダリング中だけその解像度に切り替わり、実解像度とプリセット名は各 ZIP の render.json に記録されます。撮影前に点火直後の過渡をやり過ごすため、最初の {DEFAULT_WARMUP_FRAMES} フレームは撮影せずにステップだけ進めます（ウォームアップ。フレーム i のシミュレーション時刻は ({DEFAULT_WARMUP_FRAMES}+i+1)/{fps} 秒になります）。PNG連番（ZIP）は最大 {MAX_DETERMINISTIC_FRAMES} フレームまで、600フレームごとにパート分割して順次ダウンロードします。動画（WebM／MP4）は全フレームをメモリに保持するため最大 {MAX_DETERMINISTIC_VIDEO_FRAMES} フレームまでです{capped ? `（現在の設定は上限で ${frames} フレームに制限されています）` : ''}。
      </p>
      <Slider label="Seconds · 長さ（秒）" value={seconds} min={1} max={30} step={1} onChange={setSeconds} />
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-white/50">FPS</span>
        {([12, 24, 30, 60] as const).map((option) => (
          <button
            key={option}
            onClick={() => setFps(option)}
            className={`px-3 py-1 rounded-full text-[10px] font-bold ${fps === option ? 'bg-white text-black' : 'bg-white/10 text-white/60'}`}
          >
            {option}
          </button>
        ))}
        <span className="ml-auto font-mono text-[10px] text-white/40">{frames} frames</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] text-white/50">解像度</span>
        {DETERMINISTIC_RESOLUTION_PRESETS.map((option) => (
          <button
            key={option.id}
            onClick={() => setResolution(option.id)}
            className={`px-3 py-1 rounded-full text-[10px] font-bold ${resolution === option.id ? 'bg-white text-black' : 'bg-white/10 text-white/60'}`}
          >
            {option.label}
          </button>
        ))}
      </div>
      {resolution === '3840x2160' && isVideo && (
        <p className="text-[11px] leading-relaxed text-amber-200/80">
          4K 動画は全フレームをメモリに保持するため非常に重くなります。長尺では PNG連番 ZIP を推奨します。
        </p>
      )}
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-white/50">形式</span>
        {([
          { val: 'zip', label: 'PNG連番 ZIP' },
          { val: 'webm', label: 'WebM 動画' },
          { val: 'mp4', label: 'MP4 動画' },
        ] as const).map((option) => (
          <button
            key={option.val}
            onClick={() => setFormat(option.val)}
            disabled={backgroundMode !== 'opaque' && option.val !== 'zip'}
            title={backgroundMode !== 'opaque' && option.val !== 'zip' ? '透過系の背景モードは PNG連番 ZIP 専用です' : undefined}
            className={`px-3 py-1 rounded-full text-[10px] font-bold disabled:cursor-not-allowed disabled:opacity-30 ${format === option.val ? 'bg-white text-black' : 'bg-white/10 text-white/60'}`}
          >
            {option.label}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] text-white/50">背景</span>
        {([
          { val: 'opaque', label: '背景あり（従来）' },
          { val: 'transparent', label: '透過（PostFxなし）' },
          { val: 'unmult', label: '透過 + PostFx（UnMult）' },
        ] as const).map((option) => (
          <button
            key={option.val}
            onClick={() => updateConfig('deterministicBackgroundMode', option.val)}
            disabled={isVideo && option.val !== 'opaque'}
            title={isVideo && option.val !== 'opaque' ? '動画は alpha を持てないため、透過系は PNG連番 ZIP 専用です' : undefined}
            className={`px-3 py-1 rounded-full text-[10px] font-bold disabled:cursor-not-allowed disabled:opacity-30 ${backgroundMode === option.val ? 'bg-white text-black' : 'bg-white/10 text-white/60'}`}
          >
            {option.label}
          </button>
        ))}
      </div>
      {backgroundMode === 'unmult' && (
        <p className="text-[11px] leading-relaxed text-white/45">
          UnMult: 黒背景で PostFx 全段を効かせて描き、キャプチャ時に alpha = smoothstep(max(r,g,b)) を導出して非プリマルチプライで出します。Bloom の光も alpha 付きで残ります。PNG連番 ZIP 専用です。
        </p>
      )}
      {backgroundMode === 'transparent' && (
        <p className="text-[11px] leading-relaxed text-white/45">
          従来方式の透過: PostFx を通さずシーンを直接描くため、Bloom 等のポスト効果は乗りません。PNG連番 ZIP 専用です。
        </p>
      )}
      {videoBlockedByBackground && (
        <p className="text-[11px] leading-relaxed text-amber-200/80">
          現在は透過系の背景モードと動画形式が組み合わさっています（プリセット読込等で変わった場合）。動画は alpha を持てないため、この組合せでは書き出せません。
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] text-white/50">ループ</span>
        <button
          onClick={() => setLoopMode((prev) => !prev)}
          className={`px-3 py-1 rounded-full text-[10px] font-bold ${loopMode ? 'bg-white text-black' : 'bg-white/10 text-white/60'}`}
        >
          {loopMode ? '継ぎ目計測 ON' : '継ぎ目計測 OFF'}
        </button>
        <span className="text-[10px] leading-relaxed text-white/40">
          ON では最終フレームの後に1周期分進めたプローブを描き、先頭フレームとの差分（ドリフト）を計測して結果と render.json に記録します。時間駆動の要素は周期が一致すれば差分≈0 になりますが、状態を持つシミュレーション（GPGPU 等）は蓄積するため、これは保証ではなく計測値です。シーン全体の回転速度（表示設定）も動きの一部です — ループさせる場合は、書き出し長でちょうど整数周する速度にするか 0 にしてください（既定の 0.001 rad/frame のままだと継ぎ目がずれます）。
        </span>
      </div>
      <button
        onClick={startRender}
        disabled={rendering || videoBlockedByBackground}
        className="px-4 py-2 rounded-full bg-white text-black text-[10px] font-bold uppercase tracking-widest hover:bg-gray-200 transition-colors disabled:opacity-40"
      >
        {rendering ? 'レンダリング中…' : format === 'zip' ? 'PNG連番を書き出す（ZIP）' : `${format.toUpperCase()} 動画を書き出す`}
      </button>
      {renderStatus && <p className="text-[11px] text-white/55">{renderStatus}</p>}
      {loopReport && (
        <p className="text-[11px] leading-relaxed text-white/55">
          ループ継ぎ目計測（{loopReport.periodFrames} フレーム = {loopReport.periodSeconds.toFixed(2)} 秒周期）:
          ドリフト（1周期後 vs 先頭）平均 {loopReport.seamDriftMeanAbsDiff.toFixed(2)} / 不一致 {(loopReport.seamDriftMismatchRatio * 100).toFixed(2)}% / 最大 {loopReport.seamMaxAbsDiff}、
          ジャンプ（末尾 vs 先頭）平均 {loopReport.seamJumpMeanAbsDiff.toFixed(2)} / 不一致 {(loopReport.seamJumpMismatchRatio * 100).toFixed(2)}%。
          {loopReport.seamDriftMeanAbsDiff < 0.5
            ? 'ドリフトはほぼ 0 で、この長さでは継ぎ目なくループします。'
            : 'ドリフトが残っています（状態を持つシミュレーションの蓄積）。継ぎ目が目立つ場合は編集側のクロスフェードが対処になります。'}
        </p>
      )}
    </div>
  );
};

export const PERFORMANCE_MAX_MS = 120_000;
export const PERFORMANCE_SAMPLE_MS = 150;

export const PerformanceSection: React.FC<{
  config: ParticleConfig;
  onApplyConfig?: ControlPanelContentProps['onApplyConfig'];
}> = ({ config, onApplyConfig }) => {
  const [isRecording, setIsRecording] = React.useState(false);
  const [take, setTake] = React.useState<PerformanceTake | null>(null);
  const [recordElapsed, setRecordElapsed] = React.useState(0);
  const [isPlaying, setIsPlaying] = React.useState(false);
  const [loop, setLoop] = React.useState(true);
  const [playhead, setPlayhead] = React.useState(0);
  const [interpolate, setInterpolate] = React.useState(true);
  const [exportBusy, setExportBusy] = React.useState(false);
  const [exportNote, setExportNote] = React.useState('');
  const takeFileRef = React.useRef<HTMLInputElement | null>(null);

  const configRef = React.useRef(config);
  configRef.current = config;
  const recorderRef = React.useRef<PerformanceRecorder | null>(null);
  const recordStartRef = React.useRef(0);
  const playheadRef = React.useRef(0);
  playheadRef.current = playhead;

  const stopRecording = React.useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    const elapsed = Math.min(performance.now() - recordStartRef.current, PERFORMANCE_MAX_MS);
    recorder.sample(configRef.current, elapsed);
    setTake(recorder.finish(elapsed));
    recorderRef.current = null;
    setIsRecording(false);
    setPlayhead(0);
  }, []);

  React.useEffect(() => {
    if (!isRecording) return;
    const timer = window.setInterval(() => {
      const recorder = recorderRef.current;
      if (!recorder) return;
      const t = performance.now() - recordStartRef.current;
      if (t >= PERFORMANCE_MAX_MS) {
        stopRecording();
        return;
      }
      recorder.sample(configRef.current, t);
      setRecordElapsed(t);
    }, PERFORMANCE_SAMPLE_MS);
    return () => window.clearInterval(timer);
  }, [isRecording, stopRecording]);

  React.useEffect(() => {
    if (!isPlaying || !take || !onApplyConfig) return;
    const playback = {
      startStamp: performance.now(),
      startOffset: playheadRef.current >= take.durationMs ? 0 : playheadRef.current,
      lastIndex: -2,
    };
    if (playback.startOffset === 0) onApplyConfig(take.base);
    const timer = window.setInterval(() => {
      let t = playback.startOffset + (performance.now() - playback.startStamp);
      if (t >= take.durationMs) {
        if (loop && take.durationMs > 0) {
          onApplyConfig(take.base);
          playback.startStamp = performance.now();
          playback.startOffset = 0;
          playback.lastIndex = -2;
          t = 0;
        } else {
          setPlayhead(take.durationMs);
          setIsPlaying(false);
          return;
        }
      }
      setPlayhead(t);
      const index = frameIndexAt(take, t);
      if (interpolate) {
        // Interpolated playback: numeric keys move continuously, so the
        // config is applied on every tick, not only at keyframes.
        if (index >= 0) onApplyConfig(reconstructInterpolatedAt(take, t));
        playback.lastIndex = index;
      } else if (index !== playback.lastIndex) {
        playback.lastIndex = index;
        if (index >= 0) onApplyConfig(reconstructAt(take, t));
      }
    }, 50);
    return () => window.clearInterval(timer);
  }, [isPlaying, take, loop, onApplyConfig, interpolate]);

  const startRecording = () => {
    recorderRef.current = new PerformanceRecorder(configRef.current);
    recordStartRef.current = performance.now();
    setRecordElapsed(0);
    setIsPlaying(false);
    setIsRecording(true);
  };

  const scrub = (value: number) => {
    if (!take || !onApplyConfig) return;
    setIsPlaying(false);
    setPlayhead(value);
    onApplyConfig(interpolate ? reconstructInterpolatedAt(take, value) : reconstructAt(take, value));
  };

  const handleExportTake = () => {
    if (!take) return;
    const blob = new Blob([serializeTake(take)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `kalokagathia_take_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportTake = async (file: File) => {
    const parsed = parseTake(await file.text());
    if (!parsed) {
      setExportNote('テイクファイルを読み込めませんでした');
      return;
    }
    setIsPlaying(false);
    setTake(parsed);
    setPlayhead(0);
    setExportNote(`テイクを読み込みました（${parsed.frames.length} フレーム）`);
  };

  // Export the take through the deterministic render pipeline: the take
  // drives the config at exact frame timestamps while the scene is
  // stepped with a fixed timestep, producing a PNG sequence ZIP.
  const handleDeterministicExport = async () => {
    if (!take || !onApplyConfig || exportBusy) return;
    setExportBusy(true);
    setExportNote('');
    try {
      onApplyConfig(take.base);
      const fps = 30;
      const requestedFrames = Math.max(1, Math.ceil((take.durationMs / 1000) * fps));
      const frames = Math.min(MAX_DETERMINISTIC_FRAMES, requestedFrames);
      const truncated = frames < requestedFrames;
      // The renderer's applyAt receives stepped-clock time including the
      // warmup; offset by the warmup so captured frame i still applies the
      // take at its own (i+1)/fps (warmup steps land at t <= 0, i.e. the
      // take's initial config — the base applied above).
      const warmupSeconds = DEFAULT_WARMUP_FRAMES / fps;
      let partTotal = 1;
      await renderDeterministicSequence(
        {
          fps,
          frames,
          warmupFrames: DEFAULT_WARMUP_FRAMES,
          appVersion: KALOKAGATHIA_APP_VERSION,
          // The take export keeps its pre-Pro-1.1 opaque behaviour
          // regardless of the render panel's background-mode key.
          backgroundMode: 'opaque',
          applyAt: (tSec: number) => onApplyConfig(reconstructInterpolatedAt(take, Math.max(0, (tSec - warmupSeconds) * 1000))),
        },
        (done, total) => setExportNote(`決定論的書き出し中 ${done}/${total}`),
        (part) => {
          partTotal = part.partCount;
          const url = URL.createObjectURL(part.blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = part.partCount > 1
            ? `kalokagathia_take_frames_part${part.part}-of-${part.partCount}_${Date.now()}.zip`
            : `kalokagathia_take_frames_${Date.now()}.zip`;
          a.click();
          URL.revokeObjectURL(url);
        },
      );
      setExportNote(`決定論的書き出しが完了しました（${frames} フレーム / 30fps${partTotal > 1 ? `、${partTotal} パートに分割` : ''}${truncated ? `、上限 ${MAX_DETERMINISTIC_FRAMES} フレームで打ち切り` : ''}）`);
    } catch {
      setExportNote('決定論的書き出しに失敗しました');
    } finally {
      setExportBusy(false);
    }
  };

  const formatTime = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
  const canPlay = Boolean(take && take.frames.length > 0 && onApplyConfig);

  return (
    <section>
      <SectionTitle icon={<Video size={12} />}>Performance · 演奏の記録</SectionTitle>
      <p className="text-[11px] leading-relaxed text-white/45 mb-4">
        マクロや XY パッド、MIDI、プリセット切替の動きをそのまま録画して、再生・スクラブできます（最大2分）。キーフレームの時刻変更・削除ができるタイムライン編集、補間再生、テイクの JSON 書き出し/読み込み、決定論的レンダリングでの PNG 連番書き出しに対応します。
      </p>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        {!isRecording ? (
          <button
            onClick={startRecording}
            className="px-4 py-2 rounded-full bg-white text-black text-[10px] font-bold uppercase tracking-widest hover:bg-gray-200 transition-colors"
          >
            ● 録画開始
          </button>
        ) : (
          <button
            onClick={stopRecording}
            className="px-4 py-2 rounded-full bg-red-400 text-black text-[10px] font-bold uppercase tracking-widest hover:bg-red-300 transition-colors"
          >
            ■ 録画停止（{formatTime(recordElapsed)}）
          </button>
        )}
        {take && !isRecording && (
          <span className="text-[11px] text-white/55">
            テイク：{formatTime(take.durationMs)} / {take.frames.length} フレーム
          </span>
        )}
      </div>
      {take && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {!isPlaying ? (
              <button
                onClick={() => canPlay && setIsPlaying(true)}
                disabled={!canPlay}
                className="px-4 py-2 rounded-full bg-white text-black text-[10px] font-bold uppercase tracking-widest hover:bg-gray-200 transition-colors disabled:opacity-40"
              >
                ▶ 再生
              </button>
            ) : (
              <button
                onClick={() => setIsPlaying(false)}
                className="px-4 py-2 rounded-full bg-white text-black text-[10px] font-bold uppercase tracking-widest hover:bg-gray-200 transition-colors"
              >
                ❚❚ 一時停止
              </button>
            )}
            <button
              onClick={() => setLoop((prev) => !prev)}
              className={`px-3 py-2 rounded-full border text-[10px] uppercase tracking-widest transition-colors ${
                loop ? 'border-white/60 text-white' : 'border-white/15 text-white/40'
              }`}
            >
              ループ {loop ? 'ON' : 'OFF'}
            </button>
            <button
              onClick={() => setInterpolate((prev) => !prev)}
              data-testid="take-interpolate"
              title="数値キーをキーフレーム間でなめらかに補間して再生します"
              className={`px-3 py-2 rounded-full border text-[10px] uppercase tracking-widest transition-colors ${
                interpolate ? 'border-white/60 text-white' : 'border-white/15 text-white/40'
              }`}
            >
              補間再生 {interpolate ? 'ON' : 'OFF'}
            </button>
            <button
              onClick={() => {
                setIsPlaying(false);
                setTake(null);
                setPlayhead(0);
              }}
              className="px-3 py-2 rounded-full border border-white/15 text-[10px] uppercase tracking-widest text-white/40 hover:bg-white/10"
            >
              テイクを消す
            </button>
            <span className="font-mono text-[11px] text-white/50">
              {formatTime(playhead)} / {formatTime(take.durationMs)}
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={Math.max(1, take.durationMs)}
            step={10}
            value={Math.min(playhead, take.durationMs)}
            onChange={(event) => scrub(Number(event.target.value))}
            className="w-full accent-white"
            aria-label="再生位置（スクラブ）"
          />
          <p className="text-[10px] text-white/30">
            スライダーを動かすと、その瞬間の状態にスクラブできます。再生は録画開始時点の設定から始まります。
          </p>
          <div className="border-t border-white/10 pt-3">
            <div className="mb-2 text-[10px] uppercase tracking-widest text-white/50">タイムライン編集（{take.frames.length} キーフレーム）</div>
            <div className="max-h-44 space-y-1 overflow-y-auto pr-1" data-testid="take-timeline">
              {take.frames.map((frame, index) => (
                <div key={`${frame.t}-${index}`} className="flex items-center gap-2 rounded border border-white/10 bg-white/5 px-2 py-1">
                  <input
                    type="number"
                    min={0}
                    max={take.durationMs}
                    step={50}
                    value={frame.t}
                    onChange={(event) => setTake((prev) => (prev ? shiftTakeFrame(prev, index, Number(event.target.value)) : prev))}
                    className="w-20 rounded bg-black/40 px-1 py-0.5 font-mono text-[10px] text-white/85 outline-none"
                    aria-label="キーフレーム時刻 (ms)"
                  />
                  <span className="flex-1 truncate text-[10px] text-white/50">
                    {Object.keys(frame.changes).slice(0, 3).join(', ')}
                    {Object.keys(frame.changes).length > 3 ? ` ほか ${Object.keys(frame.changes).length - 3}` : ''}
                  </span>
                  <button
                    type="button"
                    onClick={() => setTake((prev) => (prev ? deleteTakeFrame(prev, index) : prev))}
                    className="rounded border border-white/15 px-2 py-0.5 text-[9px] uppercase tracking-widest text-white/60 hover:bg-white/10"
                  >
                    削除
                  </button>
                </div>
              ))}
              {take.frames.length === 0 && <p className="text-[10px] text-white/35">キーフレームがありません。</p>}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 border-t border-white/10 pt-3">
            <button
              type="button"
              onClick={handleExportTake}
              data-testid="take-export-json"
              className="rounded border border-white/20 px-3 py-1.5 text-[10px] tracking-wider text-white/80 transition-colors hover:bg-white/10"
            >
              テイクを書き出す（JSON）
            </button>
            <button
              type="button"
              onClick={() => takeFileRef.current?.click()}
              className="rounded border border-white/20 px-3 py-1.5 text-[10px] tracking-wider text-white/80 transition-colors hover:bg-white/10"
            >
              テイクを読み込む
            </button>
            <input
              ref={takeFileRef}
              type="file"
              accept="application/json"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void handleImportTake(file);
                event.target.value = '';
              }}
            />
            <button
              type="button"
              onClick={() => void handleDeterministicExport()}
              disabled={exportBusy || !onApplyConfig}
              data-testid="take-export-deterministic"
              className="rounded border border-white/20 px-3 py-1.5 text-[10px] tracking-wider text-white/80 transition-colors hover:bg-white/10 disabled:opacity-40"
            >
              {exportBusy ? '書き出し中…' : '決定論的書き出し（PNG ZIP）'}
            </button>
            {exportNote ? <span className="w-full text-[10px] text-emerald-300/90" data-testid="take-export-note">{exportNote}</span> : null}
          </div>
        </div>
      )}
    </section>
  );
};

export type SourceLayerIndex = 1 | 2 | 3;

export const SourceEditorSection: React.FC<{
  config: ParticleConfig;
  updateConfig: ControlPanelContentProps['updateConfig'];
}> = ({ config, updateConfig }) => {
  const write = updateConfig as (key: keyof ParticleConfig, value: ParticleConfig[keyof ParticleConfig]) => void;
  const [layer, setLayer] = React.useState<SourceLayerIndex>(2);
  const [selected, setSelected] = React.useState(0);
  const padRef = React.useRef<HTMLDivElement | null>(null);
  const dragIndexRef = React.useRef<number | null>(null);

  const prefix = `layer${layer}` as 'layer1' | 'layer2' | 'layer3';
  const positionsKey = `${prefix}SourcePositions` as keyof ParticleConfig;
  const countKey = `${prefix}SourceCount` as keyof ParticleConfig;
  const spreadKey = `${prefix}SourceSpread` as keyof ParticleConfig;
  const positions = (config[positionsKey] as { x: number; y: number; z: number }[] | undefined) ?? [];
  const count = Math.max(1, Math.min(50, Math.round((config[countKey] as number) || 1)));
  const spread = (config[spreadKey] as number) || 0;
  const validSelected = Math.min(selected, count - 1);

  const offsetAt = (index: number) => positions[index] ?? { x: 0, y: 0, z: 0 };
  const effectiveAt = (index: number) => effectivePosition(offsetAt(index), index, count, spread);

  const moveSelectedTo = (index: number, worldX: number, worldZ: number) => {
    const current = offsetAt(index);
    const nextOffset = offsetFromEffective({ x: worldX, y: current.y, z: worldZ }, index, count, spread);
    write(positionsKey, withPosition(positions, count, index, nextOffset));
  };

  const handlePointer = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.buttons !== 1 && event.type !== 'pointerdown') return;
    const rect = padRef.current?.getBoundingClientRect();
    if (!rect) return;
    const rx = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    const ry = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height));
    const world = padToWorld(rx, ry);
    if (event.type === 'pointerdown' || dragIndexRef.current === null) {
      let nearest = 0;
      let nearestDist = Number.POSITIVE_INFINITY;
      for (let i = 0; i < count; i++) {
        const pad = worldToPad(effectiveAt(i));
        const d = (pad.rx - rx) ** 2 + (pad.ry - ry) ** 2;
        if (d < nearestDist) {
          nearestDist = d;
          nearest = i;
        }
      }
      dragIndexRef.current = nearest;
      setSelected(nearest);
    }
    moveSelectedTo(dragIndexRef.current, world.x, world.z);
  };

  const endDrag = () => {
    dragIndexRef.current = null;
  };

  const selectedOffset = offsetAt(validSelected);
  const selectedEffective = effectiveAt(validSelected);

  const selectClass =
    'bg-white/5 border border-white/10 rounded px-2 py-2 text-xs outline-none focus:border-white/40';

  return (
    <section>
      <SectionTitle icon={<LocateFixed size={12} />}>Source Editor · 発生源エディタ</SectionTitle>
      <p className="text-[11px] leading-relaxed text-white/45 mb-4">
        発生源（エミッタ）の配置を真上から見た図で直接ドラッグできます。点は実際の配置（手動オフセット＋Spread の円環配置）を表し、ドラッグするとオフセットに換算して保存されます。高さは下のスライダーで調整します。
      </p>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <select
          value={layer}
          onChange={(event) => {
            setLayer(Number(event.target.value) as SourceLayerIndex);
            setSelected(0);
          }}
          className={selectClass}
        >
          <option value={1} className="bg-neutral-900">Layer 1</option>
          <option value={2} className="bg-neutral-900">Layer 2</option>
          <option value={3} className="bg-neutral-900">Layer 3</option>
        </select>
        <span className="text-[11px] text-white/55">
          発生源 {count} 個 / Spread {spread}
        </span>
        {spread !== 0 && (
          <button
            onClick={() => write(spreadKey, 0)}
            className="px-3 py-1.5 rounded-full border border-white/20 text-[10px] uppercase tracking-widest text-white/70 hover:bg-white/10"
          >
            Spread を 0 にする（絶対配置）
          </button>
        )}
      </div>
      <div
        ref={padRef}
        onPointerDown={handlePointer}
        onPointerMove={handlePointer}
        onPointerUp={endDrag}
        onPointerLeave={endDrag}
        className="relative h-56 rounded-xl border border-white/15 bg-white/5 overflow-hidden touch-none cursor-crosshair select-none mb-3"
      >
        <div className="absolute inset-x-0 top-1/2 h-px bg-white/10" />
        <div className="absolute inset-y-0 left-1/2 w-px bg-white/10" />
        <span className="absolute right-2 top-1.5 text-[9px] uppercase tracking-widest text-white/30">X →</span>
        <span className="absolute left-2 bottom-1.5 text-[9px] uppercase tracking-widest text-white/30">↓ Z</span>
        {Array.from({ length: count }).map((_, index) => {
          const pad = worldToPad(effectiveAt(index));
          const isSelected = index === validSelected;
          return (
            <div
              key={index}
              className={`absolute -ml-2 -mt-2 flex items-center justify-center rounded-full text-[8px] font-bold ${
                isSelected
                  ? 'h-5 w-5 -ml-2.5 -mt-2.5 bg-white text-black shadow-[0_0_12px_rgba(255,255,255,0.8)] z-10'
                  : 'h-4 w-4 bg-white/35 text-black/70'
              }`}
              style={{ left: `${pad.rx * 100}%`, top: `${pad.ry * 100}%` }}
            >
              {index + 1}
            </div>
          );
        })}
      </div>
      <div className="space-y-2">
        <label className="block">
          <span className="block text-[10px] uppercase tracking-widest text-white/40 mb-1">
            発生源 {validSelected + 1} の高さ Y（現在 {Math.round(selectedOffset.y)}）
          </span>
          <input
            type="range"
            min={-5000}
            max={5000}
            step={10}
            value={selectedOffset.y}
            onChange={(event) => {
              const y = Number(event.target.value);
              write(positionsKey, withPosition(positions, count, validSelected, { ...selectedOffset, y }));
            }}
            className="w-full accent-white"
          />
        </label>
        <label className="block">
          <span className="block text-[10px] uppercase tracking-widest text-white/40 mb-1">
            Spread（円環配置の半径、現在 {spread}）
          </span>
          <input
            type="range"
            min={0}
            max={20000}
            step={10}
            value={spread}
            onChange={(event) => write(spreadKey, Number(event.target.value))}
            className="w-full accent-white"
          />
        </label>
        <p className="font-mono text-[10px] text-white/35">
          #{validSelected + 1} 実配置 ({Math.round(selectedEffective.x)}, {Math.round(selectedEffective.y)},{' '}
          {Math.round(selectedEffective.z)}) / オフセット ({Math.round(selectedOffset.x)},{' '}
          {Math.round(selectedOffset.y)}, {Math.round(selectedOffset.z)})
        </p>
      </div>
    </section>
  );
};

export const SimilaritySection: React.FC<{
  presets: PresetRecord[];
  activePresetId: string | null;
  onLoadPreset: (presetId: string) => void;
}> = ({ presets, activePresetId, onLoadPreset }) => {
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const effectiveSelectedId =
    selectedId && presets.some((preset) => preset.id === selectedId)
      ? selectedId
      : (activePresetId ?? presets[0]?.id ?? null);

  const vectors = React.useMemo(() => {
    const map = new Map<string, number[]>();
    for (const preset of presets) map.set(preset.id, buildPresetVector(preset.config));
    return map;
  }, [presets]);

  const points = React.useMemo(() => projectPresetsTo2D(presets), [presets]);
  const pointById = React.useMemo(() => new Map(points.map((point) => [point.id, point])), [points]);

  const neighbors = React.useMemo(() => {
    if (!effectiveSelectedId) return [];
    const target = vectors.get(effectiveSelectedId);
    if (!target) return [];
    return presets
      .filter((preset) => preset.id !== effectiveSelectedId)
      .map((preset) => ({
        preset,
        similarity: cosineSimilarity(target, vectors.get(preset.id) ?? []),
      }))
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 8);
  }, [presets, vectors, effectiveSelectedId]);

  const selectedPreset = presets.find((preset) => preset.id === effectiveSelectedId) ?? null;

  return (
    <section>
      <SectionTitle icon={<Network size={12} />}>Similarity Map · 類似マップ</SectionTitle>
      <p className="text-[11px] leading-relaxed text-white/45 mb-4">
        全プリセットを「パラメータの形」で地図化したものです。数値パラメータ355種を主成分2軸に圧縮して配置しているので、近くにある点同士は似た見た目・動きの傾向を持ちます。点を選ぶと、そのプリセットに最も似た8件を表示します。類似度は数値の形にモーションとソースの種類も加えて計算しています。
      </p>
      <div className="rounded-xl border border-white/10 bg-black/40 overflow-hidden mb-3">
        <svg viewBox="0 0 100 62" className="w-full block" role="img" aria-label="プリセット類似マップ">
          {points.map((point) => {
            const isSelected = point.id === effectiveSelectedId;
            const isActive = point.id === activePresetId;
            return (
              <circle
                key={point.id}
                cx={4 + point.x * 92}
                cy={4 + point.y * 54}
                r={isSelected ? 1.7 : 0.85}
                fill={isSelected ? '#ffffff' : isActive ? '#d4d4d4' : 'rgba(255,255,255,0.38)'}
                stroke={isActive ? '#ffffff' : 'none'}
                strokeWidth={isActive ? 0.35 : 0}
                className="cursor-pointer"
                onClick={() => setSelectedId(point.id)}
              >
                <title>{presets.find((preset) => preset.id === point.id)?.name ?? point.id}</title>
              </circle>
            );
          })}
        </svg>
      </div>
      {selectedPreset && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] text-white/70 truncate">
              選択中：<span className="text-white font-medium">{selectedPreset.name}</span>
              <span className="font-mono text-[9px] uppercase tracking-wider text-white/35 ml-2">
                {selectedPreset.config.layer2Type} / {selectedPreset.config.layer3Type}
              </span>
            </p>
            <button
              onClick={() => onLoadPreset(selectedPreset.id)}
              className="px-3 py-1.5 rounded-full bg-white text-black text-[10px] font-bold uppercase tracking-widest hover:bg-gray-200 transition-colors shrink-0"
            >
              試す
            </button>
          </div>
          <ul className="divide-y divide-white/5">
            {neighbors.map(({ preset, similarity }) => (
              <li key={preset.id} className="flex items-center justify-between gap-2 py-1.5">
                <button onClick={() => setSelectedId(preset.id)} className="text-left min-w-0">
                  <span className="block truncate text-[11px] text-white/75 hover:text-white transition-colors">{preset.name}</span>
                  <span className="block font-mono text-[9px] uppercase tracking-wider text-white/35">
                    {preset.config.layer2Type} / {preset.config.layer3Type}
                  </span>
                </button>
                <span className="flex items-center gap-2 shrink-0">
                  <span className="font-mono text-[10px] text-white/50">{Math.round(similarity * 100)}%</span>
                  <button
                    onClick={() => onLoadPreset(preset.id)}
                    className="px-2.5 py-1 rounded-full bg-white/10 text-white/70 text-[10px] font-bold uppercase tracking-widest hover:bg-white/20 transition-colors"
                  >
                    試す
                  </button>
                </span>
              </li>
            ))}
          </ul>
          {pointById.size === 0 && <p className="text-[11px] text-white/35">プリセットがありません。</p>}
        </div>
      )}
    </section>
  );
};

