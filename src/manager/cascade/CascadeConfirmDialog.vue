<script setup lang="ts">
import { computed, ref, watch } from "vue";

import { kindIcon } from "../../components/shared/kind-icons";
import Button from "../components/ui/Button.vue";
import Modal from "../components/ui/Modal.vue";
import { useCascadeApply, type CascadeApplyRequest } from "./useCascadeApply";
import { useBundleStore } from "../stores/bundleStore";
import Checkbox from "../components/ui/Checkbox.vue";

interface Props {
  open: boolean;
  kind: string;
  id: string;
  action: "delete" | "rename";
  extra?: Record<string, unknown>;
  newName?: string;
  cascadeRefs?: boolean;
}
const props = withDefaults(defineProps<Props>(), { cascadeRefs: true });

const emit = defineEmits<{
  (e: "confirmed", result: { undo_entry_id: string; affected_count: number }): void;
  (e: "cancelled"): void;
}>();

const m = useCascadeApply();
const bundleStore = useBundleStore();
const loading = ref(true);
const affected = ref<Array<{ kind: string; id: string; name: string }>>([]);
const error = ref<string>("");
/** Local copy of the cascade-refs flag — user-toggleable via the
 *  "Update N references" checkbox. Defaults to the prop value (true
 *  by default) so the recommended path is one-click confirm. When
 *  unchecked, server deletes the target only and leaves dangling
 *  refs intact (modules get `meta.orphaned`, bundle refs get
 *  `_missing_ref` on next GET). Re-seeded from props each open so a
 *  prior false doesn't stick across dialog instances. */
const cascadeRefsLocal = ref<boolean>(props.cascadeRefs);

/** Wildcard-delete gets a per-entity cleanup model instead of the single
 *  cascade_refs flag: the engine strips a dead `@{deleted}` ref ONLY from
 *  the nested-ref wildcards/derivations whose id the user opts in here.
 *  Constraints are never cleaned (informational rows; healed via the
 *  reattach banner), so they never enter this set. */
const isWildcardDelete = computed<boolean>(
  () => props.kind === "wildcard" && props.action === "delete",
);

/** Ids the user has ticked for "strip dead reference". Re-seeded empty
 *  each open (mirrors the cascadeRefsLocal reset) so a prior dialog's
 *  ticks don't carry over. Default-UNCHECKED = leave broken → heal via
 *  chip remap. */
const checkedCleanupIds = ref<Set<string>>(new Set());

/** Constraints are the only affected kind rendered without a checkbox —
 *  they're never stripped, just re-pointed later via the constraint
 *  editor's reattach banner. */
function isConstraintRow(a: { kind: string }): boolean {
  return a.kind === "constraint";
}

function isCleanupChecked(id: string): boolean {
  return checkedCleanupIds.value.has(id);
}

/** Toggle a row's opt-in. Replace the Set so the ref's dependents
 *  re-render (mutating in place wouldn't trip reactivity on `.has`). */
function setCleanupChecked(id: string, checked: boolean): void {
  const next = new Set(checkedCleanupIds.value);
  if (checked) next.add(id);
  else next.delete(id);
  checkedCleanupIds.value = next;
}

/** Resolve the actual color a bundle row should render with. The
 *  cascade scan returns only {kind, id, name}; the library row carries
 *  the user-picked color. When the bundle isn't in the catalog yet
 *  (cold sidebar load, etc.) return null and let CSS fall back to
 *  --wp-bundle-default. */
function rowStyleFor(a: { kind: string; id: string }): Record<string, string> {
  if (a.kind !== "bundle") return {};
  const row = bundleStore.catalog.find((b) => b.id === a.id);
  if (!row?.color) return {};
  // Overriding --wp-bundle-default in the row's scope cascades to both
  // the leading icon tile (.wp-row-type-icon--bundle) and the trailing
  // badge (.wp-mod-badge--kind-bundle) — both consume the same token.
  return { "--wp-bundle-default": row.color };
}

const title = computed(() =>
  props.action === "delete" ? "Confirm delete" : "Confirm rename",
);
const confirmLabel = computed(() =>
  props.action === "delete" ? "Delete" : "Rename + update refs",
);

/** Action-kind specific blurb under the checkbox — explains what
 *  cleanup actually does for the target kind. Bundles strip parent
 *  bundles' tier-2 refs; wildcards delete dependent constraints +
 *  rewrite ref strings; categories detach the category_id from each
 *  member; options remove the option from the source wildcard +
 *  every constraint exception. */
const cleanupHint = computed<string>(() => {
  if (props.action !== "delete") return "";
  switch (props.kind) {
    case "wildcard":
      return "Removes constraints that reference this wildcard and strips @{uuid} refs from other wildcards' option values. Without cleanup, dependent constraints stay broken and ref strings point at a dead uuid.";
    case "bundle":
      return "Removes this bundle from other bundles' children lists. Without cleanup, parent bundles ship a broken tier-2 reference (rendered as MISSING).";
    case "category":
      return "Detaches the deleted category from every module/bundle that used it. Without cleanup, those rows keep a dangling category_id.";
    case "option":
      return "Removes the option from the source wildcard and every constraint exception referencing it. Without cleanup, exceptions point at a missing option id.";
    default:
      return "Rewrites every reference to this entity. Without cleanup, dependents will reference a deleted id.";
  }
});
const confirmVariant = computed<"danger" | "primary">(() =>
  props.action === "delete" ? "danger" : "primary",
);

/** Module-subtype `fixed_values` collapses to `fixed` so the icon
 * + badge variant class matches the convention already in use by
 * PickerRow / ConflictModal. Unknown kinds fall back to `bundle`'s
 * neutral indigo tint. */
const KIND_CLASS_MAP: Record<string, string> = {
  wildcard: "wildcard",
  fixed_values: "fixed",
  combine: "combine",
  derivation: "derivation",
  constraint: "constraint",
  bundle: "bundle",
  category: "category",
};

function kindClassFor(kind: string): string {
  return KIND_CLASS_MAP[kind] ?? "bundle";
}

function kindLabelFor(kind: string): string {
  if (kind === "fixed_values") return "Fixed";
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

async function refreshDryRun(): Promise<void> {
  loading.value = true;
  error.value = "";
  affected.value = [];
  // Dry-run always scans with cascade_refs=true so the affected list
  // reflects the FULL impact set regardless of the user's toggle —
  // checkbox controls behavior, not visibility of impact.
  const req: CascadeApplyRequest = {
    kind: props.kind,
    id: props.id,
    action: props.action,
    cascade_refs: true,
    new_name: props.newName,
    extra: props.extra,
  };
  const result = await m.dryRun(req);
  if (!result.ok) {
    error.value = result.error ?? "Unknown error";
  } else {
    affected.value = result.affected_entities ?? [];
  }
  loading.value = false;
}

watch(
  () => props.open,
  async (open) => {
    if (open) {
      // Reset checkbox to prop default — prevents prior "unchecked"
      // state from sticking when the dialog reopens on a different
      // target.
      cascadeRefsLocal.value = props.cascadeRefs;
      // Clear per-entity cleanup opt-ins so a prior wildcard-delete's
      // ticks don't carry over to this open. Default-unchecked.
      checkedCleanupIds.value = new Set();
      await refreshDryRun();
    }
  },
  { immediate: true },
);

async function onConfirm(): Promise<void> {
  // Wildcard-delete drives the engine via cleanup_ids (per-entity opt-in);
  // every other kind keeps the single cascade_refs flag. The engine
  // ignores cascade_refs for wildcard-delete, so we omit it on that path.
  const req: CascadeApplyRequest = isWildcardDelete.value
    ? {
        kind: props.kind,
        id: props.id,
        action: props.action,
        cleanup_ids: [...checkedCleanupIds.value],
        new_name: props.newName,
        extra: props.extra,
      }
    : {
        kind: props.kind,
        id: props.id,
        action: props.action,
        cascade_refs: cascadeRefsLocal.value,
        new_name: props.newName,
        extra: props.extra,
      };
  const result = await m.apply(req);
  if (result.ok) {
    emit("confirmed", {
      undo_entry_id: result.undo_entry_id,
      affected_count: result.affected_count,
    });
  } else {
    error.value = result.error ?? "Apply failed";
  }
}

function onCancel(): void {
  emit("cancelled");
}

function onOpenUpdate(v: boolean): void {
  if (!v) onCancel();
}
</script>

<template>
  <Modal
    :open="open"
    :title="title"
    size="sm"
    @update:open="onOpenUpdate"
  >
    <div v-if="loading" class="wp-cascade-confirm__body">
      <p class="wp-cascade-confirm__msg">Scanning impact…</p>
    </div>
    <div v-else-if="error" class="wp-cascade-confirm__body">
      <p class="wp-cascade-confirm__error">⚠ {{ error }}</p>
    </div>
    <div v-else class="wp-cascade-confirm__body">
      <p v-if="affected.length === 0" class="wp-cascade-confirm__msg">
        No downstream refs — safe to proceed.
      </p>
      <p v-else class="wp-cascade-confirm__intro">
        This will also affect
        <strong>{{ affected.length }}</strong>
        {{ affected.length === 1 ? "entity" : "entities" }}:
      </p>
      <ul v-if="affected.length > 0" class="wp-cascade-confirm__list">
        <li
          v-for="a in affected"
          :key="a.id"
          class="wp-cascade-confirm__row"
          :data-kind="a.kind"
          :style="rowStyleFor(a)"
        >
          <span
            class="wp-row-type-icon"
            :class="`wp-row-type-icon--${kindClassFor(a.kind)}`"
            aria-hidden="true"
          >
            <i :class="kindIcon(a.kind)" />
          </span>
          <div class="wp-row-name">
            <span class="wp-row-name__text">{{ a.name }}</span>
            <span class="wp-id">{{ a.id.slice(0, 8) }}</span>
          </div>
          <span
            class="wp-mod-badge"
            :class="`wp-mod-badge--kind-${kindClassFor(a.kind)}`"
          >
            {{ kindLabelFor(a.kind) }}
          </span>
          <!-- Per-entity cleanup control, wildcard-delete only.
               Constraints render an informational "reattach to heal"
               tag (never cleaned); nested-ref wildcards/derivations get
               an opt-in "strip dead reference" checkbox (default off). -->
          <template v-if="isWildcardDelete">
            <span
              v-if="isConstraintRow(a)"
              class="wp-cascade-confirm__keep-tag"
              data-test="cascade-keep-constraint"
              title="This constraint still points at the deleted wildcard. Re-point it later via the constraint editor's reattach banner."
            >
              reattach to heal
            </span>
            <span
              v-else
              class="wp-cascade-confirm__strip"
              data-test="cascade-strip"
              :data-test-id="a.id"
            >
              <Checkbox
                :model-value="isCleanupChecked(a.id)"
                aria-label="Strip dead reference"
                @update:model-value="(v: boolean) => setCleanupChecked(a.id, v)"
              />
              <span
                class="wp-cascade-confirm__strip-text"
                @click="setCleanupChecked(a.id, !isCleanupChecked(a.id))"
              >
                strip dead reference
              </span>
            </span>
          </template>
        </li>
      </ul>
      <!-- Cleanup is opt-out — checked by default + marked recommended.
           Unchecking lets the user delete the target without touching
           dependents; refs become broken but recoverable. Wildcard-delete
           opts out of this single flag — it uses the per-row controls
           above (cleanup_ids) instead. -->
      <div
        v-if="affected.length > 0 && action === 'delete' && !isWildcardDelete"
        class="wp-cascade-confirm__cleanup"
        data-test="cascade-cleanup"
      >
        <Checkbox
          v-model="cascadeRefsLocal"
          aria-label="Clean up references"
          data-test="cascade-cleanup-checkbox"
        />
        <span
          class="wp-cascade-confirm__cleanup-text"
          :title="cleanupHint"
          @click="cascadeRefsLocal = !cascadeRefsLocal"
        >
          Update <strong>{{ affected.length }}</strong>
          {{ affected.length === 1 ? "reference" : "references" }}
          <span class="wp-cascade-confirm__cleanup-rec">(recommended)</span>
        </span>
      </div>
    </div>
    <template #footer>
      <Button variant="ghost" size="sm" @click="onCancel">Cancel</Button>
      <Button
        :variant="confirmVariant"
        size="sm"
        :disabled="loading"
        data-test="cascade-confirm"
        @click="onConfirm"
      >
        {{ confirmLabel }}
      </Button>
    </template>
  </Modal>
</template>

<style scoped>
@import "../../components/shared/row-primitives.css";

.wp-cascade-confirm__body {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.wp-cascade-confirm__msg,
.wp-cascade-confirm__intro {
  margin: 0;
  font-size: 13px;
  line-height: 1.5;
  color: var(--wp-text);
}
.wp-cascade-confirm__intro strong {
  font-weight: 600;
}
.wp-cascade-confirm__error {
  margin: 0;
  color: var(--wp-color-error-fg, var(--wp-danger, #ef4444));
  font-size: 13px;
}
.wp-cascade-confirm__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.wp-cascade-confirm__cleanup {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
  padding: 6px 8px;
  background: color-mix(in oklab, var(--wp-accent-500, #8b5cf6) 8%, transparent);
  border-radius: 6px;
  font-size: 13px;
  color: var(--wp-text);
}
.wp-cascade-confirm__cleanup-text {
  cursor: pointer;
  user-select: none;
  flex: 1;
}
.wp-cascade-confirm__cleanup-rec {
  color: var(--wp-text-dim, #8a8a93);
  font-size: 12px;
  margin-left: 4px;
}
/* Per-row wildcard-delete controls. Both sit at the row's trailing edge
 * after the kind badge. */
.wp-cascade-confirm__keep-tag {
  flex-shrink: 0;
  font-size: 10.5px;
  font-style: italic;
  color: var(--wp-text-dim, var(--wp-text3, #8a8a93));
  white-space: nowrap;
}
.wp-cascade-confirm__strip {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}
.wp-cascade-confirm__strip-text {
  cursor: pointer;
  user-select: none;
  font-size: 11px;
  color: var(--wp-text-dim, var(--wp-text3, #8a8a93));
  white-space: nowrap;
}
.wp-cascade-confirm__row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border: 1px solid var(--wp-border, #38383f);
  border-radius: 6px;
  background: var(--wp-bg2, var(--wp-color-surface-2, #25252a));
  min-width: 0;
}
.wp-cascade-confirm__row .wp-row-type-icon {
  width: 22px;
  height: 22px;
}
.wp-cascade-confirm__row .wp-row-type-icon .pi {
  font-size: 12px;
}
.wp-cascade-confirm__row .wp-row-name {
  display: flex;
  flex-direction: row;
  align-items: baseline;
  gap: 9px;
  min-width: 0;
  flex: 1;
}
.wp-cascade-confirm__row .wp-row-name__text {
  font-weight: 500;
  color: var(--wp-text);
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wp-cascade-confirm__row .wp-id {
  font-family: var(--wp-font-mono, ui-monospace, Menlo, monospace);
  font-size: 10px;
  color: var(--wp-text-dim, var(--wp-text3, #8a8a93));
  font-weight: 500;
  flex-shrink: 0;
}
.wp-cascade-confirm__row .wp-mod-badge {
  margin-left: auto;
  font-weight: 700;
  font-size: 9.5px;
  line-height: 1;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  padding: 3px 7px;
  border-radius: 999px;
  flex-shrink: 0;
}
/* Kind-tinted badges — same color family as the icon tile so badge +
 * tile read together. Color-mix at 18% bg / 100% fg matches the
 * `.wp-row-type-icon--<kind>` formula in row-primitives.css. */
.wp-mod-badge--kind-wildcard {
  background: color-mix(in oklab, var(--wp-kind-wildcard) 18%, transparent);
  color: var(--wp-kind-wildcard);
}
.wp-mod-badge--kind-fixed {
  background: color-mix(in oklab, var(--wp-kind-fixed) 18%, transparent);
  color: var(--wp-kind-fixed);
}
.wp-mod-badge--kind-combine {
  background: color-mix(in oklab, var(--wp-kind-combine) 18%, transparent);
  color: var(--wp-kind-combine);
}
.wp-mod-badge--kind-derivation {
  background: color-mix(in oklab, var(--wp-kind-derivation) 18%, transparent);
  color: var(--wp-kind-derivation);
}
.wp-mod-badge--kind-constraint {
  background: color-mix(in oklab, var(--wp-kind-constraint) 18%, transparent);
  color: var(--wp-kind-constraint);
}
.wp-mod-badge--kind-bundle {
  background: color-mix(in oklab, var(--wp-bundle-default, #6366f1) 18%, transparent);
  color: var(--wp-bundle-default, #6366f1);
}
.wp-mod-badge--kind-category {
  background: color-mix(in oklab, var(--wp-text-muted, #8a8a93) 18%, transparent);
  color: var(--wp-text-muted, #8a8a93);
}
</style>
