export const MEDIA_SAMPLE_SIZE = 64;

export function extractLumaMap(source: CanvasImageSource, width: number, height: number, flipHorizontal = false) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return [] as number[];
  ctx.clearRect(0, 0, width, height);
  if (flipHorizontal) {
    // Mirror view, as users expect from a camera (roadmap 8B).
    ctx.translate(width, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(source, 0, 0, width, height);
  const imageData = ctx.getImageData(0, 0, width, height).data;
  const map = new Array<number>(width * height);
  for (let i = 0; i < width * height; i++) {
    const base = i * 4;
    const r = imageData[base] / 255;
    const g = imageData[base + 1] / 255;
    const b = imageData[base + 2] / 255;
    const a = imageData[base + 3] / 255;
    map[i] = (0.2126 * r + 0.7152 * g + 0.0722 * b) * a;
  }
  return map;
}

export function extractTextLumaMap(
  text: string,
  width: number,
  height: number,
  fontFamily: string,
  fontWeight: number,
  size: number,
  padding: number,
  invert: boolean,
) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return [] as number[];

  ctx.fillStyle = invert ? '#ffffff' : '#000000';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = invert ? '#000000' : '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const lines = (text || 'TEXT').split(/\n/).slice(0, 4);
  const clampedSize = Math.max(0.2, Math.min(1.4, size || 0.76));
  const clampedPadding = Math.max(0, Math.min(0.35, padding || 0.1));
  const pxSize = Math.max(12, Math.floor(clampedSize * Math.min(width, height)));
  ctx.font = `${Math.max(100, Math.min(900, fontWeight || 700))} ${pxSize}px ${fontFamily || 'Arial'}`;

  const usableHeight = height * (1 - clampedPadding * 2);
  const lineHeight = usableHeight / Math.max(1, lines.length);
  lines.forEach((line, index) => {
    const y = height * clampedPadding + lineHeight * (index + 0.5);
    ctx.fillText(line, width / 2, y, width * (1 - clampedPadding * 2));
  });

  const imageData = ctx.getImageData(0, 0, width, height).data;
  const map = new Array<number>(width * height);
  for (let i = 0; i < width * height; i++) {
    const base = i * 4;
    const r = imageData[base] / 255;
    const g = imageData[base + 1] / 255;
    const b = imageData[base + 2] / 255;
    const a = imageData[base + 3] / 255;
    map[i] = (0.2126 * r + 0.7152 * g + 0.0722 * b) * a;
  }
  return map;
}
