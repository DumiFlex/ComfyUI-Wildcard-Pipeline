<script setup lang="ts">
import Avatar from "@/components/shared/Avatar.vue";
</script>

<template>
  <div class="wp-kit__stack">
    <div class="wp-kit__row">
      <Avatar name="Dumi Flex" size="lg" />
      <Avatar name="Ada Lovelace" />
      <Avatar name="mira" />
      <Avatar name="Pack bot" icon="pi-box" shape="square" />
      <Avatar name="Broken picture" src="/wp/missing-avatar.png" />
      <Avatar name="Kai Sato" size="sm" />
    </div>
    <div class="wp-kit__row">
      <Avatar name="Ada Lovelace" size="sm" decorative />
      <span>Ada Lovelace published <strong>Soft light pack</strong></span>
    </div>
  </div>
</template>
