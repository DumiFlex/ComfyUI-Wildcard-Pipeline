<script setup lang="ts">
/**
 * Community → 404 state.
 */
import { useRouter } from "vue-router";
import Button from "../../components/ui/Button.vue";

const router = useRouter();

function back() {
  router.push({ name: "community-discover" });
}
</script>

<template>
  <div class="wp-comm-page">
    <div class="wp-empty wp-empty--card">
      <div class="big">404</div>
      <h3>Module not found</h3>
      <p>It might have been unpublished, renamed, or moved.</p>
      <Button icon="arrow-left" class="wp-empty__cta" @click="back">Back to Discover</Button>
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

/* CTA on the 404 empty card sits a notch lower than the default
   wp-empty__cta gap because the giant "404" hero needs more breathing room. */
.wp-empty__cta { margin-top: 16px; }
</style>
