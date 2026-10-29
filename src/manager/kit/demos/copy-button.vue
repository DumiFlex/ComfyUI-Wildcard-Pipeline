<script setup lang="ts">
import CopyButton from "@/kit/CopyButton.vue";

const prompt = "a portrait of a woman, red hair, golden hour";
</script>

<template>
  <div class="wp-kit__stack wp-kit__stack--wide">
    <div class="wp-kit__row">
      <CopyButton :text="prompt" label="Copy prompt" />
      <CopyButton :text="prompt" label="Copy prompt" show-label />
      <CopyButton :text="prompt" label="Copy prompt" variant="secondary" show-label />
      <CopyButton :text="prompt" label="Copy prompt" size="sm" />
      <CopyButton :text="prompt" label="Copy prompt" size="lg" />
      <CopyButton text="" label="Fails: nothing to copy" show-label />
      <CopyButton :text="prompt" label="Copy prompt" disabled />
    </div>
    <div class="wp-kit__canvas">
      <p class="wp-kit__caption">Canvas, size sm</p>
      <div class="wp-kit__row">
        <code>{{ prompt }}</code>
        <CopyButton :text="prompt" label="Copy prompt" size="sm" />
      </div>
    </div>
  </div>
</template>
