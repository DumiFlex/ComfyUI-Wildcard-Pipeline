<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import Button from "primevue/button";
import Card from "primevue/card";
import InputText from "primevue/inputtext";
import Textarea from "primevue/textarea";
import Select from "primevue/select";
import AutoComplete from "primevue/autocomplete";
import { useToast } from "primevue/usetoast";
import { api } from "../api/client";
import { useModuleStore } from "../stores/moduleStore";
import { useCategoryStore } from "../stores/categoryStore";
import PipelineSteps from "../components/PipelineSteps.vue";
import PipelineStepPicker from "../components/PipelineStepPicker.vue";
import type {
  CombinePayload,
  DerivationPayload,
  ConstraintPayload,
  ModuleRow,
  ModuleType,
  PipelinePayload,
  PipelineStep,
} from "../api/types";

const props = defineProps<{ id?: string }>();
const router = useRouter();
const moduleStore = useModuleStore();
const categoryStore = useCategoryStore();
const toast = useToast();

const name = ref("");
const description = ref("");
const categoryId = ref<string | null>(null);
const tags = ref<string[]>([]);
const steps = ref<PipelineStep[]>([]);
const saving = ref(false);
const pickerOpen = ref(false);

// All modules (cross-kind) used by step rows + picker.
const allModules = ref<ModuleRow[]>([]);
const isEdit = computed(() => !!props.id);

const modulesById = computed(() => {
  const m = new Map<string, ModuleRow>();
  for (const row of allModules.value) m.set(row.id, row);
  return m;
});

const modulesByKind = computed(() => {
  const groups: Record<ModuleType, ModuleRow[]> = {
    wildcard: [], fixed_values: [], combine: [],
    derivation: [], constraint: [], pipeline: [],
  };
  for (const row of allModules.value) {
    if (row.type === "pipeline") continue;
    groups[row.type].push(row);
  }
  return groups;
});

const tagSuggestions = ref<string[]>([]);
function searchTags(event: { query: string }) {
  const q = event.query.toLowerCase();
  const known = new Set<string>();
  for (const m of moduleStore.items) {
    for (const t of m.tags ?? []) known.add(t);
  }
  for (const m of allModules.value) {
    for (const t of m.tags ?? []) known.add(t);
  }
  tagSuggestions.value = Array.from(known)
    .filter((t) => t.toLowerCase().includes(q) && !tags.value.includes(t))
    .slice(0, 10);
}

async function loadAllModules() {
  try {
    const res = await api.modules.list({});
    allModules.value = res.items;
  } catch (e) {
    toast.add({ severity: "error", summary: "Failed to load modules", detail: String(e), life: 3000 });
  }
}

onMounted(async () => {
  await Promise.all([categoryStore.fetchAll(), loadAllModules()]);
  if (props.id) {
    try {
      const row = await moduleStore.get(props.id);
      name.value = row.name;
      description.value = row.description;
      categoryId.value = row.category_id;
      tags.value = row.tags;
      const p = row.payload as Partial<PipelinePayload>;
      steps.value = (p.steps ?? []).map((s) => ({
        id: s.id || `step_${Math.random().toString(16).slice(2, 8)}`,
        module_id: s.module_id,
        enabled: s.enabled !== false,
        ...(s.instance ? { instance: s.instance } : {}),
      }));
    } catch {
      toast.add({ severity: "error", summary: "Pipeline not found", life: 3000 });
      router.replace("/pipelines");
    }
  }
});

function onStepsUpdate(next: PipelineStep[]) {
  steps.value = next;
}

function onPick(mod: ModuleRow) {
  const newStep: PipelineStep = {
    id: `step_${Math.random().toString(16).slice(2, 8)}`,
    module_id: mod.id,
    enabled: true,
  };
  steps.value = [...steps.value, newStep];
  pickerOpen.value = false;
}

// ------ Resolution preview helpers ----------------------------------

interface PreviewBinding {
  text: string;
  isMutation?: boolean;
}
interface PreviewStep {
  index: number;
  kind: ModuleType | null;
  name: string;
  bindings: PreviewBinding[];
}

function previewStepBindings(step: PipelineStep): PreviewBinding[] {
  const mod = modulesById.value.get(step.module_id);
  if (!mod) return [{ text: "(missing module)", isMutation: false }];
  const payload = mod.payload as Record<string, unknown>;
  const inst = (step.instance ?? {}) as { variable_binding?: string };
  if (mod.type === "wildcard") {
    const fallback = mod.name.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_|_$/g, "");
    const v = inst.variable_binding?.trim() || (payload.variable_binding as string | undefined) || fallback;
    return [{ text: `$${v}` }];
  }
  if (mod.type === "fixed_values") {
    const values = (payload.values as { var?: string; name?: string }[] | undefined) ?? [];
    return values
      .map((row) => (row.var || row.name || "").replace(/^\$/, ""))
      .filter(Boolean)
      .map((v) => ({ text: `$${v}` }));
  }
  if (mod.type === "combine") {
    const out = (payload as Partial<CombinePayload>).output_var?.replace(/^\$/, "");
    return [{ text: out ? `$${out}` : "$output" }];
  }
  if (mod.type === "derivation") {
    const rules = (payload as Partial<DerivationPayload>).rules ?? [];
    const targets = new Set<string>();
    for (const r of rules) {
      for (const b of r.branches ?? []) {
        if (b.action?.target_var) targets.add(b.action.target_var);
      }
      if (r.else?.action?.target_var) targets.add(r.else.action.target_var);
    }
    if (!targets.size) return [{ text: "mutates $context", isMutation: true }];
    return Array.from(targets).map((t) => ({ text: `mutates $${t}`, isMutation: true }));
  }
  if (mod.type === "constraint") {
    const cp = payload as Partial<ConstraintPayload>;
    const t = cp.target_wildcard_id;
    if (t) return [{ text: `affects $${t}`, isMutation: true }];
    return [{ text: "affects (no target)", isMutation: true }];
  }
  return [];
}

const preview = computed<PreviewStep[]>(() =>
  steps.value
    .filter((s) => s.enabled)
    .map((s, idx) => {
      const mod = modulesById.value.get(s.module_id);
      return {
        index: idx,
        kind: mod?.type ?? null,
        name: mod?.name ?? "(missing)",
        bindings: previewStepBindings(s),
      };
    }),
);

const KIND_ICON: Record<ModuleType, string> = {
  wildcard: "pi pi-th-large",
  fixed_values: "pi pi-tag",
  combine: "pi pi-share-alt",
  derivation: "pi pi-code",
  constraint: "pi pi-sitemap",
  pipeline: "pi pi-list",
};

function previewKindIcon(k: ModuleType | null): string {
  return k ? KIND_ICON[k] : "pi pi-circle";
}

async function save() {
  if (!name.value.trim()) {
    toast.add({ severity: "warn", summary: "Name required", life: 2000 });
    return;
  }
  saving.value = true;
  try {
    const payload: PipelinePayload = {
      steps: steps.value.map((s) => ({
        id: s.id,
        module_id: s.module_id,
        enabled: s.enabled,
        ...(s.instance ? { instance: s.instance } : {}),
      })),
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
      await moduleStore.create({ type: "pipeline", ...body });
    }
    toast.add({ severity: "success", summary: "Saved", detail: name.value, life: 2000 });
    router.push("/pipelines");
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
      <RouterLink to="/pipelines" class="text-xs text-wp-text2 hover:text-wp-text">
        <i class="pi pi-angle-left text-xs" /> Pipelines
      </RouterLink>
      <h1 class="text-xl font-semibold m-0 mt-1">{{ isEdit ? "Edit pipeline" : "New pipeline" }}</h1>
    </div>

    <div class="form-page__body">
      <!-- A) Identity -->
      <section class="form-section">
        <h2 class="form-section__label">Identity</h2>
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label for="pl-name" class="block text-xs text-wp-text2 mb-1">Name</label>
            <InputText id="pl-name" v-model="name" class="w-full" />
          </div>
          <div>
            <label for="pl-cat" class="block text-xs text-wp-text2 mb-1">Category</label>
            <Select
              id="pl-cat" v-model="categoryId"
              :options="categoryStore.items" option-label="name" option-value="id"
              placeholder="None" show-clear class="w-full"
            />
          </div>
          <div class="col-span-2">
            <label for="pl-desc" class="block text-xs text-wp-text2 mb-1">Description</label>
            <Textarea id="pl-desc" v-model="description" rows="2" class="w-full" />
          </div>
          <div class="col-span-2">
            <label for="pl-tags" class="block text-xs text-wp-text2 mb-1">Tags</label>
            <AutoComplete
              id="pl-tags"
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

      <!-- B) Steps stack -->
      <section class="form-section">
        <div class="flex items-center justify-between mb-2">
          <h2 class="form-section__label m-0">Modules ({{ steps.length }})</h2>
          <span class="text-xs text-wp-text3">Resolve top to bottom — each appends to context</span>
        </div>
        <Card>
          <template #content>
            <PipelineSteps
              :steps="steps"
              :modules-by-id="modulesById"
              :modules-by-kind="modulesByKind"
              @update:steps="onStepsUpdate"
              @open-picker="pickerOpen = true"
            />
          </template>
        </Card>
      </section>

      <!-- D) Resolution preview -->
      <section v-if="preview.length" class="form-section">
        <h2 class="form-section__label">Resolution preview</h2>
        <Card>
          <template #content>
            <p class="text-xs text-wp-text3 m-0 mb-2">
              Synthetic flow — shows the variables each enabled step binds into the resolved context.
            </p>
            <div class="wp-pl-flow" data-test="pipeline-preview">
              <div
                v-for="ps in preview" :key="ps.index"
                class="wp-pl-flow__step"
                :data-kind="ps.kind ?? 'unknown'"
              >
                <div class="wp-pl-flow__head">
                  <span class="wp-pl-flow__idx">{{ String(ps.index + 1).padStart(2, "0") }}</span>
                  <i :class="previewKindIcon(ps.kind)" class="wp-pl-flow__icon" aria-hidden="true" />
                  <span class="wp-pl-flow__name">{{ ps.name }}</span>
                </div>
                <div v-if="ps.bindings.length" class="wp-pl-flow__adds">
                  <div
                    v-for="(b, j) in ps.bindings" :key="j"
                    class="wp-pl-flow__binding"
                    :class="{ 'wp-pl-flow__binding--mut': b.isMutation }"
                  >{{ b.text }}</div>
                </div>
              </div>
            </div>
          </template>
        </Card>
      </section>
    </div>

    <!-- C) Picker modal -->
    <PipelineStepPicker
      v-model:visible="pickerOpen"
      :modules="allModules"
      :categories="categoryStore.items"
      @pick="onPick"
    />

    <!-- E) Footer -->
    <div class="form-page__footer">
      <Button label="Cancel" severity="secondary" outlined @click="router.push('/pipelines')" />
      <Button label="Save" icon="pi pi-check" severity="primary" :loading="saving" data-test="save-btn" @click="save" />
    </div>
  </div>
</template>

<style scoped>
.form-page { display: flex; flex-direction: column; min-height: calc(100vh - 56px); }
.form-page__header { padding: 24px 24px 0; }
.form-page__body { padding: 16px 24px 96px; max-width: 60rem; flex: 1; }
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

.wp-pl-flow {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.wp-pl-flow__step {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 12px;
  background: var(--wp-bg);
  border: 1px solid var(--wp-border);
  border-left: 3px solid var(--step-color, var(--wp-accent-500));
  border-radius: var(--wp-radius);
  position: relative;
}
.wp-pl-flow__step[data-kind="wildcard"]     { --step-color: var(--wp-kind-wildcard); }
.wp-pl-flow__step[data-kind="fixed_values"] { --step-color: var(--wp-kind-fixed); }
.wp-pl-flow__step[data-kind="combine"]      { --step-color: var(--wp-kind-combine); }
.wp-pl-flow__step[data-kind="derivation"]   { --step-color: var(--wp-kind-derivation); }
.wp-pl-flow__step[data-kind="constraint"]   { --step-color: var(--wp-kind-constraint); }
.wp-pl-flow__step + .wp-pl-flow__step::before {
  content: "";
  position: absolute;
  top: -5px;
  left: 18px;
  width: 1px;
  height: 6px;
  background: var(--wp-border);
}
.wp-pl-flow__head {
  display: flex; align-items: center; gap: 8px;
  color: var(--wp-text);
}
.wp-pl-flow__idx {
  font-family: var(--wp-font-mono, ui-monospace, monospace);
  font-size: 10.5px;
  padding: 1px 5px;
  border-radius: 3px;
  background: var(--wp-bg2);
  border: 1px solid var(--wp-border);
  color: var(--wp-text3);
}
.wp-pl-flow__icon {
  color: var(--step-color, var(--wp-text2));
  font-size: 12px;
}
.wp-pl-flow__name {
  font-weight: 500;
  font-size: 12.5px;
}
.wp-pl-flow__adds {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-left: 30px;
}
.wp-pl-flow__binding {
  font-family: var(--wp-font-mono, ui-monospace, monospace);
  font-size: 12px;
  color: var(--wp-text);
  line-height: 1.4;
}
.wp-pl-flow__binding--mut { color: var(--wp-text2); font-style: italic; }
</style>
