/**
 * Number helpers for sliders (Slider now, the two-thumb range later): clamp
 * to the ends, snap to the step counted from `min`, and turn a pointer
 * position into a value. Steps like 0.1 snap without float fuzz.
 */
export function decimals(step: number): number {
  const s = String(step);
  const i = s.indexOf(".");
  return i < 0 ? 0 : s.length - i - 1;
}

export function snap(v: number, min: number, max: number, step: number): number {
  if (!Number.isFinite(v)) return min;
  const clamped = Math.min(max, Math.max(min, v));
  if (step <= 0) return clamped;
  const n = Math.round((clamped - min) / step);
  const out = Math.min(max, min + n * step);
  return Number(out.toFixed(Math.max(decimals(step), decimals(min))));
}

/** Where `v` sits between `min` and `max`, 0 to 100. */
export function percentOf(v: number, min: number, max: number): number {
  if (max <= min) return 0;
  return Math.min(100, Math.max(0, ((v - min) / (max - min)) * 100));
}

/** The value under a pointer at `x` on a track from `left`, `width` wide. */
export function valueAt(x: number, left: number, width: number, min: number, max: number, step: number): number {
  const t = width > 0 ? (x - left) / width : 0;
  return snap(min + t * (max - min), min, max, step);
}

/** The value one key press away, or null for a key the slider ignores. */
export function keyStep(key: string, v: number, min: number, max: number, step: number, big = 10): number | null {
  const s = step > 0 ? step : (max - min) / 100;
  switch (key) {
    case "ArrowRight": case "ArrowUp": return snap(v + s, min, max, step);
    case "ArrowLeft": case "ArrowDown": return snap(v - s, min, max, step);
    case "PageUp": return snap(v + s * big, min, max, step);
    case "PageDown": return snap(v - s * big, min, max, step);
    case "Home": return min;
    case "End": return max;
    default: return null;
  }
}
