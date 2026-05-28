<script setup lang="ts">
import { computed } from "vue";
import { RouterLink } from "vue-router";
import { findPage, toneVar } from "../../docs/registry";

const props = defineProps<{ id: string; label?: string }>();

const page = computed(() => findPage(props.id));
const text = computed(() => props.label ?? page.value?.title ?? props.id);
const tone = computed(() => toneVar(page.value?.tone ?? "neutral"));
</script>

<template>
  <RouterLink
    class="wp-doc-ref"
    data-test="doc-ref"
    :to="`/docs/${id}`"
    :style="{ '--doc-ref-tone': tone }"
  >{{ text }}</RouterLink>
</template>

<style scoped>
.wp-doc-ref {
  color: var(--doc-ref-tone);
  font-weight: 600;
  text-decoration: none;
  cursor: pointer;
  border-bottom: 1px solid transparent;
}
.wp-doc-ref:hover {
  border-bottom-color: color-mix(in oklab, var(--doc-ref-tone) 55%, transparent);
}
</style>
