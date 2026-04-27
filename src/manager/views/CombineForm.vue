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
import type { CombinePayload } from "../api/types";

const props = defineProps<{ id?: string }>();
const router = useRouter();
const moduleStore = useModuleStore();
const categoryStore = useCategoryStore();
const toast = useToast();

const name = ref("");
const description = ref("");
const categoryId = ref<string | null>(null);
const tags = ref<string[]>([]);
const payload = ref<CombinePayload>({ template: "", output_var: "", input_vars: [] });
const saving = ref(false);
const isEdit = computed(() => !!props.id);

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
      const p = row.payload as Partial<CombinePayload>;
      payload.value = {
        template: p.template ?? "",
        output_var: p.output_var ?? "",
        input_vars: p.input_vars ?? [],
      };
    } catch {
      toast.add({ severity: "error", summary: "Combine not found", life: 3000 });
      router.replace("/combines");
    }
  }
});

async function save() {
  if (!name.value.trim()) {
    toast.add({ severity: "warn", summary: "Name required", life: 2000 });
    return;
  }
  saving.value = true;
  try {
    const body = {
      name: name.value,
      description: description.value,
      category_id: categoryId.value,
      tags: tags.value,
      payload: payload.value as unknown as Record<string, unknown>,
    };
    if (isEdit.value && props.id) {
      await moduleStore.update(props.id, body);
    } else {
      await moduleStore.create({ type: "combine", ...body });
    }
    toast.add({ severity: "success", summary: "Saved", detail: name.value, life: 2000 });
    router.push("/combines");
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
      <RouterLink to="/combines" class="text-xs text-wp-text2 hover:text-wp-text">
        <i class="pi pi-angle-left text-xs" /> Combines
      </RouterLink>
      <h1 class="text-xl font-semibold m-0 mt-1">{{ isEdit ? "Edit combine" : "New combine" }}</h1>
    </div>

    <div class="form-page__body">
      <section class="form-section">
        <h2 class="form-section__label">Identity</h2>
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label for="cb-name" class="block text-xs text-wp-text2 mb-1">Name</label>
            <InputText id="cb-name" v-model="name" class="w-full" />
          </div>
          <div>
            <label for="cb-cat" class="block text-xs text-wp-text2 mb-1">Category</label>
            <Select
              id="cb-cat" v-model="categoryId"
              :options="categoryStore.items" option-label="name" option-value="id"
              placeholder="None" show-clear class="w-full"
            />
          </div>
          <div class="col-span-2">
            <label for="cb-desc" class="block text-xs text-wp-text2 mb-1">Description</label>
            <Textarea id="cb-desc" v-model="description" rows="2" class="w-full" />
          </div>
          <div class="col-span-2">
            <label for="cb-tags" class="block text-xs text-wp-text2 mb-1">Tags</label>
            <AutoComplete
              id="cb-tags"
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
        <h2 class="form-section__label">Template</h2>
        <Card>
          <template #content>
            <p class="text-sm text-wp-text2 m-0 mb-2">
              Editor coming soon — payload shown below.
            </p>
            <pre class="payload-preview" data-test="payload-preview">{{ JSON.stringify(payload, null, 2) }}</pre>
          </template>
        </Card>
      </section>
    </div>

    <div class="form-page__footer">
      <Button label="Cancel" severity="secondary" outlined @click="router.push('/combines')" />
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
.payload-preview {
  background: var(--wp-bg2);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius);
  padding: 8px 10px;
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-word;
  margin: 0;
  color: var(--wp-text);
  max-height: 320px;
  overflow: auto;
}
</style>
