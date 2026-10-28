<script setup lang="ts">
import { ref } from "vue";
import Button from "../../components/ui/Button.vue";

const favs = ref(true);
</script>

<template>
  <div class="wp-kit__stack wp-kit__stack--wide">
    <div class="wp-kit__row">
      <Button variant="primary" icon="pi-plus">New module</Button>
      <Button>Cancel</Button>
      <Button variant="outline" icon="pi-book">Docs</Button>
      <Button variant="ghost" icon="pi-refresh">Refresh</Button>
      <Button variant="danger" icon="pi-trash">Delete</Button>
      <Button variant="link">Open in library</Button>
      <Button variant="ghost" icon="pi-cog" aria-label="Settings" />
    </div>
    <p class="wp-kit__muted">Sizes: sm 24, md 32, lg 40.</p>
    <div class="wp-kit__row">
      <Button size="sm" icon="pi-plus">Small</Button>
      <Button icon="pi-plus">Medium</Button>
      <Button size="lg" icon="pi-plus">Large</Button>
      <Button size="sm" icon="pi-cog" aria-label="Small settings" />
      <Button icon="pi-cog" aria-label="Medium settings" />
      <Button size="lg" icon="pi-cog" aria-label="Large settings" />
    </div>
    <p class="wp-kit__muted">Loading keeps its colours; disabled fades.</p>
    <div class="wp-kit__row">
      <Button variant="primary" loading>Saving</Button>
      <Button loading>Saving</Button>
      <Button variant="danger" loading>Deleting</Button>
    </div>
    <div class="wp-kit__row">
      <Button variant="primary" disabled>Save</Button>
      <Button disabled>Cancel</Button>
      <Button variant="outline" disabled>Docs</Button>
      <Button variant="ghost" disabled>Refresh</Button>
      <Button variant="danger" disabled>Delete</Button>
    </div>
    <p class="wp-kit__muted">Toggle (pressed) and the dashed add button.</p>
    <div class="wp-kit__row">
      <Button variant="outline" :icon="favs ? 'pi-star-fill' : 'pi-star'" :pressed="favs" aria-label="Favourites only" @click="favs = !favs" />
      <Button variant="ghost" icon="pi-filter" :pressed="favs" @click="favs = !favs">Filters</Button>
    </div>
    <Button variant="add" icon="pi-plus" block>Add rule</Button>
  </div>
</template>
