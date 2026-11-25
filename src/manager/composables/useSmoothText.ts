/**
 * Text that streams in bursts (the server sends what's new every 150 ms, a
 * fast model a sentence at a time) shown word by word instead, the way
 * Claude, ChatGPT and DeepSeek pace a reply: each frame reveals up to the
 * next word boundary, faster when more is waiting, so it never falls more
 * than about a quarter of a second behind. `AiMessage` fades in whatever
 * is new since its last render, so paced words fade in one after another.
 *
 * Text that doesn't continue what is shown (a rewrite, a new step) is
 * shown at once. Reduced motion shows everything as it arrives.
 */
import { onBeforeUnmount, ref, watch, type Ref } from "vue";

/** Frames to catch up a backlog in (60 fps: about 250 ms). */
const CATCH_UP_FRAMES = 15;

/** The next cut at or after `from`: the end of the word that `from` is in
 *  or before (spaces after it included). */
export function nextCut(text: string, from: number): number {
  let i = from;
  while (i < text.length && /\s/.test(text[i])) i++;
  while (i < text.length && !/\s/.test(text[i])) i++;
  while (i < text.length && /[ \t]/.test(text[i])) i++;
  return i;
}

/** How far to reveal this frame, from `shown` characters towards `target`. */
export function step(target: string, shown: number): number {
  const backlog = target.length - shown;
  if (backlog <= 0) return target.length;
  const want = shown + Math.max(1, Math.ceil(backlog / CATCH_UP_FRAMES));
  let at = shown;
  while (at < want && at < target.length) at = nextCut(target, at);
  return Math.min(at, target.length);
}

function reducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function useSmoothText(source: () => string): Ref<string> {
  const shown = ref(source());
  let raf = 0;
  const hasRaf = typeof requestAnimationFrame === "function";

  function tick(): void {
    raf = 0;
    const target = source();
    if (!target.startsWith(shown.value)) {
      shown.value = target;
      return;
    }
    const at = step(target, shown.value.length);
    shown.value = target.slice(0, at);
    if (at < target.length) raf = requestAnimationFrame(tick);
  }

  watch(source, (target) => {
    if (!hasRaf || reducedMotion() || !target.startsWith(shown.value)) {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      shown.value = target;
      return;
    }
    if (!raf && shown.value.length < target.length) raf = requestAnimationFrame(tick);
  });

  onBeforeUnmount(() => {
    if (raf) cancelAnimationFrame(raf);
  });
  return shown;
}
