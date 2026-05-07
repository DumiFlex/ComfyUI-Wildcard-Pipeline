<script setup lang="ts">
import { computed } from "vue";
import type { ModuleEntry } from "../../../../widgets/_shared";
import { patchInstance, patchInstanceMapEntry } from "./patch";
import VariableBindingSection from "./sections/VariableBindingSection.vue";
import ResolveModeSection from "./sections/ResolveModeSection.vue";
import EnabledOptionsSection from "./sections/EnabledOptionsSection.vue";
import OptionWeightsSection from "./sections/OptionWeightsSection.vue";
import CategoryFilterSection from "./sections/CategoryFilterSection.vue";
import LockSection from "./sections/LockSection.vue";
import InternalFlagSection from "./sections/InternalFlagSection.vue";

const props = defineProps<{ module: ModuleEntry }>();
const emit = defineEmits<{ "update": [patch: Partial<ModuleEntry>] }>();

const payload = computed(() => (props.module.payload ?? {}) as {
  options?: Array<{ id: string; value: string; weight: number }>;
  sub_categories?: string[];
  var_binding?: string;
});
const instance = computed(() => props.module.instance ?? {});

function onUpdate<K extends keyof NonNullable<ModuleEntry["instance"]>>(
  field: K, value: NonNullable<ModuleEntry["instance"]>[K] | null,
): void {
  emit("update", patchInstance(props.module, field, value));
}

function onWeightUpdate(id: string, weight: number | null): void {
  emit("update", patchInstanceMapEntry(props.module, "option_weights", id, weight));
}

function onLockUpdate(seed: number | null): void {
  emit("update", patchInstance(props.module, "locked_seed", seed));
}

function onLastLockedSeedUpdate(seed: number): void {
  const next = { ...(instance.value._ui ?? {}), last_locked_seed: seed };
  emit("update", { instance: { ...instance.value, _ui: next } });
}

function onResolveModeUpdate(value: { mode: "random" | "subcategory" | "pinned" | null; pinned_option_id: string | null } | null): void {
  // Two-field tuple — split into two shallow merges via one combined emit.
  const next = {
    ...instance.value,
    mode: value?.mode ?? null,
    pinned_option_id: value?.pinned_option_id ?? null,
  };
  emit("update", { instance: next });
}
</script>

<template>
  <div class="wp-wildcard-instance">
    <VariableBindingSection
      :library="payload.var_binding ?? ''"
      :model-value="instance.variable_binding ?? null"
      @update:model-value="(v) => onUpdate('variable_binding', v)"
      @reset="onUpdate('variable_binding', null)"
    />
    <ResolveModeSection
      :library="{ mode: 'random', options: payload.options ?? [] }"
      :model-value="instance.mode || instance.pinned_option_id ? { mode: instance.mode ?? null, pinned_option_id: instance.pinned_option_id ?? null } : null"
      @update:model-value="onResolveModeUpdate"
      @reset="onResolveModeUpdate(null)"
    />
    <EnabledOptionsSection
      :library="payload.options ?? []"
      :model-value="instance.enabled_options ?? null"
      @update:model-value="(v) => onUpdate('enabled_options', v)"
      @reset="onUpdate('enabled_options', null)"
    />
    <OptionWeightsSection
      :library="payload.options ?? []"
      :model-value="instance.option_weights ?? null"
      @update:weight="onWeightUpdate"
      @update:model-value="(v) => onUpdate('option_weights', v)"
      @reset="onUpdate('option_weights', null)"
    />
    <CategoryFilterSection
      :library="payload.sub_categories ?? []"
      :model-value="instance.category_filter ?? null"
      @update:model-value="(v) => onUpdate('category_filter', v)"
      @reset="onUpdate('category_filter', null)"
    />
    <LockSection
      :library="undefined"
      :model-value="instance.locked_seed ?? null"
      :last-locked-seed="instance._ui?.last_locked_seed"
      @update:model-value="onLockUpdate"
      @update:last-locked-seed="onLastLockedSeedUpdate"
      @reset="onLockUpdate(null)"
    />
    <InternalFlagSection
      :library="false"
      :model-value="instance.internal ?? null"
      @update:model-value="(v) => onUpdate('internal', v)"
      @reset="onUpdate('internal', null)"
    />
  </div>
</template>
