<script setup lang="ts">
import { ref } from "vue";
import Input from "../../components/ui/Input.vue";

const name = ref("Hair colour");
const variable = ref("hair");
</script>

<template>
  <div class="wp-kit__stack">
    <Input v-model="name" aria-label="Name" />
    <Input v-model="variable" addon="$" aria-label="Variable name" />
    <Input model-value="" icon="pi-search" placeholder="Search modules" aria-label="Search modules" />
    <Input model-value="Hair colour" error aria-label="Name with an error" />
    <Input model-value="Locked" disabled aria-label="Disabled field" />
  </div>
</template>
