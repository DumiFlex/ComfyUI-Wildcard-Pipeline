<script setup lang="ts">
/**
 * PipelineEditor — Wave 4 port of `PipelineEditor` in `screens/editors.jsx`.
 *
 * Sections:
 *  1. Identity
 *  2. Steps stack (PipelineSteps + PipelineStepPicker modal)
 *  3. Resolution preview (synthetic flow)
 */
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import EditorFrame from "../components/EditorFrame.vue";
import IdentityCard from "../components/IdentityCard.vue";
import Card from "../components/ui/Card.vue";
import PipelineSteps from "../components/PipelineSteps.vue";
import PipelineStepPicker from "../components/PipelineStepPicker.vue";
import { useToast } from "../composables/useToast";
import { api } from "../api/client";
import { useModuleStore } from "../stores/moduleStore";
import { useCategoryStore } from "../stores/categoryStore";
import { appendSnapshot, readHistory } from "../utils/history";
import type {
  CombinePayload,
  ConstraintPayload,
  DerivationPayload,
  ModuleHistoryEntry,
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
const historyEntries = ref<ModuleHistoryEntry[]>([]);

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

async function loadAllModules() {
  try {
    const res = await api.modules.list({});
    allModules.value = res.items;
  } catch (e) {
    toast.push({ severity: "error", summary: "Failed to load modules", detail: String(e), life: 3000 });
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
      historyEntries.value = readHistory(row.payload);
    } catch {
      toast.push({ severity: "error", summary: "Pipeline not found" });
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

function applyRestore(entry: ModuleHistoryEntry): void {
  name.value = entry.name;
  description.value = entry.description ?? "";
  categoryId.value = entry.category_id ?? null;
  tags.value = entry.tags ? [...entry.tags] : [];
  const p = (entry.payload ?? {}) as Partial<PipelinePayload>;
  steps.value = (p.steps ?? []).map((s) => ({
    id: s.id || `step_${Math.random().toString(16).slice(2, 8)}`,
    module_id: s.module_id,
    enabled: s.enabled !== false,
    ...(s.instance ? { instance: s.instance } : {}),
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
    const newPayload = payload as unknown as Record<string, unknown>;
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
        name: name.value,
        description: description.value,
        category_id: categoryId.value,
        tags: tags.value,
        payload: { ...newPayload, history: nextHistory },
      });
      historyEntries.value = nextHistory;
    } else {
      await moduleStore.create({
        type: "pipeline",
        name: name.value,
        description: description.value,
        category_id: categoryId.value,
        tags: tags.value,
        payload: newPayload,
      });
    }
    toast.push({ severity: "success", summary: "Saved", detail: name.value });
    router.push("/pipelines");
  } catch (e) {
    toast.push({ severity: "error", summary: "Save failed", detail: String(e), life: 4000 });
  } finally {
    saving.value = false;
  }
}

function cancel() { router.push("/pipelines"); }
</script>

<template>
  <EditorFrame
    :title="isEdit ? 'Edit pipeline' : 'New pipeline'"
    back-route="/pipelines"
    back-label="Pipelines"
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

    <Card :title="`Modules (${steps.length})`">
      <template #actions>
        <span class="wp-dim pl-hint">Resolve top to bottom — each appends to context</span>
      </template>
      <PipelineSteps
        :steps="steps"
        :modules-by-id="modulesById"
        :modules-by-kind="modulesByKind"
        @update:steps="onStepsUpdate"
        @open-picker="pickerOpen = true"
      />
    </Card>

    <Card v-if="preview.length" title="Resolution preview">
      <template #actions>
        <span class="wp-dim pl-hint">Synthetic example — picks first option per wildcard</span>
      </template>
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
    </Card>

    <PipelineStepPicker
      v-model:visible="pickerOpen"
      :modules="allModules"
      :categories="categoryStore.items"
      @pick="onPick"
    />
  </EditorFrame>
</template>

<style scoped>
.pl-hint { font-size: 11.5px; }
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
  background: var(--wp-bg-2);
  border: 1px solid var(--wp-border);
  color: var(--wp-text-dim);
}
.wp-pl-flow__icon {
  color: var(--step-color, var(--wp-text-muted));
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
.wp-pl-flow__binding--mut { color: var(--wp-text-muted); font-style: italic; }
</style>
