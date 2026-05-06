<script setup lang="ts">
import type { ModuleEntry } from "../../../widgets/_shared";
defineProps<{ module: ModuleEntry }>();
defineEmits<{ (e: "update", patch: Record<string, unknown>): void }>();
</script>

<template>
  <div class="wp-edit-body">
    <p class="wp-edit-placeholder">Constraint editor body — TODO Task 19</p>
  </div>
</template>

<style scoped>
.wp-edit-placeholder {
  padding: 32px 16px;
  text-align: center;
  color: var(--wp-text-dim, var(--wp-text3));
  font-style: italic;
}
</style>
