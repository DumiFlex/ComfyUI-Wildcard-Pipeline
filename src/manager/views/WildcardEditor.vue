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
import type { BreadcrumbItem } from "../components/Breadcrumb.types";
import { useRouter } from "vue-router";
import EditorFrame from "../components/EditorFrame.vue";
import IdentityCard from "../components/IdentityCard.vue";
import Card from "../components/ui/Card.vue";
import Button from "../components/ui/Button.vue";
import Input from "../components/ui/Input.vue";
import Select from "../components/ui/Select.vue";
import Chip from "../components/ui/Chip.vue";
import RichTextInput from "../components/RichTextInput.vue";
import ConfirmDialog from "../../components/shared/ConfirmDialog.vue";
import { useToast } from "../composables/useToast";
import { useUnsavedGuard } from "../composables/useUnsavedGuard";
import { useReturnTo } from "../composables/useReturnTo";
import { useModuleStore } from "../stores/moduleStore";
import { useCategoryStore } from "../stores/categoryStore";
import { useRecentStore } from "../stores/recentStore";
import { toIdentifier, VALID_IDENTIFIER_RE } from "../utils/slug";
import { collectLibraryWildcardRefs } from "../utils/library-suggestions";
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
const recent = useRecentStore();
const { resolveReturnTo } = useReturnTo();

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

// Unsaved-changes guard
const baseline = ref<string>("");

function snapshot(): string {
  return JSON.stringify({
    name: name.value,
    description: description.value,
    categoryId: categoryId.value,
    tags: tags.value,
    varBinding: varBinding.value,
    subCategories: subCategories.value,
    options: options.value,
  });
}

const { showConfirm, dirty, onConfirmLeave, onCancelLeave } = useUnsavedGuard(
  () => snapshot() !== baseline.value,
);

// Suggestions: every other wildcard's id (= 8-hex uuid post DB
// migration 004) for the `@`-trigger nested-reference autocomplete.
// The canonical stored form is `@{8hex}` per the syntax spec — the
// popover surfaces the human display name (via `nameByUuid`) but
// the inserted token is the bare 8-hex id. The id IS the uuid, so
// no extraction step is needed.
//
// Walker extracted to `utils/library-suggestions.ts` (2026-05-09 cycle)
// so derivation editor + future SPA views inherit the same picker.
const wcSuggestions = computed<string[]>(
  () => collectLibraryWildcardRefs(moduleStore, props.id, nameByUuid.value),
);

// UUID → display-name map used by RichTextInput to render `@{uuid}`
// chips and the `@`-trigger autocomplete popover with human labels.
// Keyed by `mod.id` (= 8-hex uuid) so the popover, the inline chip,
// and the resolver all agree on identity.
const nameByUuid = computed<Map<string, string>>(() => {
  const m = new Map<string, string>();
  for (const mod of moduleStore.catalog) {
    if (mod.type !== "wildcard") continue;
    const p = (mod.payload ?? {}) as { var_binding?: string };
    const display = (p.var_binding && p.var_binding.trim()) || toIdentifier(mod.name);
    if (display) m.set(mod.id, display);
  }
  return m;
});

// Suggestions: union of upstream `$var` names for inline `$`-trigger autocomplete.
const varSuggestions = computed<string[]>(() => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of moduleStore.catalog) {
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
  await Promise.all([categoryStore.fetchAll(), moduleStore.fetchCatalog()]);
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
      recent.push({ id: props.id, kind: "wildcard", name: name.value });
    } catch {
      toast.push({ severity: "error", summary: "Wildcard not found" });
      router.replace("/wildcards");
    }
  }
  baseline.value = snapshot();
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
      recent.push({ id: props.id, kind: "wildcard", name: name.value });
    } else {
      // New mode: moduleStore.create() does not expose the new id on the
      // returned row in a way that's stable across mock/real backends.
      // The next time the user opens this item the mount-time push fires.
      await moduleStore.create({
        type: "wildcard",
        name: name.value, description: description.value,
        category_id: categoryId.value, tags: tags.value,
        payload: newPayload,
      });
    }
    toast.push({ severity: "success", summary: "Saved", detail: name.value });
    baseline.value = snapshot();
    router.push(resolveReturnTo("/wildcards"));
  } catch (e) {
    toast.push({ severity: "error", summary: "Save failed", detail: String(e), life: 4000 });
  } finally {
    saving.value = false;
  }
}

function cancel() { router.push(resolveReturnTo("/wildcards")); }

const breadcrumb = computed<BreadcrumbItem[]>(() => [
  { to: "/dashboard", label: "Library" },
  { to: "/wildcards", label: "Wildcards" },
  { label: isEdit.value ? (name.value || "Editing") : "New wildcard" },
]);

defineExpose({ historyEntries, applyRestore });
</script>

<template>
  <EditorFrame
    :title="isEdit ? 'Edit wildcard' : 'New wildcard'"
    back-route="/wildcards"
    back-label="Wildcards"
    :breadcrumb="breadcrumb"
    :saving="saving"
    :dirty="dirty"
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
        <span class="wp-card__hint">Optional groupings inside this wildcard</span>
      </template>
      <div class="sub-add-row">
        <Input
          v-model="subDraft"
          placeholder="e.g. warm tones"
          data-test="wc-sub-input"
          @keydown.enter.prevent="addSub"
        />
        <Button icon="pi-plus" data-test="wc-sub-add" @click="addSub">Add</Button>
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
      <span v-else class="wp-card__hint">No sub-categories yet.</span>
    </Card>

    <Card :title="`Options (${options.length})`" :padding="false">
      <template #actions>
        <Button size="sm" variant="primary" icon="pi-plus" data-test="wc-add-opt" @click="addOption">
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
                :uuid-to-name="nameByUuid"
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
                icon="pi-trash"
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

    <!-- ConfirmDialog lives INSIDE EditorFrame so the template has a single
         root vnode. Multi-root templates break the parent RouterView's
         <Transition mode="out-in"> after this component unmounts — the
         transition tracker desyncs and the destination view never paints.
         Dialog still Teleports to body via its internal <Teleport>; the
         source placement here only affects vnode tracking. -->
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
.sub-add-row {
  display: flex;
  gap: var(--wp-space-4);
  margin-bottom: var(--wp-space-5);
}
.sub-add-row > :first-child { flex: 1; }
.sub-list {
  display: flex;
  flex-wrap: wrap;
  gap: var(--wp-space-3);
}
.wp-options-table {
  font-size: var(--wp-text-sm);
}
.opt-col-weight { width: 90px; }
.opt-col-sub { width: 200px; }
.opt-col-prob { width: 130px; }
.opt-col-trash { width: 40px; }
.opt-empty {
  text-align: center;
  padding: var(--wp-space-6);
  color: var(--wp-text-dim);
}
.opt-prob {
  display: flex;
  align-items: center;
  gap: var(--wp-space-3);
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
  background: var(--wp-accent-gradient);
}
.opt-prob__value {
  width: 32px;
  text-align: right;
  font-size: var(--wp-text-xs);
  color: var(--wp-text-dim);
}
</style>
