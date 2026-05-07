<script setup lang="ts">
import { computed } from "vue";
import type { ModuleEntry } from "../../../../widgets/_shared";
import { patchInstance } from "./patch";
import ValuesOverrideSection from "./sections/ValuesOverrideSection.vue";

interface ValueRow { id: string; name: string; value: string }

const props = defineProps<{ module: ModuleEntry }>();
const emit = defineEmits<{ "update": [patch: Partial<ModuleEntry>] }>();

const libraryValues = computed<ValueRow[]>(() => {
  const payload = (props.module.payload ?? {}) as { values?: ValueRow[] };
  return payload.values ?? [];
});

const instance = computed(() => props.module.instance ?? {});

function onValuesUpdate(next: ValueRow[] | null): void {
  emit("update", patchInstance(props.module, "values_overrides", next));
}

function onReset(): void {
  emit("update", patchInstance(props.module, "values_overrides", null));
}
</script>

<template>
  <div class="wp-fixed-values-instance">
    <ValuesOverrideSection
      :library="libraryValues"
      :model-value="instance.values_overrides ?? null"
      @update:model-value="onValuesUpdate"
      @reset="onReset"
    />
  </div>
</template>
