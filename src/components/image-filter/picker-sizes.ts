/**
 * Picture sizes in the Image Filter picker. A run can mix sizes and shapes
 * (a portrait next to a landscape, a 512 draft next to a 1536 upscale), so
 * Grid lays every picture into one cell shape, Detail scales every picture
 * to fill the same stage, and nothing waits for a picture to load to know
 * its box. Pure, so it is tested on its own.
 */

export interface Size { width: number; height: number }

/** Height over width; 1 when unknown. */
export function aspectOf(size: Size | null | undefined): number {
  return size && size.width > 0 && size.height > 0 ? size.height / size.width : 1;
}

/**
 * The cell shape Grid lays every picture into (height over width): the
 * shape most pictures share, so a run of one shape keeps its cells exactly
 * and only the odd ones sit letterboxed inside. Ties go to the squarest.
 * Unknown sizes don't vote; with none known it is square.
 */
export function cellAspect(sizes: readonly (Size | null | undefined)[]): number {
  const votes = new Map<string, { aspect: number; count: number }>();
  for (const s of sizes) {
    if (!s || s.width <= 0 || s.height <= 0) continue;
    const aspect = s.height / s.width;
    // Shapes within 2% of each other (832 × 1216 and 896 × 1152 are not) count as one.
    const key = (Math.round(Math.log(aspect) * 50) / 50).toFixed(2);
    const v = votes.get(key);
    if (v) v.count++;
    else votes.set(key, { aspect, count: 1 });
  }
  let best: { aspect: number; count: number } | null = null;
  for (const v of votes.values()) {
    if (!best || v.count > best.count || (v.count === best.count && Math.abs(Math.log(v.aspect)) < Math.abs(Math.log(best.aspect)))) best = v;
  }
  return best ? best.aspect : 1;
}

/** True when the known sizes are not all the same. */
export function mixedSizes(sizes: readonly (Size | null | undefined)[]): boolean {
  let first: Size | null = null;
  for (const s of sizes) {
    if (!s || s.width <= 0) continue;
    if (!first) first = s;
    else if (s.width !== first.width || s.height !== first.height) return true;
  }
  return false;
}

/** A tile box `tile` px on its long side, in the cell shape. */
export function cellBox(tile: number, aspect: number): Size {
  const a = aspect > 0 && Number.isFinite(aspect) ? aspect : 1;
  return a >= 1 ? { width: Math.round(tile / a), height: tile } : { width: tile, height: Math.round(tile * a) };
}

/** The size that shows the whole picture in `box`, scaled up or down. */
export function containSize(image: Size, box: Size): Size {
  if (image.width <= 0 || image.height <= 0 || box.width <= 0 || box.height <= 0) return { width: 0, height: 0 };
  const k = Math.min(box.width / image.width, box.height / image.height);
  return { width: Math.max(1, Math.floor(image.width * k)), height: Math.max(1, Math.floor(image.height * k)) };
}

/** "1024 × 1536". */
export function sizeText(size: Size | null | undefined): string {
  return size && size.width > 0 ? `${size.width} × ${size.height}` : "";
}
