<script setup lang="ts">
/** A tip or warning on a docs page: the kit's Banner, as page text (`note`). */
import Banner, { type BannerTone } from "@/kit/Banner.vue";

withDefaults(defineProps<{ variant?: "tip" | "warn" | "danger" }>(), { variant: "tip" });
const TONE: Record<"tip" | "warn" | "danger", BannerTone> = { tip: "info", warn: "warn", danger: "danger" };
</script>
<template>
  <Banner class="wp-doc-callout" :tone="TONE[variant]" note><slot /></Banner>
</template>
<style scoped>
/* A Modelfile or a command shown inside the tip gets room above and below. */
.wp-doc-callout :deep(.wp-code) { margin: 6px 0; }
</style>
