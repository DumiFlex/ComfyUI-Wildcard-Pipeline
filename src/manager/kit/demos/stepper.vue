<script setup lang="ts">
import { ref } from "vue";
import Stepper from "@/kit/Stepper.vue";

const step = ref<"describe" | "plan" | "build" | "test" | "install">("build");
const steps = [
  { id: "describe", label: "Describe" },
  { id: "plan", label: "Plan", hint: "6 choices, 2 rules" },
  { id: "build", label: "Build" },
  { id: "test", label: "Test" },
  { id: "install", label: "Install" },
] as const;
const side = ref<"files" | "review" | "done">("review");
</script>

<template>
  <div class="wp-kit__stack wp-kit__stack--wide">
    <Stepper v-model="step" :steps="[...steps]" clickable linear aria-label="Pack builder steps" />
    <Stepper
      model-value="test"
      :steps="[{ id: 'files', label: 'Files' }, { id: 'review', label: 'Review', state: 'error', hint: '2 files failed' }, { id: 'test', label: 'Test' }]"
      aria-label="With a problem"
    />
    <div class="wp-kit__row">
      <Stepper
        v-model="side"
        :steps="[{ id: 'files', label: 'Pick files' }, { id: 'review', label: 'Review' }, { id: 'done', label: 'Done' }]"
        orientation="vertical"
        clickable
        aria-label="Vertical"
      />
      <div class="wp-kit__canvas">
        <p class="wp-kit__caption">Canvas, size sm</p>
        <Stepper model-value="b" :steps="[{ id: 'a', label: 'Source' }, { id: 'b', label: 'Filter' }, { id: 'c', label: 'Send' }]" size="sm" aria-label="Small" />
      </div>
    </div>
  </div>
</template>
