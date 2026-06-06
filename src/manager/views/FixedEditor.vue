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
import ConfirmDialog from "../../components/shared/ConfirmDialog.vue";
import { useToast } from "../composables/useToast";
import { useUnsavedGuard } from "../composables/useUnsavedGuard";
import { useEditorShortcuts } from "../composables/useEditorShortcuts";
import { useEditorDraft } from "../composables/useEditorDraft";
import { useReturnTo } from "../composables/useReturnTo";
import { useModuleStore } from "../stores/moduleStore";
import { useCategoryStore } from "../stores/categoryStore";
import { useRecentStore } from "../stores/recentStore";
import { VALID_IDENTIFIER_RE } from "../utils/slug";
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

const { showConfirm, dirty, onConfirmLeave, onCancelLeave } = useUnsavedGuard(
  () => snapshot() !== baseline.value,
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
    if (!VALID_IDENTIFIER_RE.test(n)) { errs.push("Invalid identifier"); continue; }
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

    <Card :title="`Values (${values.length})`" :padding="false">
      <template #actions>
        <Button size="sm" variant="primary" icon="pi-plus" data-test="fv-add" @click="addValue">
          Add value
        </Button>
      </template>
      <table class="wp-table wp-options-table">
        <thead>
          <tr>
            <th class="fv-col-var">Variable</th>
            <th>Value</th>
            <th class="fv-col-trash" />
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(v, idx) in values"
            :key="v.id"
            :data-test="`fv-row-${idx}`"
            :data-invalid="rowErrors[idx] ? 'true' : 'false'"
          >
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
              <RichTextInput
                v-model="v.value"
                surface="fixed_values"
                multiline
                :rows="2"
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
            <td colspan="3" class="opt-empty">No values yet.</td>
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
.wp-editor-used-by {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: var(--wp-text-xs);
  color: var(--wp-text-muted);
}
.fv-col-var { width: 220px; }
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
</style>
