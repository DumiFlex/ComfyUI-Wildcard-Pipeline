<script setup lang="ts">
import { computed } from "vue";
import type { ModuleEntry } from "../../../../../widgets/_shared";
import { patchInstance } from "../../instance/patch";

const props = defineProps<{ module: ModuleEntry }>();
const emit = defineEmits<{ "update": [patch: Partial<ModuleEntry>] }>();

const libraryBinding = computed(
  () => ((props.module.payload ?? {}) as { var_binding?: string }).var_binding ?? "",
);
const instance = computed(() => props.module.instance ?? {});
const bindingValue = computed(() => instance.value.variable_binding ?? "");
const nameValue = computed(() => props.module.meta?.name ?? "");

function onNameInput(ev: Event): void {
  const next = (ev.target as HTMLInputElement).value;
  emit("update", { meta: { ...props.module.meta, name: next } });
}

function onBindingInput(ev: Event): void {
  const raw = (ev.target as HTMLInputElement).value;
  emit("update", patchInstance(props.module, "variable_binding", raw.length > 0 ? raw : null));
}
</script>

<template>
  <section class="id">
    <div class="id__label">Identity</div>

    <div class="id__row">
      <span class="id__key">Display name</span>
      <input
        class="id__input"
        data-test="id-name"
        type="text"
        :value="nameValue"
        :placeholder="module.meta?.library_name ?? 'module name'"
        aria-label="Display name"
        @input="onNameInput"
      />
    </div>

    <div class="id__row">
      <span class="id__key">Variable binding</span>
      <div class="id__input-wrap">
        <span class="id__input-prefix" data-test="id-binding-prefix">$</span>
        <input
          class="id__input id__input--prefixed"
          data-test="id-binding"
          type="text"
          :value="bindingValue"
          :placeholder="libraryBinding"
          aria-label="Variable binding"
          @input="onBindingInput"
        />
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
  margin-bottom: 6px;
}
.id__row:last-child { margin-bottom: 0; }
.id__key {
  font: 11px var(--wp-font-sans);
  color: var(--wp-text-muted, var(--wp-text2));
}
.id__input {
  background: var(--wp-bg-deep, var(--wp-bg));
  border: 1px solid var(--wp-border);
  border-radius: 3px;
  padding: 5px 8px;
  font: 11px var(--wp-font-mono);
  color: var(--wp-text);
}
.id__input:focus {
  border-color: var(--wp-accent);
  outline: none;
}
.id__input::placeholder { color: var(--wp-text-dim, var(--wp-text3)); }
.id__input-wrap {
  display: flex;
  align-items: stretch;
  background: var(--wp-bg-deep, var(--wp-bg));
  border: 1px solid var(--wp-border);
  border-radius: 3px;
  overflow: hidden;
}
.id__input-wrap:focus-within { border-color: var(--wp-accent); }
.id__input-prefix {
  background: var(--wp-bg2);
  color: var(--wp-text-dim, var(--wp-text3));
  padding: 5px 9px;
  border-right: 1px solid var(--wp-border);
  font: 11px var(--wp-font-mono);
  display: flex;
  align-items: center;
}
.id__input--prefixed {
  flex: 1;
  background: transparent;
  border: 0;
  padding: 5px 8px;
}
.id__input--prefixed:focus { outline: none; }
</style>
