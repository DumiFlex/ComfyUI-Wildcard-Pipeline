<script setup lang="ts">
import { ref } from "vue";
import Button from "../../components/ui/Button.vue";
import Lightbox from "@/kit/Lightbox.vue";
import { demoImage } from "./_images";

const shots = Array.from({ length: 4 }, (_, i) => ({ src: demoImage(i + 2, 960, 640), alt: `Preview ${i + 1}`, caption: `Preview ${i + 1} of the Soft light pack` }));
const open = ref(false);
const at = ref(0);
const one = ref(false);
const zoomed = ref(false);
</script>

<template>
  <div class="wp-kit__row">
    <Button icon="pi-images" @click="at = 0; open = true">Open four previews</Button>
    <Button variant="ghost" @click="one = true">Open one image</Button>
    <Lightbox v-model:open="open" v-model:index="at" :images="shots" />
    <Button variant="ghost" icon="pi-search-plus" @click="zoomed = true">Open with zoom</Button>
    <Lightbox v-model:open="one" :images="[shots[3]]" />
    <Lightbox v-model:open="zoomed" :images="shots" zoom />
  </div>
</template>
