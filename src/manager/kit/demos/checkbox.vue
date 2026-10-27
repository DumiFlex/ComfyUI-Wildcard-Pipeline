<script setup lang="ts">
import { ref } from "vue";
import Checkbox from "../../components/ui/Checkbox.vue";

const picked = ref(true);
const unpicked = ref(false);
</script>

<template>
  <Checkbox v-model="picked" label="Include in bundle" />
  <Checkbox v-model="unpicked" label="Hide from prompt" />
  <Checkbox :model-value="false" indeterminate label="Some selected" />
  <Checkbox :model-value="true" disabled label="Disabled" />
</template>
