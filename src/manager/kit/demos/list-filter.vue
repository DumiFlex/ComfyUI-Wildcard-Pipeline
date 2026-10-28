<script setup lang="ts">
import { computed, ref } from "vue";
import ListFilter from "../../components/ui/ListFilter.vue";

const query = ref("");
const rules = ["when $mood is dramatic", "when $mood is calm", "when $weather is rain", "when $time is night", "otherwise"];
const shownRules = computed(() => rules.filter((r) => r.includes(query.value.toLowerCase())));
</script>

<template>
  <div class="wp-kit__stack">
    <ListFilter v-model="query" :total="rules.length" :visible="shownRules.length" noun="rules" test-prefix="kit-filter" :min-rows="0" />
    <ul class="wp-kit__list">
      <li v-for="r in shownRules" :key="r">{{ r }}</li>
    </ul>
  </div>
</template>
