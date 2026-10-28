<script setup lang="ts">
import DiffView from "@/components/shared/DiffView.vue";

const before = `{
  "name": "Hair colour",
  "options": ["auburn", "black"],
  "weight": 1
}`;
const after = `{
  "name": "Hair colour",
  "options": ["auburn", "silver", "teal"],
  "weight": 1.2
}`;
</script>

<template>
  <div class="wp-kit__stack wp-kit__stack--wide">
    <DiffView before="auburn hair, soft rim light, looking away" after="silver hair, soft rim light, looking at viewer" />
    <DiffView :before="before" :after="after" by="lines" layout="split" mono />
    <DiffView before="same text" after="same text" size="sm" />
  </div>
</template>
