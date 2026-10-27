<script setup lang="ts">
import { ref } from "vue";
import Toggle from "../../components/ui/Toggle.vue";

const tooltips = ref(true);
</script>

<template>
  <Toggle v-model="tooltips" label="Show tooltips" />
  <Toggle :model-value="false" disabled label="Disabled" />
</template>
