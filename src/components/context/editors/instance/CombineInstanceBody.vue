<script setup lang="ts">
import { computed } from "vue";
import type { ModuleEntry } from "../../../../widgets/_shared";
import { patchInstance } from "./patch";
import InternalFlagSection from "./sections/InternalFlagSection.vue";

const props = defineProps<{ module: ModuleEntry }>();
const emit = defineEmits<{ "update": [patch: Partial<ModuleEntry>] }>();

const instance = computed(() => props.module.instance ?? {});

function onUpdate(next: boolean | null): void {
  emit("update", patchInstance(props.module, "internal", next));
}

function onReset(): void {
  emit("update", patchInstance(props.module, "internal", null));
}
</script>

<template>
  <div class="wp-combine-instance">
    <InternalFlagSection
      :library="false"
      :model-value="instance.internal ?? null"
      @update:model-value="onUpdate"
      @reset="onReset"
    />
  </div>
</template>
