<script setup lang="ts">
/**
 * PackSettings — what the user decides before the planner does: library
 * reuse, negatives, sub-bundles, writing style, rating, options per
 * wildcard and whether it adapts to the model family: preferences that
 * hold for any pack. What a pack is about (its subject, LoRAs, a story
 * over a Loop) the planner reads from the request or asks. Sent with every
 * plan request; no model involved.
 */
import Input from "../ui/Input.vue";
import Select from "../ui/Select.vue";
import type { SelectOption } from "../ui/select-types";
import type { AiPackSettings } from "../../api/types";
import { FIELDS, type Field } from "./pack-settings-fields";

const props = defineProps<{
  modelValue: AiPackSettings;
  disabled?: boolean;
  /** Show what each choice does under its field (the Settings step). */
  detailed?: boolean;
}>();
const emit = defineEmits<{ (e: "update:modelValue", v: AiPackSettings): void }>();

const COUNT_HINT = "How many options each wildcard gets. Empty is Auto: the planner sizes each one.";

function hintFor(key: Field): string {
  return FIELDS.find((f) => f.key === key)?.options.find((o) => o.value === props.modelValue[key])?.hint ?? "";
}

function options(f: (typeof FIELDS)[number]): SelectOption[] {
  return f.options.map(({ hint, ...o }) => ({ ...o, title: hint }));
}

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
        :options="options(f)"
        :title="f.about"
        :filterable="false"
        :disabled="disabled"
        :aria-label="f.label"
        :data-test="`pack-setting-${f.key}`"
        @update:model-value="(v) => set(f.key, v as never)"
      />
      <span v-if="detailed" class="wp-pack-settings__hint" :data-test="`pack-setting-hint-${f.key}`">{{ hintFor(f.key) }}</span>
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
      <span v-if="detailed" class="wp-pack-settings__hint">{{ COUNT_HINT }}</span>
    </label>
  </div>
</template>

<style scoped>
.wp-pack-settings {
  display: grid; gap: 8px 12px; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
}
.wp-pack-settings:has(.wp-pack-settings__hint) {
  gap: 14px 16px; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
}
.wp-pack-settings__field { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.wp-pack-settings__hint { font-size: 11.5px; line-height: 1.4; color: var(--wp-text-muted); }
.wp-pack-settings__label { font-size: 11px; color: var(--wp-text-dim); text-transform: uppercase; letter-spacing: 0.04em; }
</style>
