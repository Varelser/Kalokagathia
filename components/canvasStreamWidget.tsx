// components/canvasStreamWidget.tsx
// Floating Live Canvas Stream widget.
// Provides one-click WebM recording + OBS Browser Source integration hint.

import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { Circle, Download, MonitorPlay, Radio, Square, X } from 'lucide-react';
import { useCanvasStream, formatElapsed, type StreamBitrate } from '../lib/useCanvasStream';

interface Props {
  rendererRef: React.RefObject<THREE.WebGLRenderer | null>;
}

export const CanvasStreamWidget: React.FC<Props> = ({ rendererRef }) => {
  const [expanded, setExpanded] = useState(false);
  const downloadLinkRef = useRef<HTMLAnchorElement>(null);

  const {
    isRecording,
    elapsed,
    streamFps,
    bitrate,
    downloadUrl,
    downloadName,
    setStreamFps,
    setBitrate,
    startRecording,
    stopRecording,
    canRecord,
  } = useCanvasStream(rendererRef);

  // Auto-trigger download when blob URL is ready
  useEffect(() => {
    if (downloadUrl && downloadName && downloadLinkRef.current) {
      downloadLinkRef.current.href = downloadUrl;
      downloadLinkRef.current.download = downloadName;
      downloadLinkRef.current.click();
    }
  }, [downloadUrl, downloadName]);

  const obsUrl = typeof window !== 'undefined'
    ? `${window.location.origin}${window.location.pathname}`
    : '';

  return (
    <div className="mg-stream-widget fixed bottom-6 right-6 z-50 flex flex-col items-end gap-2 select-none">
      {/* Hidden download anchor */}
      <a ref={downloadLinkRef} className="hidden" />

      {/* Expanded panel */}
      {expanded && (
        <div className="rounded-xl border border-white/15 bg-black/85 backdrop-blur-md shadow-2xl p-4 w-64 text-white">
          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest font-bold text-white/70">
              <Radio size={11} />
              Live Canvas Stream
            </div>
            <button
              onClick={() => setExpanded(false)}
              className="text-white/40 hover:text-white/80 transition-colors"
            >
              <X size={14} />
            </button>
          </div>

          {!canRecord && (
            <p className="text-[10px] text-yellow-400/80 mb-3">
              MediaRecorder not supported in this browser. Try Chrome or Firefox.
            </p>
          )}

          {/* Settings — hidden while recording */}
          {!isRecording && canRecord && (
            <div className="space-y-3 mb-4">
              {/* FPS */}
              <div>
                <p className="text-[9px] uppercase tracking-widest text-white/40 mb-1">Capture FPS</p>
                <div className="grid grid-cols-3 gap-1">
                  {([24, 30, 60] as const).map(f => (
                    <button
                      key={f}
                      onClick={() => setStreamFps(f)}
                      className={`rounded border py-1.5 text-[10px] font-mono transition-colors ${
                        streamFps === f
                          ? 'border-white/50 bg-white/15 text-white'
                          : 'border-white/10 bg-white/5 text-white/50 hover:bg-white/10'
                      }`}
                    >
                      {f}
                    </button>
                  ))}
                </div>
              </div>

              {/* Bitrate */}
              <div>
                <p className="text-[9px] uppercase tracking-widest text-white/40 mb-1">Bitrate</p>
                <div className="grid grid-cols-3 gap-1">
                  {([
                    { val: 4 as StreamBitrate, label: '4 Mb' },
                    { val: 8 as StreamBitrate, label: '8 Mb' },
                    { val: 16 as StreamBitrate, label: '16 Mb' },
                  ]).map(({ val, label }) => (
                    <button
                      key={val}
                      onClick={() => setBitrate(val)}
                      className={`rounded border py-1.5 text-[10px] font-mono transition-colors ${
                        bitrate === val
                          ? 'border-white/50 bg-white/15 text-white'
                          : 'border-white/10 bg-white/5 text-white/50 hover:bg-white/10'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Recording status */}
          {isRecording && (
            <div className="flex items-center gap-3 mb-4 rounded border border-red-500/30 bg-red-500/10 px-3 py-2">
              <Circle size={8} className="text-red-400 fill-red-400 animate-pulse" />
              <span className="text-[10px] uppercase tracking-widest text-red-300 font-bold">REC</span>
              <span className="ml-auto text-[12px] font-mono text-red-300">{formatElapsed(elapsed)}</span>
            </div>
          )}

          {/* Record / Stop */}
          {canRecord && (
            <div className="space-y-2">
              {!isRecording ? (
                <button
                  onClick={startRecording}
                  className="w-full flex items-center justify-center gap-2 rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-[11px] uppercase tracking-widest text-red-300 hover:bg-red-500/20 transition-colors font-bold"
                >
                  <Circle size={9} className="fill-red-400 text-red-400" />
                  Start Recording
                </button>
              ) : (
                <button
                  onClick={stopRecording}
                  className="w-full flex items-center justify-center gap-2 rounded border border-white/20 bg-white/10 px-3 py-2 text-[11px] uppercase tracking-widest text-white hover:bg-white/15 transition-colors font-bold"
                >
                  <Square size={9} className="fill-white text-white" />
                  Stop &amp; Save
                </button>
              )}

              {/* Download again */}
              {downloadUrl && !isRecording && (
                <button
                  onClick={() => {
                    if (downloadLinkRef.current && downloadUrl && downloadName) {
                      downloadLinkRef.current.href = downloadUrl;
                      downloadLinkRef.current.download = downloadName;
                      downloadLinkRef.current.click();
                    }
                  }}
                  className="w-full flex items-center justify-center gap-2 rounded border border-white/15 bg-white/5 px-3 py-2 text-[11px] uppercase tracking-widest text-white/70 hover:bg-white/10 transition-colors"
                >
                  <Download size={11} />
                  Download Again
                </button>
              )}
            </div>
          )}

          {/* Divider */}
          <div className="my-4 border-t border-white/10" />

          {/* OBS Integration hint */}
          <div>
            <p className="text-[9px] uppercase tracking-widest text-white/40 mb-2">OBS Browser Source</p>
            <p className="text-[10px] text-white/50 mb-2 leading-relaxed">
              In OBS: <span className="text-white/70">Sources → + → Browser Source</span><br />
              Paste this URL and set width/height to match your canvas.
            </p>
            <div className="flex items-center gap-1">
              <input
                readOnly
                value={obsUrl}
                className="flex-1 rounded border border-white/10 bg-white/5 px-2 py-1 text-[10px] font-mono text-white/70 outline-none truncate"
                onClick={e => (e.target as HTMLInputElement).select()}
              />
              <button
                onClick={() => navigator.clipboard.writeText(obsUrl).catch(() => {})}
                className="rounded border border-white/10 bg-white/5 px-2 py-1 text-[9px] text-white/50 hover:bg-white/10 transition-colors"
              >
                Copy
              </button>
            </div>
            <p className="mt-2 text-[9px] text-white/30 leading-relaxed">
              Or use <span className="text-white/50">Screen Capture</span> in OBS to capture this browser window directly.
            </p>
          </div>
        </div>
      )}

      {/* Toggle button */}
      <button
        onClick={() => setExpanded(v => !v)}
        className={`flex items-center gap-2 rounded-full px-4 py-2 text-[10px] uppercase tracking-widest font-bold border transition-all shadow-lg ${
          isRecording
            ? 'border-red-500/60 bg-red-500/20 text-red-300 animate-pulse'
            : expanded
            ? 'border-white/30 bg-white/15 text-white'
            : 'border-white/15 bg-black/70 text-white/60 hover:bg-white/10 hover:text-white'
        }`}
      >
        {isRecording ? (
          <>
            <Circle size={8} className="fill-red-400 text-red-400" />
            {formatElapsed(elapsed)}
          </>
        ) : (
          <>
            <MonitorPlay size={13} />
            Stream
          </>
        )}
      </button>
    </div>
  );
};
