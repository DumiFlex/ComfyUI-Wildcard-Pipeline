<script setup lang="ts">
import { ref } from "vue";
import WpSwitch from "@/components/shared/WpSwitch.vue";
import KitLooks from "../KitLooks.vue";

const live = ref(true);
const hide = ref(false);
const lock = ref(true);
</script>

<template>
  <KitLooks v-slot="{ size }">
    <WpSwitch v-model="live" :size="size" label="Live preview" />
    <WpSwitch :model-value="false" :size="size" label="Off" />
    <WpSwitch :model-value="false" mixed :size="size" label="Some" />
    <WpSwitch :model-value="true" disabled :size="size" label="Disabled" />
    <WpSwitch :model-value="false" invalid :size="size" label="Invalid" />
    <WpSwitch v-model="hide" variant="chip" icon="pi-eye-slash" :size="size" label="Hide from prompt" />
    <WpSwitch v-model="lock" variant="chip" icon="pi-lock" :size="size" label="Lock pick" />
    <WpSwitch :model-value="false" mixed variant="chip" icon="pi-lock" :size="size" label="Lock all picks" />
    <WpSwitch :model-value="false" disabled variant="chip" icon="pi-link" :size="size" label="Hold across run" />
  </KitLooks>
</template>
