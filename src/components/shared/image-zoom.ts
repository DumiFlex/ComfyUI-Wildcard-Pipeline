/**
 * The maths behind `WpImageZoom`: one transform, `translate(x, y) scale(s)`
 * with its origin at the image's top-left corner. Pure, so it is tested on
 * its own.
 */

export interface Size { width: number; height: number }
export interface View { scale: number; x: number; y: number }

/** Zoom never goes below this share of Fit (or of 100% for a tiny image), nor above MAX_SCALE. */
export const MAX_SCALE = 8;
/** The steps the − / + buttons jump through, as real-size factors. */
export const ZOOM_STEPS = [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8] as const;
/** How long `WpImageZoom`'s bar stays after the last pointer move or key, with `autohide`. */
export const IDLE_MS = 2000;
/** One wheel notch. */
export const WHEEL_FACTOR = 1.2;

/** The scale that shows the whole image in the stage (it may be above 1 for a small image). */
export function fitScale(image: Size, stage: Size): number {
  if (image.width <= 0 || image.height <= 0 || stage.width <= 0 || stage.height <= 0) return 1;
  return Math.min(stage.width / image.width, stage.height / image.height);
}

export function minScale(image: Size, stage: Size): number {
  return Math.min(fitScale(image, stage), 1) / 2;
}

export function clampScale(scale: number, image: Size, stage: Size): number {
  return Math.min(MAX_SCALE, Math.max(minScale(image, stage), scale));
}

/** Keep the image in view: centred on an axis where it is smaller than the
 *  stage, otherwise never showing an empty edge. */
export function clampView(view: View, image: Size, stage: Size): View {
  const axis = (pos: number, img: number, room: number): number => {
    const size = img * view.scale;
    if (size <= room) return (room - size) / 2;
    return Math.min(0, Math.max(room - size, pos));
  };
  return { scale: view.scale, x: axis(view.x, image.width, stage.width), y: axis(view.y, image.height, stage.height) };
}

/** Set the scale, keeping the image point under `at` (stage px) where it is. */
export function zoomAt(view: View, scale: number, at: { x: number; y: number }, image: Size, stage: Size): View {
  const s = clampScale(scale, image, stage);
  const k = s / view.scale;
  return clampView({ scale: s, x: at.x - (at.x - view.x) * k, y: at.y - (at.y - view.y) * k }, image, stage);
}

/** The view at `scale` centred on the image point `centre` (fractions 0..1). */
export function viewAround(scale: number, centre: { x: number; y: number }, image: Size, stage: Size): View {
  const s = clampScale(scale, image, stage);
  return clampView({
    scale: s,
    x: stage.width / 2 - centre.x * image.width * s,
    y: stage.height / 2 - centre.y * image.height * s,
  }, image, stage);
}

/** The image point (fractions 0..1) at the middle of the stage. */
export function centreOf(view: View, image: Size, stage: Size): { x: number; y: number } {
  if (image.width <= 0 || image.height <= 0) return { x: 0.5, y: 0.5 };
  const f = (mid: number, pos: number, img: number): number => Math.min(1, Math.max(0, (mid - pos) / (img * view.scale)));
  return { x: f(stage.width / 2, view.x, image.width), y: f(stage.height / 2, view.y, image.height) };
}

/** The next step up (dir 1) or down (dir -1) from `scale`, with Fit slotted in among the steps. */
export function stepScale(scale: number, dir: 1 | -1, fit: number): number {
  const steps = [...ZOOM_STEPS, fit].sort((a, b) => a - b);
  const eps = 1e-3;
  if (dir > 0) return steps.find((s) => s > scale + eps) ?? MAX_SCALE;
  return [...steps].reverse().find((s) => s < scale - eps) ?? steps[0];
}

/** "100%", "35%", "250%". */
export function percent(scale: number): string {
  return `${Math.round(scale * 100)}%`;
}

/** The part of the image the stage shows, as fractions 0..1 of the image (for a mini-map). */
export function visibleRect(view: View, image: Size, stage: Size): { x: number; y: number; w: number; h: number } {
  if (image.width <= 0 || image.height <= 0) return { x: 0, y: 0, w: 1, h: 1 };
  const axis = (pos: number, img: number, room: number): [number, number] => {
    const size = img * view.scale;
    const a = Math.min(1, Math.max(0, -pos / size));
    const b = Math.min(1, Math.max(0, (room - pos) / size));
    return [a, b - a];
  };
  const [x, w] = axis(view.x, image.width, stage.width);
  const [y, h] = axis(view.y, image.height, stage.height);
  return { x, y, w, h };
}
