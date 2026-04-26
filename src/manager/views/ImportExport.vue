<script setup lang="ts">
import { ref } from "vue";
import Button from "primevue/button";
import { useToast } from "primevue/usetoast";
import { api } from "../api/client";
import type { ImportBundle } from "../api/types";

const toast = useToast();
const uploadInput = ref<HTMLInputElement | null>(null);
const lastResult = ref("");

async function downloadExport() {
  try {
    const bundle = await api.exportBundle();
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `wildcard-pipeline-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.add({ severity: "success", summary: "Exported", life: 2000 });
  } catch (e) {
    toast.add({ severity: "error", summary: "Export failed", detail: String(e), life: 4000 });
  }
}

async function onUpload(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    const bundle = JSON.parse(text) as ImportBundle;
    const result = await api.importBundle(bundle);
    lastResult.value = `Modules: ${result.modules_imported}, categories: ${result.categories_imported}, skipped: ${result.skipped.length}`;
    toast.add({ severity: "success", summary: "Imported", detail: lastResult.value, life: 4000 });
  } catch (err) {
    toast.add({ severity: "error", summary: "Import failed", detail: String(err), life: 5000 });
  } finally {
    if (uploadInput.value) uploadInput.value.value = "";
  }
}
</script>

<template>
  <div class="p-6 text-wp-text max-w-2xl">
    <h1 class="text-xl font-semibold m-0">Import / Export</h1>
    <p class="text-sm text-wp-text2 m-0 mt-1 mb-6">
      Library bundles are JSON files containing all module declarations and categories. Workflow files are NOT handled here.
    </p>

    <div class="flex gap-3 items-center mb-6">
      <Button icon="pi pi-download" label="Export library" severity="primary" @click="downloadExport" />
      <Button icon="pi pi-upload" label="Import bundle" severity="secondary" outlined @click="uploadInput?.click()" />
      <input
        ref="uploadInput" type="file" accept="application/json"
        class="hidden" data-test="upload-input"
        aria-label="Upload bundle JSON file"
        @change="onUpload"
      />
    </div>

    <div v-if="lastResult" class="text-sm text-wp-text2 p-3 rounded bg-wp-bg2 border border-wp-border">
      <i class="pi pi-info-circle mr-2" />
      Last import: {{ lastResult }}
    </div>
  </div>
</template>
