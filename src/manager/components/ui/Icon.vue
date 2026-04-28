<script setup lang="ts">
import { computed } from "vue";

interface Props {
  name: string;
  size?: number;
}
const props = defineProps<Props>();

const className = computed(() => {
  // Accept either bare name ("plus", "check-circle") or already-prefixed ("pi-plus").
  const n = props.name.startsWith("pi-") ? props.name : `pi-${props.name}`;
  return `pi ${n}`;
});

const style = computed(() => (props.size ? { fontSize: `${props.size}px` } : undefined));
</script>

<template>
  <i :class="className" :style="style" aria-hidden="true" />
</template>
