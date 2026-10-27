<script setup lang="ts">
import Icon, { ICON_LG, ICON_MD, ICON_SM } from "../../components/ui/Icon.vue";
import { allCuratedIcons } from "../../components/icon-catalog";

const icons = allCuratedIcons();
</script>

<template>
  <div class="wp-kit__stack">
    <div class="wp-kit__row">
      <Icon name="pi-bolt" :size="ICON_SM" /><span class="wp-kit__muted">ICON_SM</span>
      <Icon name="pi-bolt" :size="ICON_MD" /><span class="wp-kit__muted">ICON_MD</span>
      <Icon name="pi-bolt" :size="ICON_LG" /><span class="wp-kit__muted">ICON_LG</span>
    </div>
    <ul class="wp-kit__icons" aria-label="Category icons">
      <li v-for="i in icons" :key="i"><Icon :name="i" :size="ICON_LG" /><span>{{ i }}</span></li>
    </ul>
  </div>
</template>
