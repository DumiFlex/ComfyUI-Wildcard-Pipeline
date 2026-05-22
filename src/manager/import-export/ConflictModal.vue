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
 *     uniformly. The detailed per-item override list for batch
 *     conflicts is intentionally omitted for this task; it lands in a
 *     follow-up if usage shows users need per-row override.
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
 */
import { computed, ref } from "vue";
import type { EntityKind } from "./commit";

/**
 * Tag for one per-item integrity issue. Mirrors the upstream
 * verify pipeline (see parse.ts + the importer/exporter spec):
 *
 *   - broken-inner-ref      — bundle/constraint edge references an id
 *                             that isn't in the picker selection.
 *   - broken-uuid-ref       — wildcard option uses `@{id}` syntax
 *                             targeting an unknown id.
 *   - broken-constraint-ref — constraint source/target points at an
 *                             entity not in the import set.
 *   - tier-3                — entity contains a forward-incompatible
 *                             construct the server cannot accept;
 *                             non-overridable.
 *   - lossy-migration       — migration chain ran but dropped fields
 *                             from the original payload.
 *   - fingerprint-mismatch  — payload-stamped `snapshot_fingerprint`
 *                             disagrees with the value recomputed from
 *                             the row contents.
 */
export type PerItemKind =
  | "broken-inner-ref"
  | "broken-uuid-ref"
  | "broken-constraint-ref"
  | "tier-3"
  | "lossy-migration"
  | "fingerprint-mismatch";

/**
 * One UUID collision against the live DB. `kind` is the 7-bucket
 * `EntityKind` from `./commit` so the same partitioner downstream can
 * route the resolved entity to the correct server-side bucket. The
 * `entity` blob is the full payload row (passed through verbatim).
 */
export interface BatchConflict {
  kind: EntityKind;
  id: string;
  entity: Record<string, unknown>;
}

/**
 * One per-item integrity issue. `entity` MUST carry `id`; `name` is
 * optional for the display fallback (`id` shown if name absent). The
 * generic `detail` slot lets callers stash any diagnostic context the
 * modal doesn't need to interpret (e.g. specific broken-ref target).
 */
export interface PerItemIssue {
  kind: PerItemKind;
  entity: Record<string, unknown> & { id: string; name?: string };
  detail?: unknown;
}

interface Props {
  batchConflicts: BatchConflict[];
  perItemIssues: PerItemIssue[];
}

const props = defineProps<Props>();

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
      perItemDecisions: Record<
        string,
        { kind: "skip" | "replace" | "rename" | "accept"; new_name?: string }
      >;
    },
  ): void;
  (e: "cancel"): void;
}>();

const batchDefault = ref<"skip" | "replace">("skip");

type PerItemDecision = {
  kind: "skip" | "replace" | "rename" | "accept";
  new_name?: string;
};

const perItemDecisions = ref<Record<string, PerItemDecision>>({});

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
 * Record a per-item decision under `entity.id`. Uses the
 * immutable-replacement pattern (`{ ...prev, [id]: next }`) so
 * downstream `computed` graphs observing `perItemDecisions` rerun.
 * `new_name` is only attached to the stored record when supplied —
 * skips/accepts/replaces never carry it, matching the commit-side
 * shape.
 */
function resolveItem(
  id: string,
  kind: "skip" | "replace" | "rename" | "accept",
  new_name?: string,
): void {
  const next: PerItemDecision =
    typeof new_name === "string" && new_name.length > 0
      ? { kind, new_name }
      : { kind };
  perItemDecisions.value = { ...perItemDecisions.value, [id]: next };
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
</script>

<template>
  <div class="wp-conflict-modal" data-test="conflict-modal">
    <header class="wp-conflict-modal__header">
      <h3 class="wp-conflict-modal__title">Resolve conflicts</h3>
      <p class="wp-conflict-modal__summary" data-test="conflict-modal-summary">
        {{ props.batchConflicts.length }}
        {{ props.batchConflicts.length === 1 ? "batch conflict" : "batch conflicts" }},
        {{ props.perItemIssues.length }}
        {{ props.perItemIssues.length === 1 ? "per-item issue" : "per-item issues" }}.
      </p>
    </header>

    <section
      v-if="props.batchConflicts.length > 0"
      class="wp-conflict-modal__section"
      data-test="conflict-modal-batch-section"
    >
      <h4 class="wp-conflict-modal__section-title">Batch resolution</h4>
      <p class="wp-conflict-modal__section-hint">
        UUID collisions
        ({{ props.batchConflicts.length }}{{ props.batchConflicts.length === 1 ? "" : "" }})
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
      </label>
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
          <div v-else class="wp-conflict-modal__actions">
            <button
              type="button"
              class="wp-conflict-modal__btn"
              :data-test="`resolve-${issue.entity.id}-skip`"
              @click="resolveItem(issue.entity.id, 'skip')"
            >Skip</button>
            <button
              v-if="issue.kind !== 'tier-3'"
              type="button"
              class="wp-conflict-modal__btn wp-conflict-modal__btn--warn"
              :data-test="`resolve-${issue.entity.id}-accept`"
              @click="resolveItem(issue.entity.id, 'accept')"
            >Import anyway</button>
          </div>
        </li>
      </ul>
    </section>

    <footer class="wp-conflict-modal__footer">
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
    </footer>
  </div>
</template>

<style scoped>
.wp-conflict-modal {
  display: flex;
  flex-direction: column;
  gap: var(--wp-space-5);
  padding: var(--wp-space-6);
  background: var(--wp-bg-2);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius-lg);
  color: var(--wp-text);
}

.wp-conflict-modal__header {
  display: flex;
  flex-direction: column;
  gap: var(--wp-space-3);
}

.wp-conflict-modal__title {
  margin: 0;
  font-size: var(--wp-text-lg);
  line-height: var(--wp-line-lg);
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

.wp-conflict-modal__footer {
  display: flex;
  align-items: center;
  gap: var(--wp-space-4);
  padding-top: var(--wp-space-4);
  border-top: 1px solid var(--wp-border);
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
