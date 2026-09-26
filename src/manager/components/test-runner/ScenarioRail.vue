<script setup lang="ts">
/**
 * Left rail of the Test Runner: saved scenarios, pinned first, with a name
 * filter and a "new quick run" action. The active row is the scenario open
 * in the workbench; an unsaved quick run shows as its own row at the top.
 */
import { computed, ref } from "vue";
import Button from "../ui/Button.vue";
import Icon, { ICON_SM } from "../ui/Icon.vue";
import type { ScenarioRow } from "../../api/types";
import { seedLabel, type LastRunSummary } from "../../utils/scenario";

const props = defineProps<{
  scenarios: ScenarioRow[];
  activeId: string | null;
  /** Name of the open draft when it is an unsaved quick run. */
  quickRunName: string | null;
}>();

const emit = defineEmits<{
  (e: "select", row: ScenarioRow): void;
  (e: "new"): void;
  (e: "toggle-pin", row: ScenarioRow): void;
  (e: "delete", row: ScenarioRow): void;
}>();

const filter = ref("");
const filtered = computed(() => {
  const q = filter.value.trim().toLowerCase();
  return q ? props.scenarios.filter((s) => s.name.toLowerCase().includes(q)) : props.scenarios;
});
const pinned = computed(() => filtered.value.filter((s) => s.is_pinned));
const others = computed(() => filtered.value.filter((s) => !s.is_pinned));

function lastRun(row: ScenarioRow): LastRunSummary | null {
  const lr = row.last_run as Partial<LastRunSummary> | null;
  return lr && typeof lr.runs === "number" ? (lr as LastRunSummary) : null;
}

function status(row: ScenarioRow): { tone: "ok" | "warn" | "new"; label: string } {
  const lr = lastRun(row);
  if (!lr) return { tone: "new", label: "not run" };
  if (lr.failed) return { tone: "warn", label: `${lr.failed} failed` };
  if (lr.warnings) return { tone: "warn", label: `${lr.warnings} warning${lr.warnings === 1 ? "" : "s"}` };
  return { tone: "ok", label: "clean" };
}

function itemCount(row: ScenarioRow): string {
  const n = row.stack.length;
  return `${n} item${n === 1 ? "" : "s"}`;
}
</script>

<template>
  <aside class="wp-trr" aria-label="Scenarios" data-test="scenario-rail">
    <div class="wp-trr__head">
      <div class="wp-trr__title">
        <h2>Scenarios</h2>
        <Button variant="ghost" size="sm" icon="pi-plus" data-test="new-quick-run" @click="emit('new')">New</Button>
      </div>
      <input
        v-model="filter"
        class="wp-trr__filter"
        type="search"
        placeholder="Filter scenarios…"
        aria-label="Filter scenarios"
        data-test="scenario-filter"
      >
    </div>

    <ul class="wp-trr__list">
      <li v-if="quickRunName !== null">
        <button type="button" class="wp-trr__row" data-active="true" data-test="quick-run-row">
          <span class="wp-trr__name">{{ quickRunName }}</span>
          <span class="wp-trr__meta">unsaved quick run</span>
        </button>
      </li>

      <template v-for="group in [{ label: 'Pinned', rows: pinned }, { label: pinned.length ? 'Others' : '', rows: others }]" :key="group.label">
        <li v-if="group.rows.length && group.label" class="wp-trr__group">{{ group.label }}</li>
        <li v-for="row in group.rows" :key="row.id" class="wp-trr__item">
          <button
            type="button"
            class="wp-trr__row"
            :data-active="row.id === activeId ? 'true' : 'false'"
            data-test="scenario-row"
            @click="emit('select', row)"
          >
            <span class="wp-trr__line">
              <span class="wp-trr__name">{{ row.name }}</span>
              <span class="wp-trr__pill" :data-tone="status(row).tone">{{ status(row).label }}</span>
            </span>
            <span class="wp-trr__meta">{{ itemCount(row) }} · {{ seedLabel(row.seeds) }}</span>
          </button>
          <span class="wp-trr__acts">
            <button
              type="button"
              class="wp-trr__act"
              :aria-label="row.is_pinned ? `Unpin ${row.name}` : `Pin ${row.name}`"
              :data-on="row.is_pinned ? 'true' : 'false'"
              data-test="scenario-pin"
              @click="emit('toggle-pin', row)"
            ><Icon name="pi-thumbtack" :size="ICON_SM" /></button>
            <button
              type="button"
              class="wp-trr__act"
              :aria-label="`Delete ${row.name}`"
              data-test="scenario-delete"
              @click="emit('delete', row)"
            ><Icon name="pi-trash" :size="ICON_SM" /></button>
          </span>
        </li>
      </template>

      <li v-if="!scenarios.length" class="wp-trr__empty">
        No saved scenarios yet. Build a stack, run it, then Save to keep it here.
      </li>
      <li v-else-if="!filtered.length" class="wp-trr__empty">No scenario matches "{{ filter }}".</li>
    </ul>
  </aside>
</template>

<style scoped>
.wp-trr {
  display: flex; flex-direction: column; min-height: 0;
  background: var(--wp-bg-1);
  border-right: 1px solid var(--wp-border);
}
.wp-trr__head {
  display: flex; flex-direction: column; gap: var(--wp-space-4);
  padding: var(--wp-space-6) var(--wp-space-5) var(--wp-space-5);
  border-bottom: 1px solid var(--wp-border);
}
.wp-trr__title { display: flex; align-items: center; justify-content: space-between; }
.wp-trr__title h2 { margin: 0; font-size: var(--wp-text-md); font-weight: var(--wp-weight-semibold); }
.wp-trr__filter {
  width: 100%;
  background: var(--wp-bg-2); color: var(--wp-text);
  border: 1px solid var(--wp-border); border-radius: var(--wp-radius-sm);
  padding: var(--wp-space-3) var(--wp-space-4); font-size: var(--wp-text-sm);
}
.wp-trr__filter:focus-visible { outline: none; border-color: var(--wp-border-focus); }
.wp-trr__list {
  list-style: none; margin: 0; padding: var(--wp-space-3);
  overflow: auto; display: flex; flex-direction: column; gap: var(--wp-space-1);
}
.wp-trr__group {
  padding: var(--wp-space-5) var(--wp-space-4) var(--wp-space-2);
  font-size: var(--wp-text-xs); font-weight: var(--wp-weight-semibold);
  letter-spacing: .08em; text-transform: uppercase; color: var(--wp-text-dim);
}
.wp-trr__item { position: relative; }
.wp-trr__row {
  width: 100%; text-align: left; cursor: pointer;
  background: none; border: 0; border-radius: var(--wp-radius-sm);
  padding: var(--wp-space-4) var(--wp-space-4);
  display: flex; flex-direction: column; gap: var(--wp-space-1);
  color: var(--wp-text); font: inherit;
}
.wp-trr__row:hover { background: var(--wp-bg-2); }
.wp-trr__row[data-active="true"] { background: var(--wp-bg-3); box-shadow: inset 0 0 0 1px var(--wp-border-strong); }
.wp-trr__row:focus-visible { outline: 2px solid var(--wp-border-focus); outline-offset: -2px; }
.wp-trr__line { display: flex; justify-content: space-between; align-items: flex-start; gap: var(--wp-space-3); padding-right: 44px; } /* audit-exempt: 44px reserves room for the two hover actions */
.wp-trr__name { font-weight: var(--wp-weight-medium); font-size: var(--wp-text-base); word-break: break-word; }
.wp-trr__meta { font-size: var(--wp-text-xs); color: var(--wp-text-dim); }
.wp-trr__pill {
  flex-shrink: 0; font: var(--wp-weight-medium) 10px/16px var(--wp-font-mono); /* audit-exempt: 10px pill text */
  padding: 0 var(--wp-space-3); border-radius: 999px;
  background: var(--wp-bg-4); color: var(--wp-text-muted);
}
.wp-trr__pill[data-tone="ok"] { background: color-mix(in oklab, var(--wp-success) 16%, transparent); color: var(--wp-success); }
.wp-trr__pill[data-tone="warn"] { background: color-mix(in oklab, var(--wp-warn) 16%, transparent); color: var(--wp-warn); }
.wp-trr__acts {
  position: absolute; top: var(--wp-space-3); right: var(--wp-space-3);
  display: flex; gap: var(--wp-space-1); opacity: 0; transition: opacity .12s;
}
.wp-trr__item:hover .wp-trr__acts,
.wp-trr__item:focus-within .wp-trr__acts { opacity: 1; }
.wp-trr__act {
  background: var(--wp-bg-4); border: 0; border-radius: var(--wp-radius-sm);
  color: var(--wp-text-muted); cursor: pointer; padding: var(--wp-space-2);
  display: inline-flex;
}
.wp-trr__act:hover { color: var(--wp-text); }
.wp-trr__act[data-on="true"] { color: var(--wp-accent-text); }
.wp-trr__act:focus-visible { outline: 2px solid var(--wp-border-focus); }
.wp-trr__empty { padding: var(--wp-space-5) var(--wp-space-4); font-size: var(--wp-text-sm); color: var(--wp-text-muted); }
</style>
