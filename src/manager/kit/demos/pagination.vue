<script setup lang="ts">
import { ref } from "vue";
import Pagination from "@/components/shared/Pagination.vue";

const page = ref(4);
const small = ref(1);
const shown = ref(50);
const busy = ref(false);
function more(): void {
  busy.value = true;
  setTimeout(() => { shown.value = Math.min(230, shown.value + 50); busy.value = false; }, 600);
}
</script>

<template>
  <div class="wp-kit__stack wp-kit__stack--wide">
    <Pagination v-model:page="page" :total="480" :page-size="25" aria-label="Modules pages" />
    <Pagination v-model:page="small" :total="60" :page-size="25" disabled aria-label="Disabled pages" />
    <Pagination mode="more" :shown="shown" :total="230" noun="modules" :loading="busy" @more="more" />
    <div class="wp-kit__canvas">
      <p class="wp-kit__caption">Canvas, size sm</p>
      <Pagination v-model:page="small" :total="60" :page-size="25" size="sm" aria-label="Small pages" />
    </div>
  </div>
</template>
