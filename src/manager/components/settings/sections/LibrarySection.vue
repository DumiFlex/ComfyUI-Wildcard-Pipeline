<script setup lang="ts">
import DatabaseCard from "../DatabaseCard.vue";
import BackupsPanel from "../BackupsPanel.vue";
import LocationSection from "../LocationSection.vue";
</script>

<template>
  <div id="db-summary" class="wp-set-lib__db" data-setting="db-summary">
    <DatabaseCard />
  </div>
  <BackupsPanel />
  <section id="db-location" class="wp-set-lib__loc" data-setting="db-location">
    <LocationSection />
  </section>
</template>

<style scoped>
.wp-set-lib__db { margin-bottom: var(--wp-space-7, 24px); scroll-margin-top: 80px; }
.wp-set-lib__loc {
  background: var(--wp-bg-2);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius-lg, 10px);
  padding: var(--wp-space-5) var(--wp-space-6);
  scroll-margin-top: 80px;
}
</style>
