<script setup lang="ts">
import { ref } from "vue";
import DropZone, { type RejectedFile } from "@/kit/DropZone.vue";

const got = ref("");
function took(files: File[]): void { got.value = `Took ${files.map((f) => f.name).join(", ")}`; }
function refused(files: RejectedFile[]): void { got.value = files.map((r) => `${r.file.name}: ${r.reason}`).join("; "); }
</script>

<template>
  <div class="wp-kit__stack wp-kit__stack--wide">
    <DropZone accept=".txt,.yaml,.yml,.zip" multiple hint="Wildcard .txt, .yaml or a .zip" :max-size="20 * 1024 * 1024" @files="took" @reject="refused" />
    <p v-if="got" class="wp-kit__muted" role="status">{{ got }}</p>
    <DropZone accept="image/*" size="sm" label="Drop a reference image" hint="PNG, JPG or WebP" @files="took" @reject="refused" />
    <DropZone disabled label="Uploads are off" size="sm" />
    <DropZone overlay accept="image/*" multiple label="Drop images to attach" @files="took" @reject="refused">
      <div class="wp-kit__target">Overlay: drag an image over this panel</div>
    </DropZone>
  </div>
</template>
