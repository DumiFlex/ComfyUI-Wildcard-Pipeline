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
import { useRoute, useRouter } from "vue-router";
import EditorFrame from "../components/EditorFrame.vue";
import IdentityCard from "../components/IdentityCard.vue";
import Card from "../components/ui/Card.vue";
import Button from "../components/ui/Button.vue";
import Textarea from "../components/ui/Textarea.vue";
import ConfirmDialog from "../../components/shared/ConfirmDialog.vue";
import { useToast } from "../composables/useToast";
import { useUnsavedGuard } from "../composables/useUnsavedGuard";
import { useModuleStore } from "../stores/moduleStore";
import { useCategoryStore } from "../stores/categoryStore";
import { useRecentStore } from "../stores/recentStore";
import { VALID_IDENTIFIER_RE } from "../utils/slug";
import { appendSnapshot, readHistory } from "../utils/history";
import type { ModuleHistoryEntry } from "../api/types";

interface NamedValue { id: string; name: string; value: string; }

const props = defineProps<{ id?: string }>();
const route = useRoute();
const router = useRouter();
const moduleStore = useModuleStore();
const categoryStore = useCategoryStore();
const toast = useToast();
const recent = useRecentStore();

const KNOWN_LIST_PATHS = new Set([
  "/wildcards",
  "/fixed-values",
  "/combines",
  "/derivations",
  "/constraints",
  "/bundles",
  "/all",
  "/categories",
  "/dashboard",
]);

/** Validated return path or fallback to bare list. */
function resolveReturnTo(fallback: string): string {
  const raw = route.query.returnTo;
  if (typeof raw !== "string") return fallback;
  try {
    const decoded = decodeURIComponent(raw);
    if (!decoded.startsWith("/") || decoded.startsWith("//")) return fallback;
    const basePath = decoded.split("?")[0];
    if (!KNOWN_LIST_PATHS.has(basePath)) return fallback;
    return decoded;
  } catch {
    return fallback;
  }
}

const name = ref("");
const description = ref("");
const categoryId = ref<string | null>(null);
const tags = ref<string[]>([]);
const values = ref<NamedValue[]>([
  { id: `val_${Math.random().toString(16).slice(2, 8)}`, name: "", value: "" },
  { id: `val_${Math.random().toString(16).slice(2, 8)}`, name: "", value: "" },
]);
const saving = ref(false);
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

const { showConfirm, onConfirmLeave, onCancelLeave } = useUnsavedGuard(
  () => snapshot() !== baseline.value,
);

onMounted(async () => {
  await Promise.all([categoryStore.fetchAll(), moduleStore.fetchCatalog()]);
  if (props.id) {
    try {
      const row = await moduleStore.get(props.id);
      name.value = row.name;
      description.value = row.description;
      categoryId.value = row.category_id;
      tags.value = row.tags;
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
      });
    }
    toast.push({ severity: "success", summary: "Saved", detail: name.value });
    baseline.value = snapshot();
    router.push(resolveReturnTo("/fixed-values"));
  } catch (e) {
    toast.push({ severity: "error", summary: "Save failed", detail: String(e), life: 4000 });
  } finally {
    saving.value = false;
  }
}

function cancel() { router.push(resolveReturnTo("/fixed-values")); }
</script>

<template>
  <EditorFrame
    :title="isEdit ? 'Edit fixed values' : 'New fixed values'"
    back-route="/fixed-values"
    back-label="Fixed Values"
    :saving="saving"
    :history-entries="historyEntries"
    @save="save"
    @cancel="cancel"
    @restore="applyRestore"
  >
    <IdentityCard
      :name="name"
      :description="description"
      :category-id="categoryId"
      :tags="tags"
      @update:name="(v) => (name = v)"
      @update:description="(v) => (description = v)"
      @update:category-id="(v) => (categoryId = v)"
      @update:tags="(v) => (tags = v)"
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
              <Textarea
                v-model="v.value"
                :rows="2"
                auto-resize
                placeholder="value"
                aria-label="Variable value"
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
