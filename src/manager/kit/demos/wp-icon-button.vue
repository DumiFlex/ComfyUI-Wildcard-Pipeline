<script setup lang="ts">
import { ref } from "vue";
import WpIconButton from "@/components/shared/WpIconButton.vue";

const locked = ref(true);
const internal = ref(false);
const open = ref(true);
</script>

<template>
  <div class="wp-kit__stack wp-kit__stack--wide">
    <div class="wp-kit__row">
      <WpIconButton icon="pi-lock" tone="warn" :pressed="locked" :label="locked ? 'Unlock seed' : 'Lock seed'" @click="locked = !locked" />
      <WpIconButton icon="pi-globe" tone="accent" :pressed="internal" :label="internal ? 'Unmark internal' : 'Mark internal'" @click="internal = !internal" />
      <WpIconButton icon="pi-trash" tone="danger" label="Remove module" />
      <WpIconButton icon="pi-eye" label="Toggle all enabled" />
      <WpIconButton icon="pi-globe" tone="accent" pressed="mixed" label="Some children internal" />
      <WpIconButton tone="accent" :pressed="true" label="Make the total internal">Σ</WpIconButton>
      <WpIconButton icon="pi-trash" tone="danger" label="Remove (disabled)" disabled />
    </div>
    <div class="wp-kit__canvas">
      <p class="wp-kit__caption">In a row: fold caret (bare), then the actions</p>
      <div class="wp-kit__row">
        <WpIconButton variant="bare" :icon="open ? 'pi-caret-down' : 'pi-caret-right'" :label="open ? 'Collapse' : 'Expand'" @click="open = !open" />
        <span>Hair colour</span>
        <WpIconButton icon="pi-lock" tone="warn" :pressed="locked" label="Lock seed" @click="locked = !locked" />
        <WpIconButton icon="pi-globe" tone="accent" :pressed="internal" label="Mark internal" @click="internal = !internal" />
        <WpIconButton icon="pi-trash" tone="danger" label="Remove module" />
      </div>
    </div>
  </div>
</template>
