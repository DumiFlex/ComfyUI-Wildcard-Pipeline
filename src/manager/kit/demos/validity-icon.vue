<script setup lang="ts">
import ValidityIcon from "../../components/ValidityIcon.vue";
</script>

<template>
  <span class="wp-kit__inline"><ValidityIcon :issues="[]" /> No problems</span>
  <span class="wp-kit__inline"><ValidityIcon :issues="[{ severity: 'warn', message: 'Uses $subject, which nothing sets.' }]" /> A warning</span>
  <span class="wp-kit__inline"><ValidityIcon :issues="[{ severity: 'error', message: 'Points at a wildcard that is gone.' }]" /> An error</span>
</template>
