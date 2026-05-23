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
import PickerSection from "./PickerSection.vue";
import PickerRow from "./PickerRow.vue";
import type { StatusBadge, DepRef } from "./PickerRow.vue";
import { CURRENT_SCHEMA_VERSION, type RawPayload } from "./migrations";
import type { IntegrityWarning } from "./parse";
import { buildDepGraph, constraintsBothSidesIn, transitiveClosure } from "./dep-graph";
import { detectCollisions, type CollisionState, type LibraryRow } from "./collision";
import type { ModuleRow as FingerprintModuleRow } from "./fingerprint";

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
  /** Category cross-ref. Resolved against `props.payload.categories` for
   *  the inline chip; null/undefined → no chip. */
  category_id?: string | null;
  /** Module type slug ("wildcard", "fixed_values", etc.). Present on
   *  module-bucket entities. */
  type?: string;
}

/**
 * Subset of a payload category row needed for chip lookup. The picker
 * only reads `id`, `name`, `color` — anything else (description, tags)
 * is ignored.
 */
interface PayloadCategory {
  id: string;
  name?: string;
  color?: string | null;
}

interface Props {
  payload: RawPayload;
  migratedEntityCount: number;
  integrityWarnings: IntegrityWarning[];
  /**
   * Optional receiver-library snapshot keyed by id. When set, the picker
   * runs `detectCollisions` inline so each module-bucket row can carry
   * an early conflict badge before the orchestrator's commit-time pass.
   *
   * Bundles + categories DO carry a `LibraryRow` entry in this map (the
   * orchestrator builds it from `localBundles`), but only `id-presence`
   * is consulted for the inline badge — bundle MOD detection runs
   * separately downstream. When the prop is omitted entirely (unit tests
   * mounting the picker in isolation), no collision badges are produced.
   */
  libraryRows?: Map<string, LibraryRow>;
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
  /**
   * Default `kind` slug for PickerRow's tinted icon when the bucket's
   * entities don't carry their own `type` field (bundles, categories).
   * Module buckets fall back to `entity.type` first; this default only
   * kicks in for malformed payload rows missing a type.
   */
  kindFallback: string;
}

const BUCKETS: BucketMeta[] = [
  { key: "bundles",      title: "Bundles",      kindFallback: "bundle" },
  { key: "wildcards",    title: "Wildcards",    kindFallback: "wildcard" },
  { key: "fixed_values", title: "Fixed values", kindFallback: "fixed_values" },
  { key: "combines",     title: "Combines",     kindFallback: "combine" },
  { key: "derivations",  title: "Derivations",  kindFallback: "derivation" },
  { key: "constraints",  title: "Constraints",  kindFallback: "constraint" },
  { key: "categories",   title: "Categories",   kindFallback: "category" },
];

function entitiesForBucket(bucket: BucketKey): PayloadEntity[] {
  return props.payload[bucket] as unknown as PayloadEntity[];
}

/**
 * Resolve a `category_id` to `{name, color}` by scanning the payload's
 * own `categories` bucket. Mirrors ExportTab's `lookupCategory` but
 * reads from `props.payload.categories` (the migrated import payload's
 * category list) instead of `categories.value` (the live receiver
 * library). Returns `undefined` when the id is null/empty/unmatched so
 * the caller can suppress the chip.
 *
 * The 7-bucket payload's category bucket is typed as
 * `Array<Record<string, unknown>>` (see migrations.ts:44) — narrow each
 * row via a defensive `id`-string check before reading.
 */
function lookupCategoryFromPayload(
  categoryId: string | null | undefined,
): { name: string; color?: string } | undefined {
  if (!categoryId) return undefined;
  const cats = props.payload.categories as unknown as PayloadCategory[];
  const hit = cats.find((c) => c.id === categoryId);
  if (!hit) return undefined;
  return {
    name: hit.name ?? hit.id,
    color: typeof hit.color === "string" ? hit.color : undefined,
  };
}

/**
 * Derive the `kind` slug to pass to PickerRow for an entity. Module
 * buckets prefer the entity's own `type` field (so a payload-claimed
 * `derivation` row in the `wildcards` bucket — unlikely but possible —
 * still gets its true icon). Bundle and category buckets always emit
 * `"bundle"` / `"category"`. Falls back to the bucket's `kindFallback`
 * for malformed module rows missing a type.
 */
function kindForEntity(entity: PayloadEntity, bucket: BucketMeta): string {
  if (bucket.key === "bundles") return "bundle";
  if (bucket.key === "categories") return "category";
  return typeof entity.type === "string" && entity.type.length > 0
    ? entity.type
    : bucket.kindFallback;
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
 * Run `detectCollisions` once per payload+library snapshot to produce a
 * per-id collision state map across the FIVE module buckets. The result
 * is an empty record when `libraryRows` is absent (unit tests or
 * payloads loaded before the library finished loading).
 *
 * Bundles + categories are intentionally NOT fed to `detectCollisions`
 * — bundles have their own MOD-detection flow downstream
 * (bundle-fingerprint.ts) and categories merge by name. The picker
 * surfaces a placeholder id-presence conflict for bundles separately
 * in `badgesForEntity`; categories never get a conflict badge here.
 */
const collisionStates = computed<Record<string, CollisionState>>(() => {
  if (!props.libraryRows) return {};
  const incoming: Array<FingerprintModuleRow & { id: string }> = [];
  const moduleBuckets: BucketKey[] = [
    "wildcards", "fixed_values", "combines", "derivations", "constraints",
  ];
  for (const bk of moduleBuckets) {
    const arr = props.payload[bk] as unknown as Array<
      FingerprintModuleRow & { id: string }
    >;
    for (const row of arr) {
      if (typeof row.id !== "string" || row.id.length === 0) continue;
      incoming.push(row);
    }
  }
  return detectCollisions(incoming, props.libraryRows);
});

/**
 * Categories don't carry `snapshot_fingerprint` (organizational metadata
 * merged-or-created by name; see parse.ts:62) so they get no integrity
 * badge. Every other bucket runs through `verifyOne` and can carry one.
 *
 * Phase-5 collision-state → badge mapping:
 *   - Module buckets:
 *     - `no-collision`   → NEW (green) — clean import, no decision needed.
 *     - `conflict`       → MODIFIED (orange) — uuid match, fingerprint diff.
 *     - `exists-unknown` → EXISTING (drift / amber) — library row present
 *                          but stored fingerprint absent (legacy row
 *                          pre-fingerprint-backfill). Distinct from
 *                          MODIFIED so users aren't misled.
 *     - `silent-skip`    → (no badge) — true duplicate, auto-excluded at
 *                          commit time; badging it would be misleading noise.
 *   - Bundles: id-presence check only — present in library →
 *     EXISTING (drift / amber). Bundle MOD detection runs separately
 *     downstream via bundle-fingerprint.ts so the inline picker badge
 *     never claims "MODIFIED" without proof.
 *   - Categories: never get a collision badge (name-merge semantics on
 *     server, no id collision possible).
 *
 * Order: `migrated` first → `new` / `mod` / `drift` (collision) →
 * `drift` (integrity warning). Multiple badges allowed per row — e.g.
 * a row that was migrated AND also has a uuid collision stacks
 * MIGRATED + MODIFIED so the user sees both signals.
 */
function badgesForEntity(entity: PayloadEntity, bucket: BucketKey): StatusBadge[] {
  const badges: StatusBadge[] = [];
  if (typeof entity.migrated_from === "number") {
    badges.push({
      variant: "migrated",
      label: `MIGRATED v${entity.migrated_from}→${CURRENT_SCHEMA_VERSION}`,
    });
  }
  if (bucket === "bundles") {
    if (props.libraryRows?.has(entity.id) === true) {
      // Id-presence only — we never compute bundle fingerprints in this
      // picker, so route through the same EXISTING badge as
      // exists-unknown rather than overclaiming MODIFIED.
      badges.push({ variant: "drift", label: "EXISTING" });
    }
    // Bundles never get a NEW badge here — id-presence semantics only;
    // the orchestrator's bundle MOD pass surfaces the actual state.
  } else if (bucket !== "categories") {
    const state = collisionStates.value[entity.id];
    if (state === "no-collision") {
      badges.push({ variant: "new", label: "NEW" });
    } else if (state === "conflict") {
      badges.push({ variant: "mod", label: "MODIFIED" });
    } else if (state === "exists-unknown") {
      badges.push({ variant: "drift", label: "EXISTING" });
    }
    // silent-skip intentionally produces no badge.
  }
  if (bucket !== "categories" && warningIds.value.has(entity.id)) {
    badges.push({ variant: "drift", label: "INTEGRITY" });
  }
  return badges;
}

/**
 * Build a quick lookup `id → {name, type}` over every payload entity so
 * the dep-list can show human-readable info instead of bare ids.
 *
 * Computed once per payload — not per row — to keep large imports
 * responsive. Module buckets contribute `type` (wildcard / fixed_values /
 * etc); bundles + categories slot in with their bucket-implied kind.
 */
const entityIndex = computed<Map<string, { name: string; type: string }>>(() => {
  const m = new Map<string, { name: string; type: string }>();
  for (const b of BUCKETS) {
    const arr = entitiesForBucket(b.key);
    for (const e of arr) {
      if (typeof e.id !== "string" || e.id.length === 0) continue;
      const name = typeof e.name === "string" && e.name.length > 0 ? e.name : e.id;
      const type =
        b.key === "bundles" ? "bundle"
        : b.key === "categories" ? "category"
        : (typeof e.type === "string" && e.type.length > 0 ? e.type : b.kindFallback);
      m.set(e.id, { name, type });
    }
  }
  return m;
});

/**
 * Set of every entity id present in the payload across all 7 buckets.
 * Used both by `unselectedDepsForEntity` (to scope amber chips to refs
 * that resolve WITHIN the payload) and `missingDepsFor` (to surface
 * refs that resolve neither within the payload nor against the receiver
 * library). Computed once per payload reference change.
 */
const payloadIds = computed<Set<string>>(() => {
  const s = new Set<string>();
  for (const b of BUCKETS) {
    for (const e of entitiesForBucket(b.key)) {
      if (typeof e.id === "string" && e.id.length > 0) s.add(e.id);
    }
  }
  return s;
});

/**
 * Build the "Requires N" dep-chip refs for a selected entity. Only
 * surfaces for rows already selected, and only for outgoing edges to
 * UNSELECTED ids that ARE present in the payload (so the user can opt
 * to include them).
 *
 * Refs that resolve OUTSIDE the payload are routed to `missingDepsFor`
 * instead — those land in the red "Missing N" chip when they're also
 * absent from the receiver library.
 */
function unselectedDepsForEntity(entity: PayloadEntity): DepRef[] {
  if (!selected.value.has(entity.id)) return [];
  const edges = depGraph.value[entity.id] ?? [];
  const refs: DepRef[] = [];
  for (const target of edges) {
    if (selected.value.has(target)) continue;
    // Only payload-resolvable refs land in the amber chip. Out-of-payload
    // refs are handled by `missingDepsFor` (red chip) — surfacing them
    // here would falsely promise "select with deps will pull them in".
    if (!payloadIds.value.has(target)) continue;
    const info = entityIndex.value.get(target);
    refs.push({
      id: target,
      name: info?.name ?? target,
      type: info?.type,
    });
  }
  return refs;
}

/**
 * Build the "Missing N" dep-chip refs for an entity. Refs that target
 * entities NOT in the payload AND NOT in the receiver library —
 * truly unresolvable from the import side.
 *
 * Surfaces independently of selection state (an unselected row whose
 * refs are broken still warrants the warning — selecting it would
 * commit broken refs into the library).
 */
function missingDepsFor(entity: PayloadEntity): DepRef[] {
  const edges = depGraph.value[entity.id] ?? [];
  const refs: DepRef[] = [];
  for (const target of edges) {
    if (payloadIds.value.has(target)) continue;          // resolves within payload
    if (props.libraryRows?.has(target) === true) continue; // resolves against library
    refs.push({
      id: target,
      name: `@{${target}}`,
      // No type info — target absent from both sources; row renders the
      // generic pi-circle glyph from PickerRow's depIconClass fallback.
    });
  }
  return refs;
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
    <!-- Informational notices: surfaced above the section list rather
         than in a side panel so the user sees them in the same column
         as the rows they describe. Phase-4 redesign removed the side
         panel; these slot in at the top of the picker column. -->
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

    <div class="wp-import-picker__sections">
      <PickerSection
        v-for="bucket in BUCKETS"
        :key="bucket.key"
        :title="bucket.title"
        :total-count="entitiesForBucket(bucket.key).length"
        :selected-count="selectedInBucket(bucket.key)"
        :default-open="false"
        :kind="bucket.kindFallback"
        :data-test="`import-picker-section-${bucket.key}`"
        @toggle-all="(v: boolean) => toggleAllInBucket(bucket.key, v)"
      >
        <PickerRow
          v-for="entity in entitiesForBucket(bucket.key)"
          :key="`${bucket.key}:${entity.id}`"
          :uuid="entity.id"
          :name="entity.name ?? entity.id"
          :kind="kindForEntity(entity, bucket)"
          :category-name="lookupCategoryFromPayload(entity.category_id)?.name"
          :category-color="lookupCategoryFromPayload(entity.category_id)?.color"
          :show-id="true"
          :checked="isSelected(entity.id)"
          :status-badges="badgesForEntity(entity, bucket.key)"
          :unselected-deps="unselectedDepsForEntity(entity)"
          :missing-deps="missingDepsFor(entity)"
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

    <div class="wp-picker-footer" data-test="import-picker-footer">
      <Button
        variant="secondary"
        size="sm"
        icon="pi-sitemap"
        data-test="import-picker-select-deps"
        :disabled="selected.size === 0"
        @click="selectWithDependencies"
      >Select with dependencies</Button>
      <Button
        variant="ghost"
        size="sm"
        data-test="import-picker-deselect-all"
        :disabled="selected.size === 0"
        @click="deselectAll"
      >Deselect all</Button>
      <div class="wp-picker-footer__spacer" />
      <span
        class="wp-picker-footer__counter"
        data-test="import-picker-selected-count"
      ><strong>{{ selected.size }}</strong> of {{ totalEntityCount }} selected</span>
      <Button
        variant="primary"
        icon-right="pi-arrow-right"
        :disabled="selected.size === 0"
        data-test="import-picker-continue"
        @click="emitContinue"
      >Continue</Button>
    </div>
  </div>
</template>

<style scoped>
/* ImportPicker — verbatim port from
 * docs/superpowers/ui-prototypes/import-export-redesign.html §03 + §04
 * (sections + footer mirror ExportTab). */

.wp-import-picker {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.wp-import-picker__sections {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.wp-import-picker__notice {
  padding: var(--wp-space-4) var(--wp-space-5);
  margin-bottom: 10px;
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

.wp-picker-footer {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 11px 14px;
  background: var(--wp-bg-2);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius);
  margin-top: 10px;
}
.wp-picker-footer__spacer {
  flex: 1;
}
.wp-picker-footer__counter {
  font-size: var(--wp-text-sm);
  color: var(--wp-text-muted);
  font-feature-settings: "tnum";
}
.wp-picker-footer__counter strong {
  color: var(--wp-text);
  font-weight: 600;
}
</style>
