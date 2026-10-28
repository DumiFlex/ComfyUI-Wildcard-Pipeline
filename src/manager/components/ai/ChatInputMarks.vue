<script setup lang="ts">
/**
 * `@Name` items picked from the `@` menu drawn as chips while the user is
 * still typing, in a plain `<textarea>`.
 *
 * Drop it next to the box, in the same parent: `<ChatInputMarks
 * :target="box" :text="model" />`. It lays a copy of the text over the box (same font,
 * padding, width and scroll), with the text itself invisible and each picked
 * label a tinted pill, so the box's own text shows through and nothing about
 * typing, the caret or selection changes. The pill uses no padding or border
 * (only a background and a box-shadow), so it never moves a letter.
 *
 * Which labels count: `mentionSpans` in `utils/chat-completions.ts` (the
 * same ones the message sends as `[[id#Name]]`).
 */
import { onBeforeUnmount, ref, watch } from "vue";
import { mentionSpans } from "../../utils/chat-completions";

const props = defineProps<{
  target: HTMLTextAreaElement | null | undefined;
  /** The box's v-model: the text can change without an input event (a
   *  sent message clears the box, an edit puts one back). */
  text?: string;
}>();

const layer = ref<HTMLElement | null>(null);
const spans = ref<Array<{ text: string; mention: boolean }>>([]);
const style = ref<Record<string, string>>({ display: "none" });

/** What the copy must share with the box to wrap at the same places. */
const COPIED = [
  "fontFamily", "fontSize", "fontWeight", "fontStyle", "letterSpacing", "lineHeight",
  "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "tabSize", "textIndent",
  "wordSpacing", "textTransform",
] as const;

function sync(): void {
  const el = props.target;
  if (!el) return;
  const runs = mentionSpans(el.value);
  if (!runs.some((r) => r.mention)) {
    spans.value = [];
    style.value = { display: "none" };
    return;
  }
  // A trailing newline needs a character after it to take up its line.
  spans.value = el.value.endsWith("\n") ? [...runs, { text: " ", mention: false }] : runs;
  // The layer sits at the box's offset, so the shared parent must be what
  // both are placed in (it is our own markup).
  const parent = el.parentElement;
  if (parent && getComputedStyle(parent).position === "static") parent.style.position = "relative";
  const cs = getComputedStyle(el);
  const s: Record<string, string> = {
    top: `${el.offsetTop + el.clientTop}px`, left: `${el.offsetLeft + el.clientLeft}px`,
    width: `${el.clientWidth}px`, height: `${el.clientHeight}px`,
  };
  for (const k of COPIED) s[k] = cs[k];
  style.value = s;
  requestAnimationFrame(() => {
    if (layer.value) layer.value.scrollTop = el.scrollTop;
  });
}

let observer: ResizeObserver | undefined;
function attach(el: HTMLTextAreaElement): void {
  el.addEventListener("input", sync);
  el.addEventListener("scroll", sync);
  if (typeof ResizeObserver !== "undefined") {
    observer = new ResizeObserver(sync);
    observer.observe(el);
  }
  sync();
}
function detach(el: HTMLTextAreaElement): void {
  el.removeEventListener("input", sync);
  el.removeEventListener("scroll", sync);
  observer?.disconnect();
  observer = undefined;
}

watch(() => props.target, (el, old) => {
  if (old) detach(old);
  if (el) attach(el);
}, { immediate: true });
watch(() => props.text, sync, { flush: "post" });
onBeforeUnmount(() => {
  if (props.target) detach(props.target);
});

defineExpose({ sync });
</script>

<template>
  <div ref="layer" class="wp-ai-marks" :style="style" aria-hidden="true" data-test="ai-input-marks">
    <template v-for="(s, i) in spans" :key="i">
      <mark v-if="s.mention" class="wp-ai-marks__chip" data-test="ai-input-chip">{{ s.text }}</mark>
      <template v-else>{{ s.text }}</template>
    </template>
  </div>
</template>

<style scoped>
.wp-ai-marks {
  position: absolute; z-index: 1; overflow: hidden; pointer-events: none;
  box-sizing: border-box; margin: 0; border: 0;
  white-space: pre-wrap; overflow-wrap: break-word; word-break: normal;
  color: transparent; background: transparent;
}
.wp-ai-marks__chip {
  color: transparent; border-radius: min(4px, var(--wp-radius-cap, 999px));
  background: color-mix(in oklab, var(--wp-accent-500) 24%, transparent);
  box-shadow: 0 0 0 1px color-mix(in oklab, var(--wp-accent-500) 55%, transparent);
  -webkit-box-decoration-break: clone; box-decoration-break: clone;
}
</style>
