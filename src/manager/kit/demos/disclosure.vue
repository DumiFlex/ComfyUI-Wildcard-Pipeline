<script setup lang="ts">
import { ref } from "vue";
import Disclosure from "@/kit/Disclosure.vue";
import Button from "../../../kit/Button.vue";

const open = ref(true);
</script>

<template>
  <div class="wp-kit__stack wp-kit__stack--wide">
    <Disclosure v-model:open="open" label="Advanced" :count="3">
      <p class="wp-kit__muted">Seed stride, pick strategy and the fallback rule live here.</p>
    </Disclosure>
    <Disclosure label="Boxed, with an action" boxed default-open>
      <template #actions><Button size="sm" variant="ghost" icon="pi-plus">Add rule</Button></template>
      <p class="wp-kit__muted">A boxed disclosure reads as a card that folds.</p>
    </Disclosure>
    <Disclosure label="Disabled" disabled>
      <p class="wp-kit__muted">Never shown.</p>
    </Disclosure>
    <div class="wp-kit__canvas">
      <p class="wp-kit__caption">Canvas, size sm</p>
      <Disclosure label="Step 3: derivation" size="sm" :count="2">
        <p class="wp-kit__muted">$mood ← happy</p>
      </Disclosure>
    </div>
  </div>
</template>
