<script setup lang="ts">
import { ref } from "vue";
import TagInput from "@/components/shared/TagInput.vue";

const tags = ref(["warm", "portrait"]);
const axes = ref(["season"]);
const many = ref(["a", "b", "c"]);
const canvas = ref(["#nsfw"]);
const library = ["warm", "cool", "pastel", "portrait", "landscape", "night", "day", "rim light", "studio", "outdoor"];
</script>

<template>
  <div class="wp-kit__stack">
    <TagInput v-model="tags" :suggestions="library" aria-label="Tags" />
    <TagInput
      v-model="axes"
      :suggestions="['season', 'time', 'weather', 'mood']"
      :allow-new="false"
      placeholder="Pick an axis"
      aria-label="Accepts axes (suggestions only)"
    />
    <TagInput v-model="many" :max="3" aria-label="At most three" invalid />
    <TagInput :model-value="['locked']" disabled aria-label="Disabled" />
    <div class="wp-kit__canvas">
      <p class="wp-kit__caption">Canvas, size sm</p>
      <TagInput v-model="canvas" size="sm" placeholder="#tag" aria-label="Canvas tags" />
    </div>
  </div>
</template>
