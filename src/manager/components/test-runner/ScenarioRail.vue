<script setup lang="ts">
/**
 * Left rail of the Test Runner: saved scenarios, pinned first, with a name
 * filter and a "new quick run" action. The active row is the scenario open
 * in the workbench; an unsaved quick run shows as its own row at the top.
 */
import SearchInput from "@/kit/SearchInput.vue";
import { computed, ref } from "vue";
import Button from "@/kit/Button.vue";
import ListRow from "@/kit/ListRow.vue";
import Skeleton from "@/kit/Skeleton.vue";
import type { ScenarioRow } from "../../api/types";
import { seedLabel, type LastRunSummary } from "../../utils/scenario";

const props = defineProps<{
  scenarios: ScenarioRow[];
  activeId: string | null;
  /** Name of the open draft when it is an unsaved quick run. */
  quickRunName: string | null;
  /** Pinned re-run progress, null when idle. */
  rerun: { done: number; total: number } | null;
  /** Narrow the list to scenarios whose stack holds this module or bundle. */
  uses?: { id: string; name: string } | null;
  /** The saved scenarios are still loading: draw their lines, not "No saved
   *  scenarios yet". */
  loading?: boolean;
}>();

const emit = defineEmits<{
  (e: "select", row: ScenarioRow): void;
  (e: "new"): void;
  (e: "toggle-pin", row: ScenarioRow): void;
  (e: "delete", row: ScenarioRow): void;
  (e: "rerun-pinned"): void;
  (e: "clear-uses"): void;
}>();

const pinnedCount = computed(() => props.scenarios.filter((s) => s.is_pinned).length);

const filter = ref("");
const filtered = computed(() => {
  const q = filter.value.trim().toLowerCase();
  const uses = props.uses?.id;
  return props.scenarios.filter((s) =>
    (!q || s.name.toLowerCase().includes(q))
    && (!uses || s.stack.some((i) => ("module" in i ? i.module : i.bundle) === uses)));
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
  if (lr.baseline && !lr.baseline.same) {
    const n = lr.baseline.changed;
    return { tone: "warn", label: n ? `${n} changed` : "differs" };
  }
  if (lr.failed) return { tone: "warn", label: `${lr.failed} failed` };
  if (lr.warnings) return { tone: "warn", label: `${lr.warnings} warning${lr.warnings === 1 ? "" : "s"}` };
  if (lr.baseline?.same) return { tone: "ok", label: "matches" };
  return { tone: "ok", label: "clean" };
}

function statusTitle(row: ScenarioRow): string | undefined {
  const b = lastRun(row)?.baseline;
  if (!b) return undefined;
  return b.same
    ? "The last run matched this scenario's baseline"
    : `The last run differs from the baseline: ${b.changed} of ${b.compared} compared outputs changed`;
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
      <SearchInput
        v-model="filter"
        size="sm"
        placeholder="Filter scenarios…"
        aria-label="Filter scenarios"
        data-test="scenario-filter"
      />
      <div v-if="uses" class="wp-trr__uses" data-test="uses-filter">
        <span>Using <strong>{{ uses.name }}</strong></span>
        <Button variant="ghost" size="sm" icon="pi-times" aria-label="Show all scenarios" @click="emit('clear-uses')" />
      </div>
    </div>

    <ul class="wp-trr__list">
      <li v-if="quickRunName !== null">
        <ListRow class="wp-trr__row" selected description="unsaved quick run" data-active="true" data-test="quick-run-row">
          <span class="wp-trr__name">{{ quickRunName }}</span>
        </ListRow>
      </li>

      <template v-for="group in [{ label: 'Pinned', rows: pinned }, { label: pinned.length ? 'Others' : '', rows: others }]" :key="group.label">
        <li v-if="group.rows.length && group.label" class="wp-trr__group">
          <span>{{ group.label }}</span>
          <Button
            v-if="group.label === 'Pinned'"
            variant="link"
            size="sm"
            icon="pi-refresh"
            class="wp-trr__rerun"
            :loading="rerun !== null"
            :disabled="rerun !== null"
            :title="`Run all ${pinnedCount} pinned scenarios as saved and compare each with its baseline`"
            data-test="rerun-pinned"
            @click="emit('rerun-pinned')"
          >
            {{ rerun ? `Running ${rerun.done + 1} of ${rerun.total}` : "Re-run all" }}
          </Button>
        </li>
        <li v-for="row in group.rows" :key="row.id" class="wp-trr__item">
          <ListRow
            class="wp-trr__row"
            :selected="row.id === activeId"
            :data-active="row.id === activeId ? 'true' : 'false'"
            data-test="scenario-row"
            @click="emit('select', row)"
          >
            <span class="wp-trr__name">{{ row.name }}</span>
            <template #description>
              <span class="wp-trr__meta">
                <span>{{ itemCount(row) }} · {{ seedLabel(row.seeds) }}</span>
                <span class="wp-trr__pill" :data-tone="status(row).tone" :title="statusTitle(row)" data-test="scenario-status">{{ status(row).label }}</span>
              </span>
            </template>
          </ListRow>
          <span class="wp-trr__acts">
            <Button
              variant="ghost"
              size="sm"
              icon="pi-thumbtack"
              class="wp-trr__act"
              :aria-label="row.is_pinned ? `Unpin ${row.name}` : `Pin ${row.name}`"
              :data-on="row.is_pinned ? 'true' : 'false'"
              data-test="scenario-pin"
              @click="emit('toggle-pin', row)"
            />
            <Button
              variant="ghost"
              size="sm"
              icon="pi-trash"
              class="wp-trr__act"
              :aria-label="`Delete ${row.name}`"
              data-test="scenario-delete"
              @click="emit('delete', row)"
            />
          </span>
        </li>
      </template>

      <li v-if="loading && !scenarios.length" class="wp-trr__skel" data-test="scenario-skeleton">
        <Skeleton :lines="4" label="Loading scenarios" />
      </li>
      <li v-else-if="!scenarios.length" class="wp-trr__empty">
        No saved scenarios yet. Build a stack, run it, then Save to keep it here.
      </li>
      <li v-else-if="!filtered.length" class="wp-trr__empty">
        {{ filter ? `No scenario matches "${filter}".` : "No saved scenario uses this." }}
      </li>
    </ul>
  </aside>
</template>

<style scoped>
.wp-trr__skel { list-style: none; padding: var(--wp-space-3) var(--wp-space-4); }
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
.wp-trr__uses {
  display: flex; align-items: center; justify-content: space-between; gap: var(--wp-space-3);
  font-size: var(--wp-text-xs); color: var(--wp-text-muted);
  background: var(--wp-bg-3); border-radius: var(--wp-radius-sm); padding: var(--wp-space-2) var(--wp-space-2) var(--wp-space-2) var(--wp-space-4);
}
.wp-trr__uses strong { color: var(--wp-text); font-weight: var(--wp-weight-medium); }
.wp-trr__list {
  list-style: none; margin: 0; padding: var(--wp-space-3);
  overflow: auto; display: flex; flex-direction: column; gap: var(--wp-space-1);
}
.wp-trr__group {
  display: flex; justify-content: space-between; align-items: center;
  padding: var(--wp-space-5) var(--wp-space-4) var(--wp-space-2);
  font-size: var(--wp-text-xs); font-weight: var(--wp-weight-semibold);
  letter-spacing: .08em; text-transform: uppercase; color: var(--wp-text-dim);
}
/* The group label is uppercase; its link button is not. */
.wp-trr__rerun { letter-spacing: normal; text-transform: none; font-size: var(--wp-text-xs); }
.wp-trr__item { position: relative; }
.wp-trr__row { padding: var(--wp-space-3) var(--wp-space-4); }
.wp-trr__row :deep(.wp-list-row__label) { overflow: visible; white-space: normal; }
/* The name keeps clear of the two hover actions; the status sits on the meta line. */
.wp-trr__item .wp-trr__name { display: block; padding-right: 56px; } /* audit-exempt: 56px reserves room for the two hover actions */
.wp-trr__meta { display: flex; flex-wrap: wrap; align-items: center; gap: var(--wp-space-2) var(--wp-space-3); }
.wp-trr__name { font-weight: var(--wp-weight-medium); font-size: var(--wp-text-base); word-break: break-word; }
.wp-trr__pill {
  flex-shrink: 0; font: var(--wp-weight-medium) 10px/16px var(--wp-font-mono); /* audit-exempt: 10px pill text */
  padding: 0 var(--wp-space-3); border-radius: var(--wp-radius-cap, 999px);
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
.wp-trr__act { color: var(--wp-text-muted); }
.wp-trr__act[data-on="true"] { color: var(--wp-accent-text); }
.wp-trr__empty { padding: var(--wp-space-5) var(--wp-space-4); font-size: var(--wp-text-sm); color: var(--wp-text-muted); }
</style>
