<script setup lang="ts">
import { ref } from "vue";
import Checkbox from "../../../kit/Checkbox.vue";

const picked = ref(true);
const unpicked = ref(false);
const favorites = ref(false);
</script>

<template>
  <Checkbox v-model="picked" label="Include in bundle" />
  <Checkbox v-model="unpicked" label="Hide from prompt" />
  <Checkbox :model-value="false" indeterminate label="Some selected" />
  <Checkbox :model-value="true" disabled label="Disabled, ticked" />
  <Checkbox :model-value="false" disabled label="Disabled" />
  <div style="width: 220px">
    <Checkbox v-model="favorites" field label="Favorites only" />
  </div>
</template>
