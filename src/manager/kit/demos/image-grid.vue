<script setup lang="ts">
import { ref } from "vue";
import ImageGrid from "@/components/shared/ImageGrid.vue";
import { demoImage } from "./_images";

const outputs = Array.from({ length: 6 }, (_, i) => ({
  id: `img-${i}`, src: demoImage(i), alt: `Output ${i + 1}`, caption: `seed ${1000 + i * 17}`,
}));
const frames = [
  ...Array.from({ length: 4 }, (_, i) => ({ id: `f-${i}`, src: demoImage(i + 6, 384, 512), alt: `Frame ${i + 1}` })),
  { id: "f-wait", src: "", alt: "Frame 5 (rendering)" },
];
const keep = ref<string[]>(["f-1"]);
</script>

<template>
  <div class="wp-kit__stack wp-kit__stack--wide">
    <ImageGrid :images="outputs" :min-size="110" aria-label="Outputs" />
    <ImageGrid v-model:selected="keep" :images="frames" selectable :aspect="0.75" :min-size="90" gap="sm" aria-label="Frames" />
    <p class="wp-kit__caption">{{ keep.length }} selected</p>
  </div>
</template>
