<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import Textarea from "primevue/textarea";
import InputNumber from "primevue/inputnumber";
import Select from "primevue/select";
import { useToast } from "primevue/usetoast";
import { useModuleStore } from "../stores/moduleStore";
import { useCategoryStore } from "../stores/categoryStore";

const props = defineProps<{ id?: string }>();
const router = useRouter();
const moduleStore = useModuleStore();
const categoryStore = useCategoryStore();
const toast = useToast();

interface Option { id: string; value: string; weight: number; }

const name = ref("");
const description = ref("");
const categoryId = ref<string | null>(null);
const tags = ref<string[]>([]);
const options = ref<Option[]>([]);
const saving = ref(false);
const isEdit = computed(() => !!props.id);

onMounted(async () => {
  await categoryStore.fetchAll();
  if (props.id) {
    try {
      const row = await moduleStore.get(props.id);
      name.value = row.name;
      description.value = row.description;
      categoryId.value = row.category_id;
      tags.value = row.tags;
      options.value = (row.payload as { options?: Option[] }).options ?? [];
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
  saving.value = true;
  try {
    const payload = { options: options.value };
    if (isEdit.value && props.id) {
      await moduleStore.update(props.id, {
        name: name.value, description: description.value,
        category_id: categoryId.value, tags: tags.value, payload,
      });
    } else {
      await moduleStore.create({
        type: "wildcard",
        name: name.value, description: description.value,
        category_id: categoryId.value, tags: tags.value, payload,
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
        </div>
      </section>

      <section class="form-section">
        <div class="flex items-center justify-between mb-2">
          <h2 class="form-section__label m-0">Options</h2>
          <Button label="Add option" icon="pi pi-plus" size="small" severity="primary" @click="addOption" />
        </div>
        <table class="w-full text-sm border border-wp-border rounded">
          <thead>
            <tr class="bg-wp-bg2">
              <th class="px-3 py-2 text-left text-wp-text2 text-xs uppercase">Weight</th>
              <th class="px-3 py-2 text-left text-wp-text2 text-xs uppercase">Value</th>
              <th class="w-16"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(opt, idx) in options" :key="opt.id" class="border-t border-wp-border">
              <td class="px-3 py-2 w-24">
                <InputNumber v-model="opt.weight" :min="0" :max="999" size="small" class="w-full" />
              </td>
              <td class="px-3 py-2"><InputText v-model="opt.value" class="w-full" /></td>
              <td class="px-3 py-2 text-right">
                <Button icon="pi pi-trash" text rounded size="small" severity="danger"
                  aria-label="Remove option" @click="removeOption(idx)" />
              </td>
            </tr>
            <tr v-if="!options.length">
              <td colspan="3" class="text-center text-wp-text2 py-4">No options yet.</td>
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
</style>
