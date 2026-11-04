/**
 * Pictures saved in a WP Note: turning a pasted, dropped or picked file into
 * a small data URL the workflow can carry, and the caps that keep a note
 * from bloating every saved workflow (and the PNG metadata of every image
 * it renders).
 *
 * The file is drawn onto a canvas and encoded again: long side at most
 * MAX_SIDE, WebP (JPEG where the browser can't write WebP, PNG kept only
 * when it is the smallest), stepping quality and size down until it fits
 * MAX_BYTES. Encoding again also drops EXIF (camera, GPS).
 */
import type { NoteImage } from "../../extension/note";
import { findImages, IMAGE_ID_RE } from "./note-format";

export const MAX_SIDE = 1280;
/** One picture, as a data URL (base64 is 4/3 of the bytes). */
export const MAX_BYTES = 400 * 1024;
/** All pictures in one note. */
export const MAX_NOTE_BYTES = 2 * 1024 * 1024;
export const MAX_IMAGES = 6;
/** What a file may be before we even try (decoding a huge file is slow). */
export const MAX_INPUT_BYTES = 25 * 1024 * 1024;

export const ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/bmp"];

/** A fresh 8-hex id not used in this note. */
export function newImageId(taken: Record<string, unknown>, rand: () => number = Math.random): string {
  for (;;) {
    const id = Math.floor(rand() * 0x100000000).toString(16).padStart(8, "0").slice(-8);
    if (IMAGE_ID_RE.test(id) && !(id in taken)) return id;
  }
}

/** The bytes a data URL stands for, near enough for a cap. */
export function dataUrlBytes(src: string): number {
  const comma = src.indexOf(",");
  return comma < 0 ? src.length : Math.floor((src.length - comma - 1) * 3 / 4);
}

export function notePictureBytes(images: Record<string, NoteImage>): number {
  return Object.values(images).reduce((n, i) => n + dataUrlBytes(i.src), 0);
}

/** Why one more picture of `bytes` can't go in, or null when it can. */
export function capProblem(images: Record<string, NoteImage>, bytes: number): string | null {
  if (Object.keys(images).length >= MAX_IMAGES) return `A note holds at most ${MAX_IMAGES} pictures.`;
  if (notePictureBytes(images) + bytes > MAX_NOTE_BYTES) {
    return `This note's pictures would pass ${Math.round(MAX_NOTE_BYTES / 1024 / 1024)} MB. Take one out, or use a smaller picture.`;
  }
  return null;
}

/** Only the pictures the text still names (the rest were taken out). */
export function prunePictures(text: string, images: Record<string, NoteImage>): Record<string, NoteImage> {
  const used = new Set(findImages(text).flatMap((r) => (r.target.kind === "saved" ? [r.target.id] : [])));
  const out: Record<string, NoteImage> = {};
  for (const [id, img] of Object.entries(images)) if (used.has(id)) out[id] = img;
  return out;
}

/** The size to draw at: the long side at most `max`, never upscaled. */
export function fitSide(w: number, h: number, max = MAX_SIDE): { w: number; h: number } {
  const long = Math.max(w, h);
  if (long <= max) return { w, h };
  const k = max / long;
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

/** The first picture file in a paste or a drop, if any. */
export function pictureFile(list: DataTransfer | null): File | null {
  if (!list) return null;
  for (const f of Array.from(list.files ?? [])) if (f.type.startsWith("image/")) return f;
  for (const it of Array.from(list.items ?? [])) {
    if (it.kind === "file" && it.type.startsWith("image/")) {
      const f = it.getAsFile();
      if (f) return f;
    }
  }
  return null;
}

export class PictureError extends Error {}

async function decode(file: Blob): Promise<{ source: CanvasImageSource; w: number; h: number; close(): void }> {
  if (typeof createImageBitmap === "function") {
    const bmp = await createImageBitmap(file);
    return { source: bmp, w: bmp.width, h: bmp.height, close: () => bmp.close() };
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { source: img, w: img.naturalWidth, h: img.naturalHeight, close: () => {} };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function hasAlpha(ctx: CanvasRenderingContext2D, w: number, h: number): boolean {
  // A sampled look is enough: is any pixel not fully opaque?
  const data = ctx.getImageData(0, 0, w, h).data;
  const stride = Math.max(4, Math.floor(data.length / 4 / 20000) * 4);
  for (let i = 3; i < data.length; i += stride) if ((data[i] ?? 255) < 255) return true;
  return false;
}

/** Encodes a picture file for a note. Throws a PictureError with a reason
 *  the user can read. */
export async function encodePicture(file: Blob): Promise<NoteImage> {
  if (!file.type.startsWith("image/")) throw new PictureError("That file isn't a picture.");
  if (file.size > MAX_INPUT_BYTES) throw new PictureError("That picture is too big to add (over 25 MB).");
  let pic: Awaited<ReturnType<typeof decode>>;
  try {
    pic = await decode(file);
  } catch {
    throw new PictureError("That picture couldn't be read.");
  }
  try {
    if (!pic.w || !pic.h) throw new PictureError("That picture is empty.");
    let size = fitSide(pic.w, pic.h);
    const canvas = document.createElement("canvas");
    const draw = (): CanvasRenderingContext2D => {
      canvas.width = size.w;
      canvas.height = size.h;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new PictureError("This browser can't make pictures.");
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(pic.source, 0, 0, size.w, size.h);
      return ctx;
    };
    let ctx = draw();
    const alpha = hasAlpha(ctx, size.w, size.h);
    const webp = canvas.toDataURL("image/webp", 0.9).startsWith("data:image/webp");
    for (let round = 0; round < 6; round++) {
      const tries: string[] = [];
      for (const q of [0.9, 0.82, 0.72, 0.6]) {
        if (webp) tries.push(canvas.toDataURL("image/webp", q));
        // JPEG has no transparency: only for opaque pictures.
        else if (!alpha) tries.push(canvas.toDataURL("image/jpeg", q));
        const fit = tries.find((t) => dataUrlBytes(t) <= MAX_BYTES);
        if (fit) {
          // A screenshot is often smaller as PNG; keep whichever is less.
          const png = canvas.toDataURL("image/png");
          const best = dataUrlBytes(png) < dataUrlBytes(fit) ? png : fit;
          return { src: best, w: size.w, h: size.h };
        }
      }
      if (!webp && alpha) {
        const png = canvas.toDataURL("image/png");
        if (dataUrlBytes(png) <= MAX_BYTES) return { src: png, w: size.w, h: size.h };
      }
      // Still too big: a smaller picture.
      size = fitSide(size.w, size.h, Math.round(Math.max(size.w, size.h) * 0.75));
      ctx = draw();
    }
    throw new PictureError("That picture stays too big even made smaller.");
  } finally {
    pic.close();
  }
}
