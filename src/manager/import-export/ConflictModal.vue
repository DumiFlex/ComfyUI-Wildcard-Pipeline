<script setup lang="ts">
/**
 * Conflict modal — Task 18 (Phase 3 relabel + segmented control).
 *
 * Sits between ImportPicker (`selection-ready`) and the commit endpoint.
 * The parent runs Task 8's `detectCollisions` over the chosen ids plus
 * the per-item integrity checks (tier-3, lossy migration, broken refs,
 * fingerprint mismatch) and hands the resulting two arrays to this
 * modal. The user resolves every per-item issue (and optionally flips
 * the batch default from "skip" → "replace") and we emit
 * `commit-ready` carrying a resolution payload the parent threads into
 * `buildCommitPayload`.
 *
 * Label / engine-value mapping (Phase 3): the UI surfaces user-facing
 * labels Skip / Replace / Import as new while the emit payload + the
 * stored `BatchAction` / `PerItemDecision.kind` values keep the engine
 * vocabulary `skip` / `replace` / `rename`. The orchestrator + server
 * contract are unchanged; only the rendered text + control affordance
 * shifted (dropdowns → segmented buttons).
 *
 * Two distinct surfaces:
 *
 *   - **Batch section** (only when `batchConflicts.length > 0`).
 *     UUID collisions where the live-DB row has different content. A
 *     3-button segmented control sets the default action — Skip /
 *     Replace / Import as new — applied uniformly. An expandable
 *     per-row override list (collapsed by default) lets the user
 *     override individual batch conflicts without changing the batch
 *     default; overrides are written into `perItemDecisions` alongside
 *     per-item-issue decisions, and the orchestrator at commit time
 *     already prefers `perItemDecisions[id]` over `batchDefault`.
 *
 *   - **Per-item section** (only when `perItemIssues.length > 0`).
 *     One row per issue with the entity name, the issue kind label,
 *     and action buttons. Non-tier-3 rows surface a 3-button
 *     segmented control: Skip / Import as new / Import anyway. (Import
 *     anyway keeps its distinct label because the per-item issue may
 *     not be a UUID collision at all — fingerprint mismatch, broken
 *     ref, etc. — so "Replace" would be semantically wrong.)
 *     **Tier-3 is non-overridable** per spec lock #9 in
 *     CHECKPOINT-importer-exporter.md, so tier-3 rows render the Skip
 *     button only. Once resolved, the buttons collapse into a
 *     "✓ Skip" / "✓ Import as new" / "✓ Import anyway" indicator so
 *     the user sees their choice stuck.
 *
 * The Import button stays disabled until every per-item issue has a
 * decision, gated by `unresolvedCount`. The footer surfaces the count
 * so users know how much more work remains.
 *
 * Decision storage uses entity `id` (NOT `uuid`) — the entire TS
 * import-export surface aligned to `id` in commit `9cf37c7`. The
 * `EntityKind` discriminant for `BatchConflict.kind` is the 7-bucket
 * union re-exported from `./commit`, NOT a redefined 4-bucket type
 * (the plan body sketched the older 4-bucket shape; the real server
 * shape is 7 buckets).
 *
 * State updates use the immutable-replacement pattern (full record
 * clone) so any downstream `computed` that observes
 * `perItemDecisions` reruns when a single key flips.
 *
 * Accessibility: the visual chrome (role="dialog", aria-modal,
 * Esc-to-close, backdrop click, Teleport-to-body) is delegated to the
 * shared `Modal` wrapper from `manager/components/ui/Modal.vue`. The
 * `open` prop is optional (defaults to `true`) so the simplest caller
 * pattern — `<ConflictModal v-if="conflicts" ... @cancel="dismiss" />`
 * — works without extra wiring. Closing via Esc/backdrop routes
 * through `update:open` and emits `cancel`.
 */
import { computed, ref } from "vue";
import Modal from "../components/ui/Modal.vue";
import ImportAsNewRename from "./ImportAsNewRename.vue";
import Tier3ChainViz from "./conflict-rows/Tier3ChainViz.vue";
import type { ChainStep } from "./conflict-rows/chain-types";
import type {
  BatchConflict,
  PerItemDecision,
  PerItemIssue,
} from "./conflict-types";

// Re-export types from the dedicated module so existing consumers
// that happen to import from this SFC keep working. New consumers
// should import from `./conflict-types` directly — see the module
// comment for why named-type re-exports from `*.vue` are fragile
// under plain `tsc` / IDE diagnostic engines.
export type {
  BatchAction,
  BatchConflict,
  PerItemDecision,
  PerItemIssue,
  PerItemKind,
} from "./conflict-types";

interface Props {
  batchConflicts: BatchConflict[];
  perItemIssues: PerItemIssue[];
  /**
   * Controls modal visibility. Optional with default `true` so a
   * parent that gates the modal via `v-if` doesn't need to bind it;
   * a parent that wants the `update:open` two-way contract can pass
   * a ref and listen to the event.
   */
  open?: boolean;
}

const props = withDefaults(defineProps<Props>(), { open: true });

/**
 * Resolution emit payload:
 *   - batchDefault       — applies uniformly to every batch UUID
 *                          collision; the parent threads it into the
 *                          per-row decisions before calling commit.
 *                          `"rename"` means "Import as new" — the
 *                          orchestrator mints a fresh id per conflict
 *                          entity + suffixes the name with
 *                          `" (imported)"`. The batch segmented control
 *                          doesn't surface the inline rename UI; users
 *                          who want a custom new name use the per-item
 *                          issue row's inline rename (which writes
 *                          explicit `new_id` + `new_name`).
 *   - perItemDecisions   — keyed by entity `id` (NOT `uuid`). Each
 *                          value carries the chosen action and an
 *                          optional `new_id` / `new_name` pair for the
 *                          rename case. When `kind === "rename"` lacks
 *                          `new_id`/`new_name` (e.g. the batch override
 *                          per-row segmented control was set to
 *                          "Import as new") the orchestrator mints them
 *                          the same way it handles
 *                          `batchDefault === "rename"`. When they're
 *                          present (set via the inline rename on a
 *                          per-item issue row) the orchestrator uses
 *                          those values verbatim.
 */
const emit = defineEmits<{
  (
    e: "commit-ready",
    resolution: {
      batchDefault: "skip" | "replace" | "rename";
      perItemDecisions: Record<string, PerItemDecision>;
    },
  ): void;
  (e: "cancel"): void;
  (e: "update:open", v: boolean): void;
}>();

const batchDefault = ref<"skip" | "replace" | "rename">("skip");

const perItemDecisions = ref<Record<string, PerItemDecision>>({});

/**
 * Whether the per-conflict override list under the batch section is
 * expanded. Collapsed by default — the typical user flips the batch
 * dropdown and never opens this. Users who need to override individual
 * rows opt in via the toggle button.
 */
const batchExpanded = ref<boolean>(false);

/**
 * Number of per-item issues without a decision yet. Drives the disabled
 * state of the Import button + the "N unresolved" footer line. Batch
 * conflicts don't add to this count because the batch default always
 * has a value (defaults to "skip").
 */
const unresolvedCount = computed<number>(() => {
  let n = 0;
  for (const issue of props.perItemIssues) {
    if (!perItemDecisions.value[issue.entity.id]) n += 1;
  }
  return n;
});

/**
 * Per-item ids currently in "rename input" mode. When `renamingIds`
 * contains an issue's id, that row renders `<ImportAsNewRename>`
 * instead of the Skip / Import-anyway / Import-as-new button trio.
 * Cleared on rename-applied (decision recorded) or rename-cancel
 * (row returns to the button trio).
 *
 * A `Set<string>` rather than a `Record<string, boolean>` so the
 * mutation API stays small (`add` / `delete`) — Vue 3's reactivity
 * tracks Set membership the same way it tracks object keys.
 */
const renamingIds = ref<Set<string>>(new Set());

/**
 * Record a per-item decision under `entity.id`. Uses the
 * immutable-replacement pattern (`{ ...prev, [id]: next }`) so
 * downstream `computed` graphs observing `perItemDecisions` rerun.
 *
 * The rename branch (`kind === "rename"`) carries both `new_id` and
 * `new_name` per the locked server contract (Tasks 13/14/15); they're
 * minted by `ImportAsNewRename.vue` and threaded straight through to
 * `commit.ts`'s partitioner.
 */
function resolveItem(
  id: string,
  kind: "skip" | "replace" | "rename" | "accept",
  rename?: { new_id: string; new_name: string },
): void {
  const next: PerItemDecision = rename
    ? { kind, new_id: rename.new_id, new_name: rename.new_name }
    : { kind };
  perItemDecisions.value = { ...perItemDecisions.value, [id]: next };
}

/**
 * Toggle a per-item row into rename-input mode. The button trio is
 * swapped out for the `<ImportAsNewRename>` component until the user
 * confirms (→ `onRenameApplied`) or cancels (→ `onRenameCancel`).
 */
function startRename(id: string): void {
  // Set membership change isn't observed in Vue 3 unless we replace
  // the Set wholesale (Sets are reactive but the .add() mutation
  // doesn't always trigger template re-eval on existing renders —
  // immutable replacement matches the perItemDecisions pattern).
  const next = new Set(renamingIds.value);
  next.add(id);
  renamingIds.value = next;
}

/**
 * Confirm a rename from `<ImportAsNewRename>` — store the decision
 * and exit rename-input mode. Strict typing on the payload mirrors
 * the component's emit signature so any future contract drift
 * surfaces at compile time.
 */
function onRenameApplied(
  id: string,
  payload: { new_id: string; new_name: string },
): void {
  resolveItem(id, "rename", payload);
  const next = new Set(renamingIds.value);
  next.delete(id);
  renamingIds.value = next;
}

/**
 * Cancel from `<ImportAsNewRename>` — exit rename-input mode without
 * recording a decision so the row returns to the button trio.
 */
function onRenameCancel(id: string): void {
  const next = new Set(renamingIds.value);
  next.delete(id);
  renamingIds.value = next;
}

function onCommit(): void {
  if (unresolvedCount.value > 0) return;
  emit("commit-ready", {
    batchDefault: batchDefault.value,
    perItemDecisions: perItemDecisions.value,
  });
}

function onCancel(): void {
  emit("cancel");
  emit("update:open", false);
}

/**
 * Forwarded from the Modal wrapper. `Modal` fires `update:open=false`
 * on Esc / close-button / backdrop click — every one of those paths is
 * a cancel from this modal's perspective, so we re-emit `cancel` to
 * keep the public contract simple. Callers can listen to either event.
 */
function onModalUpdateOpen(v: boolean): void {
  emit("update:open", v);
  if (!v) emit("cancel");
}

/**
 * Pull a `ChainStep[]` out of an issue's untyped `detail` blob. The
 * `PerItemIssue.detail` slot is typed as `unknown` so callers can stash
 * arbitrary diagnostic context; the tier-3 row needs to fish a
 * specific `{ name, id }[]` shape out of that. We narrow with type
 * guards (NOT `as any` — banned by CLAUDE.md), returning `[]` on any
 * shape mismatch so the viz degrades to "outer name + badge only"
 * rather than crashing the modal.
 *
 * Why per-step filtering rather than a single array-level check: we
 * want to defensively skip malformed entries (server bug, future
 * payload schema drift) without losing the well-formed ones.
 */
function extractChain(issue: PerItemIssue): ChainStep[] {
  const d = issue.detail;
  if (!d || typeof d !== "object") return [];
  const c = (d as { chain?: unknown }).chain;
  if (!Array.isArray(c)) return [];
  return c.filter(
    (s): s is ChainStep =>
      typeof s === "object" && s !== null
      && typeof (s as { name?: unknown }).name === "string"
      && typeof (s as { id?: unknown }).id === "string",
  );
}

/**
 * Set the batch default from a segmented-control click. The literal
 * union signature keeps the call sites at the template strict — Vue
 * type-checks the inline `@click="setBatchDefault('skip')"` against
 * the parameter type without an `as` cast.
 *
 * Phase 3 replaced the `<select>` + `onBatchDefaultChange` indirection
 * with this direct setter; the segmented control buttons each carry
 * their literal action and call this on click.
 */
function setBatchDefault(value: "skip" | "replace" | "rename"): void {
  batchDefault.value = value;
}

/**
 * Map an engine action (`skip` / `replace` / `rename`) to its display
 * label (`Skip` / `Replace` / `Import as new`). Centralised so the
 * label vocabulary lives in exactly one spot — when the locked-engine
 * `rename` field eventually surfaces in a new context, we relabel here
 * only. Used by the resolved-state pill for batch overrides and by the
 * per-item resolved pill (`accept` maps to "Import anyway", which is
 * the only label not parallel to the batch-action vocabulary).
 */
function labelForKind(
  kind: "skip" | "replace" | "rename" | "accept",
): string {
  if (kind === "skip") return "Skip";
  if (kind === "replace") return "Replace";
  if (kind === "rename") return "Import as new";
  return "Import anyway";
}

/**
 * Read the current per-row override for a batch conflict. Returns
 * `"default"` when no override exists (i.e. the row will follow the
 * batch default's value at commit time). Returns `"skip"`, `"replace"`,
 * or `"rename"` when the user has explicitly overridden this row.
 *
 * The "default" sentinel keeps the segmented-control's active state
 * cleanly multi-valued — without it, a row with no entry in
 * `perItemDecisions` would have no button painted active, leaving the
 * user unsure whether they'd ever touched the row. Mapping the
 * absence-of-entry to a named option (the "Default" button) makes the
 * intent explicit in the UI.
 *
 * Decisions with `kind === "accept"` (which the batch override flow does
 * not surface) coerce to `"default"` so the override row reflects
 * "no batch-side override" without misrepresenting the underlying
 * decision. This doesn't happen in practice today (the batch override
 * path only writes skip/replace/rename) but the type widens to those
 * values, so the narrowing is defensive.
 */
function batchOverrideFor(
  id: string,
): "default" | "skip" | "replace" | "rename" {
  const d = perItemDecisions.value[id];
  if (!d) return "default";
  if (d.kind === "skip" || d.kind === "replace" || d.kind === "rename") {
    return d.kind;
  }
  return "default";
}

/**
 * Apply a per-row batch override decision keyed by entity id. Picking
 * `"default"` deletes the entry from `perItemDecisions` so the batch
 * default's value applies at commit time (clean state — no lingering
 * stub). Picking `"skip"` / `"replace"` / `"rename"` writes the decision
 * into the map, where it takes precedence over `batchDefault` for that
 * id.
 *
 * The `"rename"` override stores `{kind: "rename"}` WITHOUT
 * `new_id`/`new_name`. The orchestrator (`partitionSelection` in
 * `ImportExport.vue`) mints a fresh id + suffixes the name with
 * `" (imported)"` at commit time, matching the batch-default rename
 * semantics. This keeps the per-row override compact (no inline rename
 * UI per row); users who want a custom new name use the per-item issue
 * row's inline `<ImportAsNewRename>` component instead.
 *
 * Immutable replacement matches the `resolveItem` pattern so any
 * downstream `computed` observing `perItemDecisions` reruns.
 */
function setBatchOverride(
  id: string,
  value: "default" | "skip" | "replace" | "rename",
): void {
  if (value === "default") {
    const next = { ...perItemDecisions.value };
    delete next[id];
    perItemDecisions.value = next;
  } else {
    perItemDecisions.value = {
      ...perItemDecisions.value,
      [id]: { kind: value },
    };
  }
}

/**
 * Display name for a batch conflict row — prefer the entity's `name`
 * field, fall back to the id. Mirrors the per-item issue display
 * fallback in the template.
 */
function batchRowName(conflict: BatchConflict): string {
  const raw = conflict.entity.name;
  if (typeof raw === "string" && raw.length > 0) return raw;
  return conflict.id;
}

// ---------- Visual helpers added for the prototype port (template-only) ----------

/**
 * Map an `EntityKind` (canonical 7-bucket discriminant) to the
 * `.wp-row-type-icon--{slug}` tint class used by the shared row
 * primitives. Mirrors PickerRow's KIND_CLASS — `fixed_values → fixed`,
 * `category → category`, unknown kinds fall back to `bundle`.
 */
const KIND_CLASS: Record<string, string> = {
  wildcard:     "wildcard",
  fixed_values: "fixed",
  combine:      "combine",
  derivation:   "derivation",
  constraint:   "constraint",
  bundle:       "bundle",
  category:     "category",
};

/** Canonical pi-icon class per kind — mirrors `kindIcon` from
 *  `shared/kind-icons` plus a `category → folder` fallback for the
 *  org-meta entity (categories don't appear in `kind-icons` since they
 *  aren't a module subtype). */
function iconForKind(kind: string): string {
  if (kind === "wildcard")     return "pi pi-sparkles";
  if (kind === "fixed_values") return "pi pi-tag";
  if (kind === "combine")      return "pi pi-link";
  if (kind === "derivation")   return "pi pi-arrow-right-arrow-left";
  if (kind === "constraint")   return "pi pi-filter";
  if (kind === "bundle")       return "pi pi-box";
  if (kind === "category")     return "pi pi-folder";
  return "pi pi-circle";
}

function overrideRowKindClass(conflict: BatchConflict): string {
  return KIND_CLASS[conflict.kind] ?? "bundle";
}
function overrideRowIconClass(conflict: BatchConflict): string {
  return iconForKind(conflict.kind);
}

/**
 * Read the `kind` slug off a per-item issue's entity (its bucket).
 * The issue's `entity` blob is a plain `Record<string, unknown>`, so
 * narrow with a defensive `typeof` check before reading. Falls back
 * to `bundle` for any malformed row (no kind crash on render).
 */
function entityKind(issue: PerItemIssue): string {
  const raw = (issue.entity as { kind?: unknown; type?: unknown }).kind
    ?? (issue.entity as { kind?: unknown; type?: unknown }).type;
  return typeof raw === "string" && raw.length > 0 ? raw : "bundle";
}

function issueRowKindClass(issue: PerItemIssue): string {
  return KIND_CLASS[entityKind(issue)] ?? "bundle";
}
function issueRowIconClass(issue: PerItemIssue): string {
  return iconForKind(entityKind(issue));
}

/**
 * Short uppercase badge label per per-item issue kind. The prototype
 * shows "MISSING DEP" for broken-ref kinds (line 988); other kinds
 * surface their semantically-closest taxonomy term so the row's badge
 * still reads as an alert at a glance.
 */
function issueBadgeLabel(issue: PerItemIssue): string {
  if (issue.kind === "broken-inner-ref")     return "MISSING DEP";
  if (issue.kind === "broken-uuid-ref")      return "MISSING DEP";
  if (issue.kind === "broken-constraint-ref")return "MISSING DEP";
  if (issue.kind === "fingerprint-mismatch") return "FINGERPRINT";
  if (issue.kind === "lossy-migration")      return "LOSSY";
  return "ISSUE";
}

/**
 * One-liner detail text under the row name. Mirrors the prototype's
 * "References @{deadbeef} — not in payload, not in library. Importing
 * will leave one dangling ref on this combine template." (line 990).
 * Pulls the `target` id (if present) out of the issue's `detail` blob
 * defensively so the modal degrades to a generic line on malformed
 * payloads.
 */
function issueDetailText(issue: PerItemIssue): string {
  const d = issue.detail;
  let targetId: string | undefined;
  if (d && typeof d === "object") {
    const t = (d as { target?: unknown }).target;
    if (typeof t === "string" && t.length > 0) targetId = t;
  }
  if (issue.kind === "broken-inner-ref" || issue.kind === "broken-uuid-ref" || issue.kind === "broken-constraint-ref") {
    if (targetId) {
      return `References @{${targetId}} — not in payload, not in library. Importing will leave a dangling ref.`;
    }
    return "References an entity that is not in the payload or the library.";
  }
  if (issue.kind === "fingerprint-mismatch") {
    return "Payload-stamped fingerprint disagrees with the row content.";
  }
  if (issue.kind === "lossy-migration") {
    return "Migration chain ran but dropped fields from the original payload.";
  }
  return "";
}

/**
 * Phase 8 — split modified vs existing count in the modal chrome.
 *
 * `modified` rows have proven content drift (collisionState = "conflict").
 * `existing` rows are library-present-but-no-stored-fingerprint
 * (collisionState = "exists-unknown"); the user still must decide what
 * to do, but the modal shouldn't label them MODIFIED since drift is
 * unproven. Conflicts without a `collisionState` (older orchestrator
 * paths) fall back to the historical "modified" bucket for safety.
 */
const modifiedConflictCount = computed<number>(() => {
  let n = 0;
  for (const c of props.batchConflicts) {
    if (c.collisionState === "exists-unknown") continue;
    n += 1;
  }
  return n;
});
const existingConflictCount = computed<number>(() => {
  let n = 0;
  for (const c of props.batchConflicts) {
    if (c.collisionState === "exists-unknown") n += 1;
  }
  return n;
});

/**
 * Title-bar "N modified · M existing · K missing dep · J tier-3" text
 * builder. Suppresses the EXISTING segment entirely when there are none,
 * so the historical "N modified · …" output for purely-conflict imports
 * stays identical.
 */
const batchCountsLabel = computed<string>(() => {
  const parts: string[] = [];
  const m = modifiedConflictCount.value;
  const e = existingConflictCount.value;
  if (m > 0 || (e === 0 && props.batchConflicts.length === 0)) {
    parts.push(`${m} modified`);
  }
  if (e > 0) parts.push(`${e} existing`);
  return parts.join(" · ");
});

/**
 * Per-row badge variant + label for a batch override row. Phase 8 split:
 * conflict (proven drift) → orange MOD; exists-unknown (no library
 * fingerprint) → amber DRIFT/EXISTING; unspecified → MOD fallback so
 * pre-Phase-8 orchestrators still render a familiar badge.
 */
function batchOverrideBadge(
  conflict: BatchConflict,
): { variant: "mod" | "drift"; label: string } {
  if (conflict.collisionState === "exists-unknown") {
    return { variant: "drift", label: "EXISTING" };
  }
  return { variant: "mod", label: "MODIFIED" };
}

/** Count of per-item issues that are NOT tier-3 — used in the modal
 *  title bar's `N missing dep` counter. */
const perItemIssuesNonTier3Count = computed<number>(() => {
  let n = 0;
  for (const issue of props.perItemIssues) if (issue.kind !== "tier-3") n += 1;
  return n;
});

/** Tier-3 issue count — used in the modal title bar's `N tier-3`
 *  counter. */
const perItemIssuesTier3Count = computed<number>(() => {
  let n = 0;
  for (const issue of props.perItemIssues) if (issue.kind === "tier-3") n += 1;
  return n;
});

/**
 * Item count for the primary import button label. Counts every batch
 * conflict (minus the ones the user resolved to "skip") plus every
 * per-item issue resolved to anything other than "skip". A coarse
 * lower-bound on the rows that will actually land in the library; the
 * orchestrator does the precise commit-time math.
 */
const importItemCount = computed<number>(() => {
  let n = 0;
  for (const c of props.batchConflicts) {
    const dec = perItemDecisions.value[c.id];
    if (dec && dec.kind === "skip") continue;
    if (!dec && batchDefault.value === "skip") continue;
    n += 1;
  }
  for (const issue of props.perItemIssues) {
    const dec = perItemDecisions.value[issue.entity.id];
    if (!dec) continue;
    if (dec.kind !== "skip") n += 1;
  }
  return n;
});
</script>

<template>
  <Modal
    :open="props.open"
    title="Resolve conflicts"
    size="lg"
    @update:open="onModalUpdateOpen"
  >
    <template #header>
      <span
        class="wp-modal-shell__title-counts"
        data-test="conflict-modal-summary"
      >
        {{ batchCountsLabel }} ·
        {{ perItemIssuesNonTier3Count }} missing dep ·
        {{ perItemIssuesTier3Count }} tier-3
      </span>
    </template>

    <div class="wp-conflict-modal" data-test="conflict-modal">

      <template v-if="props.batchConflicts.length > 0">
        <div
          class="wp-conflict-modal__section-title"
          data-test="conflict-modal-batch-section"
        >
          Batch resolution
          <span
            class="wp-conflict-modal__section-count"
            data-test="conflict-modal-batch-count"
          >{{ batchCountsLabel }}</span>
        </div>

        <div class="wp-conflict-modal__batch-card">
          <div class="wp-conflict-modal__batch-head">
            <span class="wp-conflict-modal__batch-label">
              Apply to all <strong>{{ props.batchConflicts.length }}</strong>
              {{ existingConflictCount > 0 && modifiedConflictCount === 0
                ? "existing"
                : existingConflictCount > 0
                  ? "modified + existing"
                  : "modified" }} rows:
            </span>
            <div
              class="wp-action-group"
              role="radiogroup"
              aria-label="Default action for batch conflicts"
              data-test="batch-action-group"
            >
              <button
                type="button"
                class="wp-action-group__btn"
                role="radio"
                :aria-checked="batchDefault === 'skip' ? 'true' : 'false'"
                :data-active="batchDefault === 'skip' ? 'true' : 'false'"
                data-test="batch-action-skip"
                @click="setBatchDefault('skip')"
              >
                <i class="pi pi-times" aria-hidden="true" /> Skip
              </button>
              <button
                type="button"
                class="wp-action-group__btn"
                role="radio"
                :aria-checked="batchDefault === 'replace' ? 'true' : 'false'"
                :data-active="batchDefault === 'replace' ? 'true' : 'false'"
                data-test="batch-action-replace"
                @click="setBatchDefault('replace')"
              >
                <i class="pi pi-arrow-circle-down" aria-hidden="true" /> Replace
              </button>
              <button
                type="button"
                class="wp-action-group__btn"
                role="radio"
                :aria-checked="batchDefault === 'rename' ? 'true' : 'false'"
                :data-active="batchDefault === 'rename' ? 'true' : 'false'"
                data-test="batch-action-rename"
                @click="setBatchDefault('rename')"
              >
                <i class="pi pi-plus" aria-hidden="true" /> Import as new
              </button>
            </div>
          </div>
          <button
            type="button"
            class="wp-conflict-modal__override-toggle"
            :aria-expanded="batchExpanded ? 'true' : 'false'"
            aria-controls="wp-conflict-modal-batch-overrides"
            data-test="batch-override-toggle"
            @click="batchExpanded = !batchExpanded"
          >
            <i
              :class="batchExpanded ? 'pi pi-angle-down' : 'pi pi-angle-right'"
              aria-hidden="true"
            />
            {{ batchExpanded ? "Hide per-conflict overrides" : "Show per-conflict overrides" }}
          </button>
          <div
            v-if="batchExpanded"
            id="wp-conflict-modal-batch-overrides"
            class="wp-conflict-modal__override-list"
            data-test="batch-override-list"
          >
            <div
              v-for="conflict in props.batchConflicts"
              :key="conflict.id"
              class="wp-conflict-modal__override-row"
              :data-test="`batch-override-row-${conflict.id}`"
            >
              <span
                class="wp-row-type-icon"
                :class="`wp-row-type-icon--${overrideRowKindClass(conflict)}`"
                aria-hidden="true"
              >
                <i :class="overrideRowIconClass(conflict)" />
              </span>
              <div class="wp-row-name">
                <span class="wp-picker-row__name">{{ batchRowName(conflict) }}</span>
                <span class="wp-id">{{ conflict.id.slice(0, 8) }}</span>
                <span
                  class="wp-mod-badge"
                  :class="`wp-mod-badge--${batchOverrideBadge(conflict).variant}`"
                  :data-test="`batch-override-badge-${conflict.id}`"
                  style="margin-left: auto"
                >{{ batchOverrideBadge(conflict).label }}</span>
              </div>
              <span
                class="wp-override-tag"
                :class="batchOverrideFor(conflict.id) !== 'default'
                  ? 'wp-override-tag--set' : ''"
              >{{ batchOverrideFor(conflict.id) === 'default'
                ? 'Use batch default'
                : 'Override' }}</span>
              <div
                class="wp-action-group wp-action-group--sm"
                role="radiogroup"
                :aria-label="`Override action for ${batchRowName(conflict)}`"
                :data-test="`batch-override-group-${conflict.id}`"
              >
                <button
                  type="button"
                  class="wp-action-group__btn"
                  role="radio"
                  :aria-checked="batchOverrideFor(conflict.id) === 'default' ? 'true' : 'false'"
                  :data-active="batchOverrideFor(conflict.id) === 'default' ? 'true' : 'false'"
                  :data-test="`batch-override-${conflict.id}-default`"
                  @click="setBatchOverride(conflict.id, 'default')"
                >Default</button>
                <button
                  type="button"
                  class="wp-action-group__btn"
                  role="radio"
                  :aria-checked="batchOverrideFor(conflict.id) === 'skip' ? 'true' : 'false'"
                  :data-active="batchOverrideFor(conflict.id) === 'skip' ? 'true' : 'false'"
                  :data-test="`batch-override-${conflict.id}-skip`"
                  @click="setBatchOverride(conflict.id, 'skip')"
                >Skip</button>
                <button
                  type="button"
                  class="wp-action-group__btn"
                  role="radio"
                  :aria-checked="batchOverrideFor(conflict.id) === 'replace' ? 'true' : 'false'"
                  :data-active="batchOverrideFor(conflict.id) === 'replace' ? 'true' : 'false'"
                  :data-test="`batch-override-${conflict.id}-replace`"
                  @click="setBatchOverride(conflict.id, 'replace')"
                >Replace</button>
                <button
                  type="button"
                  class="wp-action-group__btn"
                  role="radio"
                  :aria-checked="batchOverrideFor(conflict.id) === 'rename' ? 'true' : 'false'"
                  :data-active="batchOverrideFor(conflict.id) === 'rename' ? 'true' : 'false'"
                  :data-test="`batch-override-${conflict.id}-rename`"
                  @click="setBatchOverride(conflict.id, 'rename')"
                >Import as new</button>
              </div>
            </div>
          </div>
        </div>
      </template>

      <template v-if="props.perItemIssues.length > 0">
        <div
          class="wp-conflict-modal__section-title"
          data-test="conflict-modal-per-item-section"
        >
          Per-item issues
          <span class="wp-conflict-modal__section-count">
            {{ props.perItemIssues.length }}
            {{ props.perItemIssues.length === 1 ? "issue" : "issues" }}
          </span>
        </div>

        <div
          v-for="issue in props.perItemIssues"
          :key="issue.entity.id"
          class="wp-conflict-modal__item-row"
          :class="{ 'wp-conflict-modal__item-row--tier3': issue.kind === 'tier-3' }"
          :data-tier="issue.kind === 'tier-3' ? '3' : undefined"
          :data-test="`conflict-modal-item-${issue.entity.id}`"
        >
          <template v-if="issue.kind === 'tier-3'">
            <div class="wp-conflict-modal__tier3-body">
              <Tier3ChainViz
                :bundle-name="issue.entity.name ?? issue.entity.id"
                :chain="extractChain(issue)"
              />
            </div>
            <div
              v-if="perItemDecisions[issue.entity.id]"
              class="wp-conflict-modal__resolved"
              :data-test="`resolved-${issue.entity.id}`"
            >
              <span aria-hidden="true">✓</span>
              {{ labelForKind(perItemDecisions[issue.entity.id].kind) }}
            </div>
            <!-- Tier-3 is non-overridable per spec lock #9; only the
                 Skip path is offered. Single-button group instead of
                 a segmented control because there's nothing to switch
                 between. The Tier3ChainViz above shows the *why*. -->
            <div v-else class="wp-action-group">
              <button
                type="button"
                class="wp-action-group__btn"
                :data-test="`resolve-${issue.entity.id}-skip`"
                @click="resolveItem(issue.entity.id, 'skip')"
              ><i class="pi pi-times" aria-hidden="true" /> Skip</button>
            </div>
          </template>
          <template v-else>
            <span
              class="wp-row-type-icon"
              :class="`wp-row-type-icon--${issueRowKindClass(issue)}`"
              aria-hidden="true"
            >
              <i :class="issueRowIconClass(issue)" />
            </span>
            <div>
              <div class="wp-row-name" style="margin-bottom: 2px">
                <span class="wp-picker-row__name">{{ issue.entity.name ?? issue.entity.id }}</span>
                <span class="wp-id">{{ issue.entity.id.slice(0, 8) }}</span>
                <span class="wp-mod-badge wp-mod-badge--missing">
                  {{ issueBadgeLabel(issue) }}
                </span>
              </div>
              <div class="wp-conflict-modal__item-detail">
                {{ issueDetailText(issue) }}
              </div>
            </div>
            <div
              v-if="perItemDecisions[issue.entity.id]"
              class="wp-conflict-modal__resolved"
              :data-test="`resolved-${issue.entity.id}`"
              :title="perItemDecisions[issue.entity.id].kind === 'rename'
                ? perItemDecisions[issue.entity.id].new_name
                : undefined"
            >
              <span aria-hidden="true">✓</span>
              {{ labelForKind(perItemDecisions[issue.entity.id].kind) }}
            </div>
            <ImportAsNewRename
              v-else-if="renamingIds.has(issue.entity.id)"
              :original-name="issue.entity.name ?? issue.entity.id"
              @applied="(p) => onRenameApplied(issue.entity.id, p)"
              @cancel="onRenameCancel(issue.entity.id)"
            />
            <!-- Non-tier-3 per-item issues get the 3-button segmented
                 control. Note "Import anyway" keeps its distinct label
                 (it's not a UUID-collision replace — could be a
                 fingerprint mismatch, broken ref, etc.). -->
            <div
              v-else
              class="wp-action-group"
              role="radiogroup"
              :aria-label="`Resolution for ${issue.entity.name ?? issue.entity.id}`"
              :data-test="`resolve-group-${issue.entity.id}`"
            >
              <button
                type="button"
                class="wp-action-group__btn"
                :data-test="`resolve-${issue.entity.id}-skip`"
                @click="resolveItem(issue.entity.id, 'skip')"
              ><i class="pi pi-times" aria-hidden="true" /> Skip</button>
              <button
                type="button"
                class="wp-action-group__btn"
                :data-test="`resolve-${issue.entity.id}-rename`"
                @click="startRename(issue.entity.id)"
              ><i class="pi pi-plus" aria-hidden="true" /> Import as new</button>
              <button
                type="button"
                class="wp-action-group__btn"
                :data-test="`resolve-${issue.entity.id}-accept`"
                @click="resolveItem(issue.entity.id, 'accept')"
              ><i class="pi pi-arrow-circle-down" aria-hidden="true" /> Import anyway</button>
            </div>
          </template>
        </div>
      </template>
    </div>

    <template #footer>
      <span
        v-if="unresolvedCount > 0"
        class="wp-conflict-modal__unresolved"
        data-test="conflict-modal-unresolved"
      >{{ unresolvedCount }} unresolved</span>
      <span
        v-else
        class="wp-conflict-modal__ready"
        data-test="conflict-modal-ready"
      >
        <i class="pi pi-check-circle" aria-hidden="true" />
        All issues resolved
      </span>
      <span class="wp-conflict-modal__spacer" />
      <button
        type="button"
        class="wp-btn wp-btn--ghost"
        data-test="cancel-btn"
        @click="onCancel"
      >Cancel</button>
      <button
        type="button"
        class="wp-btn wp-btn--primary"
        :disabled="unresolvedCount > 0"
        data-test="commit-btn"
        @click="onCommit"
      >Import {{ importItemCount }} items</button>
    </template>
  </Modal>
</template>

<style scoped>
@import "../../components/shared/row-primitives.css";

/* ConflictModal — verbatim port from
 * docs/superpowers/ui-prototypes/import-export-redesign.html
 * lines 246-318 (§05 modal shell + segmented control + override list +
 * item rows). */

.wp-conflict-modal {
  color: var(--wp-text);
}

/* Title-row counts (right side of the modal header). Mirrors prototype
 * line 254. */
:deep(.wp-modal-shell__title-counts),
.wp-modal-shell__title-counts {
  margin-left: auto;
  font-size: var(--wp-text-xs);
  color: var(--wp-text-muted);
  font-weight: 500;
  font-family: var(--wp-font-mono);
}

/* Section title — uppercase label + count chip. Prototype lines 261-267. */
.wp-conflict-modal__section-title {
  font-size: 9.5px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: var(--wp-text-dim);
  margin: 18px 0 8px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.wp-conflict-modal__section-title:first-child { margin-top: 0; }
.wp-conflict-modal__section-count {
  background: var(--wp-bg-3);
  color: var(--wp-text-muted);
  font-family: var(--wp-font-mono);
  font-size: 9.5px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 2px;
  letter-spacing: 0;
}

/* Action group — 3-button segmented control. Prototype lines 269-280. */
.wp-action-group {
  display: inline-flex;
  border: 1px solid var(--wp-border-strong);
  border-radius: var(--wp-radius);
  overflow: hidden;
  background: var(--wp-bg-2);
}
.wp-action-group__btn {
  background: transparent;
  border: none;
  color: var(--wp-text-muted);
  font-family: var(--wp-font);
  font-size: var(--wp-text-sm);
  font-weight: 500;
  padding: 5px 12px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border-right: 1px solid var(--wp-border-strong);
}
.wp-action-group__btn:last-child { border-right: none; }
.wp-action-group__btn:hover {
  background: var(--wp-bg-3);
  color: var(--wp-text);
}
.wp-action-group__btn[data-active="true"] {
  background: var(--wp-accent-600);
  color: #fff;
  font-weight: 600;
}
.wp-action-group__btn[data-active="true"]:hover { background: var(--wp-accent-500); }
.wp-action-group__btn .pi { font-size: 10px; }

/* Per-row override list scales the segmented control down to fit
 * inside the row. Prototype lines 940/954/968 use
 * `transform: scale(0.92); transform-origin: right center` inline. */
.wp-action-group--sm {
  transform: scale(0.92);
  transform-origin: right center;
}

/* Batch card — single rounded card containing the batch label + inline
 * segmented control on one row, the override-toggle below, and the
 * expanded override list further below. Prototype lines 282-292. */
.wp-conflict-modal__batch-card {
  background: var(--wp-bg-3);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius);
  padding: 12px 14px;
}
.wp-conflict-modal__batch-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}
.wp-conflict-modal__batch-label {
  flex: 1;
  font-size: var(--wp-text-sm);
  color: var(--wp-text);
}
.wp-conflict-modal__batch-label strong {
  color: var(--wp-text);
  font-weight: 600;
}
.wp-conflict-modal__override-toggle {
  background: transparent;
  border: 1px solid var(--wp-border-strong);
  color: var(--wp-text-muted);
  font-family: var(--wp-font);
  font-size: var(--wp-text-xs);
  padding: 4px 9px;
  border-radius: var(--wp-radius-sm);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin-top: 4px;
}
.wp-conflict-modal__override-toggle:hover {
  color: var(--wp-text);
  background: var(--wp-bg-4);
}
.wp-conflict-modal__override-toggle .pi { font-size: 9px; }

/* Override list — one row per batch conflict. Prototype lines 294-304. */
.wp-conflict-modal__override-list {
  margin-top: 10px;
  background: var(--wp-bg-1);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius);
  overflow: hidden;
}
.wp-conflict-modal__override-row {
  display: grid;
  grid-template-columns: 20px minmax(0, 1fr) auto auto;
  gap: 10px;
  align-items: center;
  padding: 7px 12px;
  border-bottom: 1px solid color-mix(in oklab, var(--wp-border) 50%, transparent);
  font-size: var(--wp-text-sm);
}
.wp-conflict-modal__override-row:last-child { border-bottom: none; }

/* Override-tag — small uppercase pill that says "Use batch default"
 * (when no per-row override) or "Override" (set). Prototype lines 302-304. */
.wp-override-tag {
  font-size: 9.5px;
  font-weight: 600;
  color: var(--wp-text-dim);
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.wp-override-tag--set { color: var(--wp-accent-text); }

/* Per-item issue rows — 3-col grid (icon + body + segmented control).
 * Prototype lines 306-318. Tier-3 rows get a danger-tinted background. */
.wp-conflict-modal__item-row {
  display: grid;
  grid-template-columns: 20px minmax(0, 1fr) auto;
  gap: 12px;
  align-items: center;
  padding: 11px 14px;
  background: var(--wp-bg-3);
  border-radius: var(--wp-radius);
  margin-bottom: 6px;
  font-size: var(--wp-text-sm);
}
.wp-conflict-modal__item-row[data-tier="3"] {
  background: color-mix(in oklab, var(--wp-danger) 6%, var(--wp-bg-3));
  border: 1px solid color-mix(in oklab, var(--wp-danger) 22%, transparent);
  /* Tier-3 row swaps the 3-col grid for a 2-col grid:
   * full-width Tier3ChainViz body + a single Skip button on the right. */
  grid-template-columns: minmax(0, 1fr) auto;
}
.wp-conflict-modal__tier3-body { min-width: 0; }
.wp-conflict-modal__item-detail {
  font-size: var(--wp-text-xs);
  color: var(--wp-text-muted);
  margin-top: 3px;
  line-height: 1.45;
}
.wp-conflict-modal__item-detail code {
  font-family: var(--wp-font-mono);
  background: color-mix(in oklab, var(--wp-bg-1) 80%, transparent);
  padding: 1px 4px;
  border-radius: 2px;
  font-size: 10px;
}

/* Override-row + item-row inherit the picker primitives — keep type-icon
 * size consistent with PickerRow at 20x20 / 11px. */
.wp-conflict-modal__override-row .wp-row-type-icon,
.wp-conflict-modal__item-row .wp-row-type-icon {
  width: 20px;
  height: 20px;
  border-radius: var(--wp-radius-sm);
}
.wp-conflict-modal__override-row .wp-row-type-icon .pi,
.wp-conflict-modal__item-row .wp-row-type-icon .pi {
  font-size: 11px;
}
.wp-conflict-modal__override-row .wp-row-name,
.wp-conflict-modal__item-row .wp-row-name {
  /* Explicit flex-direction: row to override the global
   * `.wp-row-name { flex-direction: column }` from
   * manager/styles/tokens.css:1002. */
  display: flex;
  flex-direction: row;
  align-items: baseline;
  gap: 9px;
  min-width: 0;
}
.wp-conflict-modal__override-row .wp-picker-row__name,
.wp-conflict-modal__item-row .wp-picker-row__name {
  font-weight: 500;
  color: var(--wp-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wp-conflict-modal__override-row .wp-id,
.wp-conflict-modal__item-row .wp-id {
  font-family: var(--wp-font-mono);
  font-size: 10px;
  color: var(--wp-text-dim);
  font-weight: 500;
  flex-shrink: 0;
}
.wp-conflict-modal__override-row .wp-mod-badge,
.wp-conflict-modal__item-row .wp-mod-badge {
  font-family: var(--wp-font);
  font-weight: 700;
  font-size: 9.5px;
  line-height: 1;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  padding: 3px 6px;
  border-radius: 2px;
  flex-shrink: 0;
  white-space: nowrap;
}

/* Resolved-pill — the "✓ Skip" / "✓ Replace" indicator that replaces
 * the segmented control once the user picks an action. */
.wp-conflict-modal__resolved {
  color: var(--wp-text-muted);
  font-size: var(--wp-text-sm);
  font-style: italic;
}

/* Footer state lines (left-aligned). */
.wp-conflict-modal__unresolved {
  color: var(--wp-warn);
  font-size: var(--wp-text-sm);
  font-weight: 600;
}
.wp-conflict-modal__ready {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--wp-success);
  font-size: var(--wp-text-sm);
}
.wp-conflict-modal__ready .pi { font-size: 11px; }
.wp-conflict-modal__spacer { flex: 1; }
</style>
