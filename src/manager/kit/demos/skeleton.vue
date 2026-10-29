<script setup lang="ts">
import Skeleton from "@/kit/Skeleton.vue";
</script>

<template>
  <div class="wp-kit__stack">
    <p class="wp-kit__caption">Rows</p>
    <Skeleton shape="row" :lines="3" label="Loading modules" />
    <p class="wp-kit__caption">Text and a block</p>
    <Skeleton shape="line" :lines="3" />
    <Skeleton shape="block" height="72px" />
    <div class="wp-kit__row">
      <Skeleton shape="circle" width="32px" />
      <Skeleton shape="line" width="140px" />
    </div>
  </div>
</template>
