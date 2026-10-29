<script setup lang="ts">
import { ref } from "vue";
import Button from "../../../kit/Button.vue";
import Drawer from "../../../kit/Drawer.vue";

const open = ref(false);
const side = ref(false);
</script>

<template>
  <Button @click="open = true">Open history</Button>
  <Button @click="side = true">Open beside the page</Button>
  <Drawer v-model:open="open" title="History" width="380px">
    <ul class="wp-kit__list">
      <li>Renamed Hair colour</li>
      <li>Added 3 options</li>
      <li>Changed the weight of red</li>
    </ul>
    <template #footer>
      <Button @click="open = false">Close</Button>
    </template>
  </Drawer>
  <Drawer v-model:open="side" title="Inspector" :modal="false" width="320px">
    <p class="wp-kit__muted">No backdrop: the page behind stays usable.</p>
  </Drawer>
</template>
