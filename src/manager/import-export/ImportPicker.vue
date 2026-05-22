<script setup lang="ts">
/**
 * Import picker — v2 selection surface.
 *
 * Renders one PickerSection per bucket (7 total: bundles, wildcards,
 * fixed_values, combines, derivations, constraints, categories) over
 * the migrated payload emitted by ImportTab. Each section exposes per-row
 * checkboxes plus a section "select all" affordance, and the picker
 * surfaces badges + dep warnings the user needs to make an informed
 * pick:
 *
 *   - `migrated from v0` badge — entity carries `migrated_from` tag.
 *   - `integrity warning` badge — entity id appears in `integrityWarnings`.
 *   - Per-row dep warning text — selected entity references another
 *     entity (via `@{id}` syntax in wildcard options OR bundle/constraint
 *     edges from dep-graph.ts) that the user has NOT yet selected.
 *
 * Smart default: when the payload has exactly ONE entity across all
 * seven buckets, the picker pre-selects it. Two-or-more-entity payloads
 * start with an empty selection so users actively pick.
 *
 * Actions:
 *   - "Select with dependencies" walks `transitiveClosure` over the
 *     cached dep-graph plus pulls in `constraintsBothSidesIn` so any
 *     constraints whose source AND target are now selected ride along.
 *   - "Deselect all" clears the selection in one click.
 *   - "Continue" emits `selection-ready` with the picked id set so the
 *     next stage (collision review / commit) can take over.
 *
 * Selection state is held in `ref<Set<string>>`. Mutations follow the
 * project's immutable-replacement pattern (`selected.value = new Set([…])`)
 * so the Set reference itself changes and downstream `computed` graphs
 * rerun. The dep graph is cached as a `computed` over `props.payload`
 * — building it once per payload (not once per selection mutation) keeps
 * larger imports responsive.
 */
import { computed, ref, watchEffect } from "vue";
import Button from "../components/ui/Button.vue";
import Card from "../components/ui/Card.vue";
import PickerSection from "./PickerSection.vue";
import PickerRow from "./PickerRow.vue";
import type { Badge } from "./PickerRow.vue";
import type { RawPayload } from "./migrations";
import type { IntegrityWarning } from "./parse";
import { buildDepGraph, constraintsBothSidesIn, transitiveClosure } from "./dep-graph";

/**
 * Minimal shape of an entity row in the payload, sufficient for the
 * picker. Real rows carry more fields (payload_hash, snapshot_fingerprint,
 * etc.) — those are passed through verbatim downstream.
 */
interface PayloadEntity {
  id: string;
  name?: string;
  /** Set when the row passed through one or more migration steps. */
  migrated_from?: number;
}

interface Props {
  payload: RawPayload;
  migratedEntityCount: number;
  integrityWarnings: IntegrityWarning[];
}

const props = defineProps<Props>();

const emit = defineEmits<{
  (e: "selection-ready", ids: Set<string>): void;
  (e: "cancel"): void;
}>();

// ---------- Bucket metadata ----------
//
// One row per section, in render order. The `arrayKey` lookup maps a
// bucket to its array on RawPayload — driven from one place so the
// section render template stays simple.

type BucketKey =
  | "bundles"
  | "wildcards"
  | "fixed_values"
  | "combines"
  | "derivations"
  | "constraints"
  | "categories";

interface BucketMeta {
  key: BucketKey;
  title: string;
}

const BUCKETS: BucketMeta[] = [
  { key: "bundles",      title: "Bundles" },
  { key: "wildcards",    title: "Wildcards" },
  { key: "fixed_values", title: "Fixed values" },
  { key: "combines",     title: "Combines" },
  { key: "derivations",  title: "Derivations" },
  { key: "constraints",  title: "Constraints" },
  { key: "categories",   title: "Categories" },
];

function entitiesForBucket(bucket: BucketKey): PayloadEntity[] {
  return props.payload[bucket] as unknown as PayloadEntity[];
}

const totalEntityCount = computed<number>(() =>
  BUCKETS.reduce((n, b) => n + entitiesForBucket(b.key).length, 0),
);

// ---------- Selection state ----------

const selected = ref<Set<string>>(new Set());

// One-shot smart default: when the payload happens to contain exactly
// ONE entity total, auto-select it. Guard with `seeded` so subsequent
// runs of the effect (e.g. if props.payload reference is replaced by
// the parent) do NOT clobber the user's in-progress selection.
let seeded = false;
watchEffect(() => {
  if (seeded) return;
  if (totalEntityCount.value !== 1) return;
  for (const b of BUCKETS) {
    const arr = entitiesForBucket(b.key);
    if (arr.length === 1) {
      const only = arr[0];
      if (only && typeof only.id === "string" && only.id.length > 0) {
        selected.value = new Set([only.id]);
      }
      break;
    }
  }
  seeded = true;
});

function isSelected(id: string): boolean {
  return selected.value.has(id);
}

function toggleRow(id: string, on: boolean): void {
  const next = new Set(selected.value);
  if (on) next.add(id); else next.delete(id);
  selected.value = next;
}

function toggleAllInBucket(bucket: BucketKey, on: boolean): void {
  const next = new Set(selected.value);
  for (const e of entitiesForBucket(bucket)) {
    if (typeof e.id !== "string" || e.id.length === 0) continue;
    if (on) next.add(e.id); else next.delete(e.id);
  }
  selected.value = next;
}

function selectedInBucket(bucket: BucketKey): number {
  let n = 0;
  for (const e of entitiesForBucket(bucket)) {
    if (typeof e.id === "string" && selected.value.has(e.id)) n += 1;
  }
  return n;
}

// ---------- Dep graph + warning helpers ----------

const depGraph = computed(() => buildDepGraph(props.payload));

const warningIds = computed<Set<string>>(() => {
  const s = new Set<string>();
  for (const w of props.integrityWarnings) {
    if (typeof w.id === "string" && w.id.length > 0) s.add(w.id);
  }
  return s;
});

/**
 * Categories don't carry `snapshot_fingerprint` (organizational metadata
 * merged-or-created by name; see parse.ts:62) so they get no integrity
 * badge. Every other bucket runs through `verifyOne` and can carry one.
 */
function badgesForEntity(entity: PayloadEntity, bucket: BucketKey): Badge[] {
  const badges: Badge[] = [];
  if (typeof entity.migrated_from === "number") {
    badges.push({ label: `migrated from v${entity.migrated_from}`, kind: "info" });
  }
  if (bucket !== "categories" && warningIds.value.has(entity.id)) {
    badges.push({ label: "integrity warning", kind: "warn" });
  }
  return badges;
}

/**
 * Dep warnings only fire when the row IS selected. The picker doesn't
 * surface "would reference X" for unselected rows — users get noise on
 * every row otherwise. Once selected, any outgoing ref to an UNSELECTED
 * id gets one warning line.
 */
function depWarningsForEntity(entity: PayloadEntity): string[] {
  if (!selected.value.has(entity.id)) return [];
  const edges = depGraph.value[entity.id] ?? [];
  const warns: string[] = [];
  for (const target of edges) {
    if (!selected.value.has(target)) {
      warns.push(`references @{${target}} not selected`);
    }
  }
  return warns;
}

// ---------- Footer actions ----------

function selectWithDependencies(): void {
  if (selected.value.size === 0) return;
  const closure = transitiveClosure(depGraph.value, selected.value);
  const constraints = constraintsBothSidesIn(props.payload, closure);
  const next = new Set<string>(closure);
  for (const cid of constraints) next.add(cid);
  selected.value = next;
}

function deselectAll(): void {
  selected.value = new Set();
}

function emitContinue(): void {
  if (selected.value.size === 0) return;
  // Belt-and-suspenders: even though the parent applies `:key` on
  // `importV2State.id` to force a full remount across payload swaps
  // (which by itself resets `seeded` + `selected`), filter the emit
  // against the current payload's id set so a stale id can NEVER reach
  // the commit stage. Without this, a regression in the parent's :key
  // wiring would resurface the orphan-id bug.
  const validIds = new Set<string>();
  for (const b of BUCKETS) {
    for (const entity of entitiesForBucket(b.key)) {
      if (typeof entity.id === "string" && entity.id.length > 0) {
        validIds.add(entity.id);
      }
    }
  }
  const filtered = new Set<string>();
  for (const id of selected.value) {
    if (validIds.has(id)) filtered.add(id);
  }
  if (filtered.size === 0) return;
  emit("selection-ready", filtered);
}
</script>

<template>
  <div class="wp-import-picker" data-test="import-picker">
    <Card title="Pick what to import" :padding="false">
      <template #actions>
        <Button
          variant="ghost"
          size="sm"
          data-test="import-picker-deselect-all"
          :disabled="selected.size === 0"
          @click="deselectAll"
        >Deselect all</Button>
        <Button
          variant="ghost"
          size="sm"
          icon="pi-share-alt"
          data-test="import-picker-select-deps"
          :disabled="selected.size === 0"
          @click="selectWithDependencies"
        >Select with dependencies</Button>
      </template>

      <div class="wp-import-picker__sections">
        <div
          v-if="props.migratedEntityCount > 0"
          class="wp-import-picker__notice"
          data-test="import-picker-migration-note"
        >
          Migrated {{ props.migratedEntityCount }}
          {{ props.migratedEntityCount === 1 ? "entity" : "entities" }}
          from older schema.
        </div>
        <div
          v-if="props.integrityWarnings.length > 0"
          class="wp-import-picker__notice wp-import-picker__notice--warn"
          data-test="import-picker-integrity-note"
        >
          {{ props.integrityWarnings.length }}
          {{ props.integrityWarnings.length === 1 ? "entity has" : "entities have" }}
          integrity warnings.
        </div>

        <PickerSection
          v-for="bucket in BUCKETS"
          :key="bucket.key"
          :title="bucket.title"
          :total-count="entitiesForBucket(bucket.key).length"
          :selected-count="selectedInBucket(bucket.key)"
          :default-open="true"
          :data-test="`import-picker-section-${bucket.key}`"
          @toggle-all="(v: boolean) => toggleAllInBucket(bucket.key, v)"
        >
          <PickerRow
            v-for="entity in entitiesForBucket(bucket.key)"
            :key="`${bucket.key}:${entity.id}`"
            :uuid="entity.id"
            :name="entity.name ?? entity.id"
            :checked="isSelected(entity.id)"
            :badges="badgesForEntity(entity, bucket.key)"
            :dep-warnings="depWarningsForEntity(entity)"
            :data-test="`import-picker-row-${entity.id}`"
            @update:checked="(v: boolean) => toggleRow(entity.id, v)"
          />
          <div
            v-if="entitiesForBucket(bucket.key).length === 0"
            class="wp-import-picker__empty"
          >
            <em>No {{ bucket.title.toLowerCase() }} in payload.</em>
          </div>
        </PickerSection>
      </div>
    </Card>

    <div class="wp-import-picker__side">
      <Card title="Selection">
        <dl class="wp-import-picker__stats" data-test="import-picker-summary">
          <dt>Bundles</dt>      <dd>{{ selectedInBucket("bundles") }}</dd>
          <dt>Wildcards</dt>    <dd>{{ selectedInBucket("wildcards") }}</dd>
          <dt>Fixed values</dt> <dd>{{ selectedInBucket("fixed_values") }}</dd>
          <dt>Combines</dt>     <dd>{{ selectedInBucket("combines") }}</dd>
          <dt>Derivations</dt>  <dd>{{ selectedInBucket("derivations") }}</dd>
          <dt>Constraints</dt>  <dd>{{ selectedInBucket("constraints") }}</dd>
          <dt>Categories</dt>   <dd>{{ selectedInBucket("categories") }}</dd>
        </dl>
        <div class="wp-import-picker__divider" />
        <dl class="wp-import-picker__stats">
          <dt>Selected</dt>
          <dd data-test="import-picker-selected-count">
            {{ selected.size }} of {{ totalEntityCount }}
          </dd>
        </dl>
        <Button
          variant="primary"
          icon="pi-arrow-right"
          class="wp-import-picker__continue"
          :disabled="selected.size === 0"
          data-test="import-picker-continue"
          @click="emitContinue"
        >Continue</Button>
      </Card>
    </div>
  </div>
</template>

<style scoped>
.wp-import-picker {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 320px;
  gap: var(--wp-space-6);
  align-items: start;
}
@media (max-width: 960px) {
  .wp-import-picker { grid-template-columns: 1fr; }
}

.wp-import-picker__sections {
  padding: var(--wp-space-5);
  max-height: 540px;
  overflow-y: auto;
}

.wp-import-picker__notice {
  padding: var(--wp-space-4) var(--wp-space-5);
  margin-bottom: var(--wp-space-5);
  border-radius: var(--wp-radius-sm);
  background: color-mix(in oklab, var(--wp-info) 12%, transparent);
  border: 1px solid color-mix(in oklab, var(--wp-info) 36%, transparent);
  color: var(--wp-info);
  font-size: var(--wp-text-sm);
}
.wp-import-picker__notice--warn {
  background: color-mix(in oklab, var(--wp-warn) 12%, transparent);
  border-color: color-mix(in oklab, var(--wp-warn) 36%, transparent);
  color: var(--wp-warn);
}

.wp-import-picker__empty {
  font-size: var(--wp-text-sm);
  color: var(--wp-text-muted);
  padding: var(--wp-space-3) var(--wp-space-5);
}

.wp-import-picker__side {
  display: flex;
  flex-direction: column;
  gap: var(--wp-space-5);
  position: sticky;
  top: 0;
}

.wp-import-picker__stats {
  display: grid;
  grid-template-columns: 1fr auto;
  row-gap: var(--wp-space-3);
  margin: 0;
  font-size: var(--wp-text-sm);
}
.wp-import-picker__stats dt { color: var(--wp-text-muted); }
.wp-import-picker__stats dd {
  margin: 0;
  font-family: var(--wp-font-mono);
  text-align: right;
}

.wp-import-picker__divider {
  border-top: 1px solid var(--wp-border);
  margin: var(--wp-space-5) 0;
}

.wp-import-picker__continue {
  width: 100%;
  margin-top: var(--wp-space-5);
}
</style>
