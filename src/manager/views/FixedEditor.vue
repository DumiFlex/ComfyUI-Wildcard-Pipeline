<script setup lang="ts">
/**
 * FixedEditor — Wave 4 port of `FixedValuesEditor` in `screens/editors.jsx`.
 *
 * Sections:
 *  1. Identity
 *  2. Values rows ($name + value Textarea + remove)
 *
 * Validation enforces unique, identifier-clean `$name` per row.
 */
import { computed, onMounted, ref } from "vue";
import type { BreadcrumbItem } from "../components/Breadcrumb.types";
import type { SaveState } from "../components/EditorFrame.types";
import { useRouter } from "vue-router";
import EditorFrame from "../components/EditorFrame.vue";
import IdentityCard from "../components/IdentityCard.vue";
import Card from "../components/ui/Card.vue";
import Button from "../components/ui/Button.vue";
import CommunityRowActions from "../components/CommunityRowActions.vue";
import DraftBanner from "../components/DraftBanner.vue";
import RichTextInput from "../components/RichTextInput.vue";
import BulkAddPanel from "../components/BulkAddPanel.vue";
import BulkDeleteToolbar from "../components/BulkDeleteToolbar.vue";
import Checkbox from "../components/ui/Checkbox.vue";
import { useBulkSelection } from "../composables/useBulkSelection";
import type { ParsedFixedValue } from "../utils/bulkParse";
import ConfirmDialog from "../../components/shared/ConfirmDialog.vue";
import { useToast } from "../composables/useToast";
import { useUnsavedGuard } from "../composables/useUnsavedGuard";
import { moveSelected, nudge, type MoveTarget } from "../utils/option-list-ops";
import { useEditorShortcuts } from "../composables/useEditorShortcuts";
import { useEditorDraft } from "../composables/useEditorDraft";
import { useReturnTo } from "../composables/useReturnTo";
import { useModuleStore } from "../stores/moduleStore";
import { useCategoryStore } from "../stores/categoryStore";
import { useRecentStore } from "../stores/recentStore";
import { isValidVariableName } from "../validation/names";
import { appendSnapshot, readHistory } from "../utils/history";
import { useCascadeStore } from "../cascade/cascade-store";
import { useCascadeApply } from "../cascade/useCascadeApply";
import CascadeConfirmDialog from "../cascade/CascadeConfirmDialog.vue";
import PillCountBadge from "../cascade/PillCountBadge.vue";
import type { ModuleHistoryEntry } from "../api/types";

interface NamedValue { id: string; name: string; value: string; }

const props = defineProps<{ id?: string }>();
const router = useRouter();
const moduleStore = useModuleStore();
const currentRow = computed(() =>
  props.id ? moduleStore.catalog.find((m) => m.id === props.id) ?? null : null,
);
const categoryStore = useCategoryStore();
const toast = useToast();
const recent = useRecentStore();
const { resolveReturnTo } = useReturnTo();
const cascade = useCascadeStore();
const cascadeApply = useCascadeApply();

const cascadeDialogOpen = ref(false);

const cascadeRefs = computed(() => {
  if (!props.id) return [];
  return cascade.refsTo("fixed_values", props.id);
});

async function onEntityDeleteClick(): Promise<void> {
  if (!props.id) return;
  // Always confirm — see WildcardEditor for the rationale.
  cascadeDialogOpen.value = true;
}

function onCascadeDialogConfirmed(result: { undo_entry_id: string; affected_count: number }): void {
  cascadeDialogOpen.value = false;
  moduleStore.remove(props.id!);
  const undoId = result.undo_entry_id;
  const count = result.affected_count;
  toast.push({
    severity: "success",
    summary: `"${name.value}" deleted`,
    detail: count > 0 ? `Updated ${count} reference${count === 1 ? "" : "s"}` : undefined,
    life: 5000,
    action: {
      label: "Undo",
      run: async () => {
        const undoResult = await cascadeApply.undo(undoId);
        if (!undoResult.ok) {
          toast.push({ severity: "error", summary: "Undo failed", detail: undoResult.error, life: 4000 });
        } else {
          toast.push({ severity: "info", summary: `"${name.value}" restored`, life: 3000 });
        }
      },
    },
  });
  router.push(resolveReturnTo("/fixed-values"));
}

const name = ref("");
const description = ref("");
const categoryId = ref<string | null>(null);
const tags = ref<string[]>([]);
const contentRating = ref<"safe" | "nsfw">("safe");
const values = ref<NamedValue[]>([
  { id: `val_${Math.random().toString(16).slice(2, 8)}`, name: "", value: "" },
  { id: `val_${Math.random().toString(16).slice(2, 8)}`, name: "", value: "" },
]);
const saving = ref(false);
const saveState = ref<SaveState>("idle");
const saveError = ref<string>("");
let saveStateTimer: ReturnType<typeof setTimeout> | null = null;

function setSaveState(next: SaveState, ttl?: number): void {
  if (saveStateTimer) { clearTimeout(saveStateTimer); saveStateTimer = null; }
  saveState.value = next;
  if (ttl && (next === "saved" || next === "error")) {
    saveStateTimer = setTimeout(() => {
      if (saveState.value === next) saveState.value = "idle";
    }, ttl);
  }
}
const isEdit = computed(() => !!props.id);
const historyEntries = ref<ModuleHistoryEntry[]>([]);

// Unsaved-changes guard
const baseline = ref<string>("");

function snapshot(): string {
  return JSON.stringify({
    name: name.value,
    description: description.value,
    categoryId: categoryId.value,
    tags: tags.value,
    values: values.value,
  });
}

/**
 * Bulk-add has un-added text sitting in its box.
 *
 * Reported repeatedly: users hit the PAGE's Save or Cancel instead of the
 * panel's own "Add options" / Cancel, because the page pair is larger and in
 * the familiar place — and the typed batch was silently thrown away. Two
 * guards, no new dialog for the common case:
 *   - Save is greyed while the panel is open, with a tooltip saying why, so
 *     the only Save-shaped thing that responds is the panel's own commit.
 *   - The un-added text counts as unsaved work, so the existing route guard
 *     already covers Cancel, the back link and any other navigation. Only the
 *     wording changes.
 */
const bulkPending = ref(false);

const { showConfirm, dirty, onConfirmLeave, onCancelLeave } = useUnsavedGuard(
  () => bulkPending.value || snapshot() !== baseline.value,
);

const draft = useEditorDraft({
  kind: "fixed_values",
  id: props.id ?? "new",
  dirty,
  snapshot,
});

function applyDraft(): void {
  const snap = draft.restore();
  if (!snap) return;
  try {
    const parsed = JSON.parse(snap) as {
      name: string;
      description: string;
      categoryId: string | null;
      tags: string[];
      values: NamedValue[];
    };
    name.value = parsed.name;
    description.value = parsed.description;
    categoryId.value = parsed.categoryId;
    tags.value = parsed.tags;
    values.value = parsed.values;
  } catch {
    toast.push({ severity: "error", summary: "Draft restore failed", life: 3000 });
  }
}

onMounted(async () => {
  await Promise.all([categoryStore.fetchAll(), moduleStore.fetchCatalog()]);
  if (props.id) {
    try {
      const row = await moduleStore.get(props.id);
      name.value = row.name;
      description.value = row.description;
      categoryId.value = row.category_id;
      tags.value = row.tags;
      contentRating.value = row.content_rating ?? "safe";
      const rows = (row.payload as { values?: NamedValue[] }).values ?? [];
      values.value = rows.map((v) => ({
        id: v.id,
        name: (v.name ?? "").replace(/^\$+/, ""),
        value: v.value ?? "",
      }));
      historyEntries.value = readHistory(row.payload);
      recent.push({ id: props.id, kind: "fixed_values", name: name.value });
    } catch {
      toast.push({ severity: "error", summary: "Module not found" });
      router.replace("/fixed-values");
    }
  }
  baseline.value = snapshot();
});

function addValue() {
  values.value.push({
    id: `val_${Math.random().toString(16).slice(2, 8)}`,
    name: "",
    value: "",
  });
}
function removeValue(idx: number) { values.value.splice(idx, 1); }

/* ── Bulk add ───────────────────────────────────────────────────────────
 * Inline paste panel: `name = value` per line. Existing names update in
 * place; new names append. Names are sanitised to the same identifier rule
 * the per-row input enforces (`onVarInput`). */
/* ── Search + reorder ───────────────────────────────────────────────── */

/**
 * Text filter over BOTH halves of a row.
 *
 * A fixed-values module is a list of `name → value` pairs, and you look for
 * either: the binding you are about to reference, or the text you remember
 * writing. Matching only one of them would send you back to scrolling half
 * the time. There is no tag filter here — these rows carry no tags.
 */
const fvQuery = ref("");
const fvFilterActive = computed(() => fvQuery.value.trim().length > 0);

/** Rows to render, each keeping its ORIGINAL index: every row action —
 *  `rowErrors[idx]`, the `fv-row-${idx}` hooks — addresses by position. */
const visibleValueRows = computed<{ v: NamedValue; idx: number }[]>(() => {
  const pairs = values.value.map((v, idx) => ({ v, idx }));
  const q = fvQuery.value.trim().toLowerCase();
  if (!q) return pairs;
  return pairs.filter(({ v }) =>
    v.name.toLowerCase().includes(q) || v.value.toLowerCase().includes(q));
});

/** Index of the row being dragged, and the one the drop line sits on. */
const fvDragFrom = ref<number | null>(null);
const fvDragOver = ref<number | null>(null);

function onFvDragStart(i: number, ev: DragEvent): void {
  // Never while filtered: a drop between two visible rows says nothing about
  // the hidden rows between them.
  if (fvFilterActive.value) { ev.preventDefault(); return; }
  fvDragFrom.value = i;
  ev.dataTransfer?.setData("text/plain", String(i));
  if (ev.dataTransfer) ev.dataTransfer.effectAllowed = "move";
}
function onFvDragEnd(): void { fvDragFrom.value = null; fvDragOver.value = null; }
function onFvDragOver(i: number, ev: DragEvent): void {
  if (fvDragFrom.value === null) return;
  ev.preventDefault();
  fvDragOver.value = i;
}
function onFvDrop(i: number): void {
  const from = fvDragFrom.value;
  onFvDragEnd();
  if (from === null || from === i) return;
  const row = values.value[from];
  const target = values.value[i];
  if (!row) return;
  values.value = target
    ? moveSelected(values.value, new Set([row.id]), { to: "before", id: target.id })
    : moveSelected(values.value, new Set([row.id]), { to: "bottom" });
}
function nudgeValue(id: string, dir: -1 | 1): void {
  values.value = nudge(values.value, id, dir);
}

/** Bulk moves. Unlike a drag these stay exact under a filter, because their
 *  destination is absolute rather than relative to rows you cannot see. */
function moveValuesTo(target: MoveTarget): void {
  const ids = new Set(bulk.selectedIds());
  if (ids.size === 0) return;
  values.value = moveSelected(values.value, ids, target);
  // A scattered selection lands as one contiguous block — the only coherent
  // answer, but a surprise the first time, so it is reported rather than left
  // to be discovered.
  const where = target.to === "top" ? "to the top" : "to the bottom";
  toast.push({
    severity: "success",
    summary: `Moved ${ids.size} value${ids.size === 1 ? "" : "s"} ${where}`,
    life: 2500,
  });
}

const bulkAddOpen = ref(false);
const existingValueNames = computed(() =>
  values.value.map((v) => v.name).filter((n) => n.trim().length > 0),
);
function commitBulkValues(parsed: ParsedFixedValue[]): void {
  let updated = 0;
  let added = 0;
  for (const p of parsed) {
    const cleanName = p.name.replace(/[^a-zA-Z0-9_]/g, "");
    if (!cleanName) continue;
    const existing = values.value.find((v) => v.name.toLowerCase() === cleanName.toLowerCase());
    if (existing) {
      existing.value = p.value;
      updated += 1;
    } else {
      values.value.push({ id: `val_${Math.random().toString(16).slice(2, 8)}`, name: cleanName, value: p.value });
      added += 1;
    }
  }
  bulkAddOpen.value = false;
  toast.push({ severity: "success", summary: `${added} added, ${updated} updated`, life: 2500 });
}

/* ── Bulk select + delete ────────────────────────────────────────────────
 * Multi-select value rows to delete many at once (the bulk-ADD panel above
 * stays independent). Selection keys off each row's stable `id`. */
const bulk = useBulkSelection(() => values.value.map((v) => v.id));
const {
  active: bulkActive,
  count: bulkCount,
  allSelected: bulkAllSelected,
  someSelected: bulkSomeSelected,
  isSelected: bulkIsSelected,
  toggle: bulkToggle,
  toggleAll: bulkToggleAll,
  toggleMode: bulkToggleMode,
  clear: bulkClear,
} = bulk;
function deleteSelectedValues(): void {
  const ids = new Set(bulk.selectedIds());
  if (ids.size === 0) return;
  const removed = ids.size;
  values.value = values.value.filter((v) => !ids.has(v.id));
  bulkClear();
  toast.push({
    severity: "success",
    summary: `${removed} value${removed === 1 ? "" : "s"} deleted`,
    life: 2500,
  });
}

function onVarInput(idx: number, raw: string) {
  values.value[idx].name = (raw ?? "").replace(/[^a-zA-Z0-9_]/g, "");
}

const rowErrors = computed<string[]>(() => {
  const errs: string[] = [];
  const counts = new Map<string, number>();
  for (const v of values.value) {
    const n = v.name.trim();
    counts.set(n, (counts.get(n) ?? 0) + 1);
  }
  for (const v of values.value) {
    const n = v.name.trim();
    if (!n) { errs.push("Required"); continue; }
    if (!isValidVariableName(n)) { errs.push("Invalid identifier"); continue; }
    if ((counts.get(n) ?? 0) > 1) { errs.push("Duplicate name"); continue; }
    errs.push("");
  }
  return errs;
});
const hasRowErrors = computed(() => rowErrors.value.some((e) => e !== ""));

function applyRestore(entry: ModuleHistoryEntry): void {
  name.value = entry.name;
  description.value = entry.description ?? "";
  categoryId.value = entry.category_id ?? null;
  tags.value = entry.tags ? [...entry.tags] : [];
  const rows = ((entry.payload ?? {}) as { values?: NamedValue[] }).values ?? [];
  values.value = rows.map((v) => ({
    id: v.id,
    name: (v.name ?? "").replace(/^\$+/, ""),
    value: v.value ?? "",
  }));
  toast.push({
    severity: "info",
    summary: "Version restored",
    detail: `Restored from ${new Date(entry.saved_at).toLocaleString()}; click Save to commit.`,
    life: 4000,
  });
}

async function save() {
  if (!name.value.trim()) {
    toast.push({ severity: "warn", summary: "Name required" });
    return;
  }
  if (hasRowErrors.value) {
    toast.push({
      severity: "warn",
      summary: "Fix invalid value rows",
      detail: "Each row needs a unique, valid `$name` identifier.",
      life: 3000,
    });
    return;
  }
  setSaveState("saving");
  saving.value = true;
  try {
    const payload = { values: values.value } as Record<string, unknown>;
    if (isEdit.value && props.id) {
      const prev = await moduleStore.get(props.id);
      const nextHistory = appendSnapshot(
        {
          name: prev.name,
          description: prev.description,
          category_id: prev.category_id,
          tags: prev.tags,
          payload: prev.payload as Record<string, unknown>,
        },
        prev.payload as Record<string, unknown>,
      );
      await moduleStore.update(props.id, {
        name: name.value, description: description.value,
        category_id: categoryId.value, tags: tags.value,
        payload: { ...payload, history: nextHistory },
        content_rating: contentRating.value,
      });
      historyEntries.value = nextHistory;
      recent.push({ id: props.id, kind: "fixed_values", name: name.value });
    } else {
      // New mode: the new row id is not surfaced here; mount-time push fires
      // next time the user opens this item.
      await moduleStore.create({
        type: "fixed_values",
        name: name.value, description: description.value,
        category_id: categoryId.value, tags: tags.value, payload,
        content_rating: contentRating.value,
      });
    }
    draft.discard();
    setSaveState("saved", 1500);
    baseline.value = snapshot();
    toast.push({
      severity: "success",
      summary: isEdit.value ? "Saved" : "Created",
      detail: name.value,
    });
    router.push(resolveReturnTo("/fixed-values"));
  } catch (e) {
    saveError.value = e instanceof Error ? e.message : String(e);
    setSaveState("error", 3000);
    toast.push({ severity: "error", summary: "Save failed", detail: saveError.value, life: 4000 });
  } finally {
    saving.value = false;
  }
}

function cancel() { router.push(resolveReturnTo("/fixed-values")); }

useEditorShortcuts({
  onSave: () => save(),
  onCancel: () => cancel(),
  enabled: () => !saving.value,
});

const breadcrumb = computed<BreadcrumbItem[]>(() => [
  { to: "/dashboard", label: "Library" },
  { to: "/fixed-values", label: "Fixed Values" },
  { label: isEdit.value ? (name.value || "Editing") : "New fixed values" },
]);
</script>

<template>
  <EditorFrame
    :save-disabled="bulkAddOpen"
    save-disabled-reason="Finish or cancel the bulk add first — use its own Add / Cancel buttons"
    :title="isEdit ? 'Edit fixed values' : 'New fixed values'"
    back-route="/fixed-values"
    back-label="Fixed Values"
    :breadcrumb="breadcrumb"
    :saving="saving"
    :save-state="saveState"
    :save-error="saveError"
    :dirty="dirty"
    :history-entries="historyEntries"
    @save="save"
    @cancel="cancel"
    @restore="applyRestore"
  >
    <template #draft-banner>
      <DraftBanner
        :has-draft="draft.hasDraft.value"
        :age-ms="draft.draftAge.value"
        @restore="applyDraft"
        @discard="draft.discard"
      />
    </template>
    <template v-if="isEdit" #header-extra>
      <span v-if="cascadeRefs.length > 0" class="wp-editor-used-by">
        used by <PillCountBadge :count="cascadeRefs.length" />
      </span>
      <CommunityRowActions
        v-if="currentRow"
        :row="currentRow"
        kind="module"
        labeled
      />
    </template>
    <template v-if="isEdit" #footer-left>
      <Button
        variant="ghost"
        icon="pi-trash"
        class="wp-btn--danger"
        data-test="fv-delete-btn"
        @click="onEntityDeleteClick"
      >Delete</Button>
    </template>
    <IdentityCard
      :name="name"
      :description="description"
      :category-id="categoryId"
      :tags="tags"
      :content-rating="contentRating"
      @update:name="(v) => (name = v)"
      @update:description="(v) => (description = v)"
      @update:category-id="(v) => (categoryId = v)"
      @update:tags="(v) => (tags = v)"
      @update:content-rating="(v) => (contentRating = v)"
    />

    <Card :title="`Values (${values.length})`" :padding="false" sticky-header>
      <template #actions>
        <!-- Same single row as the wildcard options list: the filter and the
             count act on the same table as the buttons beside them. No tag
             filter here — these rows carry no tags — so the text box searches
             BOTH halves of a row, the binding and the content, because you
             look for either. -->
        <div v-if="values.length > 8" class="fv-filter">
          <label class="fv-filter__search" :class="{ 'fv-filter__search--on': fvQuery.length > 0 }">
            <i class="pi pi-search" aria-hidden="true" />
            <input
              v-model="fvQuery"
              type="text"
              :placeholder="`Filter ${values.length} values…`"
              aria-label="Filter values"
              spellcheck="false"
              autocomplete="off"
              data-test="fv-search"
            />
            <button
              v-if="fvQuery"
              type="button"
              class="fv-filter__clearx"
              aria-label="Clear filter"
              @click="fvQuery = ''"
            ><i class="pi pi-times" aria-hidden="true" /></button>
          </label>
          <span class="fv-filter__count" data-test="fv-count">
            <template v-if="fvFilterActive">
              <span class="fv-filter__n" :data-zero="visibleValueRows.length === 0 ? '' : null">
                {{ visibleValueRows.length }} of {{ values.length }}
              </span>
              <button type="button" class="fv-filter__clear" data-test="fv-clear" @click="fvQuery = ''">Clear</button>
            </template>
            <span v-else class="fv-filter__idle">{{ values.length }} values</span>
          </span>
        </div>
        <Button
          size="sm"
          :variant="bulkActive ? 'secondary' : 'ghost'"
          icon="pi-check-square"
          data-test="fv-bulk-toggle"
          @click="bulkToggleMode"
        >{{ bulkActive ? "Done" : "Bulk edit" }}</Button>
        <Button
          size="sm"
          :variant="bulkAddOpen ? 'secondary' : 'ghost'"
          icon="pi-clipboard"
          data-test="fv-bulk-add"
          @click="bulkAddOpen = !bulkAddOpen"
        >Bulk add</Button>
        <Button size="sm" variant="primary" icon="pi-plus" data-test="fv-add" @click="addValue">
          Add value
        </Button>
      </template>
      <template #subheader>
      <div v-if="bulkAddOpen || (bulkActive && bulkCount > 0)" class="wpc-bulk-controls">
        <BulkAddPanel
          v-if="bulkAddOpen"
          mode="values"
          :existing-values="existingValueNames"
          @commit-values="commitBulkValues"
          @cancel="bulkAddOpen = false"
          @update:pending="(v: boolean) => (bulkPending = v)"
        />
        <BulkDeleteToolbar
          v-if="bulkActive && bulkCount > 0"
          :count="bulkCount"
          noun="values"
          reorderable
          @move-top="moveValuesTo({ to: 'top' })"
          @move-bottom="moveValuesTo({ to: 'bottom' })"
          @delete-selected="deleteSelectedValues"
          @clear="bulkClear"
        />
      </div>
      </template>
      <table class="wp-table wp-options-table">
        <thead>
          <tr>
            <th v-if="bulkActive" scope="col" class="fv-col-check">
              <Checkbox
                :model-value="bulkAllSelected"
                :indeterminate="bulkSomeSelected"
                aria-label="Select all values"
                data-test="fv-bulk-select-all"
                @update:model-value="bulkToggleAll"
              />
            </th>
            <th scope="col" class="fv-col-grip"><span class="wp-sr-only">Reorder</span></th>
            <th class="fv-col-var">Variable</th>
            <th>Value</th>
            <th class="fv-col-trash" />
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="{ v, idx } in visibleValueRows"
            :key="v.id"
            :data-test="`fv-row-${idx}`"
            :data-invalid="rowErrors[idx] ? 'true' : 'false'"
            :class="{
              'fv-row--selected': bulkActive && bulkIsSelected(v.id),
              'fv-row--dragging': fvDragFrom === idx,
              'fv-row--dropbefore': fvDragOver === idx && fvDragFrom !== null && fvDragFrom !== idx,
            }"
            @dragover="onFvDragOver(idx, $event)"
            @drop.prevent="onFvDrop(idx)"
          >
            <td class="fv-col-grip">
              <!-- Same affordance as the wildcard options list: its own cell,
                   because the value beside it is a contenteditable and a
                   press-and-move over that is a text selection. -->
              <button
                type="button"
                class="fv-grip"
                :disabled="fvFilterActive || undefined"
                :title="fvFilterActive
                  ? 'Dragging is off while a filter is active — use Bulk edit ▸ Top / Bottom'
                  : 'Drag to reorder · Alt+↑/↓ to move one step'"
                :aria-label="`Reorder ${v.name || 'value'}`"
                :data-test="`fv-grip-${idx}`"
                draggable="true"
                @dragstart="onFvDragStart(idx, $event)"
                @dragend="onFvDragEnd"
                @keydown.alt.up.prevent="nudgeValue(v.id, -1)"
                @keydown.alt.down.prevent="nudgeValue(v.id, 1)"
              ><i class="pi pi-bars" aria-hidden="true" /></button>
            </td>
            <td v-if="bulkActive" class="fv-col-check">
              <button
                type="button"
                class="wp-check"
                role="checkbox"
                :aria-checked="bulkIsSelected(v.id)"
                :data-checked="bulkIsSelected(v.id) ? 'true' : 'false'"
                :aria-label="`Select value ${idx + 1}`"
                :data-test="`fv-check-${idx}`"
                @click="bulkToggle(v.id)"
              >
                <svg v-if="bulkIsSelected(v.id)" viewBox="0 0 12 12" fill="none" style="display:block">
                  <path d="M3 6.2l2.2 2.2L9 4.4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
              </button>
            </td>
            <td>
              <div class="wp-input-group">
                <span class="wp-input-group__addon">$</span>
                <input
                  class="wp-input"
                  :value="v.name"
                  placeholder="varname"
                  aria-label="Variable name"
                  :data-test="`fv-row-${idx}-name`"
                  @input="onVarInput(idx, ($event.target as HTMLInputElement).value)"
                />
              </div>
              <p
                v-if="rowErrors[idx]"
                class="fv-row__err"
                :data-test="`fv-row-${idx}-err`"
              >{{ rowErrors[idx] }}</p>
            </td>
            <td>
              <!-- `wrap` rather than a fixed 2-row `multiline` box: values run
                   from one word to an entire paragraph, so the field starts at
                   one row, grows to fit, caps at 40vh then scrolls, and offers
                   a manual resize handle. A fixed height either wasted space or
                   hid most of a long value. -->
              <RichTextInput
                v-model="v.value"
                surface="fixed_values"
                wrap
                placeholder="value"
                :aria-label="`Variable value for row ${idx}`"
                :data-test="`fv-row-${idx}-value`"
              />
            </td>
            <td>
              <Button
                size="sm"
                variant="ghost"
                icon="pi-trash"
                class="wp-btn--danger"
                aria-label="Remove value"
                @click="removeValue(idx)"
              />
            </td>
          </tr>
          <tr v-if="!values.length">
            <td :colspan="bulkActive ? 4 : 3" class="opt-empty">No values yet.</td>
          </tr>
          <tr v-if="fvFilterActive && visibleValueRows.length === 0">
            <td :colspan="bulkActive ? 5 : 4" class="fv-filter__empty" data-test="fv-noresults">
              <b>No value matches this filter</b>
              All {{ values.length }} are still here — only the view is filtered.
              <button type="button" class="fv-filter__clear" @click="fvQuery = ''">Clear filter</button>
            </td>
          </tr>
        </tbody>
      </table>
    </Card>
    <!-- CascadeConfirmDialog: shown when entity has downstream refs. -->
    <CascadeConfirmDialog
      v-if="isEdit && props.id"
      :open="cascadeDialogOpen"
      kind="fixed_values"
      :id="props.id"
      action="delete"
      @confirmed="onCascadeDialogConfirmed"
      @cancelled="cascadeDialogOpen = false"
    />
    <!-- ConfirmDialog inside EditorFrame to keep template single-root;
         see WildcardEditor for the multi-root Transition explanation. -->
    <ConfirmDialog
      :visible="showConfirm"
      :title="bulkPending ? 'Discard un-added values?' : 'Discard unsaved changes?'"
      :body="bulkPending
        ? 'The bulk add box still holds values you have not added. Leaving discards them.'
        : 'You have unsaved edits. Leaving this page will discard them.'"
      confirm-label="Discard & leave"
      cancel-label="Stay"
      variant="danger"
      @confirm="onConfirmLeave"
      @cancel="onCancelLeave"
    />
  </EditorFrame>
</template>

<style scoped>
.wp-editor-used-by {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: var(--wp-text-xs);
  color: var(--wp-text-muted);
}
.fv-col-var { width: 220px; }
.fv-col-check { width: 34px; text-align: center; }
.fv-row--selected > td { background: color-mix(in oklab, var(--wp-accent) 8%, transparent); }
.wpc-bulk-controls {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 16px 14px;
}
.fv-col-trash { width: 40px; }
.fv-row__err {
  font-size: var(--wp-text-xs);
  color: var(--wp-danger);
  margin: var(--wp-space-2) 0 0;
}
.opt-empty {
  text-align: center;
  padding: var(--wp-space-6);
  color: var(--wp-text-dim);
}

/* ── Filter + reorder ───────────────────────────────────────────────── */
.fv-filter {
  display: flex;
  align-items: center;
  gap: var(--wp-space-4);
  flex: 1;
  min-width: 0;
  margin-right: var(--wp-space-4);
}
.fv-filter__search {
  display: flex;
  align-items: center;
  gap: var(--wp-space-3);
  flex: 1 1 auto;
  min-width: 90px;
  padding: 3px var(--wp-space-4); /* audit-exempt: compact inline search */
  background: var(--wp-bg-1);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius-sm);
  color: var(--wp-text-dim);
}
.fv-filter__search--on {
  border-color: var(--wp-accent-500);
  box-shadow: 0 0 0 3px color-mix(in oklab, var(--wp-accent-500) 20%, transparent);
}
.fv-filter__search .pi { font-size: 11px; }
.fv-filter__search input {
  flex: 1;
  min-width: 0;
  background: none;
  border: none;
  outline: none;
  color: var(--wp-text);
  font: 12px var(--wp-font-mono);
}
.fv-filter__clearx {
  background: none; border: none; padding: 0; cursor: pointer;
  color: var(--wp-text-dim); font-size: 10px;
}
.fv-filter__count {
  display: flex; align-items: center; gap: var(--wp-space-3);
  font-size: 11px; white-space: nowrap;
}
.fv-filter__n {
  font-family: var(--wp-font-mono); font-variant-numeric: tabular-nums;
  font-weight: 600; color: var(--wp-success);
}
.fv-filter__n[data-zero] { color: var(--wp-danger); }
.fv-filter__idle { color: var(--wp-text-dim); font-family: var(--wp-font-mono); }
.fv-filter__clear {
  background: none; border: none; padding: 0; cursor: pointer;
  color: var(--wp-text-muted); font: 11px var(--wp-font-sans);
  text-decoration: underline;
}
.fv-filter__empty {
  padding: var(--wp-space-6) var(--wp-space-5);
  text-align: center; color: var(--wp-text-dim); font-size: 12px;
}
.fv-filter__empty b {
  display: block; color: var(--wp-text-muted); font-weight: 600;
  margin-bottom: var(--wp-space-2);
}
.fv-filter__empty .fv-filter__clear { margin-left: var(--wp-space-3); }

.fv-col-grip { width: 26px; }
.fv-grip {
  display: grid; place-items: center;
  width: 18px; height: 22px;
  padding: 0; background: none; border: none;
  border-radius: var(--wp-radius-sm);
  color: var(--wp-text-dim); font-size: 11px;
  cursor: grab; opacity: 0; transition: opacity 0.1s;
}
tr:hover .fv-grip { opacity: 0.7; }
.fv-grip:hover { opacity: 1; background: var(--wp-bg-3); }
.fv-grip:focus-visible { opacity: 1; outline: 2px solid var(--wp-accent-500); outline-offset: 1px; }
.fv-grip:disabled { cursor: not-allowed; }
tr:hover .fv-grip:disabled { opacity: 0.2; }
/* The dragged row stays put, dimmed — pulling it out reflows everything below
   and the drop target moves out from under the cursor. */
.fv-row--dragging > td { opacity: 0.45; background: var(--wp-bg-3); }
.fv-row--dropbefore > td { box-shadow: inset 0 2px 0 var(--wp-accent-500); }
</style>
