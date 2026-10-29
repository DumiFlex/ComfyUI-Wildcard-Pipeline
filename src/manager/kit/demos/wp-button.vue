<script setup lang="ts">
import { ref } from "vue";
import WpButton from "@/kit/WpButton.vue";
import KitLooks from "../KitLooks.vue";

const favs = ref(true);
</script>

<template>
  <KitLooks v-slot="{ size }">
    <WpButton variant="primary" icon="pi-plus" :size="size">Add module</WpButton>
    <WpButton :size="size">Cancel</WpButton>
    <WpButton variant="ghost" icon="pi-replay" :size="size">Reset overrides</WpButton>
    <WpButton variant="outline" icon="pi-history" :size="size">Prev</WpButton>
    <WpButton variant="danger" :size="size">Stop branch</WpButton>
    <WpButton variant="link" :size="size">Edit in library</WpButton>
    <WpButton variant="ghost" icon="pi-download" aria-label="Download snapshot" :size="size" />
    <WpButton variant="primary" loading :size="size">Saving</WpButton>
    <WpButton disabled :size="size">Disabled</WpButton>
    <WpButton
      variant="outline"
      :icon="favs ? 'pi-star-fill' : 'pi-star'"
      :pressed="favs"
      aria-label="Favourites only"
      :size="size"
      @click="favs = !favs"
    />
    <WpButton variant="add" icon="pi-plus" block :size="size">Add template row</WpButton>
  </KitLooks>
</template>
