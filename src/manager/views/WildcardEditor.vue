<script setup lang="ts">
/**
 * WildcardEditor — Wave 4 port of `WildcardEditor` in `screens/editors.jsx`.
 *
 * Sections:
 *  1. Identity (name + category + description + tags + `$varBinding`)
 *  2. Sub-categories chip list
 *  3. Options table (weight + value RichTextInput + sub-category Select)
 *
 * Save flow appends a snapshot to `payload.history` (utils/history.ts) so
 * the EditorFrame's history button works on the next mount.
 */
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import EditorFrame from "../components/EditorFrame.vue";
import IdentityCard from "../components/IdentityCard.vue";
import Card from "../components/ui/Card.vue";
import Button from "../components/ui/Button.vue";
import Input from "../components/ui/Input.vue";
import Select from "../components/ui/Select.vue";
import Chip from "../components/ui/Chip.vue";
import RichTextInput from "../components/RichTextInput.vue";
import { useToast } from "../composables/useToast";
import { useModuleStore } from "../stores/moduleStore";
import { useCategoryStore } from "../stores/categoryStore";
import { toIdentifier, VALID_IDENTIFIER_RE } from "../utils/slug";
import { appendSnapshot, readHistory } from "../utils/history";
import type {
  CombinePayload,
  ModuleHistoryEntry,
  WildcardOption,
  WildcardPayload,
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
const varBinding = ref("");
const varBindingError = ref("");
const subCategories = ref<string[]>([]);
const subDraft = ref("");
const options = ref<WildcardOption[]>([
  { id: `opt_${Math.random().toString(16).slice(2, 8)}`, value: "", weight: 1 },
  { id: `opt_${Math.random().toString(16).slice(2, 8)}`, value: "", weight: 1 },
]);
const saving = ref(false);
const isEdit = computed(() => !!props.id);
const historyEntries = ref<ModuleHistoryEntry[]>([]);

// Suggestions: every other wildcard's binding (excluding self) for `@`-trigger
// nested-reference autocomplete.
const wcSuggestions = computed<string[]>(() => {
  const out: string[] = [];
  for (const m of moduleStore.items) {
    if (m.type !== "wildcard") continue;
    if (props.id && m.id === props.id) continue;
    const p = (m.payload ?? {}) as { var_binding?: string };
    const b = (p.var_binding && p.var_binding.trim()) || toIdentifier(m.name);
    if (b && !out.includes(b)) out.push(b);
  }
  return out.sort();
});

// Suggestions: union of upstream `$var` names for inline `$`-trigger autocomplete.
const varSuggestions = computed<string[]>(() => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of moduleStore.items) {
    if (props.id && m.id === props.id) continue;
    if (m.type === "wildcard") {
      const p = (m.payload ?? {}) as Partial<WildcardPayload>;
      const b = (p.var_binding && p.var_binding.trim()) || toIdentifier(m.name);
      if (b && !seen.has(b)) { seen.add(b); out.push(b); }
    } else if (m.type === "fixed_values") {
      const values = ((m.payload ?? {}) as { values?: { name?: string }[] }).values ?? [];
      for (const row of values) {
        const n = (row.name ?? "").replace(/^\$+/, "").trim();
        if (n && !seen.has(n)) { seen.add(n); out.push(n); }
      }
    } else if (m.type === "combine") {
      const p = (m.payload ?? {}) as Partial<CombinePayload>;
      const o = (p.output_var ?? "").replace(/^\$+/, "").trim();
      if (o && !seen.has(o)) { seen.add(o); out.push(o); }
    }
  }
  return out.sort();
});

const subCategoryOptions = computed(() => [
  { value: "", label: "(none)" },
  ...subCategories.value.map((s) => ({ value: s, label: s })),
]);

const totalWeight = computed(() => {
  const sum = options.value.reduce((acc, o) => acc + (Number(o.weight) || 0), 0);
  return sum > 0 ? sum : 1;
});

function probabilityFor(o: WildcardOption): number {
  return ((Number(o.weight) || 0) / totalWeight.value) * 100;
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
      const p = row.payload as Partial<WildcardPayload>;
      options.value = (p.options ?? []).map((o) => ({ ...o }));
      subCategories.value = [...(p.sub_categories ?? [])];
      varBinding.value = (p.var_binding && p.var_binding.trim()) || toIdentifier(row.name);
      historyEntries.value = readHistory(row.payload);
    } catch {
      toast.push({ severity: "error", summary: "Wildcard not found" });
      router.replace("/wildcards");
    }
  }
});

function addSub() {
  const s = subDraft.value.trim();
  if (!s) return;
  if (subCategories.value.includes(s)) {
    toast.push({ severity: "warn", summary: "Duplicate sub-category" });
    return;
  }
  subCategories.value.push(s);
  subDraft.value = "";
}

function removeSub(s: string) {
  subCategories.value = subCategories.value.filter((x) => x !== s);
  for (const o of options.value) if (o.sub_category === s) o.sub_category = null;
}

function addOption() {
  options.value.push({
    id: `opt_${Math.random().toString(16).slice(2, 8)}`,
    value: "",
    weight: 1,
  });
}
function removeOption(idx: number) { options.value.splice(idx, 1); }

function applyRestore(entry: ModuleHistoryEntry): void {
  name.value = entry.name;
  description.value = entry.description ?? "";
  categoryId.value = entry.category_id ?? null;
  tags.value = entry.tags ? [...entry.tags] : [];
  const p = (entry.payload ?? {}) as Partial<WildcardPayload>;
  options.value = (p.options ?? []).map((o) => ({ ...o }));
  subCategories.value = [...(p.sub_categories ?? [])];
  varBinding.value = (p.var_binding && p.var_binding.trim()) || toIdentifier(entry.name);
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
  const finalBinding = varBinding.value.trim() || toIdentifier(name.value);
  if (!VALID_IDENTIFIER_RE.test(finalBinding)) {
    varBindingError.value = "Use letters, digits, underscores; must not start with a digit.";
    toast.push({ severity: "warn", summary: "Invalid variable name" });
    return;
  }
  varBindingError.value = "";
  saving.value = true;
  try {
    const payload: WildcardPayload = {
      options: options.value,
      sub_categories: subCategories.value,
      var_binding: finalBinding,
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
        name: name.value, description: description.value,
        category_id: categoryId.value, tags: tags.value,
        payload: { ...newPayload, history: nextHistory },
      });
      historyEntries.value = nextHistory;
    } else {
      await moduleStore.create({
        type: "wildcard",
        name: name.value, description: description.value,
        category_id: categoryId.value, tags: tags.value,
        payload: newPayload,
      });
    }
    toast.push({ severity: "success", summary: "Saved", detail: name.value });
    router.push("/wildcards");
  } catch (e) {
    toast.push({ severity: "error", summary: "Save failed", detail: String(e), life: 4000 });
  } finally {
    saving.value = false;
  }
}

function cancel() { router.push("/wildcards"); }

defineExpose({ historyEntries, applyRestore });
</script>

<template>
  <EditorFrame
    :title="isEdit ? 'Edit wildcard' : 'New wildcard'"
    back-route="/wildcards"
    back-label="Wildcards"
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
      :var-binding="varBinding"
      :var-binding-error="varBindingError"
      @update:name="(v) => (name = v)"
      @update:description="(v) => (description = v)"
      @update:category-id="(v) => (categoryId = v)"
      @update:tags="(v) => (tags = v)"
      @update:var-binding="(v) => (varBinding = v)"
    />

    <Card title="Sub-Categories">
      <template #actions>
        <span class="wp-dim wp-text-xs">Optional groupings inside this wildcard</span>
      </template>
      <div class="sub-add-row">
        <Input
          v-model="subDraft"
          placeholder="e.g. warm tones"
          data-test="wc-sub-input"
          @keydown.enter.prevent="addSub"
        />
        <Button icon="pi pi-plus" data-test="wc-sub-add" @click="addSub">Add</Button>
      </div>
      <div v-if="subCategories.length" class="sub-list">
        <Chip
          v-for="s in subCategories"
          :key="s"
          tone="accent"
          removable
          @remove="removeSub(s)"
        >{{ s }}</Chip>
      </div>
      <span v-else class="wp-dim wp-text-xs">No sub-categories yet.</span>
    </Card>

    <Card :title="`Options (${options.length})`" :padding="false">
      <template #actions>
        <Button size="sm" variant="primary" icon="pi pi-plus" data-test="wc-add-opt" @click="addOption">
          Add option
        </Button>
      </template>
      <table class="wp-table wp-options-table">
        <thead>
          <tr>
            <th class="opt-col-weight">Weight</th>
            <th>Value</th>
            <th class="opt-col-sub">Sub-category</th>
            <th class="opt-col-prob">Probability</th>
            <th class="opt-col-trash" />
          </tr>
        </thead>
        <tbody>
          <tr v-for="(o, i) in options" :key="o.id">
            <td>
              <Input
                :model-value="o.weight"
                type="number"
                size="sm"
                aria-label="Option weight"
                @update:model-value="(v) => (o.weight = Number(v) || 0)"
              />
            </td>
            <td>
              <RichTextInput
                v-model="o.value"
                :ref-suggestions="wcSuggestions"
                :var-suggestions="varSuggestions"
                placeholder="value (type @ for nested wildcards · {a|b|c} for inline choices)"
                aria-label="Option value"
              />
            </td>
            <td>
              <Select
                :model-value="o.sub_category ?? ''"
                :options="subCategoryOptions"
                placeholder="(none)"
                clearable
                aria-label="Sub-category for option"
                @update:model-value="(v) => (o.sub_category = (v as string) || null)"
              />
            </td>
            <td>
              <div class="opt-prob">
                <div class="opt-prob__bar">
                  <div class="opt-prob__fill" :style="{ width: probabilityFor(o) + '%' }" />
                </div>
                <span class="opt-prob__value wp-mono">{{ probabilityFor(o).toFixed(0) }}%</span>
              </div>
            </td>
            <td>
              <Button
                size="sm"
                variant="ghost"
                icon="pi pi-trash"
                class="wp-btn--danger"
                aria-label="Remove option"
                @click="removeOption(i)"
              />
            </td>
          </tr>
          <tr v-if="!options.length">
            <td colspan="5" class="opt-empty">No options yet.</td>
          </tr>
        </tbody>
      </table>
    </Card>
  </EditorFrame>
</template>

<style scoped>
.wp-text-xs { font-size: 11.5px; }
.sub-add-row {
  display: flex;
  gap: 8px;
  margin-bottom: 10px;
}
.sub-add-row > :first-child { flex: 1; }
.sub-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.wp-options-table {
  font-size: 12.5px;
}
.opt-col-weight { width: 90px; }
.opt-col-sub { width: 200px; }
.opt-col-prob { width: 130px; }
.opt-col-trash { width: 40px; }
.opt-empty {
  text-align: center;
  padding: 16px;
  color: var(--wp-text-dim);
}
.opt-prob {
  display: flex;
  align-items: center;
  gap: 6px;
}
.opt-prob__bar {
  flex: 1;
  height: 6px;
  background: var(--wp-bg-3);
  border-radius: 999px;
  overflow: hidden;
}
.opt-prob__fill {
  height: 100%;
  background: linear-gradient(90deg, var(--wp-accent-500), var(--wp-accent-400));
}
.opt-prob__value {
  width: 32px;
  text-align: right;
  font-size: 11px;
  color: var(--wp-text-dim);
}
</style>
