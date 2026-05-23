<script setup lang="ts">
/**
 * Tier-3 chain visualization — Task 19.
 *
 * Rendered inside `ConflictModal.vue` for every `PerItemIssue` with
 * `kind === "tier-3"`. Tier-3 means "nested too deep" (exceeds the
 * tier-2 nesting cap) — hard-rejected per spec lock #9 of
 * CHECKPOINT-importer-exporter.md, so the parent suppresses the
 * "Import anyway" button. This component's only job is to show the
 * user *what* is too deeply nested so they can flatten the bundle
 * chain and retry the export.
 *
 * Surface:
 *   - The outer bundle name + a "Tier-3 rejected" badge.
 *   - A "Why?" / "Hide why" toggle (collapsed by default — the chain
 *     can be long, so we keep the row compact until the user asks).
 *   - When expanded: one row per chain step with `idx * 16px` of
 *     left padding so the chain reads as visually nested. Step 0 is
 *     the outer bundle (no prefix); steps 1..n get prefixed with
 *     `└ contains: ` so the parent/child relationship is obvious
 *     even without the indentation cues.
 *   - A hint line spelling out the remediation:
 *     "Exceeds tier-2 nesting cap. Flatten the chain to import."
 *
 * No emits — this is pure visualization. The Skip resolution flow
 * lives in `ConflictModal`; this sub-component only renders.
 *
 * `ChainStep.id` (NOT `uuid`) — the entire TS import-export surface
 * aligned to `id` in commit `9cf37c7` (Task 17). The type lives in
 * `./chain-types.ts` rather than being exported from this SFC so
 * plain-`tsc` + IDE diagnostic engines resolve it cleanly (Task 18
 * type-export pattern).
 */
import { ref, useId } from "vue";
import type { ChainStep } from "./chain-types";

interface Props {
  bundleName: string;
  chain: ChainStep[];
}

defineProps<Props>();

const expanded = ref<boolean>(false);

/**
 * Stable id for the collapsible chain body so the toggle's
 * `aria-controls` can reference it. Vue 3.5+ `useId()` gives us a
 * deterministic, SSR-safe id per component instance — required for
 * the assistive-tech announcement of expanded/collapsed state on the
 * toggle button (see WAI-ARIA disclosure pattern).
 */
const bodyId = useId();
</script>

<template>
  <div class="wp-tier3-row" data-test="tier3-row">
    <div class="wp-tier3-row__head">
      <span class="wp-tier3-row__name">{{ bundleName }}</span>
      <span class="wp-tier3-row__badge">Tier-3 rejected</span>
      <button
        type="button"
        class="wp-tier3-row__toggle"
        data-test="chain-toggle"
        :aria-expanded="expanded ? 'true' : 'false'"
        :aria-controls="bodyId"
        @click="expanded = !expanded"
      >
        {{ expanded ? "Hide why" : "Why?" }}
      </button>
    </div>
    <div
      v-if="expanded"
      :id="bodyId"
      class="wp-tier3-row__chain"
      data-test="chain-body"
    >
      <div
        v-for="(step, idx) in chain"
        :key="step.id"
        class="wp-tier3-row__step"
        :style="{ paddingLeft: `${idx * 16}px` }"
      >
        <span v-if="idx > 0" class="wp-tier3-row__step-prefix">└ contains: </span>{{ step.name }}
      </div>
      <p class="wp-tier3-row__hint">
        Exceeds tier-2 nesting cap. Flatten the chain to import.
      </p>
    </div>
  </div>
</template>

<style scoped>
.wp-tier3-row {
  display: flex;
  flex-direction: column;
  gap: var(--wp-space-3);
  flex: 1;
  min-width: 0;
}

.wp-tier3-row__head {
  display: flex;
  align-items: center;
  gap: var(--wp-space-4);
  flex-wrap: wrap;
}

.wp-tier3-row__name {
  font-weight: var(--wp-weight-medium);
  color: var(--wp-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wp-tier3-row__badge {
  font-size: var(--wp-text-xs);
  font-weight: var(--wp-weight-semibold);
  color: var(--wp-warn);
  background: color-mix(in oklab, var(--wp-warn) 14%, transparent);
  border: 1px solid color-mix(in oklab, var(--wp-warn) 40%, transparent);
  border-radius: var(--wp-radius-sm);
  padding: var(--wp-space-1) var(--wp-space-3);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.wp-tier3-row__toggle {
  height: var(--wp-btn-h-sm);
  padding: 0 var(--wp-space-4);
  background: transparent;
  color: var(--wp-text-muted);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius-sm);
  font-family: inherit;
  font-size: var(--wp-text-sm);
  cursor: pointer;
  transition: background .12s, color .12s, border-color .12s;
  margin-left: auto;
}
.wp-tier3-row__toggle:hover {
  background: var(--wp-bg-3);
  color: var(--wp-text);
  border-color: var(--wp-border-strong);
}
.wp-tier3-row__toggle:focus-visible {
  outline: none;
  box-shadow: var(--wp-focus-ring);
}

.wp-tier3-row__chain {
  display: flex;
  flex-direction: column;
  gap: var(--wp-space-2);
  padding: var(--wp-space-3) var(--wp-space-4);
  background: var(--wp-bg-3);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius-sm);
  font-family: var(--wp-font-mono);
  font-size: var(--wp-text-sm);
  color: var(--wp-text);
}

.wp-tier3-row__step {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.wp-tier3-row__step-prefix {
  color: var(--wp-text-muted);
}

.wp-tier3-row__hint {
  margin: var(--wp-space-3) 0 0 0;
  padding-top: var(--wp-space-3);
  border-top: 1px solid var(--wp-border);
  color: var(--wp-text-muted);
  font-family: var(--wp-font);
  font-size: var(--wp-text-sm);
  line-height: var(--wp-line-sm);
}
</style>
