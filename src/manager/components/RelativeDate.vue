<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{ value: string | null | undefined }>();

const display = computed(() => {
  if (!props.value) return "—";
  const ts = Date.parse(props.value);
  if (Number.isNaN(ts)) return "—";
  const diff = Date.now() - ts;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  if (day < 30) return `${Math.floor(day / 7)}w ago`;
  if (day < 365) return `${Math.floor(day / 30)}mo ago`;
  return `${Math.floor(day / 365)}y ago`;
});
</script>

<template>
  <span class="text-xs text-wp-text2" :title="value || ''">{{ display }}</span>
</template>
