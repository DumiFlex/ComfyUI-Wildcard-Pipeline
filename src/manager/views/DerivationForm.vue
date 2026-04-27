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
import { useModuleStore } from "../stores/moduleStore";
import { useCategoryStore } from "../stores/categoryStore";
import DerivationRuleCard from "../components/DerivationRuleCard.vue";
import type {
  DerivationAction,
  DerivationBranch,
  DerivationElse,
  DerivationPayload,
  DerivationRule,
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
const rules = ref<DerivationRule[]>([]);
const saving = ref(false);
const isEdit = computed(() => !!props.id);

// Variable suggestions are populated by the parent surface in the future. For
// now this is intentionally an empty list — the rule card falls back to a free
// InputText when no suggestions are provided.
const varSuggestions = ref<string[]>([]);

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

let ruleSeq = 0;
function newRuleId(): string {
  ruleSeq += 1;
  return `r_${Date.now().toString(36)}_${ruleSeq}`;
}

function blankAction(): DerivationAction {
  return { target_var: "", mode: "replace", value: "" };
}
function blankBranch(): DerivationBranch {
  return {
    condition: { var: "", op: "equals", value: "" },
    action: blankAction(),
  };
}
function blankRule(): DerivationRule {
  return { id: newRuleId(), branches: [blankBranch()] };
}

function migrateRule(raw: unknown): DerivationRule {
  const r = (raw ?? {}) as Partial<DerivationRule> & {
    else?: Partial<DerivationElse> | DerivationAction | null;
  };
  const id = typeof r.id === "string" && r.id ? r.id : newRuleId();
  const branchesIn = Array.isArray(r.branches) ? r.branches : [];
  const branches: DerivationBranch[] = branchesIn.length
    ? branchesIn.map((b) => migrateBranch(b))
    : [blankBranch()];
  const out: DerivationRule = { id, branches };
  if (r.else && typeof r.else === "object") {
    // Tolerate either {action: ...} (canonical) or a bare action object (older
    // designs / the simplified handoff spec).
    const wrapped = (r.else as Partial<DerivationElse>).action;
    const action = wrapped
      ? migrateAction(wrapped)
      : migrateAction(r.else as Partial<DerivationAction>);
    out.else = { action };
  }
  return out;
}

function migrateBranch(raw: unknown): DerivationBranch {
  const b = (raw ?? {}) as Partial<DerivationBranch>;
  const cIn = (b.condition ?? {}) as Record<string, unknown>;
  const aIn = (b.action ?? {}) as Record<string, unknown>;
  const op = typeof cIn.op === "string" ? cIn.op : "equals";
  return {
    condition: {
      var: typeof cIn.var === "string" ? cIn.var : "",
      op: (op === "equals" || op === "not_equals" || op === "contains" || op === "matches"
        ? op
        : "equals") as DerivationBranch["condition"]["op"],
      value: typeof cIn.value === "string" ? cIn.value : "",
    },
    action: migrateAction(aIn),
  };
}

function migrateAction(raw: unknown): DerivationAction {
  const a = (raw ?? {}) as Record<string, unknown>;
  const target =
    typeof a.target_var === "string"
      ? a.target_var
      : typeof a.target === "string"
        ? a.target
        : "";
  const mode = typeof a.mode === "string" ? a.mode : "replace";
  return {
    target_var: target,
    mode: (mode === "replace" || mode === "append" || mode === "prepend"
      ? mode
      : "replace") as DerivationAction["mode"],
    value: typeof a.value === "string" ? a.value : "",
  };
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
      const p = row.payload as Partial<DerivationPayload>;
      const incoming = Array.isArray(p.rules) ? p.rules : [];
      rules.value = incoming.length ? incoming.map(migrateRule) : [];
    } catch {
      toast.add({ severity: "error", summary: "Derivation not found", life: 3000 });
      router.replace("/derivations");
    }
  }
});

function addRule() {
  rules.value = [...rules.value, blankRule()];
}

function removeRule(idx: number) {
  rules.value = rules.value.filter((_, i) => i !== idx);
}

function updateRule(idx: number, value: DerivationRule) {
  rules.value = rules.value.map((r, i) => (i === idx ? value : r));
}

async function save() {
  if (!name.value.trim()) {
    toast.add({ severity: "warn", summary: "Name required", life: 2000 });
    return;
  }
  saving.value = true;
  try {
    const payload: DerivationPayload = { rules: rules.value };
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
      await moduleStore.create({ type: "derivation", ...body });
    }
    toast.add({ severity: "success", summary: "Saved", detail: name.value, life: 2000 });
    router.push("/derivations");
  } catch (e) {
    toast.add({ severity: "error", summary: "Save failed", detail: String(e), life: 4000 });
  } finally {
    saving.value = false;
  }
}

defineExpose({ rules, addRule, removeRule });
</script>

<template>
  <div class="form-page">
    <div class="form-page__header">
      <RouterLink to="/derivations" class="text-xs text-wp-text2 hover:text-wp-text">
        <i class="pi pi-angle-left text-xs" /> Derivations
      </RouterLink>
      <h1 class="text-xl font-semibold m-0 mt-1">{{ isEdit ? "Edit derivation" : "New derivation" }}</h1>
    </div>

    <div class="form-page__body">
      <!-- A) Identity -->
      <section class="form-section">
        <h2 class="form-section__label">Identity</h2>
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label for="dv-name" class="block text-xs text-wp-text2 mb-1">Name</label>
            <InputText id="dv-name" v-model="name" class="w-full" />
          </div>
          <div>
            <label for="dv-cat" class="block text-xs text-wp-text2 mb-1">Category</label>
            <Select
              id="dv-cat" v-model="categoryId"
              :options="categoryStore.items" option-label="name" option-value="id"
              placeholder="None" show-clear class="w-full"
            />
          </div>
          <div class="col-span-2">
            <label for="dv-desc" class="block text-xs text-wp-text2 mb-1">Description</label>
            <Textarea id="dv-desc" v-model="description" rows="2" class="w-full" />
          </div>
          <div class="col-span-2">
            <label for="dv-tags" class="block text-xs text-wp-text2 mb-1">Tags</label>
            <AutoComplete
              id="dv-tags"
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

      <!-- B) Rules -->
      <section class="form-section">
        <div class="flex items-center justify-between mb-1">
          <h2 class="form-section__label m-0">Rules ({{ rules.length }})</h2>
          <Button
            label="Add rule"
            icon="pi pi-plus"
            size="small"
            severity="primary"
            data-test="add-rule"
            aria-label="Add rule"
            @click="addRule"
          />
        </div>
        <p class="text-xs text-wp-text2 mb-3">
          All rules evaluate independently. Each rule may have multiple ELIF branches and an optional ELSE.
        </p>

        <Card v-if="rules.length === 0" data-test="rules-empty">
          <template #content>
            <div class="text-sm text-wp-text2 py-6 text-center">
              No rules yet. Click <strong>Add rule</strong> to start defining IF / ELIF / ELSE behaviour.
            </div>
          </template>
        </Card>

        <div v-else class="rules-stack" data-test="rules-stack">
          <DerivationRuleCard
            v-for="(rule, idx) in rules"
            :key="rule.id"
            :model-value="rule"
            :index="idx"
            :var-suggestions="varSuggestions"
            :data-test="`rule-${idx}`"
            @update:model-value="(v) => updateRule(idx, v)"
            @remove="removeRule(idx)"
          />
        </div>
      </section>
    </div>

    <div class="form-page__footer">
      <Button label="Cancel" severity="secondary" outlined @click="router.push('/derivations')" />
      <Button label="Save" icon="pi pi-check" severity="primary" :loading="saving" data-test="save-btn" @click="save" />
    </div>
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
  display: flex; gap: 8px; justify-content: flex-end;
}
.form-section { margin-bottom: 24px; }
.form-section__label {
  font-size: 11px; text-transform: uppercase;
  letter-spacing: 0.5px; color: var(--wp-text2);
  margin: 0 0 8px 0;
}
.rules-stack {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
</style>
