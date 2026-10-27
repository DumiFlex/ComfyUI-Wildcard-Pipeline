<script setup lang="ts">
import { ref } from "vue";
import Select from "../../components/ui/Select.vue";
import type { SelectOption } from "../../components/ui/select-types";

const category = ref<string | number | null>("characters");
const categories: SelectOption[] = [
  { value: "characters", label: "Characters", dot: "#60a5fa" },
  { value: "scenes", label: "Scenes", dot: "#34d399" },
  { value: "style", label: "Style", dot: "#f472b6" },
];
</script>

<template>
  <div class="wp-kit__stack">
    <Select v-model="category" :options="categories" clearable aria-label="Category" />
  </div>
</template>
