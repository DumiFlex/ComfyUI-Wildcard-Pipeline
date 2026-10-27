<script setup lang="ts">
import { computed, ref } from "vue";
import SearchInput from "@/components/shared/SearchInput.vue";

const rows = ["Hair colour", "Hair style", "Mood", "Weather", "Time of day", "Lighting"];
const query = ref("hair");
const empty = ref("");
const none = ref("zzz");
const shown = computed(() => rows.filter((r) => r.toLowerCase().includes(query.value.trim().toLowerCase())));
</script>

<template>
  <div class="wp-kit__stack">
    <SearchInput v-model="query" placeholder="Search modules" :visible="shown.length" :total="rows.length" data-test="kit-search" />
    <SearchInput v-model="empty" placeholder="Filter rules" :visible="rows.length" :total="rows.length" noun="rules" />
    <SearchInput v-model="none" placeholder="No matches" :visible="0" :total="rows.length" />
    <SearchInput v-model="empty" placeholder="Search bundles" shortcut="/" size="sm" />
    <SearchInput v-model="empty" placeholder="Large" size="lg" />
    <SearchInput v-model="empty" placeholder="Disabled" disabled />
  </div>
</template>
