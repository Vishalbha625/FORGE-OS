// Client-side photo compression for community posts. Every photo is uploaded
// twice: a small thumbnail for the feed and a larger version for the full view,
// which keeps feed bandwidth inside the Supabase free tier.
// Progress photos are never passed through here: they never leave the device.

export interface CompressOptions {
  /** Longest edge in px. Images are never upscaled. */
  maxWidth: number;
  /** Starting quality, 0 to 1. */
  quality: number;
  maxSizeKB: number;
  format?: 'image/webp';
}

export interface CompressedImage {
  blob: Blob;
  width: number;
  height: number;
  sizeKB: number;
  /** The encoder actually used. Safari cannot encode WebP and falls back to JPEG. */
  type: string;
  /** False when even the lowest quality at the smallest size tried is over maxSizeKB. */
  withinLimit: boolean;
}

const MIN_QUALITY = 0.3;
const MAX_SHRINKS = 3;

/** Scale (w, h) so the longest edge is at most `max`, keeping the aspect ratio. */
export function fitWithin(width: number, height: number, max: number): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= max || longest === 0) return { width, height };
  const scale = max / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Qualities to try, in 0.1 steps from `start` down to 0.3 (inclusive). */
export function qualitySteps(start: number): number[] {
  const steps: number[] = [];
  for (let q = Math.round(start * 100); q > MIN_QUALITY * 100; q -= 10) steps.push(q / 100);
  steps.push(MIN_QUALITY);
  return steps;
}

/**
 * How much to scale both edges when even the lowest quality is over the cap.
 * File size grows roughly with pixel count, so scale by the square root of the
 * overshoot (with a 5% margin), never less than half or more than 90% per step.
 */
export function shrinkFactor(sizeKB: number, maxSizeKB: number): number {
  return Math.min(0.9, Math.max(0.5, Math.sqrt(maxSizeKB / sizeKB) * 0.95));
}

function loadImage(file: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('This file could not be read as an image.'));
    img.src = url;
  }).finally(() => URL.revokeObjectURL(url));
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Image could not be compressed.'))), type, quality);
  });
}

export async function compressImage(file: Blob, options: CompressOptions): Promise<CompressedImage> {
  const img = await loadImage(file);
  let { width, height } = fitWithin(img.naturalWidth, img.naturalHeight, options.maxWidth);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Image could not be compressed on this device.');

  let type: string = options.format ?? 'image/webp';
  let best: Blob | undefined;
  // Lower the quality first; if the floor is still too big, shrink the image and try again.
  for (let shrink = 0; shrink <= MAX_SHRINKS; shrink++) {
    canvas.width = width;
    canvas.height = height;
    ctx.drawImage(img, 0, 0, width, height);
    for (const q of qualitySteps(options.quality)) {
      let blob = await toBlob(canvas, type, q);
      if (blob.type !== type) {
        // Browser ignored the format (it returns PNG): use JPEG, which every browser encodes.
        type = 'image/jpeg';
        blob = await toBlob(canvas, type, q);
      }
      best = blob;
      if (blob.size / 1024 <= options.maxSizeKB) break;
    }
    if (!best || best.size / 1024 <= options.maxSizeKB || shrink === MAX_SHRINKS) break;
    const factor = shrinkFactor(best.size / 1024, options.maxSizeKB);
    width = Math.max(1, Math.round(width * factor));
    height = Math.max(1, Math.round(height * factor));
  }
  if (!best) throw new Error('Image could not be compressed.');
  const sizeKB = Math.round((best.size / 1024) * 10) / 10;
  return { blob: best, width, height, sizeKB, type: best.type, withinLimit: sizeKB <= options.maxSizeKB };
}

export const compressThumb = (file: Blob) => compressImage(file, { maxWidth: 400, quality: 0.6, maxSizeKB: 25, format: 'image/webp' });
export const compressFull = (file: Blob) => compressImage(file, { maxWidth: 1200, quality: 0.75, maxSizeKB: 120, format: 'image/webp' });
export const compressAvatar = (file: Blob) => compressImage(file, { maxWidth: 200, quality: 0.7, maxSizeKB: 50, format: 'image/webp' });
