<script setup lang="ts">
/**
 * ImageFilterWidget — the on-node settings of WP Image Filter, plus a strip of
 * what the last run kept.
 *
 * Value contract: `modelValue` is an `ImageFilterConfig`; every edit emits the
 * whole next config (`src/widgets/image_filter.ts` serializes it).
 */
import { computed } from "vue";
import WpNumber from "../shared/WpNumber.vue";
import WpSelect from "../shared/WpSelect.vue";
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
const SEND_AS: { value: SendAs; label: string }[] = [
  { value: "same_shape", label: "Same shape" },
  { value: "per_image", label: "One per image" },
];
const ON_TIMEOUT: { value: OnTimeout; label: string }[] = [
  { value: "keep_all", label: "keep all" },
  { value: "keep_first", label: "keep the first" },
  { value: "stop", label: "stop this branch" },
];
function setSendAs(v: string | number): void {
  const hit = SEND_AS.find((o) => o.value === v);
  if (hit) patch({ send_as: hit.value });
}
function setOnTimeout(v: string | number): void {
  const hit = ON_TIMEOUT.find((o) => o.value === v);
  if (hit) patch({ on_timeout: hit.value });
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
          <WpSelect
            class="wp-ifw__select"
            :model-value="modelValue.send_as"
            :options="SEND_AS"
            aria-label="Send picks as"
            data-test="if-send-as"
            @update:model-value="setSendAs"
          />
        </div>
        <div class="wp-ifw__row" :class="{ 'is-off': modelValue.mode === 'pass_all' }">
          <span class="wp-ifw__row-label" title="Seconds to wait for your picks. 0 waits until you answer. The picker can't send an empty pick, so this is also what happens when nothing gets picked.">Timeout</span>
          <span class="wp-ifw__timeout">
            <WpNumber
              class="wp-ifw__num-wrap"
              :model-value="modelValue.timeout"
              :min="0"
              :step="TIMEOUT_STEP"
              aria-label="Timeout in seconds"
              up-label="Longer timeout"
              down-label="Shorter timeout"
              data-test="if-timeout"
              @update:model-value="setTimeoutSecs"
            />
            <span class="wp-ifw__unit">{{ modelValue.timeout === 0 ? "no limit" : "s, then" }}</span>
            <WpSelect
              v-if="modelValue.timeout > 0"
              class="wp-ifw__select"
              :model-value="modelValue.on_timeout"
              :options="ON_TIMEOUT"
              aria-label="After the timeout"
              data-test="if-on-timeout"
              @update:model-value="setOnTimeout"
            />
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
.wp-ifw__select { height: 20px; }
.wp-ifw__timeout { display: flex; align-items: center; gap: 6px; }
.wp-ifw__unit { font-size: 10px; color: var(--wp-text-dim, var(--wp-text3)); white-space: nowrap; }
.wp-ifw__num-wrap { width: 64px; height: 20px; }
.wp-ifw__thumbs { display: flex; flex-wrap: wrap; gap: 4px; padding: 4px; background: var(--wp-bg-deep, var(--wp-bg)); border: 1px solid var(--wp-border); border-radius: 3px; }
.wp-ifw__thumb { width: 40px; height: 40px; object-fit: cover; border-radius: 3px; }
.wp-ifw__thumb-more { align-self: center; font: 10px var(--wp-font-mono, monospace); color: var(--wp-text-dim, var(--wp-text3)); padding: 0 4px; }
</style>
