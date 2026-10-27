<script setup lang="ts">
import { ref } from "vue";

const mode = ref("tags");
</script>

<template>
  <div class="wp-kit__stack">
    <div role="radiogroup" aria-label="Writing style" class="wp-kit__row">
      <label class="wp-kit__inline"><input v-model="mode" type="radio" class="wp-radio" value="tags"> Tags</label>
      <label class="wp-kit__inline"><input v-model="mode" type="radio" class="wp-radio" value="phrases"> Natural phrases</label>
      <label class="wp-kit__inline"><input v-model="mode" type="radio" class="wp-radio" value="both"> Per model family</label>
    </div>
    <div role="radiogroup" aria-label="Disabled example" class="wp-kit__row">
      <label class="wp-kit__inline"><input type="radio" class="wp-radio" name="kit-radio-off" checked disabled> Disabled, picked</label>
      <label class="wp-kit__inline"><input type="radio" class="wp-radio" name="kit-radio-off" disabled> Disabled</label>
    </div>
  </div>
</template>
