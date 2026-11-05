<script setup lang="ts">
import { ref } from "vue";
import NegativeField from "../../components/NegativeField.vue";

const negative = ref("blurry, cropped");
</script>

<template>
  <div class="wp-kit__stack wp-kit__stack--wide">
    <NegativeField v-model="negative" label="option" always-open />
  </div>
</template>
