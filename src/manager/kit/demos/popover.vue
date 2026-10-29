<script setup lang="ts">
import { ref } from "vue";
import Button from "../../components/ui/Button.vue";
import Checkbox from "../../components/ui/Checkbox.vue";
import Popover from "@/kit/Popover.vue";

const open = ref(false);
const kinds = ref({ wildcard: true, fixed: true, derivation: false });
</script>

<template>
  <Popover v-model:open="open" label="Filter by kind">
    <template #trigger="{ props }">
      <Button v-bind="props" icon="pi-filter">Filter</Button>
    </template>
    <div class="wp-kit__menu-col">
      <Checkbox v-model="kinds.wildcard" label="Wildcards" />
      <Checkbox v-model="kinds.fixed" label="Fixed values" />
      <Checkbox v-model="kinds.derivation" label="Derivations" />
    </div>
  </Popover>
</template>
