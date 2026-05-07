<script setup lang="ts">
import { computed } from "vue";

type ResolveMode = "random" | "subcategory" | "pinned";
type Override = { mode: ResolveMode | null; pinned_option_id: string | null };

const props = defineProps<{
  library: { mode: "random"; options: { id: string }[] };
  modelValue: Override | null;
}>();

const emit = defineEmits<{
  "update:modelValue": [next: Override | null];
  "reset": [];
}>();

const hasOverride = computed(() => props.modelValue !== null);

const effectiveMode = computed<ResolveMode>(() => {
  return (props.modelValue?.mode as ResolveMode | null) ?? props.library.mode;
});

const effectivePinned = computed<string | null>(() => {
  return props.modelValue?.pinned_option_id ?? null;
});

function setMode(mode: ResolveMode): void {
  if (mode === "random") {
    // Switching back to random — full reset of override pair.
    emit("update:modelValue", null);
    return;
  }
  if (mode === "pinned") {
    const fallback = props.library.options[0]?.id ?? null;
    const id = effectivePinned.value ?? fallback;
    emit("update:modelValue", { mode: "pinned", pinned_option_id: id });
    return;
  }
  // subcategory
  emit("update:modelValue", { mode, pinned_option_id: null });
}

function onModeChange(ev: Event): void {
  const v = (ev.target as HTMLInputElement).value as ResolveMode;
  setMode(v);
}

function onPinnedSelect(ev: Event): void {
  const v = (ev.target as HTMLSelectElement).value;
  emit("update:modelValue", { mode: "pinned", pinned_option_id: v || null });
}

function onClickReset(): void {
  emit("reset");
}
</script>

<template>
  <section class="wp-instance-section">
    <div class="wp-instance-section-head">
      <span class="wp-instance-section-title">Resolve mode</span>
      <span v-if="hasOverride" class="wp-instance-section-modified">modified</span>
      <button
        v-if="hasOverride"
        type="button"
        class="wp-instance-section-reset"
        data-test="rm-reset"
        @click="onClickReset"
      >
        <i class="pi pi-replay" /> reset
      </button>
    </div>
    <div class="wp-instance-section-body wp-instance-section-body-col">
      <div class="wp-instance-radio-group">
        <label class="wp-instance-radio">
          <input
            type="radio"
            value="random"
            data-test="rm-random"
            :checked="effectiveMode === 'random'"
            @change="onModeChange"
          />
          <span>Random</span>
        </label>
        <label class="wp-instance-radio">
          <input
            type="radio"
            value="subcategory"
            data-test="rm-subcategory"
            :checked="effectiveMode === 'subcategory'"
            @change="onModeChange"
          />
          <span>Subcategory pool</span>
        </label>
        <label class="wp-instance-radio">
          <input
            type="radio"
            value="pinned"
            data-test="rm-pinned"
            :checked="effectiveMode === 'pinned'"
            @change="onModeChange"
          />
          <span>Pinned option</span>
        </label>
      </div>
      <select
        v-if="effectiveMode === 'pinned'"
        class="wp-instance-input"
        data-test="rm-pinned-select"
        aria-label="Pinned option"
        :value="effectivePinned ?? ''"
        @change="onPinnedSelect"
      >
        <option
          v-for="opt in library.options"
          :key="opt.id"
          :value="opt.id"
        >{{ opt.id }}</option>
      </select>
    </div>
  </section>
</template>

<style scoped>
.wp-instance-section {
  margin-bottom: 12px;
  padding-bottom: 12px;
  border-bottom: 1px dashed var(--wp-border-soft, var(--wp-border));
}
.wp-instance-section-head {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
}
.wp-instance-section-title {
  font: 600 10px/1 var(--wp-font-sans);
  color: var(--wp-text-muted, var(--wp-text3));
  text-transform: uppercase;
  letter-spacing: 0.08em;
}
.wp-instance-section-modified {
  background: rgba(251, 146, 60, 0.18);
  color: var(--wp-status-modified, #fb923c);
  padding: 1px 5px;
  border-radius: 2px;
  font: 600 9px/1 var(--wp-font-sans);
  text-transform: uppercase;
}
.wp-instance-section-reset {
  margin-left: auto;
  background: transparent;
  border: 1px solid var(--wp-border);
  color: var(--wp-text-muted);
  padding: 2px 6px;
  font: 9px/1 var(--wp-font-sans);
  cursor: pointer;
  border-radius: 3px;
}
.wp-instance-section-body {
  display: flex;
  align-items: center;
  gap: 6px;
}
.wp-instance-section-body-col {
  flex-direction: column;
  align-items: stretch;
}
.wp-instance-radio-group {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}
.wp-instance-radio {
  display: flex;
  align-items: center;
  gap: 4px;
  font: 11px/1.3 var(--wp-font-sans);
  color: var(--wp-text);
  cursor: pointer;
}
.wp-instance-input {
  background: var(--wp-bg-deep, var(--wp-bg));
  border: 1px solid var(--wp-border);
  color: var(--wp-text);
  padding: 4px 6px;
  font: 11px/1.3 var(--wp-font-mono);
  border-radius: 3px;
}
</style>
