<script setup lang="ts">
import Kbd from "@/kit/Kbd.vue";
</script>

<template>
  <div class="wp-kit__stack">
    <span class="wp-kit__inline"><Kbd keys="Mod+K" /> opens search</span>
    <span class="wp-kit__inline"><Kbd keys="Mod+Shift+P" /> runs a command</span>
    <span class="wp-kit__inline"><Kbd :keys="['Shift', 'Enter']" /> adds a new line</span>
    <span class="wp-kit__inline"><Kbd keys="Esc" size="sm" /> closes (size sm)</span>
  </div>
</template>
