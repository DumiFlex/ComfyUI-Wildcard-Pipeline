<script setup lang="ts">
import { computed } from "vue";
import type { ModuleEntry } from "../../../../widgets/_shared";
import { patchInstance } from "./patch";
import DisabledRulesSection from "./sections/DisabledRulesSection.vue";

interface Rule {
  id: string;
  label?: string;
  source_value?: string;
  target_value?: string;
}

const props = defineProps<{ module: ModuleEntry }>();
const emit = defineEmits<{ "update": [patch: Partial<ModuleEntry>] }>();

const rules = computed<Rule[]>(() => {
  const payload = (props.module.payload ?? {}) as { rules?: Rule[] };
  return payload.rules ?? [];
});

const instance = computed(() => props.module.instance ?? {});

function onUpdate(next: string[] | null): void {
  emit("update", patchInstance(props.module, "disabled_rule_ids", next));
}

function onReset(): void {
  emit("update", patchInstance(props.module, "disabled_rule_ids", null));
}
</script>

<template>
  <div class="wp-derivation-instance">
    <DisabledRulesSection
      :library="rules"
      :model-value="instance.disabled_rule_ids ?? null"
      @update:model-value="onUpdate"
      @reset="onReset"
    />
  </div>
</template>
