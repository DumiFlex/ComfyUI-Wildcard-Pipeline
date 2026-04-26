<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import Button from "primevue/button";
import InputNumber from "primevue/inputnumber";
import InputText from "primevue/inputtext";
import Select from "primevue/select";
import { useToast } from "primevue/usetoast";
import { api } from "../api/client";
import { useModuleStore } from "../stores/moduleStore";
import type { TestResponse } from "../api/types";

const store = useModuleStore();
const toast = useToast();
const moduleId = ref<string | null>(null);
const samples = ref(50);
const variableBinding = ref("$x");
const result = ref<TestResponse | null>(null);
const running = ref(false);

onMounted(async () => {
  store.filter.type = undefined;
  await store.fetchAll();
});

const selectedModule = computed(() => store.items.find((m) => m.id === moduleId.value));

watch(selectedModule, (mod) => {
  if (mod && variableBinding.value === "$x") {
    variableBinding.value = `$${mod.name.replace(/[^a-zA-Z0-9_]/g, "_")}`;
  }
});

async function run() {
  const mod = selectedModule.value;
  if (!mod) return;
  running.value = true;
  try {
    const instance = mod.type === "wildcard" ? { variable_binding: variableBinding.value } : {};
    result.value = await api.test({
      type: mod.type, payload: mod.payload, instance, samples: samples.value,
    });
  } catch (e) {
    toast.add({ severity: "error", summary: "Test failed", detail: String(e), life: 4000 });
  } finally {
    running.value = false;
  }
}

const histogramEntries = computed(() => {
  if (!result.value) return [];
  const max = Math.max(...Object.values(result.value.histogram), 1);
  return Object.entries(result.value.histogram)
    .sort((a, b) => b[1] - a[1])
    .map(([value, count]) => ({ value, count, pct: Math.round((count / max) * 100) }));
});
</script>

<template>
  <div class="p-6 text-wp-text max-w-3xl">
    <h1 class="text-xl font-semibold m-0">Test runner</h1>
    <p class="text-sm text-wp-text2 m-0 mt-1 mb-6">
      Run a module against the engine N times, view the resolved-value distribution.
    </p>

    <div class="grid grid-cols-3 gap-3 mb-4">
      <div class="col-span-2">
        <label for="tr-module" class="block text-xs text-wp-text2 mb-1">Module</label>
        <Select
          id="tr-module" v-model="moduleId"
          :options="store.items" option-label="name" option-value="id"
          placeholder="Select a module…" filter class="w-full"
        />
      </div>
      <div>
        <label for="tr-samples" class="block text-xs text-wp-text2 mb-1">Samples</label>
        <InputNumber id="tr-samples" v-model="samples" :min="1" :max="10000" class="w-full" />
      </div>
      <div v-if="selectedModule?.type === 'wildcard'" class="col-span-2">
        <label for="tr-binding" class="block text-xs text-wp-text2 mb-1">Variable binding</label>
        <InputText id="tr-binding" v-model="variableBinding" class="w-full" />
      </div>
    </div>

    <Button
      label="Run" icon="pi pi-bolt" severity="primary"
      :loading="running" :disabled="!moduleId"
      data-test="run-btn"
      @click="run"
    />

    <div v-if="result" class="mt-6">
      <h2 class="text-sm uppercase tracking-wider text-wp-text2 mb-2">Histogram</h2>
      <div class="space-y-1">
        <div v-for="entry in histogramEntries" :key="entry.value" class="flex items-center gap-2 text-sm">
          <div class="w-48 truncate" :title="entry.value">{{ entry.value }}</div>
          <div class="flex-1 h-3 bg-wp-bg2 rounded overflow-hidden">
            <div class="h-full" :style="{ width: entry.pct + '%', background: 'var(--wp-accent)' }" />
          </div>
          <div class="w-12 text-right text-wp-text2">{{ entry.count }}</div>
        </div>
      </div>
    </div>
  </div>
</template>
