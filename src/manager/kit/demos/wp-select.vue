<script setup lang="ts">
import { ref } from "vue";
import WpSelect from "@/kit/WpSelect.vue";

const strategy = ref<"hash" | "sequential" | "stride">("hash");
const strategies = [
  { value: "hash" as const, label: "Hash" },
  { value: "sequential" as const, label: "Sequential" },
  { value: "stride" as const, label: "Stride" },
];
</script>

<template>
  <WpSelect v-model="strategy" :options="strategies" aria-label="Strategy" class="wp-kit__compact" />
</template>
