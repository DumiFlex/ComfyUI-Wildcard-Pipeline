<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import Textarea from "primevue/textarea";
import InputNumber from "primevue/inputnumber";
import Select from "primevue/select";
import AutoComplete from "primevue/autocomplete";
import { useToast } from "primevue/usetoast";
import RichTextInput from "../components/RichTextInput.vue";
import { useModuleStore } from "../stores/moduleStore";
import { useCategoryStore } from "../stores/categoryStore";
import { toIdentifier, VALID_IDENTIFIER_RE } from "../utils/slug";
import type { WildcardOption, WildcardPayload } from "../api/types";

const props = defineProps<{ id?: string }>();
const router = useRouter();
const moduleStore = useModuleStore();
const categoryStore = useCategoryStore();
const toast = useToast();

const name = ref("");
const description = ref("");
const categoryId = ref<string | null>(null);
const tags = ref<string[]>([]);
const options = ref<WildcardOption[]>([]);
const subCategories = ref<string[]>([]);
const newSubCategory = ref("");
const varBinding = ref("");
// Tracks whether the user has manually edited the var_binding field. While
// false, the field auto-tracks the (slugified) name; once true we never
// clobber the user's value.
const varBindingTouched = ref(false);
const varBindingError = ref("");
const saving = ref(false);
const isEdit = computed(() => !!props.id);

const subCategoryOptions = computed(() => [
  { label: "(none)", value: null as string | null },
  ...subCategories.value.map((s) => ({ label: s, value: s })),
]);

// Suggestions for option-value RichTextInput: every other wildcard's
// var_binding (or slug fallback). Self is excluded so authors don't write
// a recursive reference by accident.
const otherWildcardBindings = computed<string[]>(() => {
  const out: string[] = [];
  for (const m of moduleStore.items) {
    if (m.type !== "wildcard") continue;
    if (props.id && m.id === props.id) continue;
    const p = (m.payload ?? {}) as { var_binding?: string };
    const binding = (p.var_binding && p.var_binding.trim()) || toIdentifier(m.name);
    if (binding && !out.includes(binding)) out.push(binding);
  }
  return out;
});

watch(name, (next) => {
  if (!varBindingTouched.value) {
    varBinding.value = toIdentifier(next);
  }
});

function onVarBindingInput(value: string | undefined): void {
  varBindingTouched.value = true;
  varBinding.value = value ?? "";
  if (varBindingError.value) varBindingError.value = "";
}

function addSubCategory() {
  const v = newSubCategory.value.trim();
  if (!v) return;
  if (subCategories.value.includes(v)) {
    toast.add({ severity: "warn", summary: "Duplicate sub-category", life: 1500 });
    return;
  }
  subCategories.value.push(v);
  newSubCategory.value = "";
}

function removeSubCategory(s: string) {
  subCategories.value = subCategories.value.filter((x) => x !== s);
  // Also clear it from any option assignment
  for (const o of options.value) if (o.sub_category === s) o.sub_category = null;
}

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
      const payload = row.payload as Partial<WildcardPayload>;
      options.value = payload.options ?? [];
      subCategories.value = payload.sub_categories ?? [];
      if (payload.var_binding && payload.var_binding.trim()) {
        varBinding.value = payload.var_binding;
        varBindingTouched.value = true;
      } else {
        varBinding.value = toIdentifier(row.name);
      }
    } catch {
      toast.add({ severity: "error", summary: "Wildcard not found", life: 3000 });
      router.replace("/wildcards");
    }
  }
});

function addOption() {
  const id = `opt_${Math.random().toString(16).slice(2, 8)}`;
  options.value.push({ id, value: "", weight: 1 });
}
function removeOption(idx: number) { options.value.splice(idx, 1); }

async function save() {
  if (!name.value.trim()) {
    toast.add({ severity: "warn", summary: "Name required", life: 2000 });
    return;
  }
  const finalBinding = (varBinding.value.trim()) || toIdentifier(name.value);
  if (!VALID_IDENTIFIER_RE.test(finalBinding)) {
    varBindingError.value = "Use letters, digits, underscores; must not start with a digit.";
    toast.add({ severity: "warn", summary: "Invalid variable name", life: 2500 });
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
    if (isEdit.value && props.id) {
      await moduleStore.update(props.id, {
        name: name.value, description: description.value,
        category_id: categoryId.value, tags: tags.value,
        payload: payload as unknown as Record<string, unknown>,
      });
    } else {
      await moduleStore.create({
        type: "wildcard",
        name: name.value, description: description.value,
        category_id: categoryId.value, tags: tags.value,
        payload: payload as unknown as Record<string, unknown>,
      });
    }
    toast.add({ severity: "success", summary: "Saved", detail: name.value, life: 2000 });
    router.push("/wildcards");
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
      <RouterLink to="/wildcards" class="text-xs text-wp-text2 hover:text-wp-text">
        <i class="pi pi-angle-left text-xs" /> Wildcards
      </RouterLink>
      <h1 class="text-xl font-semibold m-0 mt-1">{{ isEdit ? "Edit wildcard" : "New wildcard" }}</h1>
    </div>

    <div class="form-page__body">
      <section class="form-section">
        <h2 class="form-section__label">Identity</h2>
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label for="wc-name" class="block text-xs text-wp-text2 mb-1">Name</label>
            <InputText id="wc-name" v-model="name" class="w-full" />
          </div>
          <div>
            <label for="wc-var" class="block text-xs text-wp-text2 mb-1">Variable name</label>
            <InputText
              id="wc-var"
              :model-value="varBinding"
              data-test="wc-var-binding"
              class="w-full"
              :class="{ 'p-invalid': !!varBindingError }"
              @update:model-value="onVarBindingInput"
            />
            <p class="text-xs text-wp-text2 mt-1">
              Other modules will reference this wildcard's resolved value as <span class="wc-var-mono">${{ varBinding || "name" }}</span>.
            </p>
            <p v-if="varBindingError" class="text-xs text-wp-danger mt-1" data-test="wc-var-error">
              {{ varBindingError }}
            </p>
          </div>
          <div>
            <label for="wc-cat" class="block text-xs text-wp-text2 mb-1">Category</label>
            <Select
              id="wc-cat" v-model="categoryId"
              :options="categoryStore.items" option-label="name" option-value="id"
              placeholder="None" show-clear class="w-full"
            />
          </div>
          <div class="col-span-2">
            <label for="wc-desc" class="block text-xs text-wp-text2 mb-1">Description</label>
            <Textarea id="wc-desc" v-model="description" rows="2" class="w-full" />
          </div>
          <div class="col-span-2">
            <label for="wc-tags" class="block text-xs text-wp-text2 mb-1">Tags</label>
            <AutoComplete
              id="wc-tags"
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
          <h2 class="form-section__label m-0">Sub-categories</h2>
        </div>
        <p class="text-xs text-wp-text2 mb-2">
          Optional groupings inside this wildcard. Tag each option below with one of these to allow filtering at resolve time.
        </p>
        <div class="flex gap-2 mb-2">
          <InputText
            v-model="newSubCategory"
            placeholder="e.g. warm-tones"
            class="flex-1"
            aria-label="Sub-category name"
            @keydown.enter="addSubCategory"
          />
          <Button label="Add" icon="pi pi-plus" size="small" severity="secondary" outlined @click="addSubCategory" />
        </div>
        <div v-if="subCategories.length" class="flex flex-wrap gap-2">
          <span
            v-for="s in subCategories"
            :key="s"
            class="sub-cat-chip"
          >
            {{ s }}
            <i class="pi pi-times cursor-pointer" @click="removeSubCategory(s)" />
          </span>
        </div>
        <p v-else class="text-xs text-wp-text3">No sub-categories yet.</p>
      </section>

      <section class="form-section">
        <div class="flex items-center justify-between mb-2">
          <h2 class="form-section__label m-0">Options</h2>
          <Button label="Add option" icon="pi pi-plus" size="small" severity="primary" @click="addOption" />
        </div>
        <table class="w-full text-sm border border-wp-border rounded">
          <thead>
            <tr class="bg-wp-bg2">
              <th class="px-3 py-2 text-left text-wp-text2 text-xs uppercase w-24">Weight</th>
              <th class="px-3 py-2 text-left text-wp-text2 text-xs uppercase">Value</th>
              <th class="px-3 py-2 text-left text-wp-text2 text-xs uppercase w-44">Sub-category</th>
              <th class="w-16"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(opt, idx) in options" :key="opt.id" class="border-t border-wp-border">
              <td class="px-3 py-2 w-24">
                <InputNumber v-model="opt.weight" :min="0" :max="999" size="small" class="w-full" />
              </td>
              <td class="px-3 py-2">
                <RichTextInput
                  v-model="opt.value"
                  :ref-suggestions="otherWildcardBindings"
                  aria-label="Option value"
                />
              </td>
              <td class="px-3 py-2 w-44">
                <Select
                  v-model="opt.sub_category"
                  :options="subCategoryOptions"
                  option-label="label"
                  option-value="value"
                  placeholder="(none)"
                  class="w-full"
                  aria-label="Sub-category for option"
                />
              </td>
              <td class="px-3 py-2 text-right">
                <Button icon="pi pi-trash" text rounded size="small" severity="danger"
                  aria-label="Remove option" @click="removeOption(idx)" />
              </td>
            </tr>
            <tr v-if="!options.length">
              <td colspan="4" class="text-center text-wp-text2 py-4">No options yet.</td>
            </tr>
          </tbody>
        </table>
      </section>
    </div>

    <div class="form-page__footer">
      <Button label="Cancel" severity="secondary" outlined @click="router.push('/wildcards')" />
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
.sub-cat-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 10px;
  border-radius: 11px;
  font-size: 11px;
  background: var(--wp-violet-bg);
  color: var(--wp-violet);
  border: 1px solid var(--wp-violet);
}
.sub-cat-chip i { opacity: 0.7; font-size: 10px; }
.sub-cat-chip i:hover { opacity: 1; }
.wc-var-mono {
  font-family: var(--wp-font-mono, ui-monospace, monospace);
  color: var(--wp-accent-text, #c4b5fd);
}
</style>
