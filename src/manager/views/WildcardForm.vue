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
      const payload = row.payload as { options?: Option[] };
      options.value = payload.options ?? [];
    } catch {
      toast.add({ severity: "error", summary: "Module not found", life: 3000 });
      router.replace("/modules");
    }
  }
});

function addOption() {
  const id = `opt_${Math.random().toString(16).slice(2, 8)}`;
  options.value.push({ id, value: "", weight: 1 });
}

function removeOption(idx: number) {
  options.value.splice(idx, 1);
}

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
    router.push("/modules");
  } catch (e) {
    toast.add({ severity: "error", summary: "Save failed", detail: String(e), life: 4000 });
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="p-6 text-wp-text max-w-4xl">
    <h1 class="text-xl font-semibold mb-4">{{ isEdit ? "Edit wildcard" : "New wildcard" }}</h1>

    <div class="grid grid-cols-2 gap-4 mb-6">
      <div>
        <label for="wc-name" class="block text-xs text-wp-text2 mb-1">Name</label>
        <InputText id="wc-name" v-model="name" class="w-full" />
      </div>
      <div>
        <label for="wc-cat" class="block text-xs text-wp-text2 mb-1">Category</label>
        <Select
          id="wc-cat"
          v-model="categoryId"
          :options="categoryStore.items"
          option-label="name"
          option-value="id"
          placeholder="None"
          show-clear
          class="w-full"
        />
      </div>
      <div class="col-span-2">
        <label for="wc-desc" class="block text-xs text-wp-text2 mb-1">Description</label>
        <Textarea id="wc-desc" v-model="description" rows="2" class="w-full" />
      </div>
    </div>

    <div class="flex items-center justify-between mb-2">
      <h2 class="text-sm font-semibold text-wp-text2 uppercase tracking-wider">Options</h2>
      <Button label="+ Add option" size="small" severity="secondary" @click="addOption" />
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
          <td class="px-3 py-2">
            <InputText v-model="opt.value" class="w-full" />
          </td>
          <td class="px-3 py-2 text-right">
            <Button icon="pi pi-trash" text rounded size="small" severity="danger" @click="removeOption(idx)" aria-label="Remove option" />
          </td>
        </tr>
        <tr v-if="!options.length">
          <td colspan="3" class="text-center text-wp-text2 py-4">No options yet.</td>
        </tr>
      </tbody>
    </table>

    <div class="flex gap-2 mt-6">
      <Button label="Save" severity="primary" :loading="saving" data-test="save-btn" @click="save" />
      <Button label="Cancel" severity="secondary" outlined @click="router.push('/modules')" />
    </div>
  </div>
</template>
