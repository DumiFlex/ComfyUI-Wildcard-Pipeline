<script setup lang="ts">
/**
 * Inline rename input — Task 20.
 *
 * Surfaced inside `ConflictModal.vue` when the user picks "Import as
 * new" on a UUID-collision (batch or per-item) row. The component mints
 * a fresh 8-hex-char id client-side via `newShortId()` and lets the
 * user edit the display name; on confirm it emits the
 * `{ new_id, new_name }` pair the partitioner stamps onto the
 * outgoing `renames[]` row in `commit.ts`.
 *
 * Field naming uses `new_id` (NOT `new_uuid`) — the plan body sketched
 * the older `new_uuid` shape but the locked server contract
 * (Tasks 13/14/15) and the existing TS rename branch in `commit.ts`
 * both use `new_id`. We follow the locked contract.
 *
 * Surface:
 *   - One labeled text input pre-populated with
 *     `"${originalName} (imported)"`.
 *   - Confirm button (primary) — emits `applied` with the minted id +
 *     edited name.
 *   - Cancel button — emits `cancel`.
 *
 * Each call to confirm mints a *fresh* id so a parent that re-opens
 * the inline rename for the same row (e.g. user changes their mind
 * twice) doesn't reuse a stale id. The mint happens at confirm time,
 * not mount time, so a user who opens-then-cancels never burns an id.
 *
 * No persistent state — the parent is responsible for stashing the
 * applied decision in its `perItemDecisions` map. This component is
 * pure UI + event surface.
 *
 * Strict TS: no `any` / `@ts-ignore` / `as any`. The input value is
 * bound via `v-model` to a `Ref<string>`; the emit payload is typed
 * as the exact `{ new_id, new_name }` shape the commit-side partitioner
 * accepts.
 */
import { ref } from "vue";
import { newShortId } from "../utils/ids";

interface Props {
  /**
   * Display name of the original entity (e.g. `"$colors"`,
   * `"Sketch Pack"`). Used to seed the input value as
   * `"${originalName} (imported)"`. If the caller only has an id
   * available, passing the id as a fallback is fine — the user can
   * edit it before confirming.
   */
  originalName: string;
}

const props = defineProps<Props>();

/**
 * Emit signature:
 *   - `applied` carries the minted id + edited name. The parent stores
 *     this on its `perItemDecisions[id] = { kind: "rename", new_id,
 *     new_name }` record, which the partitioner in `commit.ts`
 *     translates into a `renames[]` row.
 *   - `cancel` lets the parent return to the row's pre-rename state
 *     (e.g. show the Skip / Import-anyway / Import-as-new buttons
 *     again).
 */
const emit = defineEmits<{
  (e: "applied", payload: { new_id: string; new_name: string }): void;
  (e: "cancel"): void;
}>();

const renameTo = ref<string>(`${props.originalName} (imported)`);

function onConfirm(): void {
  emit("applied", {
    new_id: newShortId(),
    new_name: renameTo.value,
  });
}

function onCancel(): void {
  emit("cancel");
}
</script>

<template>
  <div class="wp-rename" data-test="rename-row">
    <!-- Both `for=` AND nested-input pattern: the
         `vuejs-accessibility/label-has-for` rule requires the input to
         live inside the label (the explicit `for=` alone is not enough
         under this plugin's default config). The same pattern is used
         by the batch-default select in `ConflictModal.vue`. -->
    <label class="wp-rename__label" for="wp-rename-input">
      <span class="wp-rename__label-text">Rename to</span>
      <input
        id="wp-rename-input"
        v-model="renameTo"
        type="text"
        class="wp-rename__input"
        data-test="rename-input"
        autocomplete="off"
        spellcheck="false"
      >
    </label>
    <div class="wp-rename__actions">
      <button
        type="button"
        class="wp-rename__btn"
        data-test="rename-cancel"
        @click="onCancel"
      >Cancel</button>
      <button
        type="button"
        class="wp-rename__btn wp-rename__btn--primary"
        data-test="rename-confirm"
        @click="onConfirm"
      >Import as new</button>
    </div>
  </div>
</template>

<style scoped>
.wp-rename {
  display: flex;
  align-items: center;
  gap: var(--wp-space-3);
  padding: var(--wp-space-3) var(--wp-space-4);
  background: var(--wp-bg-2);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius-sm);
}

.wp-rename__label {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: var(--wp-space-3);
}

.wp-rename__label-text {
  font-size: var(--wp-text-sm);
  color: var(--wp-text-muted);
  font-weight: var(--wp-weight-semibold);
  flex-shrink: 0;
}

.wp-rename__input {
  flex: 1;
  min-width: 0;
  height: var(--wp-btn-h);
  padding: 0 var(--wp-space-4);
  background: var(--wp-bg-1);
  color: var(--wp-text);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius-sm);
  font-family: inherit;
  font-size: var(--wp-text-base);
}
.wp-rename__input:focus-visible {
  outline: none;
  border-color: var(--wp-accent-500);
  box-shadow: var(--wp-focus-ring);
}

.wp-rename__actions {
  display: flex;
  gap: var(--wp-space-2);
  flex-shrink: 0;
}

.wp-rename__btn {
  height: var(--wp-btn-h);
  padding: 0 var(--wp-space-4);
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
.wp-rename__btn:hover:not(:disabled) {
  background: var(--wp-bg-4);
  border-color: var(--wp-border-strong);
}
.wp-rename__btn:focus-visible {
  outline: none;
  box-shadow: var(--wp-focus-ring);
}

.wp-rename__btn--primary {
  background: linear-gradient(180deg, var(--wp-accent-500), var(--wp-accent-600));
  border-color: var(--wp-accent-600);
  /* audit-exempt: white on accent gradient ≥4.5:1 across both themes */
  color: #fff;
}
.wp-rename__btn--primary:hover:not(:disabled) {
  background: linear-gradient(180deg, var(--wp-accent-400), var(--wp-accent-500));
  border-color: var(--wp-accent-500);
}
</style>
