<script setup lang="ts">
/**
 * PackSettings — what the user decides before the planner does: library
 * reuse, negatives, sub-bundles, writing style, rating and options per
 * wildcard. Sent with every plan request; no model involved.
 */
import Input from "../ui/Input.vue";
import Select from "../ui/Select.vue";
import type { SelectOption } from "../ui/select-types";
import type { AiPackSettings } from "../../api/types";

const props = defineProps<{ modelValue: AiPackSettings; disabled?: boolean }>();
const emit = defineEmits<{ (e: "update:modelValue", v: AiPackSettings): void }>();

type Field = Exclude<keyof AiPackSettings, "count">;

const FIELDS: Array<{ key: Field; label: string; options: SelectOption[] }> = [
  { key: "library", label: "Your library", options: [
    { value: "reuse", label: "Reuse what fits" },
    { value: "inspire", label: "New, in its style" },
    { value: "new", label: "Everything new" },
  ] },
  { key: "negatives", label: "Negatives", options: [
    { value: "auto", label: "Standing + per option" },
    { value: "template", label: "Template only" },
    { value: "none", label: "None" },
  ] },
  { key: "structure", label: "Structure", options: [
    { value: "sections", label: "Sub-bundle per section" },
    { value: "flat", label: "One bundle" },
  ] },
  { key: "style", label: "Written as", options: [
    { value: "auto", label: "Planner decides" },
    { value: "tags", label: "Tags" },
    { value: "sentences", label: "Natural phrases" },
  ] },
  { key: "rating", label: "Rating", options: [
    { value: "auto", label: "Planner decides" },
    { value: "safe", label: "Safe" },
    { value: "nsfw", label: "NSFW" },
  ] },
];

function set<K extends keyof AiPackSettings>(key: K, value: AiPackSettings[K]): void {
  emit("update:modelValue", { ...props.modelValue, [key]: value });
}

function setCount(v: string | number): void {
  const n = Math.round(Number(v));
  // 0 (or empty) is "Auto"; the server keeps a set number within 4–60.
  set("count", Number.isFinite(n) && n > 0 ? Math.min(60, n) : 0);
}
</script>

<template>
  <div class="wp-pack-settings" data-test="pack-settings">
    <label v-for="f in FIELDS" :key="f.key" class="wp-pack-settings__field">
      <span class="wp-pack-settings__label">{{ f.label }}</span>
      <Select
        size="sm"
        :model-value="modelValue[f.key]"
        :options="f.options"
        :filterable="false"
        :disabled="disabled"
        :aria-label="f.label"
        :data-test="`pack-setting-${f.key}`"
        @update:model-value="(v) => set(f.key, v as never)"
      />
    </label>
    <label class="wp-pack-settings__field">
      <span class="wp-pack-settings__label">Options per wildcard</span>
      <Input
        type="number"
        size="sm"
        :model-value="modelValue.count || ''"
        :min="0"
        :max="60"
        placeholder="Auto"
        :disabled="disabled"
        aria-label="Options per wildcard"
        data-test="pack-setting-count"
        @update:model-value="setCount"
      />
    </label>
  </div>
</template>

<style scoped>
.wp-pack-settings {
  display: grid; gap: 8px 12px; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
}
.wp-pack-settings__field { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.wp-pack-settings__label { font-size: 11px; color: var(--wp-text-dim); text-transform: uppercase; letter-spacing: 0.04em; }
</style>
