<script setup lang="ts">
/**
 * BundleEditor — SPA editor for library-tracked bundles.
 *
 * Scope (post Task 23): editable name, color, category, tags, and a
 * read-only ordered children list. Save handler comes in Task 24.
 *
 * Route shape mirrors the other kind editors:
 *   /bundles/new            → create-mode (no `id` prop, empty form)
 *   /bundles/:id/edit       → edit-mode (`id` injected as prop)
 *
 * Children are displayed read-only with kind chip + name. The library
 * surface of a bundle is its name + color + classification metadata —
 * the children themselves are frozen snapshots, edited via the Context
 * widget (use "Save changes to library" there to push edits back).
 */
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { useToast } from "../composables/useToast";
import Button from "../components/ui/Button.vue";
import Card from "../components/ui/Card.vue";
import Input from "../components/ui/Input.vue";
import Select from "../components/ui/Select.vue";
import ColorPicker from "../components/ColorPicker.vue";
import { useBundleStore } from "../stores/bundleStore";
import { useCategoryStore } from "../stores/categoryStore";
import type { BundleRow } from "../api/types";

const props = defineProps<{ id?: string }>();

const router = useRouter();
const store = useBundleStore();
const categoryStore = useCategoryStore();
const toast = useToast();

/** Default bundle frame color when user hasn't picked one. Mirrors the
 *  `--wp-bundle-default` token + ContextWidget fallback so the editor
 *  preview matches the canvas. */
const DEFAULT_COLOR = "#46566B";

/** Color swatches surfaced in the picker. These mirror the BundlePicker
 *  defaults the user sees when first creating a bundle from Context, so
 *  the SPA and the picker stay visually aligned. The ColorPicker still
 *  accepts arbitrary hex via the input field — these are just one-tap
 *  presets. */
const COLOR_PRESETS = [
  "#46566B", "#7c3aed", "#a78bfa", "#22d3ee", "#34d399",
  "#fbbf24", "#f472b6", "#fb7185", "#ef4444", "#6366f1",
  "#10b981", "#f59e0b",
];

const loading = ref(false);
const saving = ref(false);
const original = ref<BundleRow | null>(null);

// Editable fields — bound to inputs. Saved as a single PUT in Task 24.
const name = ref("");
const description = ref("");
const color = ref<string>(DEFAULT_COLOR);
const categoryId = ref<string | null>(null);
const tags = ref<string[]>([]);
const tagDraft = ref("");

const isEdit = computed(() => !!props.id);

const categoryOptions = computed(() => [
  { value: null, label: "No category" },
  ...categoryStore.items.map((c) => ({ value: c.id, label: c.name, dot: c.color || undefined })),
]);

const children = computed(() => (original.value?.children ?? []) as Array<Record<string, unknown>>);

interface ChildView {
  id: string;
  type: string;
  name: string;
}

/** Project library-side child snapshot to a display row. Children carry
 *  `id`, `type`, and `name` at the top level (the engine reads these
 *  same fields), so the projection is trivial. */
const childRows = computed<ChildView[]>(() =>
  children.value.map((c, i) => ({
    id: String(c.id ?? `child_${i}`),
    type: String(c.type ?? "module"),
    name: String(c.name ?? "(unnamed)"),
  })),
);

onMounted(async () => {
  await categoryStore.fetchAll();
  if (!props.id) return;
  loading.value = true;
  try {
    const row = await store.get(props.id);
    original.value = row;
    name.value = row.name;
    description.value = row.description ?? "";
    color.value = row.color || DEFAULT_COLOR;
    categoryId.value = row.category_id;
    tags.value = [...(row.tags ?? [])];
  } catch (e) {
    toast.push({ severity: "error", summary: "Load failed", detail: String(e), life: 4000 });
  } finally {
    loading.value = false;
  }
});

function back() {
  router.push("/bundles");
}

/** Persist the form to the library entry. Save is metadata-only here
 *  — name, description, color, category, tags. Children are NOT
 *  re-snapshotted by the editor; that's the Context widget's "Save
 *  changes to library" action (which operates on a live in-graph
 *  bundle, not the library entry itself).
 *
 *  Create-mode without children disallowed for now: the SPA "+ New
 *  Bundle" path is intentionally limited — the canonical creation
 *  flow is Wrap-in-bundle from the Context multi-select. The Save
 *  button is disabled in create-mode to surface that constraint
 *  before the user types anything. */
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
    // Color stored as null when user chose the default — keeps the
    // library entry free of a hard-coded value if we ever change the
    // default token, and matches the "color is optional" semantics
    // the BundleRow type encodes.
    const colorOut = color.value === DEFAULT_COLOR ? null : color.value;
    const updated = await store.update(props.id, {
      name: name.value.trim(),
      description: description.value,
      color: colorOut,
      category_id: categoryId.value,
      tags: [...tags.value],
    });
    original.value = updated;
    toast.push({ severity: "success", summary: "Saved", detail: updated.name, life: 2000 });
  } catch (e) {
    toast.push({ severity: "error", summary: "Save failed", detail: String(e), life: 4000 });
  } finally {
    saving.value = false;
  }
}

function addTag() {
  const t = tagDraft.value.trim();
  if (!t) return;
  if (!tags.value.includes(t)) tags.value.push(t);
  tagDraft.value = "";
}

function removeTag(t: string) {
  tags.value = tags.value.filter((x) => x !== t);
}

/** Display label for the kind chip — capitalize the lowercase engine
 *  type so the list reads naturally without forcing a separate label
 *  table. */
function kindLabel(type: string): string {
  if (!type) return "Module";
  return type.charAt(0).toUpperCase() + type.slice(1).replace(/_/g, " ");
}
</script>

<template>
  <div class="wp-bundle-editor">
    <div class="wp-bundle-editor__header">
      <Button variant="ghost" icon="pi-arrow-left" @click="back">Back</Button>
      <h2 class="wp-bundle-editor__title">
        {{ isEdit ? (original?.name || "Loading…") : "New Bundle" }}
      </h2>
      <span class="wp-spacer" />
      <Button
        variant="primary"
        icon="pi-save"
        :disabled="saving || !isEdit"
        :title="isEdit ? 'Save changes' : 'New bundles are created from the Context widget'"
        @click="save"
      >
        {{ saving ? "Saving…" : "Save" }}
      </Button>
    </div>

    <div v-if="loading" class="wp-dim wp-bundle-editor__loading">Loading bundle…</div>

    <div v-else class="wp-bundle-editor__body">
      <Card title="Identity" subtitle="Bundle metadata stored on the library entry.">
        <div class="wp-bundle-form">
          <label class="wp-field">
            <span class="wp-field__label">Name</span>
            <Input v-model="name" placeholder="e.g. Character Pack" aria-label="Bundle name" />
          </label>

          <label class="wp-field">
            <span class="wp-field__label">Description</span>
            <textarea
              v-model="description"
              class="wp-textarea"
              rows="2"
              placeholder="Optional short summary."
              aria-label="Bundle description"
            />
          </label>

          <div class="wp-field-row">
            <label class="wp-field">
              <span class="wp-field__label">Category</span>
              <Select
                :model-value="categoryId"
                :options="categoryOptions"
                placeholder="No category"
                aria-label="Bundle category"
                @update:model-value="(v) => (categoryId = v as string | null)"
              />
            </label>

            <label class="wp-field">
              <span class="wp-field__label">Frame color</span>
              <ColorPicker
                v-model="color"
                :presets="COLOR_PRESETS"
                aria-label="Bundle frame color"
              />
            </label>
          </div>

          <div class="wp-field">
            <span class="wp-field__label">Tags</span>
            <div class="wp-tags-row">
              <span
                v-for="t in tags"
                :key="t"
                class="wp-tag-chip wp-tag-chip--removable"
              >
                {{ t }}
                <button
                  type="button"
                  class="wp-tag-chip__x"
                  :aria-label="`Remove tag ${t}`"
                  @click="removeTag(t)"
                >×</button>
              </span>
              <Input
                v-model="tagDraft"
                placeholder="Add tag + Enter"
                aria-label="New tag"
                @keyup.enter="addTag"
              />
            </div>
          </div>
        </div>
      </Card>

      <Card
        :title="`Children (${childRows.length})`"
        subtitle="Frozen snapshots — edit children from the Context widget then use Save changes to library."
      >
        <div v-if="!childRows.length" class="wp-dim wp-bundle-editor__empty">
          This bundle has no children yet.
        </div>
        <ol v-else class="wp-bundle-children">
          <li
            v-for="(child, idx) in childRows"
            :key="`${child.id}_${idx}`"
            class="wp-bundle-children__row"
          >
            <span class="wp-bundle-children__idx">{{ idx + 1 }}</span>
            <span class="wp-bundle-children__kind">{{ kindLabel(child.type) }}</span>
            <span class="wp-bundle-children__name">{{ child.name }}</span>
            <span class="wp-id wp-bundle-children__id">{{ child.id }}</span>
          </li>
        </ol>
      </Card>
    </div>
  </div>
</template>

<style scoped>
.wp-bundle-editor {
  padding: 16px 20px;
  max-width: 900px;
}
.wp-bundle-editor__header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}
.wp-bundle-editor__title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
}
.wp-spacer { flex: 1; }
.wp-bundle-editor__loading { padding: 32px 0; text-align: center; }
.wp-bundle-editor__body { display: flex; flex-direction: column; gap: 16px; }
.wp-bundle-editor__empty { padding: 16px 0; font-size: 13px; }

.wp-bundle-form { display: flex; flex-direction: column; gap: 14px; }
.wp-field { display: flex; flex-direction: column; gap: 4px; }
.wp-field__label { font-size: 12px; color: var(--wp-text2); }
.wp-field-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
}
.wp-textarea {
  background: var(--wp-bg2);
  border: 1px solid var(--wp-border);
  color: var(--wp-text);
  padding: 6px 8px;
  border-radius: 4px;
  font: 13px/1.4 var(--wp-font-sans);
  resize: vertical;
  min-height: 40px;
}
.wp-textarea:focus { outline: 1px solid var(--wp-accent-500); }

.wp-tags-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
.wp-tags-row :deep(.wp-input) {
  flex: 1;
  min-width: 140px;
}
.wp-tag-chip--removable {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 6px 2px 8px;
  border-radius: 999px;
  background: color-mix(in oklab, var(--wp-accent-500) 14%, transparent);
  border: 1px solid color-mix(in oklab, var(--wp-accent-500) 35%, transparent);
  color: var(--wp-accent-text);
  font-size: 11.5px;
}
.wp-tag-chip__x {
  background: transparent;
  border: 0;
  color: inherit;
  font-size: 13px;
  line-height: 1;
  cursor: pointer;
  padding: 0 2px;
}
.wp-tag-chip__x:hover { color: var(--wp-danger, #ef4444); }

.wp-bundle-children {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.wp-bundle-children__row {
  display: grid;
  grid-template-columns: 28px max-content 1fr max-content;
  align-items: center;
  gap: 10px;
  padding: 6px 8px;
  border: 1px solid var(--wp-border);
  border-radius: 4px;
  background: var(--wp-bg2);
}
.wp-bundle-children__idx {
  font: 500 11px/1 var(--wp-font-mono);
  color: var(--wp-text3);
  text-align: right;
}
.wp-bundle-children__kind {
  font: 600 9px/1 var(--wp-font-sans);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 3px 5px;
  border-radius: 3px;
  background: color-mix(in oklab, var(--wp-accent-500) 18%, transparent);
  color: var(--wp-accent-text);
}
.wp-bundle-children__name {
  font: 500 13px/1.2 var(--wp-font-sans);
  color: var(--wp-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wp-bundle-children__id {
  font-family: var(--wp-font-mono);
  font-size: 10.5px;
  color: var(--wp-text3);
}
</style>
