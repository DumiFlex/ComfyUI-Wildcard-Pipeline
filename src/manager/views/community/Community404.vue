<script setup lang="ts">
/**
 * Community → 404 state.
 */
import { useRouter } from "vue-router";
import Button from "primevue/button";

const router = useRouter();

function back() {
  router.push({ name: "community-discover" });
}
</script>

<template>
  <div class="wp-comm-page">
    <div class="wp-comm-empty">
      <div class="big">404</div>
      <h3>Module not found</h3>
      <p>It might have been unpublished, renamed, or moved.</p>
      <Button label="Back to Discover" icon="pi pi-arrow-left" class="mt-3" @click="back" />
    </div>
  </div>
</template>

<style scoped>
@import "../../community/community.css";

.big {
  font-size: 88px;
  font-weight: 700;
  color: var(--wp-accent-text);
  line-height: 1;
}
.mt-3 { margin-top: 16px; }
</style>
