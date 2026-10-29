<script setup lang="ts">
import { ref } from "vue";
import WpSegmented from "@/kit/WpSegmented.vue";

const theme = ref<"system" | "dark" | "light">("dark");
const view = ref<"grid" | "list">("grid");
const mode = ref<"hash" | "seq" | "stride">("hash");
const size = ref<"sm" | "md" | "lg">("md");
</script>

<template>
  <div class="wp-kit__stack wp-kit__stack--wide">
    <div class="wp-kit__row">
      <WpSegmented
        v-model="theme"
        :options="[{ value: 'system', label: 'System', icon: 'pi-desktop' }, { value: 'dark', label: 'Dark', icon: 'pi-moon' }, { value: 'light', label: 'Light', icon: 'pi-sun' }]"
        aria-label="Theme"
      />
      <WpSegmented
        v-model="view"
        :options="[{ value: 'grid', label: 'Grid', icon: 'pi-th-large' }, { value: 'list', label: 'List', icon: 'pi-list' }]"
        icon-only
        aria-label="View"
      />
    </div>
    <div class="wp-kit__row">
      <WpSegmented v-model="size" :options="[{ value: 'sm', label: 'Small' }, { value: 'md', label: 'Medium' }, { value: 'lg', label: 'Large' }]" size="lg" aria-label="Large size" />
      <WpSegmented v-model="size" :options="[{ value: 'sm', label: 'sm' }, { value: 'md', label: 'md' }, { value: 'lg', label: 'lg', disabled: true }]" aria-label="With a disabled option" />
      <WpSegmented v-model="size" :options="[{ value: 'sm', label: 'Off' }, { value: 'md', label: 'On' }]" disabled aria-label="Disabled" />
    </div>
    <div class="wp-kit__canvas">
      <p class="wp-kit__caption">Canvas, size sm</p>
      <WpSegmented v-model="mode" :options="[{ value: 'hash', label: 'Hash' }, { value: 'seq', label: 'Sequential' }, { value: 'stride', label: 'Stride' }]" size="sm" aria-label="Strategy" />
    </div>
  </div>
</template>
