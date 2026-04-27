<script setup lang="ts">
/**
 * DerivationEditor — Wave 4 port of `DerivationEditor` in `screens/editors.jsx`.
 *
 * Sections:
 *  1. Identity
 *  2. Rules list (DerivationRuleCard, with add/remove)
 */
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import EditorFrame from "../components/EditorFrame.vue";
import IdentityCard from "../components/IdentityCard.vue";
import Card from "../components/ui/Card.vue";
import Button from "../components/ui/Button.vue";
import DerivationRuleCard from "../components/DerivationRuleCard.vue";
import { useToast } from "../composables/useToast";
import { useModuleStore } from "../stores/moduleStore";
import { useCategoryStore } from "../stores/categoryStore";
import { appendSnapshot, readHistory } from "../utils/history";
import type {
  DerivationAction,
  DerivationBranch,
  DerivationElse,
  DerivationPayload,
  DerivationRule,
  ModuleHistoryEntry,
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
const historyEntries = ref<ModuleHistoryEntry[]>([]);

const varSuggestions = ref<string[]>([]);

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
      historyEntries.value = readHistory(row.payload);
    } catch {
      toast.push({ severity: "error", summary: "Derivation not found" });
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

function applyRestore(entry: ModuleHistoryEntry): void {
  name.value = entry.name;
  description.value = entry.description ?? "";
  categoryId.value = entry.category_id ?? null;
  tags.value = entry.tags ? [...entry.tags] : [];
  const p = (entry.payload ?? {}) as Partial<DerivationPayload>;
  const incoming = Array.isArray(p.rules) ? p.rules : [];
  rules.value = incoming.length ? incoming.map(migrateRule) : [];
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
    const payload: DerivationPayload = { rules: rules.value };
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
        type: "derivation",
        name: name.value,
        description: description.value,
        category_id: categoryId.value,
        tags: tags.value,
        payload: newPayload,
      });
    }
    toast.push({ severity: "success", summary: "Saved", detail: name.value });
    router.push("/derivations");
  } catch (e) {
    toast.push({ severity: "error", summary: "Save failed", detail: String(e), life: 4000 });
  } finally {
    saving.value = false;
  }
}

function cancel() { router.push("/derivations"); }

defineExpose({ rules, addRule, removeRule, applyRestore });
</script>

<template>
  <EditorFrame
    :title="isEdit ? 'Edit derivation' : 'New derivation'"
    back-route="/derivations"
    back-label="Derivations"
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

    <Card :title="`Rules (${rules.length})`">
      <template #actions>
        <Button size="sm" variant="primary" icon="pi-plus" data-test="add-rule" @click="addRule">
          Add rule
        </Button>
      </template>
      <p class="wp-card__hint">
        Each rule runs independently. Inside a rule, branches evaluate top-to-bottom — the first matching IF/ELIF wins; the optional ELSE only fires when no branch matched.
      </p>

      <div v-if="rules.length === 0" class="wp-empty-card" data-test="rules-empty">
        No rules yet. Click <strong>Add rule</strong> to start defining IF / ELIF / ELSE behaviour.
      </div>

      <div v-else class="rules-stack" data-test="rules-stack">
        <DerivationRuleCard
          v-for="(rule, idx) in rules"
          :key="rule.id"
          :model-value="rule"
          :index="idx"
          :var-suggestions="varSuggestions"
          :default-collapsed="rules.length > 1"
          :data-test="`rule-${idx}`"
          @update:model-value="(v) => updateRule(idx, v)"
          @remove="removeRule(idx)"
        />
      </div>
    </Card>
  </EditorFrame>
</template>

<style scoped>
.rules-stack {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
</style>
