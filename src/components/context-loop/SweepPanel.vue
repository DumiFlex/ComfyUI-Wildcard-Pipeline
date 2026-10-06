<script setup lang="ts">
/**
 * SweepPanel — the Sweep section of the Context Loop widget.
 *
 * Pick downstream wildcards and which of their options to walk; the loop
 * then runs every combination, one frame each, up to `limit`. The panel
 * shows the frame total before anything runs. Value contract mirrors the
 * parent: `modelValue` is the `SweepConfig`, every change emits a new one.
 */
import { computed, ref } from "vue";
import {
  SWEEP_MAX_LIMIT,
  sweepTotal,
  type SweepAxis,
  type SweepConfig,
} from "./types";
import { axisStatus, type SweepCandidate } from "./sweep-candidates";

const props = withDefaults(
  defineProps<{
    modelValue: SweepConfig;
    candidates?: SweepCandidate[];
    /** Whole-loop bypass is on, so the sweep is ignored this run. */
    loopBypassed?: boolean;
  }>(),
  { candidates: () => [], loopBypassed: false },
);

const emit = defineEmits<{ "update:modelValue": [next: SweepConfig] }>();

const HOLD_TOOLTIP =
  "When ON, everything you are not sweeping keeps the same pick on every " +
  "frame, so only the swept wildcards change. When OFF, the rest re-rolls " +
  "per frame as in a normal loop.";

/** uid of the axis whose option list is open. */
const openUid = ref<string | null>(null);

function patch(next: Partial<SweepConfig>): void {
  emit("update:modelValue", { ...props.modelValue, ...next });
}

const rows = computed(() =>
  props.modelValue.axes.map((axis) => ({ axis, ...axisStatus(axis, props.candidates) })),
);

const total = computed(() => sweepTotal(props.modelValue.axes));
const frames = computed(() => Math.min(total.value, props.modelValue.limit));
const capped = computed(() => total.value > props.modelValue.limit);

const available = computed(() => {
  const used = new Set(props.modelValue.axes.map((a) => a.uid));
  return props.candidates.filter((c) => !used.has(c.uid));
});

function axisName(row: (typeof rows.value)[number]): string {
  if (row.candidate) return `$${row.candidate.binding || row.candidate.name}`;
  return row.axis.label ?? row.axis.uid;
}

function toggleEnabled(): void {
  patch({ enabled: !props.modelValue.enabled });
}

function toggleHold(): void {
  patch({ hold_others: !props.modelValue.hold_others });
}

function onLimit(ev: Event): void {
  const n = Math.round(Number((ev.target as HTMLInputElement).value));
  if (!Number.isFinite(n)) return;
  patch({ limit: Math.min(SWEEP_MAX_LIMIT, Math.max(1, n)) });
}

function addAxis(ev: Event): void {
  const sel = ev.target as HTMLSelectElement;
  const c = props.candidates.find((x) => x.uid === sel.value);
  sel.value = "";
  if (!c) return;
  const axis: SweepAxis = {
    uid: c.uid,
    option_ids: [...c.defaultIds],
    label: `$${c.binding || c.name}`,
  };
  patch({ axes: [...props.modelValue.axes, axis] });
  openUid.value = c.uid;
}

function removeAxis(uid: string): void {
  patch({ axes: props.modelValue.axes.filter((a) => a.uid !== uid) });
  if (openUid.value === uid) openUid.value = null;
}

function setAxisIds(uid: string, ids: string[]): void {
  // An axis with nothing picked would drop out of the sweep on save (the
  // parsers discard it), so keep at least one option.
  if (!ids.length) return;
  patch({
    axes: props.modelValue.axes.map((a) => (a.uid === uid ? { ...a, option_ids: ids } : a)),
  });
}

function toggleOption(axis: SweepAxis, id: string, candidate: SweepCandidate): void {
  const on = new Set(axis.option_ids);
  if (on.has(id)) on.delete(id);
  else on.add(id);
  // Keep the wildcard's own option order so frames read top to bottom.
  setAxisIds(axis.uid, candidate.options.map((o) => o.id).filter((x) => on.has(x)));
}

function selectAll(axis: SweepAxis, candidate: SweepCandidate): void {
  setAxisIds(axis.uid, candidate.options.map((o) => o.id));
}

function selectDefault(axis: SweepAxis, candidate: SweepCandidate): void {
  setAxisIds(axis.uid, [...candidate.defaultIds]);
}

function moveAxis(uid: string, dir: -1 | 1): void {
  const axes = [...props.modelValue.axes];
  const i = axes.findIndex((a) => a.uid === uid);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= axes.length) return;
  [axes[i], axes[j]] = [axes[j], axes[i]];
  patch({ axes });
}
</script>

<template>
  <div class="wp-sweep" :class="{ 'wp-sweep--on': modelValue.enabled }">
    <div class="wp-sweep__row">
      <span class="wp-sweep__row-label">Sweep combinations</span>
      <button
        type="button"
        class="wp-sweep__switch"
        :class="{ 'wp-sweep__switch--on': modelValue.enabled }"
        data-test="sweep-toggle"
        :aria-pressed="modelValue.enabled"
        :aria-label="`Sweep combinations: ${modelValue.enabled ? 'on' : 'off'}`"
        title="Run every combination of the wildcards you pick, one frame each."
        @click="toggleEnabled"
      >
        <span class="wp-sweep__switch-thumb" />
      </button>
    </div>

    <template v-if="modelValue.enabled">
      <div v-if="modelValue.axes.length" class="wp-sweep__total" :class="{ 'wp-sweep__total--warn': capped }" data-test="sweep-total">
        <template v-if="loopBypassed">Loop is bypassed, so the sweep is ignored.</template>
        <template v-else>
          <template v-if="modelValue.axes.length > 1">
            <span class="wp-sweep__math">{{ modelValue.axes.map((a) => a.option_ids.length).join(" × ") }}</span> =
          </template>
          <strong>{{ total }}</strong> {{ total === 1 ? "combination" : "combinations" }}<template v-if="capped">; the limit runs the first <strong>{{ frames }}</strong></template>
        </template>
      </div>
      <div v-else class="wp-sweep__hint" data-test="sweep-empty">
        {{ candidates.length
          ? "Add a wildcard to sweep. Its options become the frames."
          : "No wildcards downstream. Wire this loop into a WP Context that has one." }}
      </div>

      <div
        v-for="(row, i) in rows"
        :key="row.axis.uid"
        class="wp-sweep__axis"
        :class="{ 'wp-sweep__axis--missing': row.missing }"
        :data-test="`sweep-axis-${row.axis.uid}`"
      >
        <div class="wp-sweep__axis-head">
          <button
            type="button"
            class="wp-sweep__axis-name"
            :disabled="row.missing"
            :aria-expanded="openUid === row.axis.uid"
            :title="row.missing ? 'This wildcard is no longer downstream of the loop.' : 'Choose which options to sweep'"
            @click="openUid = openUid === row.axis.uid ? null : row.axis.uid"
          >
            <span class="wp-sweep__axis-var">{{ axisName(row) }}</span>
            <span v-if="row.candidate" class="wp-sweep__axis-node">{{ row.candidate.nodeLabel }}</span>
            <span v-if="row.missing" class="wp-sweep__axis-node">missing</span>
          </button>
          <span class="wp-sweep__axis-count" :title="row.staleIds.length ? `${row.staleIds.length} picked option(s) no longer exist; those frames roll normally` : ''">
            {{ row.axis.option_ids.length }}<template v-if="row.candidate">/{{ row.candidate.options.length }}</template>
            <i v-if="row.staleIds.length" class="pi pi-exclamation-triangle wp-sweep__warn-ico" aria-hidden="true" />
          </span>
          <button v-if="modelValue.axes.length > 1" type="button" class="wp-sweep__icon" :disabled="i === 0" title="Move up (changes slower)" @click="moveAxis(row.axis.uid, -1)">
            <i class="pi pi-arrow-up" aria-hidden="true" />
          </button>
          <button type="button" class="wp-sweep__icon" title="Stop sweeping this wildcard" :data-test="`sweep-remove-${row.axis.uid}`" @click="removeAxis(row.axis.uid)">
            <i class="pi pi-times" aria-hidden="true" />
          </button>
        </div>
        <div v-if="openUid === row.axis.uid && row.candidate" class="wp-sweep__opts">
          <div class="wp-sweep__opts-bar">
            <button type="button" class="wp-sweep__link" @click="selectAll(row.axis, row.candidate)">all</button>
            <button type="button" class="wp-sweep__link" @click="selectDefault(row.axis, row.candidate)">enabled only</button>
          </div>
          <div class="wp-sweep__opts-list">
            <button
              v-for="o in row.candidate.options"
              :key="o.id"
              type="button"
              class="wp-sweep__opt"
              :class="{ 'wp-sweep__opt--on': row.axis.option_ids.includes(o.id) }"
              :aria-pressed="row.axis.option_ids.includes(o.id)"
              :title="o.label"
              :data-test="`sweep-opt-${o.id}`"
              @click="toggleOption(row.axis, o.id, row.candidate)"
            >
              {{ o.label || "(empty)" }}
            </button>
          </div>
        </div>
      </div>

      <select
        v-if="available.length"
        class="wp-sweep__add"
        data-test="sweep-add"
        value=""
        aria-label="Add a wildcard to sweep"
        @change="addAxis"
      >
        <option value="" disabled>+ Sweep a wildcard…</option>
        <option v-for="c in available" :key="c.uid" :value="c.uid">
          ${{ c.binding || c.name }} · {{ c.nodeLabel }} ({{ c.options.length }})
        </option>
      </select>

      <div class="wp-sweep__row">
        <span class="wp-sweep__row-label">Limit</span>
        <input
          type="number"
          class="wp-sweep__limit"
          min="1"
          :max="SWEEP_MAX_LIMIT"
          :value="modelValue.limit"
          data-test="sweep-limit"
          aria-label="Most frames a sweep runs"
          @change="onLimit"
        />
      </div>
      <div class="wp-sweep__row" :title="HOLD_TOOLTIP">
        <span class="wp-sweep__row-label">Hold other picks</span>
        <button
          type="button"
          class="wp-sweep__switch"
          :class="{ 'wp-sweep__switch--on': modelValue.hold_others }"
          data-test="sweep-hold-toggle"
          :aria-pressed="modelValue.hold_others"
          :aria-label="`Hold other picks: ${modelValue.hold_others ? 'on' : 'off'}`"
          @click="toggleHold"
        >
          <span class="wp-sweep__switch-thumb" />
        </button>
      </div>
    </template>
  </div>
</template>

<style scoped>
@import "../shared/theme.css";

.wp-sweep { display: flex; flex-direction: column; gap: 6px; }
.wp-sweep--on {
  padding: 6px 7px;
  border: 1px solid color-mix(in srgb, var(--wp-accent, #c4b5fd) 35%, var(--wp-border, #353841));
  border-radius: 4px;
  background: color-mix(in srgb, var(--wp-accent, #c4b5fd) 5%, transparent);
}
.wp-sweep__row { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.wp-sweep__row-label { font: 10px var(--wp-font-sans, sans-serif); color: var(--wp-text-muted, #aeb1bb); }

.wp-sweep__switch {
  width: 32px; height: 18px; border-radius: 9px; position: relative; padding: 0; cursor: pointer; flex-shrink: 0;
  background: var(--wp-bg-deep, var(--wp-bg, #0e1015));
  border: 1px solid var(--wp-border, #353841);
}
.wp-sweep__switch-thumb {
  position: absolute; top: 1px; left: 1px; width: 14px; height: 14px; border-radius: 50%;
  background: var(--wp-text-dim, #7a7d88);
  transition: left var(--wp-motion-hover, 120ms) ease;
}
.wp-sweep__switch--on {
  background: color-mix(in srgb, var(--wp-accent, #c4b5fd) 22%, transparent);
  border-color: var(--wp-accent, #c4b5fd);
}
.wp-sweep__switch--on .wp-sweep__switch-thumb { left: 15px; background: var(--wp-accent, #c4b5fd); }

.wp-sweep__total { font: 10.5px var(--wp-font-sans, sans-serif); color: var(--wp-text); }
.wp-sweep__total strong { color: var(--wp-accent, #c4b5fd); }
.wp-sweep__total--warn strong:last-child { color: var(--wp-warning, #f59e0b); }
.wp-sweep__math { font-family: var(--wp-font-mono, monospace); color: var(--wp-text-muted, #aeb1bb); }
.wp-sweep__hint { font: 10px var(--wp-font-sans, sans-serif); color: var(--wp-text-dim, #7a7d88); }

.wp-sweep__axis {
  border: 1px solid var(--wp-border, #353841);
  border-radius: 3px;
  background: var(--wp-bg-deep, var(--wp-bg, #0e1015));
}
.wp-sweep__axis--missing { border-style: dashed; opacity: .75; }
.wp-sweep__axis-head { display: flex; align-items: center; gap: 4px; padding: 3px 4px 3px 6px; }
.wp-sweep__axis-name {
  flex: 1; min-width: 0; display: flex; align-items: baseline; gap: 6px;
  background: none; border: 0; padding: 0; cursor: pointer; text-align: left; color: var(--wp-text);
}
.wp-sweep__axis-name:disabled { cursor: default; }
.wp-sweep__axis-var { font: 600 11px var(--wp-font-mono, monospace); color: var(--wp-accent, #c4b5fd); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wp-sweep__axis-node { font: 9.5px var(--wp-font-sans, sans-serif); color: var(--wp-text-dim, #7a7d88); white-space: nowrap; }
.wp-sweep__axis--missing .wp-sweep__axis-node { color: var(--wp-warning, #f59e0b); }
.wp-sweep__axis-count { font: 10px var(--wp-font-mono, monospace); color: var(--wp-text-muted, #aeb1bb); white-space: nowrap; }
.wp-sweep__warn-ico { font-size: 9px; color: var(--wp-warning, #f59e0b); margin-left: 2px; }
.wp-sweep__icon {
  width: 18px; height: 18px; display: inline-flex; align-items: center; justify-content: center; padding: 0;
  background: transparent; border: 1px solid transparent; border-radius: 3px; cursor: pointer;
  color: var(--wp-text-dim, #7a7d88);
}
.wp-sweep__icon:hover:not(:disabled) { color: var(--wp-text); border-color: var(--wp-border, #353841); }
.wp-sweep__icon:disabled { opacity: .35; cursor: default; }
.wp-sweep__icon .pi { font-size: 9px; }

.wp-sweep__opts { border-top: 1px solid var(--wp-border, #353841); padding: 4px 6px 6px; }
.wp-sweep__opts-bar { display: flex; gap: 10px; margin-bottom: 4px; }
.wp-sweep__link {
  background: none; border: 0; padding: 0; cursor: pointer;
  font: 600 9px var(--wp-font-sans, sans-serif); text-transform: uppercase; letter-spacing: .06em;
  color: var(--wp-text-dim, #7a7d88);
}
.wp-sweep__link:hover { color: var(--wp-accent, #c4b5fd); }
.wp-sweep__opts-list { display: flex; flex-wrap: wrap; gap: 3px; max-height: 120px; overflow-y: auto; }
.wp-sweep__opt {
  max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  padding: 2px 6px; border-radius: 3px; cursor: pointer;
  font: 10px var(--wp-font-sans, sans-serif);
  background: transparent; border: 1px solid var(--wp-border, #353841); color: var(--wp-text-dim, #7a7d88);
}
.wp-sweep__opt--on {
  background: color-mix(in srgb, var(--wp-accent, #c4b5fd) 16%, transparent);
  border-color: var(--wp-accent, #c4b5fd);
  color: var(--wp-text);
}

.wp-sweep__add, .wp-sweep__limit {
  background: var(--wp-bg-deep, var(--wp-bg, #0e1015));
  border: 1px solid var(--wp-border, #353841);
  border-radius: 3px;
  color: var(--wp-text-muted, #aeb1bb);
  font: 10.5px var(--wp-font-sans, sans-serif);
}
.wp-sweep__add { width: 100%; padding: 4px 5px; cursor: pointer; }
.wp-sweep__limit { width: 64px; padding: 2px 5px; text-align: right; font-family: var(--wp-font-mono, monospace); -moz-appearance: textfield; appearance: textfield; }
.wp-sweep__limit::-webkit-outer-spin-button, .wp-sweep__limit::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
</style>
