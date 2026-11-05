<script setup lang="ts">
/**
 * The kit SettingRow with the route wired in: the row flashes when the
 * Settings search (or a link) lands on `#<settingKey>`. Every other prop and
 * slot goes straight through to `@/kit/SettingRow.vue`.
 */
import { computed } from "vue";
import { useRoute } from "vue-router";
import KitSettingRow from "@/kit/SettingRow.vue";

const props = defineProps<{
  label: string;
  hint?: string;
  settingKey?: string;
  stacked?: boolean;
  form?: boolean;
  /** Control id, so the label is a real <label for>. */
  for?: string;
  recommended?: string;
}>();

const route = useRoute();
const highlighted = computed(() => !!props.settingKey && route?.hash === `#${props.settingKey}`);
</script>

<template>
  <KitSettingRow
    :label="label"
    :hint="hint"
    :setting-key="settingKey"
    :stacked="stacked"
    :form="form"
    :for="props.for"
    :recommended="recommended"
    :highlighted="highlighted"
  >
    <template v-if="$slots.badge" #badge><slot name="badge" /></template>
    <template v-if="$slots.extra" #extra><slot name="extra" /></template>
    <slot />
  </KitSettingRow>
</template>
