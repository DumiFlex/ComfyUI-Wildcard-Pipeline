<script setup lang="ts">
/**
 * SweepModal — the Context Loop's Sweep settings, opened from the node's
 * "Sweep combinations" button (same pattern as Per-iteration seeds).
 *
 * Hosts SweepPanel for the controls and lists the frames the sweep will
 * run, so the grid can be checked before anything is queued.
 */
import { computed } from "vue";
import ModalShell from "../shared/ModalShell.vue";
import SweepPanel from "./SweepPanel.vue";
import { liveAxes, sweepTotal, type SweepConfig } from "./types";
import type { SweepCandidate } from "./sweep-candidates";
import WpButton from "../shared/WpButton.vue";
import CloseButton from "../shared/CloseButton.vue";

const props = withDefaults(
  defineProps<{
    modelValue: SweepConfig;
    candidates?: SweepCandidate[];
    loopBypassed?: boolean;
  }>(),
  { candidates: () => [], loopBypassed: false },
);

const emit = defineEmits<{
  "update:modelValue": [next: SweepConfig];
  close: [];
}>();

/** Frames shown in the preview; the rest are summarised in one line. */
const PREVIEW_MAX = 40;

const total = computed(() => sweepTotal(props.modelValue.axes));
const frameCount = computed(() => Math.min(total.value, props.modelValue.limit));

/** Option text per axis, in the axis's order (unknown ids keep their id). */
const axisLabels = computed(() =>
  liveAxes(props.modelValue.axes).map((a) => {
    const c = props.candidates.find((x) => x.uid === a.uid);
    return a.option_ids.map((id) => c?.options.find((o) => o.id === id)?.label || id);
  }),
);

/** Row-major, last axis fastest: the same order the engine runs. */
const preview = computed(() => {
  if (!props.modelValue.enabled || !axisLabels.value.length) return [];
  const labels = axisLabels.value;
  const n = Math.min(frameCount.value, PREVIEW_MAX);
  const rows: string[][] = [];
  for (let f = 0; f < n; f++) {
    let rest = f;
    const row: string[] = new Array(labels.length);
    for (let i = labels.length - 1; i >= 0; i--) {
      const len = labels[i].length;
      row[i] = labels[i][rest % len];
      rest = Math.floor(rest / len);
    }
    rows.push(row);
  }
  return rows;
});
</script>

<template>
  <ModalShell :visible="true" @close="emit('close')">
    <div class="wp-swm" data-test="sweep-modal">
      <div class="wp-swm__head">
        <span class="wp-swm__head-icon"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="4" y="4" width="6" height="6" rx="1" /><rect x="14" y="4" width="6" height="6" rx="1" /><rect x="4" y="14" width="6" height="6" rx="1" /><rect x="14" y="14" width="6" height="6" rx="1" /></svg></span>
        <div class="wp-swm__title-block">
          <div class="wp-swm__title-row"><span class="wp-swm__name">WP Context Loop</span><span class="wp-swm__chip">Sweep</span></div>
          <div class="wp-swm__sub">Run every combination of the wildcards you pick, one frame each.</div>
        </div>
        <CloseButton size="sm" kbd="Esc" data-test="sweep-modal-close" @click="emit('close')" />
      </div>

      <div class="wp-swm__body">
        <SweepPanel
          :model-value="modelValue"
          :candidates="candidates"
          :loop-bypassed="loopBypassed"
          @update:model-value="(v) => emit('update:modelValue', v)"
        />

        <div v-if="preview.length" class="wp-swm__frames" data-test="sweep-preview">
          <div class="wp-swm__frames-label">Frames</div>
          <div v-for="(row, i) in preview" :key="i" class="wp-swm__frame">
            <span class="wp-swm__frame-n">#{{ i + 1 }}</span>
            <span class="wp-swm__frame-vals">{{ row.join(" · ") }}</span>
          </div>
          <div v-if="frameCount > preview.length" class="wp-swm__frame-more">
            … and {{ frameCount - preview.length }} more
          </div>
        </div>
      </div>

      <div class="wp-swm__foot">
        <span class="wp-swm__foot-hint">Changes save as you make them.</span>
        <span class="wp-swm__spacer" />
        <WpButton variant="primary" data-test="sweep-modal-done" @click="emit('close')">Done</WpButton>
      </div>
    </div>
  </ModalShell>
</template>

<style scoped>
.wp-swm { width: 520px; max-width: 100%; max-height: 86vh; display: flex; flex-direction: column; background: var(--wp-bg2); border: 1px solid var(--wp-border); border-radius: min(6px, var(--wp-radius-cap, 999px)); overflow: hidden; color: var(--wp-text); font-size: 12px; box-shadow: var(--wp-shadow-lg); }
.wp-swm__head { display: flex; align-items: center; gap: 10px; padding: 12px 14px; flex-shrink: 0; border-bottom: 1px solid var(--wp-border); background: color-mix(in srgb, var(--wp-accent) 9%, var(--wp-bg2)); }
.wp-swm__head-icon { color: var(--wp-accent); width: 24px; display: flex; justify-content: center; }
.wp-swm__title-block { flex: 1; min-width: 0; }
.wp-swm__title-row { display: flex; align-items: center; gap: 8px; }
.wp-swm__name { font: 600 13px var(--wp-font-sans); }
.wp-swm__chip { font: 600 9px var(--wp-font-sans); text-transform: uppercase; letter-spacing: .06em; padding: 2px 6px; border-radius: min(2px, var(--wp-radius-cap, 999px)); background: color-mix(in srgb, var(--wp-accent) 22%, transparent); color: var(--wp-accent); }
.wp-swm__sub { font: 10.5px var(--wp-font-sans); color: var(--wp-text-dim, var(--wp-text3)); margin-top: 3px; }

.wp-swm__body { overflow-y: auto; padding: 12px 14px; flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 12px; font-size: 11px; }

.wp-swm__frames { border: 1px solid var(--wp-border); border-radius: min(4px, var(--wp-radius-cap, 999px)); padding: 6px 8px; background: var(--wp-bg-deep, var(--wp-bg)); }
.wp-swm__frames-label { font: 600 9px var(--wp-font-sans); text-transform: uppercase; letter-spacing: .08em; color: var(--wp-text-dim, var(--wp-text3)); margin-bottom: 4px; }
.wp-swm__frame { display: flex; gap: 10px; padding: 2px 0; font: 11px var(--wp-font-mono, monospace); }
.wp-swm__frame-n { width: 32px; flex-shrink: 0; color: var(--wp-text-dim, var(--wp-text3)); text-align: right; }
.wp-swm__frame-vals { color: var(--wp-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wp-swm__frame-more { padding: 4px 0 0 42px; font: 10.5px var(--wp-font-sans); color: var(--wp-text-dim, var(--wp-text3)); }

.wp-swm__foot { display: flex; align-items: center; gap: 12px; padding: 10px 14px; flex-shrink: 0; background: var(--wp-bg3); border-top: 1px solid var(--wp-border); }
.wp-swm__foot-hint { font: 10px var(--wp-font-sans); color: var(--wp-text-dim, var(--wp-text3)); }
.wp-swm__spacer { flex: 1; }
</style>
