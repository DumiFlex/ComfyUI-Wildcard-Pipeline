<script setup lang="ts">
import { ref } from "vue";
import ChoiceCards, { type ChoiceCardOption } from "../../../kit/ChoiceCards.vue";

type Layout = "list" | "grid" | "board";
const layout = ref<Layout>("grid");
const OPTIONS: ChoiceCardOption<Layout>[] = [
  { value: "list", label: "List", hint: "One row per item, the most at once." },
  { value: "grid", label: "Grid", hint: "Cards in columns with a preview." },
  { value: "board", label: "Board", hint: "Columns you drag items between." },
];
</script>

<template>
  <div class="wp-kit__stack wp-kit__stack--wide">
    <ChoiceCards v-model="layout" :options="OPTIONS" aria-label="Layout">
      <template #preview="{ option }">
        <span class="wp-kit-cc__pic" :data-kind="option.value" aria-hidden="true" />
      </template>
    </ChoiceCards>
    <p class="wp-kit__caption">compact</p>
    <ChoiceCards v-model="layout" :options="OPTIONS" compact aria-label="Layout, compact" />
  </div>
</template>

<style scoped>
.wp-kit-cc__pic {
  display: block;
  height: 36px;
  border-radius: var(--wp-radius-sm);
  border: 1px solid var(--wp-border);
  background:
    repeating-linear-gradient(var(--wp-kit-cc-dir, 180deg), var(--wp-bg-4) 0 6px, transparent 6px 12px),
    var(--wp-bg-1);
}
.wp-kit-cc__pic[data-kind="grid"] { --wp-kit-cc-dir: 90deg; }
.wp-kit-cc__pic[data-kind="board"] { --wp-kit-cc-dir: 90deg; background-size: 33% 100%; }
</style>
