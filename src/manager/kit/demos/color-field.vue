<script setup lang="ts">
import { ref } from "vue";
import ColorField from "@/components/shared/ColorField.vue";

const text = ref("#ffffff");
const band = ref("#00000099");
const none = ref("none");
</script>

<template>
  <div class="wp-kit__row">
    <ColorField v-model="text" aria-label="Text colour" />
    <ColorField v-model="band" alpha allow-none aria-label="Label band" />
    <ColorField v-model="none" alpha allow-none size="md" aria-label="Strip colour" />
  </div>
</template>
