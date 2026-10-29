<script setup lang="ts">
import LoadingMark from "@/kit/LoadingMark.vue";
import Button from "../../../kit/Button.vue";
</script>

<template>
  <div class="wp-kit__stack wp-kit__stack--wide">
    <p class="wp-kit__muted">Inline (tight spots): the sparkle.</p>
    <div class="wp-kit__row">
      <LoadingMark label="Loading" />
      <LoadingMark>Loading bundle…</LoadingMark>
      <Button loading>Saving</Button>
    </div>
    <p class="wp-kit__muted">Pages and panels: the full logo.</p>
    <LoadingMark block>Loading the library…</LoadingMark>
  </div>
</template>
