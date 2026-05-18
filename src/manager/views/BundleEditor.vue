<script setup lang="ts">
/**
 * BundleEditor — SPA editor for library-tracked bundles.
 *
 * Task 2: interactive children list — drag reorder, enable/disable toggle,
 * duplicate, remove. Children mutations live in a local ref and persist
 * via a single bundles.update PUT on Save. Task 3 adds the right-side
 * snapshot edit pane.
 *
 * Route shape mirrors the other kind editors:
 *   /bundles/new            → create-mode (disabled Save, points user to Context widget)
 *   /bundles/:id/edit       → edit-mode
 */
import { computed, onMounted, ref } from "vue";
import type { BreadcrumbItem } from "../components/Breadcrumb.types";
import { useRouter } from "vue-router";
import EditorFrame from "../components/EditorFrame.vue";
import IdentityCard from "../components/IdentityCard.vue";
import Card from "../components/ui/Card.vue";
import ColorPicker from "../components/ColorPicker.vue";
import BundleChildRow from "../components/BundleChildRow.vue";
import BundleChildPane from "../components/BundleChildPane.vue";
import BundleAddChildModal from "../components/BundleAddChildModal.vue";
import ConfirmDialog from "../../components/shared/ConfirmDialog.vue";
import { useToast } from "../composables/useToast";
import { useUnsavedGuard } from "../composables/useUnsavedGuard";
import { useEditorShortcuts } from "../composables/useEditorShortcuts";
import { useReturnTo } from "../composables/useReturnTo";
import { useBundleStore } from "../stores/bundleStore";
import { useCategoryStore } from "../stores/categoryStore";
import { useModuleStore } from "../stores/moduleStore";
import { useRecentStore } from "../stores/recentStore";
import type { BundleRow, ModuleRow } from "../api/types";
import type { ModuleEntry } from "../../widgets/_shared";

const props = defineProps<{ id?: string }>();

const router = useRouter();
const { resolveReturnTo } = useReturnTo();
const store = useBundleStore();
const categoryStore = useCategoryStore();
const moduleStore = useModuleStore();
const toast = useToast();
const recent = useRecentStore();

const addModalOpen = ref(false);

/** Default bundle frame color when user hasn't picked one. Mirrors the
 *  `--wp-bundle-default` token + ContextWidget fallback so the editor
 *  preview matches the canvas. */
const DEFAULT_COLOR = "#46566B";

const COLOR_PRESETS = [
  "#46566B", "#7c3aed", "#a78bfa", "#22d3ee", "#34d399",
  "#fbbf24", "#f472b6", "#fb7185", "#ef4444", "#6366f1",
  "#10b981", "#f59e0b",
];

const loading = ref(false);
const saving = ref(false);
const original = ref<BundleRow | null>(null);

const name = ref("");
const description = ref("");
const color = ref<string>(DEFAULT_COLOR);
const categoryId = ref<string | null>(null);
const tags = ref<string[]>([]);

/** Mutable local copy of bundle children. Edits in the row stack
 *  (and the side pane in Task 3) update this; Save persists it via PUT. */
const children = ref<Array<Record<string, unknown>>>([]);

/** Last-saved baseline state per child, keyed by id. Used by
 *  BundleChildRow to decide whether to render SNAPSHOT or
 *  SNAPSHOT · EDITED — the pill resets to plain SNAPSHOT after every
 *  successful save (current children become the new baseline). */
const baselineByChildId = ref<Map<string, string>>(new Map());

/** `patchInstance` writes `null` to a field rather than deleting the key
 *  when the user reverts a value back to library default. For the
 *  EDITED diff we want those null overrides to be indistinguishable
 *  from "field never set" — otherwise the pill never clears even when
 *  the user manually returns every field to its starting value. Strip
 *  null/undefined entries from `instance` before serializing. */
function normalizeChild(c: Record<string, unknown>): Record<string, unknown> {
  const inst = c.instance as Record<string, unknown> | undefined;
  if (!inst) return c;
  const cleaned: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(inst)) {
    if (v !== null && v !== undefined) cleaned[k] = v;
  }
  return { ...c, instance: cleaned };
}

function snapshotBaseline(rows: Array<Record<string, unknown>>): Map<string, string> {
  const m = new Map<string, string>();
  for (const c of rows) {
    const id = c.id as string | undefined;
    if (id) m.set(id, JSON.stringify(normalizeChild(c)));
  }
  return m;
}

/** Drag-reorder state. Source index captured on dragstart, target on
 *  dragover. Cleared on drop / cancel. Drives the data-drag-over
 *  styling for the drop-line indicator. */
const dragSourceIdx = ref<number | null>(null);
const dragOverIdx = ref<number | null>(null);

/** Side-pane selection — null when no child is being edited. */
const selectedChildId = ref<string | null>(null);

const isEdit = computed(() => !!props.id);

// Unsaved-changes guard
const bundleBaseline = ref<string>("");

function bundleSnapshot(): string {
  return JSON.stringify({
    name: name.value,
    description: description.value,
    color: color.value,
    categoryId: categoryId.value,
    tags: tags.value,
    children: children.value.map(normalizeChild),
  });
}

const { showConfirm, dirty, onConfirmLeave, onCancelLeave } = useUnsavedGuard(
  () => bundleSnapshot() !== bundleBaseline.value,
);

const selectedChild = computed<Record<string, unknown> | null>(() => {
  const id = selectedChildId.value;
  if (!id) return null;
  return children.value.find((c) => (c.id as string) === id) ?? null;
});

const selectedChildIdx = computed<number>(() => {
  const id = selectedChildId.value;
  if (!id) return -1;
  return children.value.findIndex((c) => (c.id as string) === id);
});

/** Set of child ids whose current normalized state diverges from the
 *  last-saved baseline. Drives the SNAPSHOT · EDITED pill on each row.
 *  Recomputes reactively as children mutate, so reverting overrides
 *  back to baseline (even via "no override" null writes) clears the
 *  pill without an explicit reset. */
const editedChildIds = computed<Set<string>>(() => {
  const out = new Set<string>();
  for (const c of children.value) {
    const id = c.id as string | undefined;
    if (!id) continue;
    const base = baselineByChildId.value.get(id);
    if (base === undefined) {
      out.add(id); // new row, no baseline yet
      continue;
    }
    if (JSON.stringify(normalizeChild(c)) !== base) out.add(id);
  }
  return out;
});

const childrenSubtitle = computed<string>(() => {
  if (!selectedChildId.value || !selectedChild.value) {
    return "Frozen snapshots — click row to edit on the right.";
  }
  const meta = selectedChild.value.meta as { name?: string } | undefined;
  const name = meta?.name ?? "(unnamed)";
  return `Editing snapshot of ${name} — click × on the pane to close`;
});

onMounted(async () => {
  await categoryStore.fetchAll();
  // Catalog load powers the add-child library picker AND
  // ConstraintMatrixSection's sub-category lookups inside the pane.
  try {
    await moduleStore.fetchCatalog();
  } catch (e) {
    toast.push({ severity: "error", summary: "Failed to load module library", detail: String(e), life: 3000 });
  }
  if (!props.id) {
    bundleBaseline.value = bundleSnapshot();
    return;
  }
  loading.value = true;
  try {
    const row = await store.get(props.id);
    original.value = row;
    name.value = row.name;
    description.value = row.description ?? "";
    color.value = row.color || DEFAULT_COLOR;
    categoryId.value = row.category_id;
    tags.value = [...(row.tags ?? [])];
    children.value = Array.isArray(row.children)
      ? row.children.map((c) => ({ ...(c as Record<string, unknown>) }))
      : [];
    baselineByChildId.value = snapshotBaseline(children.value);
    recent.push({ id: props.id, kind: "bundle", name: name.value });
  } catch (e) {
    toast.push({ severity: "error", summary: "Load failed", detail: String(e), life: 4000 });
  } finally {
    loading.value = false;
  }
  bundleBaseline.value = bundleSnapshot();
});

function cancel() {
  router.push(resolveReturnTo("/bundles"));
}

// BundleEditor deliberately does not redirect on save. Bundles are edited
// iteratively (add children, reorder, recolor); jumping back to the list
// after every save would force the user to re-enter the editor for each
// tweak. cancel() uses resolveReturnTo for the explicit-exit path.
async function save() {
  if (!isEdit.value || !props.id) {
    toast.push({
      severity: "info",
      summary: "Create from Context",
      detail: "New bundles are created by wrapping modules in the Context widget.",
      life: 4000,
    });
    return;
  }
  if (!name.value.trim()) {
    toast.push({ severity: "warn", summary: "Name required", life: 2500 });
    return;
  }
  saving.value = true;
  try {
    const colorOut = color.value === DEFAULT_COLOR ? null : color.value;
    const updated = await store.update(props.id, {
      name: name.value.trim(),
      description: description.value,
      color: colorOut,
      category_id: categoryId.value,
      tags: [...tags.value],
      children: children.value.map((c) => ({ ...c })),
    });
    original.value = updated;
    children.value = Array.isArray(updated.children)
      ? updated.children.map((c) => ({ ...(c as Record<string, unknown>) }))
      : [];
    baselineByChildId.value = snapshotBaseline(children.value);
    bundleBaseline.value = bundleSnapshot();
    recent.push({ id: props.id, kind: "bundle", name: updated.name });
    toast.push({ severity: "success", summary: "Saved", detail: updated.name, life: 2000 });
  } catch (e) {
    toast.push({ severity: "error", summary: "Save failed", detail: String(e), life: 4000 });
  } finally {
    saving.value = false;
  }
}

useEditorShortcuts({
  onSave: () => save(),
  onCancel: () => cancel(),
  enabled: () => !saving.value,
});

/** Snapshot a library module into a bundle child entry.
 *
 *  Critical: the snapshot's `id` MUST be the library uuid (`row.id`),
 *  NOT a fresh local id. Bundle insertion at runtime treats the child's
 *  `id` as the library link — Context-side `buildBundleInsertion`
 *  preserves it verbatim, and the engine's drift / missing-from-library
 *  scanners match against it. A random id surfaces every child as
 *  "missing in library" on the ComfyUI side. `meta.library_name`
 *  carries the canonical name so "reset overrides" can restore the
 *  display name without hitting the server (denormalized at snapshot
 *  time). Matches `toChildSnapshot` in ContextWidget for in-graph
 *  Wrap-in-bundle. */
function onAddPick(row: ModuleRow) {
  const snapshot: Record<string, unknown> = {
    id: row.id,
    type: row.type,
    enabled: true,
    collapsed: false,
    meta: { name: row.name, library_name: row.name },
    payload: row.payload ?? {},
    payload_hash: row.payload_hash,
    instance: {},
    entries: [],
  };
  children.value = [...children.value, snapshot];
}

function onToggleChild(idx: number) {
  const next = [...children.value];
  const current = next[idx];
  next[idx] = { ...current, enabled: current.enabled === false };
  children.value = next;
}

function onDuplicateChild(idx: number) {
  const src = children.value[idx];
  if (!src) return;
  // Keep the library uuid — multi-instance bundles intentionally share
  // `id` across siblings (per buildBundleInsertion docs). Per-instance
  // disambiguation lives in `_uid`, which gets stamped on insert into
  // a Context node, not here at bundle-edit time.
  const copy = { ...src };
  const next = [...children.value];
  next.splice(idx + 1, 0, copy);
  children.value = next;
}

function onRemoveChild(idx: number) {
  const removedId = children.value[idx]?.id as string | undefined;
  if (removedId && removedId === selectedChildId.value) {
    selectedChildId.value = null;
  }
  const next = [...children.value];
  next.splice(idx, 1);
  children.value = next;
}

function onSelectChild(idx: number) {
  const c = children.value[idx];
  if (!c) return;
  const id = (c.id as string) ?? null;
  // Toggle off if clicking the already-selected row.
  selectedChildId.value = id === selectedChildId.value ? null : id;
}

function onPaneClose() {
  selectedChildId.value = null;
}

function onPaneUpdate(patch: Partial<ModuleEntry>) {
  const idx = selectedChildIdx.value;
  if (idx < 0) return;
  const next = [...children.value];
  next[idx] = { ...next[idx], ...(patch as Record<string, unknown>) };
  children.value = next;
}

function onDragStart(idx: number, evt: DragEvent) {
  dragSourceIdx.value = idx;
  if (evt.dataTransfer) {
    evt.dataTransfer.effectAllowed = "move";
    // Firefox needs setData for the drag to fire at all.
    evt.dataTransfer.setData("text/plain", String(idx));
  }
}
function onDragOver(idx: number, evt: DragEvent) {
  if (dragSourceIdx.value === null || dragSourceIdx.value === idx) return;
  evt.preventDefault();
  if (evt.dataTransfer) evt.dataTransfer.dropEffect = "move";
  if (dragOverIdx.value !== idx) dragOverIdx.value = idx;
}
function onDragLeave() {
  dragOverIdx.value = null;
}
function onDrop(idx: number, evt: DragEvent) {
  evt.preventDefault();
  const from = dragSourceIdx.value;
  dragSourceIdx.value = null;
  dragOverIdx.value = null;
  if (from === null || from === idx) return;
  const next = [...children.value];
  const [moved] = next.splice(from, 1);
  next.splice(idx, 0, moved);
  children.value = next;
}
function onDragEnd() {
  dragSourceIdx.value = null;
  dragOverIdx.value = null;
}

const breadcrumb = computed<BreadcrumbItem[]>(() => [
  { to: "/dashboard", label: "Library" },
  { to: "/bundles", label: "Bundles" },
  { label: isEdit.value ? (name.value || original.value?.name || "Editing") : "New bundle" },
]);
</script>

<template>
  <EditorFrame
    :title="isEdit ? (original?.name || 'Loading…') : 'New bundle'"
    back-route="/bundles"
    back-label="Bundles"
    :breadcrumb="breadcrumb"
    :saving="saving"
    :dirty="dirty"
    :save-disabled="!isEdit"
    @save="save"
    @cancel="cancel"
  >
    <div v-if="loading" class="wp-dim wp-bundle-editor__loading">Loading bundle…</div>

    <template v-else>
      <IdentityCard
        :name="name"
        :description="description"
        :category-id="categoryId"
        :tags="tags"
        @update:name="(v) => (name = v)"
        @update:description="(v) => (description = v)"
        @update:category-id="(v) => (categoryId = v)"
        @update:tags="(v) => (tags = v)"
      >
        <template #nameLeading>
          <ColorPicker
            v-model="color"
            :presets="COLOR_PRESETS"
            aria-label="Bundle frame color"
          />
        </template>
      </IdentityCard>

      <Card
        :title="`Children (${children.length})`"
        :subtitle="childrenSubtitle"
      >
        <div class="wp-bundle-children-grid">
          <div class="wp-bundle-children-stack" data-test="bundle-children-list">
            <div
              v-if="!children.length"
              class="wp-dim wp-bundle-editor__empty"
            >
              This bundle has no children yet.
            </div>
            <BundleChildRow
              v-for="(child, idx) in children"
              :key="`${(child.id as string) ?? ''}_${idx}`"
              :child="child"
              :idx="idx"
              :selected="(child.id as string) === selectedChildId"
              :edited="editedChildIds.has((child.id as string) ?? '')"
              :class="dragOverIdx === idx ? 'wp-bundle-children-stack__drag-over' : null"
              @toggle="onToggleChild(idx)"
              @duplicate="onDuplicateChild(idx)"
              @remove="onRemoveChild(idx)"
              @select="onSelectChild(idx)"
              @drag-start="(e) => onDragStart(idx, e)"
              @drag-over="(e) => onDragOver(idx, e)"
              @drag-leave="onDragLeave"
              @drop="(e) => onDrop(idx, e)"
              @drag-end="onDragEnd"
            />
            <button
              type="button"
              class="wp-bundle-add-btn"
              data-test="bundle-add-open"
              @click="addModalOpen = true"
            >
              <i class="pi pi-plus" aria-hidden="true" />
              add child from library
            </button>
          </div>
          <BundleChildPane
            :child="selectedChild"
            @update="onPaneUpdate"
            @close="onPaneClose"
          />
        </div>
      </Card>

      <BundleAddChildModal
        :visible="addModalOpen"
        :modules="moduleStore.catalog"
        @close="addModalOpen = false"
        @pick="onAddPick"
      />
    </template>

    <!-- ConfirmDialog inside EditorFrame to keep template single-root;
         see WildcardEditor for the multi-root Transition explanation. -->
    <ConfirmDialog
      :visible="showConfirm"
      title="Discard unsaved changes?"
      body="You have unsaved edits. Leaving this page will discard them."
      confirm-label="Discard & leave"
      cancel-label="Stay"
      variant="danger"
      @confirm="onConfirmLeave"
      @cancel="onCancelLeave"
    />
  </EditorFrame>
</template>

<style scoped>
.wp-bundle-editor__loading { padding: var(--wp-space-8) 0; text-align: center; }
.wp-bundle-editor__empty { padding: var(--wp-space-6) 0; font-size: var(--wp-text-base); }

.wp-bundle-children-grid {
  display: grid;
  grid-template-columns: minmax(380px, 1fr) minmax(420px, 1.4fr);
  gap: var(--wp-space-5);
  align-items: start;
}
.wp-bundle-children-stack {
  display: flex;
  flex-direction: column;
  gap: var(--wp-space-2);
  min-width: 0;
}
.wp-bundle-children-stack__drag-over {
  box-shadow: 0 -2px 0 var(--wp-accent-500);
}
.wp-bundle-add-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--wp-space-4);
  width: 100%;
  padding: var(--wp-space-4);
  margin-top: var(--wp-space-2);
  border: 1px dashed var(--wp-border-strong, var(--wp-border));
  border-radius: var(--wp-radius, 4px);
  background: transparent;
  color: var(--wp-text-dim);
  font-size: var(--wp-text-xs);
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  cursor: pointer;
  transition: border-color 120ms ease, color 120ms ease, background-color 120ms ease;
}
.wp-bundle-add-btn:hover {
  border-style: solid;
  border-color: var(--wp-accent-500);
  color: var(--wp-accent-500);
  background: color-mix(in oklab, var(--wp-accent-500) 7%, transparent);
}
</style>
