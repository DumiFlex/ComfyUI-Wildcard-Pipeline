<script setup lang="ts">
import { ref } from "vue";
import Input from "../../components/ui/Input.vue";

const name = ref("Hair colour");
const variable = ref("hair");
const width = ref("1024");
</script>

<template>
  <div class="wp-kit__stack">
    <Input v-model="name" aria-label="Name" />
    <Input v-model="variable" prefix="$" aria-label="Variable name" />
    <Input v-model="width" suffix="px" aria-label="Width" />
    <Input model-value="" icon="pi-search" placeholder="Search modules" aria-label="Search modules" />
    <Input model-value="Hair colour" error aria-label="Name with an error" />
    <Input model-value="hair_colour" prefix="$" readonly aria-label="Read-only variable" />
    <Input model-value="Locked" disabled aria-label="Disabled field" />
    <p class="wp-kit__muted">Sizes: sm 24, md 32, lg 40.</p>
    <Input model-value="Small" size="sm" aria-label="Small" />
    <Input model-value="Medium" aria-label="Medium" />
    <Input model-value="Large" size="lg" aria-label="Large" />
  </div>
</template>
