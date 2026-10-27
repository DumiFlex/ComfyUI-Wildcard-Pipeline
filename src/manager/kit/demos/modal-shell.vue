<script setup lang="ts">
import { ref } from "vue";
import Button from "../../components/ui/Button.vue";
import ModalShell from "@/components/shared/ModalShell.vue";

const open = ref(false);
</script>

<template>
  <Button @click="open = true">Open a canvas dialog</Button>
  <ModalShell :visible="open" @close="open = false">
    <div class="wp-kit__canvas-dialog">
      <p>The canvas look: ModalShell gives the backdrop, Escape and the key shield; the frame inside is the dialog's own.</p>
      <Button size="sm" @click="open = false">Close</Button>
    </div>
  </ModalShell>
</template>
