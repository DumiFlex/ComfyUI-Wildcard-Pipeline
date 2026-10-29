<script setup lang="ts">
import { ref } from "vue";
import Button from "../../../kit/Button.vue";
import ModalShell from "@/kit/ModalShell.vue";

const open = ref(false);
</script>

<template>
  <Button @click="open = true">Open a dialog</Button>
  <ModalShell :visible="open" @close="open = false">
    <div class="wp-kit__canvas-dialog">
      <p>ModalShell gives the backdrop, Escape and the key shield, and wears the colours of the side it opens on; the frame inside is the dialog's own.</p>
      <Button size="sm" @click="open = false">Close</Button>
    </div>
  </ModalShell>
</template>
