<script setup lang="ts">
/**
 * ImageFilterWidget — the on-node settings of WP Image Filter, plus a strip of
 * what the last run kept.
 *
 * Value contract: `modelValue` is an `ImageFilterConfig`; every edit emits the
 * whole next config (`src/widgets/image_filter.ts` serializes it).
 */
import { computed } from "vue";
import {
  clampTimeout,
  viewUrl,
  type FilterMode,
  type ImageFilterConfig,
  type ImageFilterRun,
  type ImageRef,
  type OnTimeout,
  type SendAs,
} from "./types";

const props = withDefaults(
  defineProps<{
    modelValue: ImageFilterConfig;
    lastRun?: ImageFilterRun | null;
    /** Thumbnails of the last run's picks, when this page saw the request. */
    thumbs?: ImageRef[];
    /** Litegraph mode: 2 = muted, 4 = bypassed (dims the widget). */
    nodeMode?: number;
  }>(),
  { lastRun: null, thumbs: () => [], nodeMode: 0 },
);
const emit = defineEmits<{ "update:modelValue": [next: ImageFilterConfig] }>();

const isSkipped = computed(() => props.nodeMode === 2 || props.nodeMode === 4);

const MODES: { value: FilterMode; label: string; title: string }[] = [
  { value: "pause", label: "Pause & pick", title: "Stop at this node every run and let you pick" },
  { value: "reuse", label: "Reuse last picks", title: "Keep the same picks as last time without asking (asks again when they no longer fit)" },
  { value: "pass_all", label: "Pass all", title: "Let everything through, as if the node weren't there" },
];

function patch(p: Partial<ImageFilterConfig>): void {
  emit("update:modelValue", { ...props.modelValue, ...p });
}

const TIMEOUT_STEP = 30;
function setTimeoutSecs(n: number): void {
  patch({ timeout: clampTimeout(n) });
}
function onTimeoutInput(ev: Event): void {
  const n = Number((ev.target as HTMLInputElement).value);
  setTimeoutSecs(Number.isFinite(n) ? n : props.modelValue.timeout);
}

const MAX_THUMBS = 12;
const shownThumbs = computed(() => props.thumbs.slice(0, MAX_THUMBS));

const summary = computed(() => {
  const run = props.lastRun;
  if (!run) return "";
  if (run.stopped) return "stopped the branch";
  const frames = [...new Set(run.picks.map(([f]) => f + 1))];
  const frameText = run.frames > 1 && frames.length
    ? ` · ${frames.length === 1 ? "frame" : "frames"} ${frames.join(", ")}`
    : "";
  const extras = [
    run.edited ? `${run.edited} ${run.edited === 1 ? "prompt" : "prompts"} edited` : "",
    run.masks ? `${run.masks} ${run.masks === 1 ? "mask" : "masks"}` : "",
  ].filter(Boolean);
  return `${run.picks.length} of ${run.total} kept${frameText}${extras.length ? ` · ${extras.join(" · ")}` : ""}`;
});
</script>

<template>
  <div class="wp-ifw" :class="{ 'wp-ifw--skipped': isSkipped }" data-test="image-filter-widget">
    <section class="wp-ifw__section">
      <div class="wp-ifw__head"><span class="wp-ifw__label">WHEN IT RUNS</span></div>
      <div class="wp-ifw__box">
        <div class="wp-ifw__row">
          <span class="wp-ifw__row-label">Mode</span>
          <div class="wp-ifw__seg" role="radiogroup" aria-label="Mode">
            <button
              v-for="m in MODES"
              :key="m.value"
              type="button"
              role="radio"
              class="wp-ifw__seg-btn"
              :class="{ 'is-on': modelValue.mode === m.value }"
              :aria-checked="modelValue.mode === m.value"
              :title="m.title"
              :data-test="`if-mode-${m.value}`"
              @click="patch({ mode: m.value })"
            >{{ m.label }}</button>
          </div>
        </div>
        <div class="wp-ifw__row">
          <span class="wp-ifw__row-label" title="One per image: every picked image becomes its own item, with its own copy of its frame's prompt and conditioning">Send picks as</span>
          <select
            class="wp-ifw__select"
            :value="modelValue.send_as"
            aria-label="Send picks as"
            data-test="if-send-as"
            @change="patch({ send_as: ($event.target as HTMLSelectElement).value as SendAs })"
          >
            <option value="same_shape">Same shape</option>
            <option value="per_image">One per image</option>
          </select>
        </div>
        <div class="wp-ifw__row" :class="{ 'is-off': modelValue.mode === 'pass_all' }">
          <span class="wp-ifw__row-label" title="Seconds to wait for your picks. 0 waits until you answer. The picker can't send an empty pick, so this is also what happens when nothing gets picked.">Timeout</span>
          <span class="wp-ifw__timeout">
            <span class="wp-ifw__num-wrap">
              <input
                type="number"
                class="wp-ifw__num"
                min="0"
                :step="TIMEOUT_STEP"
                :value="modelValue.timeout"
                aria-label="Timeout in seconds"
                data-test="if-timeout"
                @keydown.stop
                @change="onTimeoutInput"
              >
              <span class="wp-ifw__spin">
                <button type="button" class="wp-ifw__spin-btn" tabindex="-1" aria-label="Longer timeout" data-test="if-timeout-up" @click="setTimeoutSecs(modelValue.timeout + TIMEOUT_STEP)">
                  <svg width="6" height="4" viewBox="0 0 8 5"><path d="M0 5 L4 0 L8 5 Z" fill="currentColor" /></svg></button>
                <button type="button" class="wp-ifw__spin-btn" tabindex="-1" aria-label="Shorter timeout" data-test="if-timeout-down" @click="setTimeoutSecs(modelValue.timeout - TIMEOUT_STEP)">
                  <svg width="6" height="4" viewBox="0 0 8 5"><path d="M0 0 L4 5 L8 0 Z" fill="currentColor" /></svg></button>
              </span>
            </span>
            <span class="wp-ifw__unit">{{ modelValue.timeout === 0 ? "no limit" : "s, then" }}</span>
            <select
              v-if="modelValue.timeout > 0"
              class="wp-ifw__select"
              :value="modelValue.on_timeout"
              aria-label="After the timeout"
              data-test="if-on-timeout"
              @change="patch({ on_timeout: ($event.target as HTMLSelectElement).value as OnTimeout })"
            >
              <option value="keep_all">keep all</option>
              <option value="keep_first">keep the first</option>
              <option value="stop">stop this branch</option>
            </select>
          </span>
        </div>
      </div>
    </section>

    <section class="wp-ifw__section">
      <div class="wp-ifw__head">
        <span class="wp-ifw__label">LAST RUN</span>
        <span class="wp-ifw__head-note" data-test="if-summary">{{ summary || "picks show here after a run" }}</span>
      </div>
      <div v-if="shownThumbs.length" class="wp-ifw__thumbs" data-test="if-thumbs">
        <img v-for="(t, i) in shownThumbs" :key="i" :src="viewUrl(t)" class="wp-ifw__thumb" alt="">
        <span v-if="thumbs.length > shownThumbs.length" class="wp-ifw__thumb-more">+{{ thumbs.length - shownThumbs.length }}</span>
      </div>
    </section>
  </div>
</template>

<style scoped>
.wp-ifw { display: flex; flex-direction: column; gap: 10px; color: var(--wp-text); font: 12px var(--wp-font-sans, sans-serif); padding: 4px 0; min-width: 0; }
.wp-ifw--skipped { opacity: 0.45; }
.wp-ifw__section { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.wp-ifw__head { display: flex; align-items: center; gap: 8px; }
.wp-ifw__label { font: 600 9px var(--wp-font-sans, sans-serif); letter-spacing: 0.08em; text-transform: uppercase; color: var(--wp-text-dim, var(--wp-text-muted, var(--wp-text2))); }
.wp-ifw__head-note { flex: 1; font-size: 9px; color: var(--wp-text-dim, var(--wp-text3)); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wp-ifw__box { display: flex; flex-direction: column; gap: 2px; padding: 4px 6px; background: var(--wp-bg-deep, var(--wp-bg)); border: 1px solid var(--wp-border); border-radius: 3px; }
.wp-ifw__row { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 24px; }
.wp-ifw__row.is-off { opacity: .45; }
.wp-ifw__row-label { font-size: 10.5px; color: var(--wp-text-muted, var(--wp-text2)); white-space: nowrap; }
.wp-ifw__seg { display: flex; padding: 1px; border: 1px solid var(--wp-border); border-radius: 3px; background: var(--wp-bg2); }
.wp-ifw__seg-btn { padding: 2px 7px; border: 0; border-radius: 2px; background: transparent; color: var(--wp-text-dim, var(--wp-text3)); font: 10.5px var(--wp-font-sans, sans-serif); cursor: pointer; white-space: nowrap; }
.wp-ifw__seg-btn:hover { color: var(--wp-text); }
.wp-ifw__seg-btn.is-on { background: var(--wp-accent); color: #fff; }
.wp-ifw__select { height: 20px; padding: 0 4px; background: var(--wp-bg2); color: var(--wp-text); border: 1px solid var(--wp-border); border-radius: 3px; font: 10.5px var(--wp-font-sans, sans-serif); cursor: pointer; }
.wp-ifw__timeout { display: flex; align-items: center; gap: 6px; }
.wp-ifw__unit { font-size: 10px; color: var(--wp-text-dim, var(--wp-text3)); white-space: nowrap; }
/* Custom ± arrows, same as the seed rows and the sweep Limit. */
.wp-ifw__num-wrap { display: inline-flex; align-items: stretch; width: 64px; height: 20px; overflow: hidden; background: var(--wp-bg2); border: 1px solid var(--wp-border); border-radius: 3px; }
.wp-ifw__num-wrap:focus-within { border-color: var(--wp-accent); }
.wp-ifw__num { flex: 1; min-width: 0; background: transparent; border: 0; padding: 0 5px; color: var(--wp-text); font: 10.5px var(--wp-font-mono, monospace); text-align: right; -moz-appearance: textfield; appearance: textfield; }
.wp-ifw__num:focus { outline: none; }
.wp-ifw__num::-webkit-outer-spin-button, .wp-ifw__num::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
.wp-ifw__spin { display: flex; flex-direction: column; width: 14px; flex-shrink: 0; border-left: 1px solid var(--wp-border); background: rgba(99,102,241,.04); }
.wp-ifw__spin-btn { flex: 1; display: flex; align-items: center; justify-content: center; background: transparent; border: 0; padding: 0; color: var(--wp-text-dim, #7a7d88); cursor: pointer; line-height: 0; }
.wp-ifw__spin-btn + .wp-ifw__spin-btn { border-top: 1px solid var(--wp-border); }
.wp-ifw__spin-btn:hover { color: var(--wp-accent-text, var(--wp-text)); background: rgba(99,102,241,.12); }
.wp-ifw__thumbs { display: flex; flex-wrap: wrap; gap: 4px; padding: 4px; background: var(--wp-bg-deep, var(--wp-bg)); border: 1px solid var(--wp-border); border-radius: 3px; }
.wp-ifw__thumb { width: 40px; height: 40px; object-fit: cover; border-radius: 3px; }
.wp-ifw__thumb-more { align-self: center; font: 10px var(--wp-font-mono, monospace); color: var(--wp-text-dim, var(--wp-text3)); padding: 0 4px; }
</style>
