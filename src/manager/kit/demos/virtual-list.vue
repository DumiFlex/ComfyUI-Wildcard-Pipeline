<script setup lang="ts">
import { ref } from "vue";
import VirtualList from "@/components/shared/VirtualList.vue";
import WpButton from "@/components/shared/WpButton.vue";

const colours = ["red", "teal", "amber", "violet", "silver", "black", "auburn", "rose"];
const options = Array.from({ length: 5000 }, (_, i) => ({ id: i, text: `${colours[i % colours.length]} hair, variant ${i + 1}` }));
const list = ref<{ scrollToIndex: (i: number) => void } | null>(null);
</script>

<template>
  <div class="wp-kit__stack">
    <div class="wp-kit__row">
      <span class="wp-kit__caption">5,000 options, about 20 rows built</span>
      <WpButton size="sm" @click="list?.scrollToIndex(2500)">Go to 2,501</WpButton>
    </div>
    <VirtualList ref="list" :items="options" :item-height="32" height="240px" :item-key="(o) => o.id" label="Options">
      <template #item="{ item, index }">
        <span class="wp-kit-vlist-row"><span class="wp-kit-vlist-row__n">{{ index + 1 }}</span>{{ item.text }}</span>
      </template>
    </VirtualList>
  </div>
</template>

<style scoped>
.wp-kit-vlist-row { display: flex; align-items: center; gap: var(--wp-space-3); height: 32px; padding: 0 var(--wp-space-3); border-bottom: 1px solid var(--wp-border-soft); }
.wp-kit-vlist-row__n { width: 4ch; color: var(--wp-text-dim); font-variant-numeric: tabular-nums; text-align: right; }
</style>
