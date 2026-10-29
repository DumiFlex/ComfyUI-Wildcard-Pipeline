<script setup lang="ts">
import { ref } from "vue";
import Select from "../../../kit/Select.vue";
import type { SelectOption } from "../../../kit/select-types";

const category = ref<string | number | null>("characters");
const empty = ref<string | number | null>(null);
const categories: SelectOption[] = [
  { value: "characters", label: "Characters", dot: "#60a5fa" },
  { value: "scenes", label: "Scenes", dot: "#34d399" },
  { value: "style", label: "Style", dot: "#f472b6" },
];
</script>

<template>
  <div class="wp-kit__stack">
    <Select v-model="category" :options="categories" clearable aria-label="Category" />
    <p class="wp-kit__muted">The clear ✕ shows on hover or focus, set apart from the chevron.</p>
    <Select v-model="empty" :options="categories" placeholder="Pick a category" aria-label="Empty category" />
    <Select v-model="category" :options="categories" size="sm" aria-label="Small category" />
    <Select v-model="category" :options="categories" disabled aria-label="Disabled category" />
  </div>
</template>
