<script setup lang="ts">
import { ref } from "vue";
import SplitPane from "@/kit/SplitPane.vue";

const list = ref(200);
const top = ref(70);
</script>

<template>
  <div class="wp-kit__stack wp-kit__stack--wide">
    <div style="height: 140px; border: 1px solid var(--wp-border); border-radius: var(--wp-radius); overflow: hidden;">
      <SplitPane v-model="list" :min="120" :max="420" :default-size="200" label="List width">
        <template #start><p class="wp-kit__muted" style="padding: 10px;">List, {{ list }} px</p></template>
        <template #end><p class="wp-kit__muted" style="padding: 10px;">Detail takes the rest.</p></template>
      </SplitPane>
    </div>
    <div style="height: 160px; border: 1px solid var(--wp-border); border-radius: var(--wp-radius); overflow: hidden;">
      <SplitPane v-model="top" orientation="vertical" :min="40" :max="120" label="Preview height">
        <template #start><p class="wp-kit__muted" style="padding: 10px;">Preview</p></template>
        <template #end><p class="wp-kit__muted" style="padding: 10px;">Editor</p></template>
      </SplitPane>
    </div>
  </div>
</template>
