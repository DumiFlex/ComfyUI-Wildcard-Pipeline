<script setup lang="ts">
import { ref } from "vue";
import RadioGroup from "@/components/shared/RadioGroup.vue";
import Badge from "@/components/shared/Badge.vue";

type Style = "tags" | "sentences" | "both";
const styles: { value: Style; label: string; hint?: string; disabled?: boolean }[] = [
  { value: "tags", label: "Tags", hint: "Danbooru-style, comma separated" },
  { value: "sentences", label: "Sentences", hint: "Natural language, for Flux and SD3" },
  { value: "both", label: "Both", hint: "Needs a model that reads both", disabled: true },
];
const style = ref<Style>("tags");
const mode = ref<"merge" | "replace">("merge");
const canvas = ref<"seed" | "fixed" | "random">("seed");
const where = ref<"cloud" | "local">("local");
</script>

<template>
  <div class="wp-kit__stack">
    <RadioGroup v-model="style" :options="styles" aria-label="Prompt style" />
    <RadioGroup
      v-model="mode"
      :options="[{ value: 'merge', label: 'Merge', hint: 'Keep my edits' }, { value: 'replace', label: 'Replace', hint: 'Take theirs' }]"
      orientation="horizontal"
      cards
      aria-label="Install mode"
    />
    <RadioGroup
      v-model="where"
      :options="[{ value: 'cloud', label: 'Claude' }, { value: 'local', label: 'LM Studio' }]"
      orientation="horizontal"
      cards
      aria-label="Provider"
    >
      <template #label="{ option }">
        {{ option.label }}
        <Badge :text="option.value === 'local' ? 'Local' : 'Cloud'" :tone="option.value === 'local' ? 'success' : 'warn'" dot />
      </template>
    </RadioGroup>
    <div class="wp-kit__canvas">
      <p class="wp-kit__caption">Canvas, size sm</p>
      <RadioGroup
        v-model="canvas"
        :options="[{ value: 'seed', label: 'From seed' }, { value: 'fixed', label: 'Fixed' }, { value: 'random', label: 'Random' }]"
        orientation="horizontal"
        size="sm"
        aria-label="Seed mode"
      />
    </div>
  </div>
</template>
