// Frame-exact video encoding for the deterministic render: the captured
// PNG frames are fed to a WebCodecs VideoEncoder one by one with exact
// timestamps (frame i at i/fps seconds), and muxed in-app — WebM/VP9 via
// webm-muxer or MP4/H.264 via mp4-muxer. Unlike the realtime
// MediaRecorder export, the video's timing comes from the stepped frames
// themselves, so it stays deterministic. Support is probed with
// VideoEncoder.isConfigSupported; unsupported environments throw
// VideoEncodeUnsupportedError and the UI falls back to the PNG sequence.

import { Muxer as WebmMuxer, ArrayBufferTarget as WebmTarget } from 'webm-muxer';
import { Muxer as Mp4Muxer, ArrayBufferTarget as Mp4Target } from 'mp4-muxer';

export type VideoFormat = 'webm' | 'mp4';

export class VideoEncodeUnsupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VideoEncodeUnsupportedError';
  }
}

const CODECS: Record<VideoFormat, string> = {
  webm: 'vp09.00.10.08',
  mp4: 'avc1.640028',
};

export async function isVideoFormatSupported(format: VideoFormat, width: number, height: number): Promise<boolean> {
  if (typeof VideoEncoder === 'undefined') return false;
  try {
    const support = await VideoEncoder.isConfigSupported({
      codec: CODECS[format],
      width,
      height,
      bitrate: 8_000_000,
      framerate: 30,
    });
    return support.supported === true;
  } catch {
    return false;
  }
}

export async function encodeFramesToVideo(
  frames: Blob[],
  fps: number,
  format: VideoFormat,
  onProgress?: (done: number, total: number) => void,
): Promise<Blob> {
  if (frames.length === 0) {
    throw new Error('no frames to encode');
  }
  if (typeof VideoEncoder === 'undefined') {
    throw new VideoEncodeUnsupportedError('WebCodecs VideoEncoder is not available in this browser.');
  }
  const firstBitmap = await createImageBitmap(frames[0]);
  const width = firstBitmap.width;
  const height = firstBitmap.height;
  const bitrate = Math.min(24_000_000, Math.max(2_000_000, Math.round(width * height * fps * 0.12)));
  const config: VideoEncoderConfig = {
    codec: CODECS[format],
    width,
    height,
    bitrate,
    framerate: fps,
    latencyMode: 'quality',
  };
  const support = await VideoEncoder.isConfigSupported(config);
  if (!support.supported) {
    firstBitmap.close();
    throw new VideoEncodeUnsupportedError(`${format} encoding (${CODECS[format]}) is not supported in this browser.`);
  }

  const target = format === 'webm' ? new WebmTarget() : new Mp4Target();
  const muxer = format === 'webm'
    ? new WebmMuxer({
      target: target as WebmTarget,
      video: { codec: 'V_VP9', width, height },
      firstTimestampBehavior: 'offset',
    })
    : new Mp4Muxer({
      target: target as Mp4Target,
      video: { codec: 'avc', width, height },
      fastStart: false,
      firstTimestampBehavior: 'offset',
    });

  let encoderError: Error | null = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => {
      muxer.addVideoChunk(chunk, meta);
    },
    error: (error) => {
      encoderError = error;
    },
  });
  encoder.configure(config);

  const frameDurationUs = Math.round(1_000_000 / fps);
  for (let index = 0; index < frames.length; index += 1) {
    if (encoderError) throw encoderError;
    const bitmap = index === 0 ? firstBitmap : await createImageBitmap(frames[index]);
    const frame = new VideoFrame(bitmap, {
      timestamp: index * frameDurationUs,
      duration: frameDurationUs,
    });
    bitmap.close();
    encoder.encode(frame, { keyFrame: index % (fps * 2) === 0 });
    frame.close();
    while (encoder.encodeQueueSize > 4) {
      await new Promise((resolve) => setTimeout(resolve, 8));
    }
    onProgress?.(index + 1, frames.length);
  }
  await encoder.flush();
  if (encoderError) throw encoderError;
  encoder.close();
  muxer.finalize();
  const buffer = (target as WebmTarget).buffer;
  return new Blob([buffer], { type: format === 'webm' ? 'video/webm' : 'video/mp4' });
}
