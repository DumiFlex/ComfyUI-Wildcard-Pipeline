<script setup lang="ts">
import { useSlots } from "vue";

interface Props {
  title?: string;
  subtitle?: string;
  padding?: boolean;
}
withDefaults(defineProps<Props>(), { padding: true });

const slots = useSlots();
</script>

<template>
  <section class="wp-card">
    <header v-if="title || slots.actions" class="wp-card__header">
      <h3 v-if="title" class="wp-card__title">{{ title }}</h3>
      <p v-if="subtitle" class="wp-card__subtitle">{{ subtitle }}</p>
      <span class="wp-spacer" />
      <slot name="actions" />
    </header>
    <div :class="padding ? 'wp-card__body' : ''">
      <slot />
    </div>
  </section>
</template>
