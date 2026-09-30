<script setup lang="ts">
/**
 * Warnings tab: everything the engine flagged this run, errors first, each
 * with a friendly label, the module that raised it (click to open it in
 * the trace) and the engine's own message with its refs as chips.
 */
import { computed } from "vue";
import RichTextPreview from "../../manager/components/RichTextPreview.vue";
import type { TraceStep, WarningRow } from "./debug-model";

const props = defineProps<{
  rows: WarningRow[];
  stepsByKey: Map<string, TraceStep>;
  uuidToName: Map<string, string>;
  uuidToKind: Map<string, string>;
}>();
const emit = defineEmits<{ (e: "goto-step", key: string): void }>();

const RANK = { error: 0, warning: 1, info: 2 } as const;
const sorted = computed(() =>
  [...props.rows].sort((a, b) => RANK[a.severity] - RANK[b.severity] || Number(a.key) - Number(b.key)),
);

function ownerLabel(key: string | null): string {
  if (!key) return "";
  const s = props.stepsByKey.get(key);
  if (!s) return "";
  return s.name || (s.bindings[0] ? `$${s.bindings[0]}` : s.kindLabel);
}
</script>

<template>
  <div class="wp-dbg-warns" data-test="dbg-warnings">
    <div
      v-for="w in sorted"
      :key="w.key"
      class="wp-dbg-warn"
      :class="`is-${w.severity}`"
      data-test="dbg-warning"
    >
      <span class="wp-dbg-warn__dot" aria-hidden="true" />
      <div class="wp-dbg-warn__body">
        <div class="wp-dbg-warn__head">
          <span class="wp-dbg-warn__label" :title="w.type">{{ w.label }}</span>
          <span v-if="w.detailText" class="wp-dbg-warn__detail">{{ w.detailText }}</span>
          <button
            v-if="w.stepKey && ownerLabel(w.stepKey)"
            type="button"
            class="wp-dbg-warn__owner"
            title="Show the module in the trace"
            data-test="dbg-warning-owner"
            @click="emit('goto-step', w.stepKey)"
          >
            <span
              class="wp-dbg-kind-dot"
              :style="{ background: `var(--wp-kind-${stepsByKey.get(w.stepKey)?.kind})` }"
            />
            {{ ownerLabel(w.stepKey) }}
          </button>
        </div>
        <div v-if="w.message" class="wp-dbg-warn__msg">
          <RichTextPreview
            :value="w.message"
            :uuid-to-name="uuidToName"
            :uuid-to-kind="uuidToKind"
            surface="wildcard"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.wp-dbg-warns { display: flex; flex-direction: column; }
.wp-dbg-warn {
  display: flex;
  gap: 8px;
  padding: 6px;
  border-top: 1px solid var(--wp-border-soft, var(--wp-border));
}
.wp-dbg-warn:first-child { border-top: 0; }
.wp-dbg-warn__dot {
  flex: none;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  margin-top: 5px;
  background: var(--wp-warn);
}
.wp-dbg-warn.is-error .wp-dbg-warn__dot { background: var(--wp-red, #e5484d); }
.wp-dbg-warn.is-info .wp-dbg-warn__dot { background: var(--wp-info, var(--wp-accent)); }
.wp-dbg-warn__body { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 2px; }
.wp-dbg-warn__head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.wp-dbg-warn__label { font: 600 11.5px/1.4 var(--wp-font-sans); color: var(--wp-text); }
.wp-dbg-warn__detail {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 999px;
  background: color-mix(in oklab, var(--wp-warn) 14%, transparent);
  color: var(--wp-warn);
}
.wp-dbg-warn.is-error .wp-dbg-warn__detail { background: color-mix(in oklab, var(--wp-red, #e5484d) 14%, transparent); color: var(--wp-red, #e5484d); }
.wp-dbg-warn__owner {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  background: transparent;
  border: 0;
  padding: 0;
  font: 500 10.5px/1.4 var(--wp-font-sans);
  color: var(--wp-text-dim);
  cursor: pointer;
}
.wp-dbg-warn__owner:hover { color: var(--wp-text); text-decoration: underline; }
.wp-dbg-warn__msg { font-size: 11px; color: var(--wp-text-muted); word-break: break-word; }
.wp-dbg-kind-dot { width: 7px; height: 7px; border-radius: 2px; flex: none; }
</style>
