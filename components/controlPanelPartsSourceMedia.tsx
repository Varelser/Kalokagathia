import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Slider, Toggle } from './controlPanelPartsCore';
import { MEDIA_SAMPLE_SIZE, extractLumaMap, extractTextLumaMap } from './controlPanelPartsSourceMediaUtils';
import { textPageCount } from '../lib/textPageLayout';

export type MediaSourceSettingsProps = {
  mode: 'image' | 'video' | 'text';
  currentTheme: 'white' | 'black';
  threshold: number;
  depth: number;
  invert: boolean;
  frameRate: number;
  mapWidth: number;
  mapHeight: number;
  hasMap: boolean;
  onThresholdChange: (value: number) => void;
  onDepthChange: (value: number) => void;
  onInvertChange: (value: boolean) => void;
  onFrameRateChange: (value: number) => void;
  onMapChange: (map: number[], width: number, height: number) => void;
  onClear: () => void;
  textValue?: string;
  onTextValueChange?: (value: string) => void;
  textFontFamily?: string;
  onTextFontFamilyChange?: (value: string) => void;
  textWeight?: number;
  onTextWeightChange?: (value: number) => void;
  textSize?: number;
  onTextSizeChange?: (value: number) => void;
  textPadding?: number;
  onTextPaddingChange?: (value: number) => void;
  textInvert?: boolean;
  onTextInvertChange?: (value: boolean) => void;
  // Vertical text layout (Phase BG): optional props — only the
  // layer-2 TextMap wiring passes them (the layer-2 TextMap keys
  // are the ones the morph / supply / mask paths read).
  textVertical?: boolean;
  onTextVerticalChange?: (value: boolean) => void;
  textColumnLength?: number;
  onTextColumnLengthChange?: (value: number) => void;
  textColumnGap?: number;
  onTextColumnGapChange?: (value: number) => void;
  textLetterSpacing?: number;
  onTextLetterSpacingChange?: (value: number) => void;
  // Vertical text finishing (Phase BK): same optional-prop
  // convention as the BG fields above.
  textKinsoku?: boolean;
  onTextKinsokuChange?: (value: boolean) => void;
  textYakumono?: boolean;
  onTextYakumonoChange?: (value: boolean) => void;
  // Vertical text finishing (Phase BP): same optional-prop
  // convention as the BK fields above.
  textTateChuYoko?: boolean;
  onTextTateChuYokoChange?: (value: boolean) => void;
  textRuby?: boolean;
  onTextRubyChange?: (value: boolean) => void;
  // Text pages (Phase 17): same optional-prop convention as the
  // BP fields above.
  textPageEnabled?: boolean;
  onTextPageEnabledChange?: (value: boolean) => void;
  textColumnBalance?: boolean;
  onTextColumnBalanceChange?: (value: boolean) => void;
  textPageIndex?: number;
  onTextPageIndexChange?: (value: number) => void;
};

export const SourceMediaSettings: React.FC<MediaSourceSettingsProps> = ({
  mode,
  currentTheme,
  threshold,
  depth,
  invert,
  frameRate,
  mapWidth,
  mapHeight,
  hasMap,
  onThresholdChange,
  onDepthChange,
  onInvertChange,
  onFrameRateChange,
  onMapChange,
  onClear,
  textValue,
  onTextValueChange,
  textFontFamily,
  onTextFontFamilyChange,
  textWeight,
  onTextWeightChange,
  textSize,
  onTextSizeChange,
  textPadding,
  onTextPaddingChange,
  textInvert,
  onTextInvertChange,
  textVertical,
  onTextVerticalChange,
  textColumnLength,
  onTextColumnLengthChange,
  textColumnGap,
  onTextColumnGapChange,
  textLetterSpacing,
  onTextLetterSpacingChange,
  textKinsoku,
  onTextKinsokuChange,
  textYakumono,
  onTextYakumonoChange,
  textTateChuYoko,
  onTextTateChuYokoChange,
  textRuby,
  onTextRubyChange,
  textPageEnabled,
  onTextPageEnabledChange,
  textColumnBalance,
  onTextColumnBalanceChange,
  textPageIndex,
  onTextPageIndexChange,
}) => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const intervalRef = useRef<number | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isCameraLive, setIsCameraLive] = useState(false);
  const [status, setStatus] = useState('No media loaded');

  const accept = mode === 'video' ? 'video/*' : 'image/*';
  const sampleSize = useMemo(() => ({ width: MEDIA_SAMPLE_SIZE, height: MEDIA_SAMPLE_SIZE }), []);

  const clearPlaybackLoop = () => {
    if (intervalRef.current !== null) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  };

  const releaseObjectUrl = () => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  };

  const stopCamera = () => {
    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach((track) => track.stop());
      cameraStreamRef.current = null;
    }
    if (videoRef.current && videoRef.current.srcObject) {
      videoRef.current.srcObject = null;
    }
    setIsCameraLive(false);
  };

  useEffect(() => () => {
    clearPlaybackLoop();
    releaseObjectUrl();
    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach((track) => track.stop());
      cameraStreamRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (mode !== 'video') {
      clearPlaybackLoop();
      // eslint-disable-next-line react-hooks/set-state-in-effect -- leaving video mode must clear the playing flag immediately; a mode-change reset, not derived render state.
      setIsPlaying(false);
      return;
    }
    if (!isPlaying || !videoRef.current) {
      clearPlaybackLoop();
      return;
    }
    const fps = Math.max(1, frameRate || 6);
    const sampleFrame = () => {
      if (!videoRef.current) return;
      if (videoRef.current.readyState < 2) return;
      const map = extractLumaMap(videoRef.current, sampleSize.width, sampleSize.height, isCameraLive);
      onMapChange(map, sampleSize.width, sampleSize.height);
      setStatus(isCameraLive ? `Camera sampled @ ${fps.toFixed(1)} fps` : `Video sampled @ ${fps.toFixed(1)} fps`);
    };
    sampleFrame();
    intervalRef.current = window.setInterval(sampleFrame, 1000 / fps);
    return clearPlaybackLoop;
  }, [mode, isPlaying, isCameraLive, frameRate, onMapChange, sampleSize]);

  useEffect(() => {
    if (mode !== 'text') return;
    const map = extractTextLumaMap(
      textValue || 'TEXT',
      sampleSize.width,
      sampleSize.height,
      textFontFamily || 'Arial',
      textWeight || 700,
      textSize || 0.76,
      textPadding || 0.1,
      textInvert || false,
      {
        vertical: textVertical || false,
        columnLength: textColumnLength || 0,
        columnGap: textColumnGap ?? 0.4,
        letterSpacing: textLetterSpacing || 0,
        kinsoku: textKinsoku || false,
        yakumono: textYakumono || false,
        tatechuyoko: textTateChuYoko || false,
        ruby: textRuby || false,
        pageEnabled: textPageEnabled || false,
        columnBalance: textColumnBalance || false,
        pageIndex: textPageIndex || 0,
      },
    );
    onMapChange(map, sampleSize.width, sampleSize.height);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the status line reports the rasterization this effect just performed; it is an effect result, not derived render state.
    setStatus(`Text rasterized (${sampleSize.width}×${sampleSize.height})`);
  }, [mode, textValue, textFontFamily, textWeight, textSize, textPadding, textInvert, textVertical, textColumnLength, textColumnGap, textLetterSpacing, textKinsoku, textYakumono, textTateChuYoko, textRuby, textPageEnabled, textColumnBalance, textPageIndex, onMapChange, sampleSize]);

  const handleLoadedImage = (file: File) => {
    const image = new window.Image();
    image.onload = () => {
      const map = extractLumaMap(image, sampleSize.width, sampleSize.height);
      onMapChange(map, sampleSize.width, sampleSize.height);
      setStatus(`${file.name} loaded (${sampleSize.width}×${sampleSize.height})`);
      releaseObjectUrl();
    };
    const url = URL.createObjectURL(file);
    objectUrlRef.current = url;
    image.src = url;
  };

  const startCamera = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus('Camera is not available in this browser');
      return;
    }
    try {
      clearPlaybackLoop();
      releaseObjectUrl();
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      cameraStreamRef.current = stream;
      const video = document.createElement('video');
      videoRef.current = video;
      video.srcObject = stream;
      video.muted = true;
      video.playsInline = true;
      // Do not block on play(): a detached element's play() promise can
      // stay pending in some browsers even while frames are flowing.
      await Promise.race([
        video.play().catch(() => {}),
        new Promise((resolve) => window.setTimeout(resolve, 800)),
      ]);
      setIsCameraLive(true);
      setIsPlaying(true);
      setStatus('Camera live');
    } catch {
      setStatus('Camera unavailable (permission denied or no camera found)');
    }
  };

  const handleLoadedVideo = async (file: File) => {
    clearPlaybackLoop();
    stopCamera();
    setIsPlaying(false);
    releaseObjectUrl();
    const url = URL.createObjectURL(file);
    objectUrlRef.current = url;
    const video = document.createElement('video');
    videoRef.current = video;
    video.src = url;
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    await video.play().catch(() => {});
    video.pause();
    const handleCanPlay = () => {
      const map = extractLumaMap(video, sampleSize.width, sampleSize.height);
      onMapChange(map, sampleSize.width, sampleSize.height);
      setStatus(`${file.name} ready (${sampleSize.width}×${sampleSize.height})`);
    };
    video.addEventListener('loadeddata', handleCanPlay, { once: true });
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (mode === 'video') await handleLoadedVideo(file);
    else handleLoadedImage(file);
    event.target.value = '';
  };

  const handleResample = () => {
    if (mode === 'video' && videoRef.current) {
      const map = extractLumaMap(videoRef.current, sampleSize.width, sampleSize.height, isCameraLive);
      onMapChange(map, sampleSize.width, sampleSize.height);
      setStatus(`Frame resampled (${sampleSize.width}×${sampleSize.height})`);
    }
  };

  const handleTogglePlayback = async () => {
    if (!videoRef.current) return;
    if (isPlaying) {
      videoRef.current.pause();
      setIsPlaying(false);
      setStatus('Video paused');
      return;
    }
    await videoRef.current.play().catch(() => {});
    setIsPlaying(true);
    setStatus('Video playing');
  };

  // Text pages (Phase 17): the total page count at the supply
  // texture's metrics (256px, the same clamping the rasteriser
  // applies), shown next to the page selector. The count is a
  // pure function of the text and the layout settings.
  const clampedPageSize = Math.max(0.2, Math.min(1.4, textSize || 0.76));
  const clampedPagePadding = Math.max(0, Math.min(0.35, textPadding || 0.1));
  const totalTextPages = textPageCount(
    textValue || 'TEXT',
    textColumnLength || 0,
    {
      width: 256,
      height: 256,
      padding: clampedPagePadding,
      pxSize: Math.max(12, Math.floor(clampedPageSize * 256)),
      columnGap: textColumnGap ?? 0.4,
      letterSpacing: textLetterSpacing || 0,
    },
    {
      kinsoku: textKinsoku || false,
      yakumono: textYakumono || false,
      tatechuyoko: textTateChuYoko || false,
      ruby: textRuby || false,
    },
    textColumnBalance || false,
  );

  return (
    <div className="mb-5 p-3 bg-white/5 rounded border border-white/10">
      <div className="mb-2 text-[10px] uppercase tracking-widest font-medium opacity-70">
        {mode === 'video' ? 'Video-driven Layout' : mode === 'text' ? 'Text / Glyph Layout' : 'Image-driven Layout'}
      </div>
      <div className="mb-3 flex flex-wrap gap-2">
        {mode !== 'text' && <input ref={inputRef} type="file" accept={accept} onChange={handleFileChange} className="hidden" />}
        {mode !== 'text' && (
          <button onClick={() => inputRef.current?.click()} className={`rounded border px-2 py-1 text-[10px] uppercase ${currentTheme === 'white' ? 'border-black/20 bg-black text-white' : 'border-white/20 bg-white text-black'}`}>
            Load {mode}
          </button>
        )}
        {mode === 'video' && (
          <>
            <button onClick={handleTogglePlayback} disabled={!videoRef.current} className="rounded border border-white/20 bg-transparent px-2 py-1 text-[10px] uppercase text-white/80 disabled:opacity-30">
              {isPlaying ? 'Pause' : 'Play'}
            </button>
            <button onClick={handleResample} disabled={!videoRef.current} className="rounded border border-white/20 bg-transparent px-2 py-1 text-[10px] uppercase text-white/80 disabled:opacity-30">
              Sample Frame
            </button>
            {isCameraLive ? (
              <button onClick={() => { stopCamera(); setIsPlaying(false); clearPlaybackLoop(); setStatus('Camera stopped'); }} className="rounded border border-white/20 bg-transparent px-2 py-1 text-[10px] uppercase text-white/80">
                Stop Camera
              </button>
            ) : (
              <button onClick={startCamera} className="rounded border border-white/20 bg-transparent px-2 py-1 text-[10px] uppercase text-white/80">
                Use Camera
              </button>
            )}
          </>
        )}
        <button onClick={() => { clearPlaybackLoop(); stopCamera(); setIsPlaying(false); onClear(); releaseObjectUrl(); setStatus(mode === 'text' ? 'Text cleared' : 'Media cleared'); }} className="rounded border border-white/20 bg-transparent px-2 py-1 text-[10px] uppercase text-white/80">
          Clear
        </button>
      </div>
      <div className="mb-3 text-[10px] text-white/55">
        {status} {hasMap ? `• map ${mapWidth}×${mapHeight}` : ''}
      </div>
      {mode === 'text' && (
        <>
          <div className="mb-3">
            <div className="mb-2 text-[10px] uppercase tracking-widest font-medium opacity-70">Text / Glyph</div>
            <textarea
              value={textValue ?? 'TEXT'}
              onChange={(event) => onTextValueChange?.(event.target.value)}
              rows={3}
              className="w-full rounded border border-white/15 bg-black/20 px-2 py-2 text-[11px] text-white outline-none"
            />
          </div>
          <div className="mb-3 grid grid-cols-2 gap-3">
            <label className="text-[10px] uppercase tracking-widest font-medium opacity-70">
              Font
              <input
                value={textFontFamily ?? 'Arial'}
                onChange={(event) => onTextFontFamilyChange?.(event.target.value)}
                className="mt-1 w-full rounded border border-white/15 bg-black/20 px-2 py-1 text-[11px] text-white outline-none"
              />
            </label>
            <div className="rounded border border-white/10 bg-white/5 p-2 text-[10px] text-white/55">
              Multi-line text is supported. Up to 4 lines are rasterized into the particle mask.
            </div>
          </div>
          <Slider label="Font Weight" value={textWeight ?? 700} min={100} max={900} step={100} onChange={(value) => onTextWeightChange?.(value)} />
          <Slider label="Font Size" value={textSize ?? 0.76} min={0.2} max={1.4} step={0.01} onChange={(value) => onTextSizeChange?.(value)} />
          <Slider label="Padding" value={textPadding ?? 0.1} min={0} max={0.35} step={0.01} onChange={(value) => onTextPaddingChange?.(value)} />
          <Toggle label="Invert Text Mask" value={textInvert ?? false} options={[{ label: 'Off', val: false }, { label: 'On', val: true }]} onChange={(value) => onTextInvertChange?.(value)} />
          {onTextVerticalChange && (
            <Toggle label="Vertical Text (縦書き)" value={textVertical ?? false} options={[{ label: 'Off', val: false }, { label: 'On', val: true }]} onChange={(value) => onTextVerticalChange(value)} />
          )}
          {onTextVerticalChange && textVertical && (
            <>
              <div className="mb-3 rounded border border-white/10 bg-white/5 p-2 text-[10px] text-white/55">
                縦書きは字形を正立のまま上から下へ、段は右から左へ配置します。禁則は最小集合、約物は位置補正のみ。縦中横は半角英数字の2〜4字まで、ルビは青空文庫式の記法で親文字の右側に置きます（段間に重なることがあります）。
              </div>
              {onTextColumnLengthChange && (
                <Slider label="Column Length (0 = Auto)" value={textColumnLength ?? 0} min={0} max={40} step={1} onChange={(value) => onTextColumnLengthChange(value)} />
              )}
              {onTextColumnGapChange && (
                <Slider label="Column Gap" value={textColumnGap ?? 0.4} min={0} max={1} step={0.05} onChange={(value) => onTextColumnGapChange(value)} />
              )}
              {onTextLetterSpacingChange && (
                <Slider label="Letter Spacing" value={textLetterSpacing ?? 0} min={0} max={1} step={0.05} onChange={(value) => onTextLetterSpacingChange(value)} />
              )}
              {onTextKinsokuChange && (
                <Toggle label="Kinsoku (禁則)" value={textKinsoku ?? false} options={[{ label: 'Off', val: false }, { label: 'On', val: true }]} onChange={(value) => onTextKinsokuChange(value)} />
              )}
              {onTextYakumonoChange && (
                <Toggle label="Yakumono Position (約物)" value={textYakumono ?? false} options={[{ label: 'Off', val: false }, { label: 'On', val: true }]} onChange={(value) => onTextYakumonoChange(value)} />
              )}
              {onTextTateChuYokoChange && (
                <Toggle label="Tate-Chu-Yoko (縦中横)" value={textTateChuYoko ?? false} options={[{ label: 'Off', val: false }, { label: 'On', val: true }]} onChange={(value) => onTextTateChuYokoChange(value)} />
              )}
              {onTextRubyChange && (
                <Toggle label="Ruby (ルビ)" value={textRuby ?? false} options={[{ label: 'Off', val: false }, { label: 'On', val: true }]} onChange={(value) => onTextRubyChange(value)} />
              )}
              {onTextPageEnabledChange && (
                <Toggle label="Text Pages (ページ送り)" value={textPageEnabled ?? false} options={[{ label: 'Off', val: false }, { label: 'On', val: true }]} onChange={(value) => onTextPageEnabledChange(value)} />
              )}
              {onTextPageEnabledChange && textPageEnabled && (
                <>
                  <div className="mb-3 rounded border border-white/10 bg-white/5 p-2 text-[10px] text-white/55">
                    1ラスタに収まる段数を超えた段を次ページへ送り、選択中のページだけを描きます。段バランスは段の並び順を保ったまま段の長さを均します。
                  </div>
                  {onTextColumnBalanceChange && (
                    <Toggle label="Column Balance (段バランス)" value={textColumnBalance ?? false} options={[{ label: 'Off', val: false }, { label: 'On', val: true }]} onChange={(value) => onTextColumnBalanceChange(value)} />
                  )}
                  {onTextPageIndexChange && (
                    <>
                      <Slider label="Page (ページ)" value={Math.min(textPageIndex ?? 0, Math.max(0, totalTextPages - 1))} min={0} max={Math.max(0, totalTextPages - 1)} step={1} onChange={(value) => onTextPageIndexChange(Math.round(value))} />
                      <div className="mb-3 text-[10px] text-white/55">
                        全{totalTextPages}ページ（256pxテクスチャ基準の段の収まりで計算）
                      </div>
                    </>
                  )}
                </>
              )}
            </>
          )}
        </>
      )}
      <Slider label="Mask Threshold" value={threshold} min={0} max={1} step={0.01} onChange={onThresholdChange} />
      <Slider label="Depth from Brightness" value={depth} min={0} max={2} step={0.01} onChange={onDepthChange} />
      {mode === 'video' && <Slider label="Sample FPS" value={frameRate} min={1} max={24} step={1} onChange={onFrameRateChange} />}
      <Toggle label="Invert Brightness" value={invert} options={[{ label: 'Off', val: false }, { label: 'On', val: true }]} onChange={onInvertChange} />
    </div>
  );
};
