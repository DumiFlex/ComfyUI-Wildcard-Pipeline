<script setup lang="ts">
/**
 * Conflict modal — Task 18.
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
 * Two distinct surfaces:
 *
 *   - **Batch section** (only when `batchConflicts.length > 0`).
 *     UUID collisions where the live-DB row has different content. One
 *     dropdown sets the default action — skip or replace — applied
 *     uniformly. An expandable per-row override list (collapsed by
 *     default) lets the user override individual batch conflicts without
 *     changing the batch default; overrides are written into
 *     `perItemDecisions` alongside per-item-issue decisions, and the
 *     orchestrator at commit time already prefers `perItemDecisions[id]`
 *     over `batchDefault`.
 *
 *   - **Per-item section** (only when `perItemIssues.length > 0`).
 *     One row per issue with the entity name, the issue kind label,
 *     and action buttons. Two actions:
 *       • Skip — drop this entity from the import.
 *       • Import anyway — proceed despite the issue.
 *     **Tier-3 is non-overridable** per spec lock #9 in
 *     CHECKPOINT-importer-exporter.md, so tier-3 rows render the Skip
 *     button only. Once resolved, the buttons collapse into a "✓ skip"
 *     / "✓ accept" indicator so the user sees their choice stuck.
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
 *   - perItemDecisions   — keyed by entity `id` (NOT `uuid`). Each
 *                          value carries the chosen action and an
 *                          optional `new_name` for the rename case.
 *                          The rename branch isn't surfaced in the
 *                          current UI but the type leaves room so a
 *                          follow-up can wire it without breaking
 *                          callers.
 */
const emit = defineEmits<{
  (
    e: "commit-ready",
    resolution: {
      batchDefault: "skip" | "replace";
      perItemDecisions: Record<string, PerItemDecision>;
    },
  ): void;
  (e: "cancel"): void;
  (e: "update:open", v: boolean): void;
}>();

const batchDefault = ref<"skip" | "replace">("skip");

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
 * Map the dropdown's typed `<select>` value back into the ref via a
 * dedicated handler. Letting Vue coerce a generic Event target to our
 * literal-string union via v-model would require an `as` cast we'd
 * rather avoid; explicit `change` handler keeps the surface strict-TS
 * clean.
 */
function onBatchDefaultChange(ev: Event): void {
  const target = ev.target as HTMLSelectElement | null;
  if (!target) return;
  const v = target.value;
  if (v === "skip" || v === "replace") {
    batchDefault.value = v;
  }
}

/**
 * Read the current per-row override for a batch conflict. Returns
 * `"default"` when no override exists (i.e. the row will follow the
 * batch dropdown's value at commit time). Returns `"skip"` or
 * `"replace"` when the user has explicitly overridden this row.
 *
 * The "default" sentinel keeps the `<select>` bound state cleanly
 * tri-valued — without it, a row with no entry in `perItemDecisions`
 * would either render as "skip" (misleading: user hasn't chosen) or as
 * blank (confusing in the dropdown). Mapping the absence-of-entry to a
 * named option makes the intent explicit in the UI.
 *
 * Decisions with `kind` other than `skip`/`replace` (i.e. `rename` or
 * `accept`, which the batch override flow does not surface) coerce to
 * `"default"` so the override dropdown reflects "no batch-side
 * override" without misrepresenting the underlying decision. This
 * doesn't happen in practice today (the batch override path only
 * writes skip/replace) but the type widens to those values, so the
 * narrowing is defensive.
 */
function batchOverrideFor(id: string): "default" | "skip" | "replace" {
  const d = perItemDecisions.value[id];
  if (!d) return "default";
  if (d.kind === "skip" || d.kind === "replace") return d.kind;
  return "default";
}

/**
 * Apply a per-row batch override decision keyed by entity id. Picking
 * `"default"` deletes the entry from `perItemDecisions` so the batch
 * dropdown's value applies at commit time (clean state — no lingering
 * stub). Picking `"skip"` or `"replace"` writes the decision into the
 * map, where it takes precedence over `batchDefault` for that id.
 *
 * Immutable replacement matches the `resolveItem` pattern so any
 * downstream `computed` observing `perItemDecisions` reruns.
 */
function setBatchOverride(
  id: string,
  value: "default" | "skip" | "replace",
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
 * Map the per-row override `<select>` change event to `setBatchOverride`.
 * Same rationale as `onBatchDefaultChange` — explicit handler keeps the
 * literal-string union strict without an `as` cast on the event target.
 */
function onBatchOverrideChange(id: string, ev: Event): void {
  const target = ev.target as HTMLSelectElement | null;
  if (!target) return;
  const v = target.value;
  if (v === "default" || v === "skip" || v === "replace") {
    setBatchOverride(id, v);
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
</script>

<template>
  <Modal
    :open="props.open"
    title="Resolve conflicts"
    size="lg"
    @update:open="onModalUpdateOpen"
  >
    <div class="wp-conflict-modal" data-test="conflict-modal">
      <p class="wp-conflict-modal__summary" data-test="conflict-modal-summary">
        {{ props.batchConflicts.length }}
        {{ props.batchConflicts.length === 1 ? "batch conflict" : "batch conflicts" }},
        {{ props.perItemIssues.length }}
        {{ props.perItemIssues.length === 1 ? "per-item issue" : "per-item issues" }}.
      </p>

      <section
        v-if="props.batchConflicts.length > 0"
        class="wp-conflict-modal__section"
        data-test="conflict-modal-batch-section"
      >
        <h4 class="wp-conflict-modal__section-title">Batch resolution</h4>
        <p class="wp-conflict-modal__section-hint">
          UUID collisions ({{ props.batchConflicts.length }})
          — applied uniformly to all matching rows.
        </p>
        <label
          for="wp-conflict-modal-batch-default"
          class="wp-conflict-modal__batch-row"
        >
          <span class="wp-conflict-modal__batch-label">Default action</span>
          <select
            id="wp-conflict-modal-batch-default"
            class="wp-conflict-modal__select"
            :value="batchDefault"
            data-test="batch-default-select"
            @change="onBatchDefaultChange"
          >
            <option value="skip">Skip — keep live-DB version</option>
            <option value="replace">Replace — overwrite live-DB row</option>
          </select>
          <button
            type="button"
            class="wp-conflict-modal__btn wp-conflict-modal__batch-override-toggle"
            :aria-expanded="batchExpanded ? 'true' : 'false'"
            aria-controls="wp-conflict-modal-batch-overrides"
            data-test="batch-override-toggle"
            @click="batchExpanded = !batchExpanded"
          >
            {{ batchExpanded ? "Hide per-conflict overrides" : "Show per-conflict overrides" }}
          </button>
        </label>
        <ul
          v-if="batchExpanded"
          id="wp-conflict-modal-batch-overrides"
          class="wp-conflict-modal__batch-override-list"
          data-test="batch-override-list"
        >
          <li
            v-for="conflict in props.batchConflicts"
            :key="conflict.id"
            class="wp-conflict-modal__batch-override-row"
            :data-test="`batch-override-row-${conflict.id}`"
          >
            <span class="wp-conflict-modal__batch-override-name">
              {{ batchRowName(conflict) }}
            </span>
            <select
              class="wp-conflict-modal__select wp-conflict-modal__batch-override-select"
              :value="batchOverrideFor(conflict.id)"
              :data-test="`batch-override-select-${conflict.id}`"
              :aria-label="`Override action for ${batchRowName(conflict)}`"
              @change="(ev) => onBatchOverrideChange(conflict.id, ev)"
            >
              <option value="default">Use batch default</option>
              <option value="skip">Skip</option>
              <option value="replace">Replace</option>
            </select>
          </li>
        </ul>
      </section>

      <section
        v-if="props.perItemIssues.length > 0"
        class="wp-conflict-modal__section"
        data-test="conflict-modal-per-item-section"
      >
        <h4 class="wp-conflict-modal__section-title">Per-item issues</h4>
        <ul class="wp-conflict-modal__items">
          <li
            v-for="issue in props.perItemIssues"
            :key="issue.entity.id"
            class="wp-conflict-modal__item"
            :data-test="`conflict-modal-item-${issue.entity.id}`"
          >
            <template v-if="issue.kind === 'tier-3'">
              <Tier3ChainViz
                :bundle-name="issue.entity.name ?? issue.entity.id"
                :chain="extractChain(issue)"
              />
              <div
                v-if="perItemDecisions[issue.entity.id]"
                class="wp-conflict-modal__resolved"
                :data-test="`resolved-${issue.entity.id}`"
              >
                <span aria-hidden="true">✓</span>
                {{ perItemDecisions[issue.entity.id].kind }}
              </div>
              <div v-else class="wp-conflict-modal__actions">
                <button
                  type="button"
                  class="wp-conflict-modal__btn"
                  :data-test="`resolve-${issue.entity.id}-skip`"
                  @click="resolveItem(issue.entity.id, 'skip')"
                >Skip</button>
                <!-- Tier-3 is non-overridable per spec lock #9; no
                     "Import anyway" button here. The Tier3ChainViz
                     shows the user *why* via the chain, and Skip is
                     the only resolution path. -->
              </div>
            </template>
            <template v-else>
              <div class="wp-conflict-modal__item-meta">
                <span class="wp-conflict-modal__row-name">
                  {{ issue.entity.name ?? issue.entity.id }}
                </span>
                <span class="wp-conflict-modal__row-kind">{{ issue.kind }}</span>
              </div>
              <div
                v-if="perItemDecisions[issue.entity.id]"
                class="wp-conflict-modal__resolved"
                :data-test="`resolved-${issue.entity.id}`"
              >
                <span aria-hidden="true">✓</span>
                {{ perItemDecisions[issue.entity.id].kind }}
              </div>
              <ImportAsNewRename
                v-else-if="renamingIds.has(issue.entity.id)"
                :original-name="issue.entity.name ?? issue.entity.id"
                @applied="(p) => onRenameApplied(issue.entity.id, p)"
                @cancel="onRenameCancel(issue.entity.id)"
              />
              <div v-else class="wp-conflict-modal__actions">
                <button
                  type="button"
                  class="wp-conflict-modal__btn"
                  :data-test="`resolve-${issue.entity.id}-skip`"
                  @click="resolveItem(issue.entity.id, 'skip')"
                >Skip</button>
                <button
                  type="button"
                  class="wp-conflict-modal__btn"
                  :data-test="`resolve-${issue.entity.id}-rename`"
                  @click="startRename(issue.entity.id)"
                >Import as new</button>
                <button
                  type="button"
                  class="wp-conflict-modal__btn wp-conflict-modal__btn--warn"
                  :data-test="`resolve-${issue.entity.id}-accept`"
                  @click="resolveItem(issue.entity.id, 'accept')"
                >Import anyway</button>
              </div>
            </template>
          </li>
        </ul>
      </section>
    </div>

    <template #footer>
      <span
        v-if="unresolvedCount > 0"
        class="wp-conflict-modal__unresolved"
        data-test="conflict-modal-unresolved"
      >{{ unresolvedCount }} unresolved</span>
      <span v-else class="wp-conflict-modal__ready" data-test="conflict-modal-ready">
        Ready to import
      </span>
      <span class="wp-conflict-modal__spacer" />
      <button
        type="button"
        class="wp-conflict-modal__btn"
        data-test="cancel-btn"
        @click="onCancel"
      >Cancel</button>
      <button
        type="button"
        class="wp-conflict-modal__btn wp-conflict-modal__btn--primary"
        :disabled="unresolvedCount > 0"
        data-test="commit-btn"
        @click="onCommit"
      >Import</button>
    </template>
  </Modal>
</template>

<style scoped>
.wp-conflict-modal {
  display: flex;
  flex-direction: column;
  gap: var(--wp-space-5);
  color: var(--wp-text);
}

.wp-conflict-modal__summary {
  margin: 0;
  color: var(--wp-text-muted);
  font-size: var(--wp-text-sm);
}

.wp-conflict-modal__section {
  display: flex;
  flex-direction: column;
  gap: var(--wp-space-4);
  padding: var(--wp-space-5);
  background: var(--wp-bg-3);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius);
}

.wp-conflict-modal__section-title {
  margin: 0;
  font-size: var(--wp-text-md);
  line-height: var(--wp-line-md);
}

.wp-conflict-modal__section-hint {
  margin: 0;
  color: var(--wp-text-muted);
  font-size: var(--wp-text-sm);
}

.wp-conflict-modal__batch-row {
  display: flex;
  align-items: center;
  gap: var(--wp-space-4);
}

.wp-conflict-modal__batch-label {
  font-size: var(--wp-text-sm);
  color: var(--wp-text-muted);
  font-weight: var(--wp-weight-semibold);
}

.wp-conflict-modal__select {
  flex: 1;
  height: var(--wp-btn-h);
  padding: 0 var(--wp-space-4);
  background: var(--wp-bg-2);
  color: var(--wp-text);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius-sm);
  font-family: inherit;
  font-size: var(--wp-text-base);
}
.wp-conflict-modal__select:focus-visible {
  outline: none;
  border-color: var(--wp-accent-500);
  box-shadow: var(--wp-focus-ring);
}

.wp-conflict-modal__batch-override-toggle {
  /* Sits next to the batch default <select> in the same row; keep it
     compact so it doesn't fight the dropdown for horizontal space.
     `flex: 0 0 auto` cancels the parent's flex stretch that the select
     uses via `flex: 1`. */
  flex: 0 0 auto;
  white-space: nowrap;
}

.wp-conflict-modal__batch-override-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--wp-space-2);
}

.wp-conflict-modal__batch-override-row {
  display: flex;
  align-items: center;
  gap: var(--wp-space-3);
  padding: var(--wp-space-3) var(--wp-space-4);
  background: var(--wp-bg-2);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius-sm);
}

.wp-conflict-modal__batch-override-name {
  flex: 1;
  font-size: var(--wp-text-sm);
  font-weight: var(--wp-weight-medium);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.wp-conflict-modal__batch-override-select {
  /* Override the parent `flex: 1` so the override dropdown stays
     compact next to the entity name (the row already grants the name
     `flex: 1`). */
  flex: 0 0 auto;
  min-width: 12ch;
}

.wp-conflict-modal__items {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--wp-space-3);
}

.wp-conflict-modal__item {
  display: flex;
  align-items: center;
  gap: var(--wp-space-4);
  padding: var(--wp-space-4) var(--wp-space-5);
  background: var(--wp-bg-2);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius-sm);
}

.wp-conflict-modal__item-meta {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: var(--wp-space-2);
  min-width: 0;
}

.wp-conflict-modal__row-name {
  font-weight: var(--wp-weight-medium);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wp-conflict-modal__row-kind {
  font-size: var(--wp-text-xs);
  color: var(--wp-warn);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  font-weight: var(--wp-weight-semibold);
}

.wp-conflict-modal__actions {
  display: flex;
  gap: var(--wp-space-3);
}

.wp-conflict-modal__resolved {
  color: var(--wp-text-muted);
  font-size: var(--wp-text-sm);
  font-style: italic;
}

.wp-conflict-modal__btn {
  height: var(--wp-btn-h);
  padding: 0 var(--wp-space-5);
  background: var(--wp-bg-3);
  color: var(--wp-text);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius-sm);
  font-family: inherit;
  font-size: var(--wp-text-base);
  font-weight: var(--wp-weight-medium);
  cursor: pointer;
  transition: background .12s, border-color .12s, color .12s;
}
.wp-conflict-modal__btn:hover:not(:disabled) {
  background: var(--wp-bg-4);
  border-color: var(--wp-border-strong);
}
.wp-conflict-modal__btn:focus-visible {
  outline: none;
  box-shadow: var(--wp-focus-ring);
}
.wp-conflict-modal__btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.wp-conflict-modal__btn--warn {
  background: color-mix(in oklab, var(--wp-warn) 14%, transparent);
  border-color: color-mix(in oklab, var(--wp-warn) 40%, transparent);
  color: var(--wp-warn);
}
.wp-conflict-modal__btn--warn:hover:not(:disabled) {
  background: color-mix(in oklab, var(--wp-warn) 22%, transparent);
  border-color: color-mix(in oklab, var(--wp-warn) 55%, transparent);
}

.wp-conflict-modal__btn--primary {
  background: linear-gradient(180deg, var(--wp-accent-500), var(--wp-accent-600));
  border-color: var(--wp-accent-600);
  /* audit-exempt: white on accent gradient ≥4.5:1 across both themes */
  color: #fff;
}
.wp-conflict-modal__btn--primary:hover:not(:disabled) {
  background: linear-gradient(180deg, var(--wp-accent-400), var(--wp-accent-500));
  border-color: var(--wp-accent-500);
}

.wp-conflict-modal__unresolved {
  color: var(--wp-warn);
  font-size: var(--wp-text-sm);
  font-weight: var(--wp-weight-semibold);
}

.wp-conflict-modal__ready {
  color: var(--wp-text-muted);
  font-size: var(--wp-text-sm);
}

.wp-conflict-modal__spacer {
  flex: 1;
}
</style>
