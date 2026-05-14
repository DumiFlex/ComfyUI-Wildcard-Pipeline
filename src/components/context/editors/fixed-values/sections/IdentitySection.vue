<script setup lang="ts">
import { computed } from "vue";
import type { ModuleEntry } from "../../../../../widgets/_shared";

const props = defineProps<{ module: ModuleEntry }>();
const emit = defineEmits<{ "update": [patch: Partial<ModuleEntry>] }>();

const libraryName = computed(() => props.module.meta?.library_name ?? "");
const nameValue = computed(() => props.module.meta?.name ?? "");

const nameOverridden = computed(() =>
  libraryName.value !== "" && nameValue.value !== libraryName.value,
);

function onNameInput(ev: Event): void {
  emit("update", {
    meta: { ...props.module.meta, name: (ev.target as HTMLInputElement).value },
  });
}

function onResetName(): void {
  if (libraryName.value === "") return;
  emit("update", { meta: { ...props.module.meta, name: libraryName.value } });
}
</script>

<template>
  <section class="id">
    <div class="id__label">Identity</div>
    <div class="id__row">
      <span class="id__key">Display name</span>
      <div class="id__input-row">
        <input
          class="id__input"
          :class="{ 'id__input--mod': nameOverridden }"
          data-test="id-name"
          type="text"
          :value="nameValue"
          :placeholder="libraryName || 'module name'"
          aria-label="Display name"
          @input="onNameInput"
        />
        <button
          v-if="nameOverridden"
          type="button"
          class="id__reset"
          data-test="id-name-reset"
          :title="`Restore name to library default: ${libraryName}`"
          aria-label="Reset display name to library default"
          @click="onResetName"
        ><i class="pi pi-replay" aria-hidden="true" /></button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.id {
  padding: 12px 16px;
  background: var(--wp-bg);
  border-bottom: 1px solid var(--wp-border-soft, var(--wp-border));
}
.id__label {
  font: 600 9px var(--wp-font-sans);
  text-transform: uppercase;
  letter-spacing: 0.14em;
  color: var(--wp-text-dim, var(--wp-text3));
  margin-bottom: 8px;
}
.id__row {
  display: grid;
  grid-template-columns: 100px 1fr;
  gap: 10px;
  align-items: center;
}
.id__key { font: 11px var(--wp-font-sans); color: var(--wp-text-muted, var(--wp-text2)); }
.id__input-row { display: flex; align-items: stretch; gap: 6px; }
.id__input {
  flex: 1;
  min-width: 0;
  background: var(--wp-bg-deep, var(--wp-bg));
  border: 1px solid var(--wp-border);
  border-radius: 3px;
  padding: 5px 8px;
  font: 11px var(--wp-font-mono);
  color: var(--wp-text);
}
.id__input:focus { border-color: var(--wp-accent); outline: none; }
.id__input::placeholder { color: var(--wp-text-dim, var(--wp-text3)); }
.id__input--mod {
  border-color: var(--wp-accent);
  color: var(--wp-accent-text, var(--wp-text));
}
/* `.id__reset` styling lives in src/components/context/editors/
 * _modal-template-ctrls.css (imported by ContextWidget unscoped). */
</style>
