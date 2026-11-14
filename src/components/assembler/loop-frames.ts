/**
 * Words for a variable a WP Context Loop sets on some frames only (the
 * Assembler's frame tag, its tooltip and the preview note). Frames arrive
 * 0-based and read 1-based, like the Loop's EDIT FRAME chips.
 *
 * Pure module: no DOM, no Vue.
 */

/** `[0, 1, 2, 4]` → "1–3, 5" (1-based, runs joined). */
export function frameList(frames: readonly number[]): string {
  const sorted = [...new Set(frames)].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const start = sorted[i];
    let end = start;
    while (i + 1 < sorted.length && sorted[i + 1] === end + 1) end = sorted[++i];
    if (end === start) parts.push(String(start + 1));
    else if (end === start + 1) parts.push(`${start + 1}, ${end + 1}`);
    else parts.push(`${start + 1}–${end + 1}`);
  }
  return parts.join(", ");
}

/** The frames NOT in `frames`, below `count`. */
export function otherFrames(frames: readonly number[], count: number): number[] {
  const on = new Set(frames);
  const out: number[] = [];
  for (let k = 0; k < count; k++) if (!on.has(k)) out.push(k);
  return out;
}

/** The chip's short tag: "#4", "#1 #4", or "3/8" once it would get long. */
export function frameTag(frames: readonly number[], count: number): string {
  if (frames.length <= 2) return frames.map((k) => `#${k + 1}`).join(" ");
  return `${frames.length}/${count}`;
}

/** The chip's tooltip: which frames set the name, which render it empty. */
export function frameSentence(name: string, frames: readonly number[], count: number): string {
  const on = frames.length === 1 ? `frame ${frameList(frames)} only` : `frames ${frameList(frames)}`;
  const off = otherFrames(frames, count);
  const offText = off.length === 1
    ? `Frame ${frameList(off)} renders it empty.`
    : `Frames ${frameList(off)} render it empty.`;
  return `$${name} is set on ${on}. ${offText}`;
}
