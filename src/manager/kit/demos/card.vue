<script setup lang="ts">
import Button from "../../../kit/Button.vue";
import Card from "../../../kit/Card.vue";
</script>

<template>
  <div class="wp-kit__stack">
    <Card title="Options" subtitle="5 options">
      <template #actions><Button size="sm" icon="pi-plus">Add</Button></template>
      <p class="wp-kit__muted">The card's body. Editors stack these. The title is the card's name, so it reads first.</p>
    </Card>
  </div>
</template>
