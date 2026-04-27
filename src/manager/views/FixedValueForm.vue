<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import InputGroup from "primevue/inputgroup";
import InputGroupAddon from "primevue/inputgroupaddon";
import Textarea from "primevue/textarea";
import Select from "primevue/select";
import AutoComplete from "primevue/autocomplete";
import { useToast } from "primevue/usetoast";
import HistoryPanel from "../components/HistoryPanel.vue";
import { useModuleStore } from "../stores/moduleStore";
import { useCategoryStore } from "../stores/categoryStore";
import { VALID_IDENTIFIER_RE } from "../utils/slug";
import { appendSnapshot, readHistory } from "../utils/history";
import type { ModuleHistoryEntry } from "../api/types";

const props = defineProps<{ id?: string }>();
const router = useRouter();
const moduleStore = useModuleStore();
const categoryStore = useCategoryStore();
const toast = useToast();

interface NamedValue { id: string; name: string; value: string; }

const name = ref("");
const description = ref("");
const categoryId = ref<string | null>(null);
const tags = ref<string[]>([]);
const values = ref<NamedValue[]>([]);
const saving = ref(false);
const isEdit = computed(() => !!props.id);
const historyEntries = ref<ModuleHistoryEntry[]>([]);
const historyOpen = ref(false);

// ----- Tag autocomplete (mirrors WildcardForm) -----
const tagSuggestions = ref<string[]>([]);
function searchTags(event: { query: string }) {
  const q = event.query.toLowerCase();
  const known = new Set<string>();
  for (const m of moduleStore.items) {
    for (const t of m.tags ?? []) known.add(t);
  }
  tagSuggestions.value = Array.from(known)
    .filter((t) => t.toLowerCase().includes(q) && !tags.value.includes(t))
    .slice(0, 10);
}

onMounted(async () => {
  await Promise.all([categoryStore.fetchAll(), moduleStore.fetchAll()]);
  if (props.id) {
    try {
      const row = await moduleStore.get(props.id);
      name.value = row.name;
      description.value = row.description;
      categoryId.value = row.category_id;
      tags.value = row.tags;
      const rows = (row.payload as { values?: NamedValue[] }).values ?? [];
      // Strip any leading "$" that might have been persisted by older shapes —
      // the variable name is rendered as `$name` via the InputGroupAddon.
      values.value = rows.map((v) => ({
        id: v.id,
        name: (v.name ?? "").replace(/^\$+/, ""),
        value: v.value ?? "",
      }));
      historyEntries.value = readHistory(row.payload);
    } catch {
      toast.add({ severity: "error", summary: "Module not found", life: 3000 });
      router.replace("/fixed-values");
    }
  }
});

function addValue() {
  const id = `val_${Math.random().toString(16).slice(2, 8)}`;
  values.value.push({ id, name: "", value: "" });
}
function removeValue(idx: number) { values.value.splice(idx, 1); }

/**
 * Sanitise a var-name on input — drop everything outside the identifier
 * charset so users can paste sloppy text and not end up with bindings the
 * engine tokenizer rejects. Mirrors the prototype's
 * `e.target.value.replace(/[^a-zA-Z0-9_]/g, "")`.
 */
function onVarInput(idx: number, raw: string | null | undefined) {
  const cleaned = (raw ?? "").replace(/[^a-zA-Z0-9_]/g, "");
  values.value[idx].name = cleaned;
}

/**
 * Per-row validity used to drive the inline error chip and the save guard.
 *  - empty       → "Required"
 *  - bad ident   → "Invalid identifier"
 *  - duplicate   → "Duplicate name"
 *  - otherwise   → ""
 */
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
  historyOpen.value = false;
  toast.add({
    severity: "info",
    summary: "Version restored",
    detail: `Restored from ${new Date(entry.saved_at).toLocaleString()}; click Save to commit.`,
    life: 4000,
  });
}

async function save() {
  if (!name.value.trim()) {
    toast.add({ severity: "warn", summary: "Name required", life: 2000 });
    return;
  }
  if (hasRowErrors.value) {
    toast.add({
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
    } else {
      await moduleStore.create({
        type: "fixed_values",
        name: name.value, description: description.value,
        category_id: categoryId.value, tags: tags.value, payload,
      });
    }
    toast.add({ severity: "success", summary: "Saved", detail: name.value, life: 2000 });
    router.push("/fixed-values");
  } catch (e) {
    toast.add({ severity: "error", summary: "Save failed", detail: String(e), life: 4000 });
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="form-page">
    <div class="form-page__header">
      <RouterLink to="/fixed-values" class="text-xs text-wp-text2 hover:text-wp-text">
        <i class="pi pi-angle-left text-xs" /> Fixed Values
      </RouterLink>
      <h1 class="text-xl font-semibold m-0 mt-1">{{ isEdit ? "Edit fixed values" : "New fixed values" }}</h1>
    </div>

    <div class="form-page__body">
      <section class="form-section">
        <h2 class="form-section__label">Identity</h2>
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label for="fv-name" class="block text-xs text-wp-text2 mb-1">Name</label>
            <InputText id="fv-name" v-model="name" class="w-full" />
          </div>
          <div>
            <label for="fv-cat" class="block text-xs text-wp-text2 mb-1">Category</label>
            <Select
              id="fv-cat" v-model="categoryId"
              :options="categoryStore.items" option-label="name" option-value="id"
              placeholder="None" show-clear class="w-full"
            />
          </div>
          <div class="col-span-2">
            <label for="fv-desc" class="block text-xs text-wp-text2 mb-1">Description</label>
            <Textarea id="fv-desc" v-model="description" rows="2" class="w-full" />
          </div>
          <div class="col-span-2">
            <label for="fv-tags" class="block text-xs text-wp-text2 mb-1">Tags</label>
            <AutoComplete
              id="fv-tags"
              v-model="tags"
              multiple
              typeahead
              :suggestions="tagSuggestions"
              placeholder="Type a tag and press Enter…"
              class="w-full"
              @complete="searchTags"
            />
          </div>
        </div>
      </section>

      <section class="form-section">
        <div class="flex items-center justify-between mb-2">
          <h2 class="form-section__label m-0">Values ({{ values.length }})</h2>
        </div>
        <p class="text-xs text-wp-text2 mb-2">
          Each row binds a literal string to <code>$name</code>. Names must match
          <code>[a-zA-Z_][a-zA-Z0-9_]*</code> and be unique within this module.
        </p>

        <div v-if="values.length" class="fv-rows">
          <div
            v-for="(v, idx) in values"
            :key="v.id"
            class="fv-row"
            :data-test="`fv-row-${idx}`"
            :data-invalid="rowErrors[idx] ? 'true' : 'false'"
          >
            <div class="fv-row__var">
              <InputGroup>
                <InputGroupAddon><i class="pi pi-dollar" /></InputGroupAddon>
                <InputText
                  :model-value="v.name"
                  :data-test="`fv-row-${idx}-name`"
                  :class="{ 'p-invalid': !!rowErrors[idx] }"
                  placeholder="varname"
                  aria-label="Variable name"
                  @update:model-value="(val) => onVarInput(idx, val)"
                />
              </InputGroup>
              <p
                v-if="rowErrors[idx]"
                class="fv-row__err"
                :data-test="`fv-row-${idx}-err`"
              >
                {{ rowErrors[idx] }}
              </p>
            </div>
            <div class="fv-row__value">
              <Textarea
                v-model="v.value"
                :rows="2"
                auto-resize
                class="w-full"
                placeholder="value"
                aria-label="Variable value"
                :data-test="`fv-row-${idx}-value`"
              />
            </div>
            <div class="fv-row__remove">
              <Button
                icon="pi pi-trash"
                text rounded size="small" severity="danger"
                aria-label="Remove value"
                @click="removeValue(idx)"
              />
            </div>
          </div>
        </div>

        <button
          type="button"
          class="fv-add"
          data-test="fv-add"
          @click="addValue"
        >
          <i class="pi pi-plus" />
          <span>Add value</span>
        </button>
      </section>
    </div>

    <div class="form-page__footer">
      <Button
        v-if="historyEntries.length"
        :label="`History (${historyEntries.length})`"
        icon="pi pi-history"
        severity="secondary"
        outlined
        data-test="history-btn"
        @click="historyOpen = true"
      />
      <div class="form-page__footer-spacer" />
      <Button label="Cancel" severity="secondary" outlined @click="router.push('/fixed-values')" />
      <Button label="Save" icon="pi pi-check" severity="primary" :loading="saving" data-test="save-btn" @click="save" />
    </div>
    <HistoryPanel
      :open="historyOpen"
      :entries="historyEntries"
      @update:open="(v) => (historyOpen = v)"
      @restore="applyRestore"
    />
  </div>
</template>

<style scoped>
.form-page { display: flex; flex-direction: column; min-height: calc(100vh - 56px); }
.form-page__header { padding: 24px 24px 0; }
.form-page__body { padding: 16px 24px 96px; max-width: 56rem; flex: 1; }
.form-page__footer {
  position: sticky; bottom: 0;
  background: var(--wp-bg);
  border-top: 1px solid var(--wp-border);
  padding: 12px 24px;
  display: flex; gap: 8px; align-items: center;
}
.form-page__footer-spacer { flex: 1; }
.form-section { margin-bottom: 24px; }
.form-section__label {
  font-size: 11px; text-transform: uppercase;
  letter-spacing: 0.5px; color: var(--wp-text2);
  margin: 0 0 8px 0;
}

/* Per-row layout: $name | value textarea | trash. */
.fv-rows {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 8px;
}
.fv-row {
  display: grid;
  grid-template-columns: 220px 1fr 36px;
  gap: 8px;
  align-items: start;
  padding: 8px;
  border: 1px solid var(--wp-border);
  border-radius: 6px;
  background: var(--wp-bg2);
}
.fv-row[data-invalid="true"] {
  border-color: var(--wp-danger, #dc2626);
}
.fv-row__var :deep(.p-inputtext) { width: 100%; }
.fv-row__err {
  font-size: 11px;
  color: var(--wp-danger, #dc2626);
  margin: 4px 0 0;
}
.fv-row__remove {
  display: flex;
  justify-content: flex-end;
  padding-top: 2px;
}

/* Dashed "Add value" button matching prototype affordance. */
.fv-add {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  padding: 10px 12px;
  border: 1px dashed var(--wp-border);
  border-radius: 6px;
  background: transparent;
  color: var(--wp-text2);
  font-size: 13px;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
}
.fv-add:hover {
  background: var(--wp-bg2);
  border-color: var(--wp-text2);
  color: var(--wp-text);
}
</style>
