<script setup lang="ts">
import { computed } from "vue";
import type { ModuleEntry } from "../../../../widgets/_shared";
import { patchInstance } from "./patch";
import DisabledExceptionsSection from "./sections/DisabledExceptionsSection.vue";
import DisabledMatrixCellsSection from "./sections/DisabledMatrixCellsSection.vue";

interface Exception {
  source_value: string;
  target_value: string;
  mode: string;
  factor: number;
}

type ConstraintMatrix = Record<string, Record<string, boolean>>;

const props = defineProps<{
  module: ModuleEntry;
  siblingModules: ModuleEntry[];
}>();
const emit = defineEmits<{ "update": [patch: Partial<ModuleEntry>] }>();

const payload = computed(() => (props.module.payload ?? {}) as {
  source_wildcard_id?: string | null;
  target_wildcard_id?: string | null;
  matrix?: ConstraintMatrix;
  exceptions?: Exception[];
});

const instance = computed(() => props.module.instance ?? {});

const exceptions = computed<Exception[]>(() => payload.value.exceptions ?? []);

const matrix = computed<ConstraintMatrix>(() => payload.value.matrix ?? {});

function siblingSubCategories(wildcardId: string | null | undefined): string[] {
  if (!wildcardId) return [];
  const sibling = props.siblingModules.find((m) => m.id === wildcardId);
  if (!sibling) return [];
  const sp = (sibling.payload ?? {}) as { sub_categories?: string[] };
  return sp.sub_categories ?? [];
}

const sourceSubs = computed<string[]>(() =>
  siblingSubCategories(payload.value.source_wildcard_id),
);

const targetSubs = computed<string[]>(() =>
  siblingSubCategories(payload.value.target_wildcard_id),
);

function onExceptionsUpdate(next: string[] | null): void {
  emit("update", patchInstance(props.module, "disabled_exception_keys", next));
}

function onExceptionsReset(): void {
  emit("update", patchInstance(props.module, "disabled_exception_keys", null));
}

function onMatrixUpdate(next: string[] | null): void {
  emit("update", patchInstance(props.module, "disabled_matrix_cells", next));
}

function onMatrixReset(): void {
  emit("update", patchInstance(props.module, "disabled_matrix_cells", null));
}
</script>

<template>
  <div class="wp-constraint-instance">
    <DisabledExceptionsSection
      :library="exceptions"
      :model-value="instance.disabled_exception_keys ?? null"
      @update:model-value="onExceptionsUpdate"
      @reset="onExceptionsReset"
    />
    <DisabledMatrixCellsSection
      :matrix="matrix"
      :source-subs="sourceSubs"
      :target-subs="targetSubs"
      :model-value="instance.disabled_matrix_cells ?? null"
      @update:model-value="onMatrixUpdate"
      @reset="onMatrixReset"
    />
  </div>
</template>
