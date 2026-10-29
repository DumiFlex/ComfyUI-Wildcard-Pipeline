<script setup lang="ts">
import Badge from "@/kit/Badge.vue";
import DescriptionList from "@/kit/DescriptionList.vue";

const items = [
  { label: "Family", value: "SDXL" },
  { label: "Variant", value: "Pony" },
  { label: "File", value: "ponyDiffusionV6XL_v6StartWithThisOne.safetensors", mono: true, copy: true },
  { label: "Status", key: "status" },
  { label: "Notes", value: "" },
];
</script>

<template>
  <div class="wp-kit__stack wp-kit__stack--wide">
    <DescriptionList :items="items">
      <template #value-status><Badge dot tone="success" text="Loaded" /></template>
    </DescriptionList>
    <p class="wp-kit__caption">Divided</p>
    <DescriptionList :items="items.slice(0, 3)" divided />
    <div class="wp-kit__canvas">
      <p class="wp-kit__caption">Canvas, size sm, stacked</p>
      <DescriptionList :items="[{ label: 'Seed', value: 184467, mono: true }, { label: 'Picked', value: 'auburn hair' }]" size="sm" layout="stacked" />
    </div>
  </div>
</template>
