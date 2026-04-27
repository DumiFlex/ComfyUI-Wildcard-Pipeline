<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import Button from "primevue/button";
import Card from "primevue/card";
import InputText from "primevue/inputtext";
import InputNumber from "primevue/inputnumber";
import Textarea from "primevue/textarea";
import Select from "primevue/select";
import AutoComplete from "primevue/autocomplete";
import { useToast } from "primevue/usetoast";
import { useModuleStore } from "../stores/moduleStore";
import { useCategoryStore } from "../stores/categoryStore";
import ConstraintMatrixGrid from "../components/ConstraintMatrix.vue";
import type {
  ConstraintCell,
  ConstraintException,
  ConstraintMatrix,
  ConstraintMode,
  ConstraintPayload,
  ModuleRow,
} from "../api/types";

const props = defineProps<{ id?: string }>();
const router = useRouter();
const moduleStore = useModuleStore();
const categoryStore = useCategoryStore();
const toast = useToast();

interface WildcardOption { id: string; value: string; weight: number; sub_category?: string | null; }
interface WildcardPayloadShape {
  options?: WildcardOption[];
  sub_categories?: string[];
}

const name = ref("");
const description = ref("");
const categoryId = ref<string | null>(null);
const tags = ref<string[]>([]);
const sourceWildcardId = ref<string | null>(null);
const targetWildcardId = ref<string | null>(null);
const matrix = ref<ConstraintMatrix>({});
const exceptions = ref<ConstraintException[]>([]);
const saving = ref(false);
const isEdit = computed(() => !!props.id);

const MODE_DEFAULT_FACTOR: Record<ConstraintMode, number> = {
  allow: 1,
  exclude: 0,
  boost: 2,
  reduce: 0.5,
};
const MODE_OPTIONS: Array<{ label: string; value: ConstraintMode }> = [
  { label: "Allow", value: "allow" },
  { label: "Exclude", value: "exclude" },
  { label: "Boost", value: "boost" },
  { label: "Reduce", value: "reduce" },
];

const wildcardOptions = computed(() =>
  moduleStore.items
    .filter((m) => m.type === "wildcard")
    .map((m) => ({ label: m.name, value: m.id })),
);

function wildcardById(id: string | null): ModuleRow | undefined {
  if (!id) return undefined;
  return moduleStore.items.find((m) => m.id === id);
}

const sourceWildcard = computed(() => wildcardById(sourceWildcardId.value));
const targetWildcard = computed(() => wildcardById(targetWildcardId.value));

const sourceValues = computed<string[]>(() => {
  const wc = sourceWildcard.value;
  if (!wc) return [];
  const payload = wc.payload as WildcardPayloadShape;
  const values = (payload.options ?? [])
    .map((o) => o.value)
    .filter((v): v is string => typeof v === "string" && v.length > 0);
  return Array.from(new Set(values));
});

const targetSubCategories = computed<string[]>(() => {
  const wc = targetWildcard.value;
  if (!wc) return [];
  const payload = wc.payload as WildcardPayloadShape;
  return payload.sub_categories ?? [];
});

const targetValues = computed<string[]>(() => {
  const wc = targetWildcard.value;
  if (!wc) return [];
  const payload = wc.payload as WildcardPayloadShape;
  const values = (payload.options ?? [])
    .map((o) => o.value)
    .filter((v): v is string => typeof v === "string" && v.length > 0);
  return Array.from(new Set(values));
});

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

function normalizeMatrix(raw: unknown): ConstraintMatrix {
  // Tolerate the legacy array-of-arrays shape silently.
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: ConstraintMatrix = {};
  for (const [r, byCol] of Object.entries(raw as Record<string, unknown>)) {
    if (!byCol || typeof byCol !== "object") continue;
    out[r] = {};
    for (const [c, cellRaw] of Object.entries(byCol as Record<string, unknown>)) {
      const cell = cellRaw as Partial<ConstraintCell>;
      const mode = (cell?.mode ?? "allow") as ConstraintMode;
      const factor =
        typeof cell?.factor === "number" ? cell.factor : MODE_DEFAULT_FACTOR[mode];
      out[r][c] = { mode, factor };
    }
  }
  return out;
}

function normalizeExceptions(raw: unknown): ConstraintException[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((e) => {
      if (!e || typeof e !== "object") return null;
      const r = e as Record<string, unknown>;
      const source = typeof r.source === "string" ? r.source : "";
      const target = typeof r.target === "string" ? r.target : "";
      const mode = (typeof r.mode === "string" ? r.mode : "allow") as ConstraintMode;
      const factor =
        typeof r.factor === "number" ? r.factor : MODE_DEFAULT_FACTOR[mode] ?? 1;
      return { source, target, mode, factor } as ConstraintException;
    })
    .filter((x): x is ConstraintException => x !== null);
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
      const p = row.payload as Partial<ConstraintPayload>;
      sourceWildcardId.value = p.source_wildcard_id ?? null;
      targetWildcardId.value = p.target_wildcard_id ?? null;
      matrix.value = normalizeMatrix(p.matrix);
      exceptions.value = normalizeExceptions(p.exceptions);
    } catch {
      toast.add({ severity: "error", summary: "Constraint not found", life: 3000 });
      router.replace("/constraints");
    }
  }
});

function onMatrixUpdate(next: ConstraintMatrix) {
  matrix.value = next;
}

function addException() {
  exceptions.value.push({ source: "", target: "", mode: "allow", factor: 1 });
}
function removeException(idx: number) {
  exceptions.value.splice(idx, 1);
}
function setExceptionMode(idx: number, mode: ConstraintMode) {
  const ex = exceptions.value[idx];
  if (!ex) return;
  ex.mode = mode;
  ex.factor = MODE_DEFAULT_FACTOR[mode] ?? 1;
}

async function save() {
  if (!name.value.trim()) {
    toast.add({ severity: "warn", summary: "Name required", life: 2000 });
    return;
  }
  if (!sourceWildcardId.value || !targetWildcardId.value) {
    toast.add({
      severity: "warn",
      summary: "Source and target wildcards are required",
      life: 2500,
    });
    return;
  }
  saving.value = true;
  try {
    const payload: ConstraintPayload = {
      source_wildcard_id: sourceWildcardId.value,
      target_wildcard_id: targetWildcardId.value,
      matrix: matrix.value,
      exceptions: exceptions.value,
    };
    const body = {
      name: name.value,
      description: description.value,
      category_id: categoryId.value,
      tags: tags.value,
      payload: payload as unknown as Record<string, unknown>,
    };
    if (isEdit.value && props.id) {
      await moduleStore.update(props.id, body);
    } else {
      await moduleStore.create({ type: "constraint", ...body });
    }
    toast.add({ severity: "success", summary: "Saved", detail: name.value, life: 2000 });
    router.push("/constraints");
  } catch (e) {
    toast.add({ severity: "error", summary: "Save failed", detail: String(e), life: 4000 });
  } finally {
    saving.value = false;
  }
}

defineExpose({ sourceWildcardId, targetWildcardId, matrix, exceptions });
</script>

<template>
  <div class="form-page">
    <div class="form-page__header">
      <RouterLink to="/constraints" class="text-xs text-wp-text2 hover:text-wp-text">
        <i class="pi pi-angle-left text-xs" /> Constraints
      </RouterLink>
      <h1 class="text-xl font-semibold m-0 mt-1">{{ isEdit ? "Edit constraint" : "New constraint" }}</h1>
    </div>

    <div class="form-page__body">
      <!-- A) Identity -->
      <section class="form-section">
        <h2 class="form-section__label">Identity</h2>
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label for="cn-name" class="block text-xs text-wp-text2 mb-1">Name</label>
            <InputText id="cn-name" v-model="name" class="w-full" />
          </div>
          <div>
            <label for="cn-cat" class="block text-xs text-wp-text2 mb-1">Category</label>
            <Select
              id="cn-cat" v-model="categoryId"
              :options="categoryStore.items" option-label="name" option-value="id"
              placeholder="None" show-clear class="w-full"
            />
          </div>
          <div class="col-span-2">
            <label for="cn-desc" class="block text-xs text-wp-text2 mb-1">Description</label>
            <Textarea id="cn-desc" v-model="description" rows="2" class="w-full" />
          </div>
          <div class="col-span-2">
            <label for="cn-tags" class="block text-xs text-wp-text2 mb-1">Tags</label>
            <AutoComplete
              id="cn-tags"
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

      <!-- B) Source / Target wildcards -->
      <section class="form-section">
        <h2 class="form-section__label">Source &amp; Target wildcards</h2>
        <p class="text-xs text-wp-text2 mb-2">
          Source wildcard's resolved value selects a row of the matrix; target wildcard's options are weighted by the matched cell.
        </p>
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label for="cn-source" class="block text-xs text-wp-text2 mb-1">Source wildcard</label>
            <Select
              id="cn-source"
              v-model="sourceWildcardId"
              :options="wildcardOptions"
              option-label="label"
              option-value="value"
              placeholder="Pick source"
              show-clear
              class="w-full"
              data-test="source-wildcard-select"
              aria-label="Source wildcard"
            />
            <p class="text-[11px] text-wp-text3 mt-1">
              Drives matrix rows ({{ sourceValues.length }} value{{ sourceValues.length === 1 ? '' : 's' }}).
            </p>
          </div>
          <div>
            <label for="cn-target" class="block text-xs text-wp-text2 mb-1">Target wildcard</label>
            <Select
              id="cn-target"
              v-model="targetWildcardId"
              :options="wildcardOptions"
              option-label="label"
              option-value="value"
              placeholder="Pick target"
              show-clear
              class="w-full"
              data-test="target-wildcard-select"
              aria-label="Target wildcard"
            />
            <p class="text-[11px] text-wp-text3 mt-1">
              Drives matrix columns ({{ targetSubCategories.length }} sub-categor{{ targetSubCategories.length === 1 ? 'y' : 'ies' }}).
            </p>
          </div>
        </div>
      </section>

      <!-- C) Matrix grid -->
      <section class="form-section">
        <div class="flex items-center justify-between mb-2">
          <h2 class="form-section__label m-0">Rule matrix</h2>
          <span class="text-[11px] text-wp-text3">Click cycles · cog tunes factor</span>
        </div>
        <Card>
          <template #content>
            <div
              v-if="!sourceWildcardId || !targetWildcardId"
              class="text-sm text-wp-text2 py-6 text-center"
              data-test="matrix-empty"
            >
              Pick a source and target wildcard to populate the matrix.
            </div>
            <div
              v-else-if="sourceValues.length === 0 || targetSubCategories.length === 0"
              class="text-sm text-wp-text2 py-6 text-center"
              data-test="matrix-need-subs"
            >
              <i class="pi pi-info-circle mr-1" />
              <span v-if="sourceValues.length === 0">Source wildcard needs at least one option value. </span>
              <span v-if="targetSubCategories.length === 0">Target wildcard needs at least one sub-category. </span>
              Add them on the wildcard editor to define rules.
            </div>
            <ConstraintMatrixGrid
              v-else
              :rows="sourceValues"
              :cols="targetSubCategories"
              :model-value="matrix"
              data-test="matrix-grid"
              @update:model-value="onMatrixUpdate"
            />
          </template>
        </Card>
      </section>

      <!-- D) Exceptions table -->
      <section class="form-section">
        <div class="flex items-center justify-between mb-2">
          <h2 class="form-section__label m-0">Exceptions ({{ exceptions.length }})</h2>
          <Button
            label="Add exception"
            icon="pi pi-plus"
            size="small"
            severity="primary"
            data-test="add-exception"
            @click="addException"
          />
        </div>
        <p class="text-xs text-wp-text2 mb-2">
          Per-pair overrides for specific option values that the matrix doesn't cover.
        </p>
        <table class="w-full text-sm border border-wp-border rounded">
          <thead>
            <tr class="bg-wp-bg2">
              <th class="px-3 py-2 text-left text-wp-text2 text-xs uppercase">Source value</th>
              <th class="px-3 py-2 text-left text-wp-text2 text-xs uppercase">Target value</th>
              <th class="px-3 py-2 text-left text-wp-text2 text-xs uppercase w-32">Mode</th>
              <th class="px-3 py-2 text-left text-wp-text2 text-xs uppercase w-28">Factor</th>
              <th class="w-12"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(ex, idx) in exceptions" :key="idx" class="border-t border-wp-border">
              <td class="px-3 py-2">
                <Select
                  v-model="ex.source"
                  :options="sourceValues.map((v) => ({ label: v, value: v }))"
                  option-label="label"
                  option-value="value"
                  editable
                  placeholder="Pick value"
                  class="w-full"
                  aria-label="Exception source value"
                />
              </td>
              <td class="px-3 py-2">
                <Select
                  v-model="ex.target"
                  :options="targetValues.map((v) => ({ label: v, value: v }))"
                  option-label="label"
                  option-value="value"
                  editable
                  placeholder="Pick value"
                  class="w-full"
                  aria-label="Exception target value"
                />
              </td>
              <td class="px-3 py-2 w-32">
                <Select
                  :model-value="ex.mode"
                  :options="MODE_OPTIONS"
                  option-label="label"
                  option-value="value"
                  class="w-full"
                  aria-label="Exception mode"
                  @update:model-value="(v) => setExceptionMode(idx, v as ConstraintMode)"
                />
              </td>
              <td class="px-3 py-2 w-28">
                <InputNumber
                  v-if="ex.mode === 'boost' || ex.mode === 'reduce'"
                  v-model="ex.factor"
                  :min="0.1"
                  :max="10"
                  :step="0.1"
                  :max-fraction-digits="2"
                  show-buttons
                  button-layout="horizontal"
                  size="small"
                  class="w-full"
                  aria-label="Exception factor"
                />
                <span v-else class="text-wp-text3 font-mono text-xs">—</span>
              </td>
              <td class="px-3 py-2 text-right">
                <Button
                  icon="pi pi-trash"
                  text
                  rounded
                  size="small"
                  severity="danger"
                  aria-label="Remove exception"
                  @click="removeException(idx)"
                />
              </td>
            </tr>
            <tr v-if="!exceptions.length">
              <td colspan="5" class="text-center text-wp-text2 py-4">No exceptions yet.</td>
            </tr>
          </tbody>
        </table>
      </section>
    </div>

    <!-- E) Footer -->
    <div class="form-page__footer">
      <Button label="Cancel" severity="secondary" outlined @click="router.push('/constraints')" />
      <Button
        label="Save"
        icon="pi pi-check"
        severity="primary"
        :loading="saving"
        data-test="save-btn"
        @click="save"
      />
    </div>
  </div>
</template>

<style scoped>
.form-page { display: flex; flex-direction: column; min-height: calc(100vh - 56px); }
.form-page__header { padding: 24px 24px 0; }
.form-page__body { padding: 16px 24px 96px; max-width: 64rem; flex: 1; }
.form-page__footer {
  position: sticky; bottom: 0;
  background: var(--wp-bg);
  border-top: 1px solid var(--wp-border);
  padding: 12px 24px;
  display: flex; gap: 8px; justify-content: flex-end;
}
.form-section { margin-bottom: 24px; }
.form-section__label {
  font-size: 11px; text-transform: uppercase;
  letter-spacing: 0.5px; color: var(--wp-text2);
  margin: 0 0 8px 0;
}
</style>
