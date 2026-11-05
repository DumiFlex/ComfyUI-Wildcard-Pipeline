/**
 * Images for the assistant chat: shrunk and re-encoded in the browser
 * before they are sent. The long edge stays within 1568 px and the area
 * within 1.15 MP (what Claude scales to; local vision encoders use less),
 * and the result is a JPEG on white: every model server decodes JPEG
 * (llama.cpp can't read WebP), and re-encoding drops EXIF, so camera
 * details and GPS never leave the machine. The server checks and
 * re-encodes again (`wp_api/_ai_images.py`).
 */

export const MAX_EDGE = 1568;
export const MAX_PIXELS = 1_150_000;
/** Images per message (the server's limit too). */
export const MAX_IMAGES = 4;
/** Larger files aren't even opened. */
export const MAX_SOURCE_BYTES = 40 * 1024 * 1024;
const QUALITY = 0.85;

export interface ChatImage {
  /** `data:image/jpeg;base64,…` */
  url: string;
  w: number;
  h: number;
  name: string;
}

/** (w, h) scaled down to the caps, keeping its shape. */
export function fitSize(w: number, h: number): { w: number; h: number } {
  const scale = Math.min(1, MAX_EDGE / Math.max(w, h, 1), Math.sqrt(MAX_PIXELS / Math.max(w * h, 1)));
  return { w: Math.max(1, Math.floor(w * scale)), h: Math.max(1, Math.floor(h * scale)) };
}

export class ImageReadError extends Error {}

/** Read, shrink and re-encode one image file. */
export async function prepareImage(file: Blob, name = "image"): Promise<ChatImage> {
  if (!file.type.startsWith("image/")) throw new ImageReadError(`${name} isn't an image`);
  if (file.size > MAX_SOURCE_BYTES) throw new ImageReadError(`${name} is too large`);
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new ImageReadError(`${name} couldn't be read`);
  }
  const { w, h } = fitSize(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    throw new ImageReadError(`${name} couldn't be read`);
  }
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  return { url: canvas.toDataURL("image/jpeg", QUALITY), w, h, name };
}
