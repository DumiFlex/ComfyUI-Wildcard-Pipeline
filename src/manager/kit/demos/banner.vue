<script setup lang="ts">
import { ref } from "vue";
import Banner from "@/kit/Banner.vue";
import Button from "../../components/ui/Button.vue";

const shown = ref(true);
</script>

<template>
  <div class="wp-kit__stack wp-kit__stack--wide">
    <Banner tone="info">Drafts are kept on this computer only.</Banner>
    <Banner tone="success" title="Pack installed">12 modules and 2 bundles were added to the library.</Banner>
    <Banner v-if="shown" tone="warn" title="2 modules are out of date" dismissible @dismiss="shown = false">
      Update them before you publish.
      <template #actions><Button size="sm">Update</Button></template>
    </Banner>
    <Button v-else size="sm" @click="shown = true">Show the warning again</Button>
    <Banner tone="danger" title="Couldn't load the library">
      The server didn't answer.
      <template #actions><Button size="sm" icon="pi-refresh">Try again</Button></template>
    </Banner>
    <Banner tone="accent" icon="pi-sparkles">The assistant can draft the options for you.</Banner>
    <Banner tone="neutral" size="sm">A small neutral note.</Banner>
    <div class="wp-kit__canvas">
      <p class="wp-kit__caption">Canvas, size sm</p>
      <Banner tone="warn" size="sm" dismissible>$mood is read but never written upstream.</Banner>
    </div>
  </div>
</template>
