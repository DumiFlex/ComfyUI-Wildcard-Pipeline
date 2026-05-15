<script setup lang="ts">
/**
 * BundleEditor — SPA editor for library-tracked bundles.
 *
 * Scope (Task 1 — layout port): editable name, description, color,
 * category, tags via EditorFrame + IdentityCard + color slot. Children
 * are rendered read-only here; Task 2 makes them interactive.
 *
 * Route shape mirrors the other kind editors:
 *   /bundles/new            → create-mode (disabled Save, points user to Context widget)
 *   /bundles/:id/edit       → edit-mode
 */
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import EditorFrame from "../components/EditorFrame.vue";
import IdentityCard from "../components/IdentityCard.vue";
import Card from "../components/ui/Card.vue";
import ColorPicker from "../components/ColorPicker.vue";
import { useToast } from "../composables/useToast";
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

const isEdit = computed(() => !!props.id);

const children = computed(() => (original.value?.children ?? []) as Array<Record<string, unknown>>);

interface ChildView {
  id: string;
  type: string;
  name: string;
}

const childRows = computed<ChildView[]>(() =>
  children.value.map((c, i) => {
    const meta = (c.meta as { name?: string } | undefined) ?? undefined;
    const displayName = meta?.name ?? (c.name as string | undefined) ?? "(unnamed)";
    return {
      id: String(c.id ?? `child_${i}`),
      type: String(c.type ?? "module"),
      name: String(displayName),
    };
  }),
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

function cancel() {
  router.push("/bundles");
}

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
    });
    original.value = updated;
    toast.push({ severity: "success", summary: "Saved", detail: updated.name, life: 2000 });
  } catch (e) {
    toast.push({ severity: "error", summary: "Save failed", detail: String(e), life: 4000 });
  } finally {
    saving.value = false;
  }
}

function kindLabel(type: string): string {
  if (!type) return "Module";
  return type.charAt(0).toUpperCase() + type.slice(1).replace(/_/g, " ");
}
</script>

<template>
  <EditorFrame
    :title="isEdit ? (original?.name || 'Loading…') : 'New bundle'"
    back-route="/bundles"
    back-label="Bundles"
    :saving="saving"
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
        aside-label="Frame color"
        @update:name="(v) => (name = v)"
        @update:description="(v) => (description = v)"
        @update:category-id="(v) => (categoryId = v)"
        @update:tags="(v) => (tags = v)"
      >
        <template #aside>
          <ColorPicker
            v-model="color"
            :presets="COLOR_PRESETS"
            aria-label="Bundle frame color"
          />
        </template>
      </IdentityCard>

      <Card
        :title="`Children (${childRows.length})`"
        subtitle="Frozen snapshots — full interactive editing lands in Task 2."
      >
        <div v-if="!childRows.length" class="wp-dim wp-bundle-editor__empty">
          This bundle has no children yet.
        </div>
        <ol v-else class="wp-bundle-children" data-test="bundle-children-list">
          <li
            v-for="(child, idx) in childRows"
            :key="`${child.id}_${idx}`"
            class="wp-bundle-children__row"
            :data-test="`bundle-child-${idx}`"
          >
            <span class="wp-bundle-children__idx">{{ idx + 1 }}</span>
            <span class="wp-bundle-children__kind">{{ kindLabel(child.type) }}</span>
            <span class="wp-bundle-children__name">{{ child.name }}</span>
          </li>
        </ol>
      </Card>
    </template>
  </EditorFrame>
</template>

<style scoped>
.wp-bundle-editor__loading { padding: 32px 0; text-align: center; }
.wp-bundle-editor__empty { padding: 16px 0; font-size: 13px; }

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
  grid-template-columns: 28px max-content 1fr;
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
</style>
