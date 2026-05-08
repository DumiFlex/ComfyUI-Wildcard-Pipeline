<script setup lang="ts">
import { computed } from "vue";
import type { ModuleEntry } from "../../../../../widgets/_shared";
import { patchInstance } from "../../instance/patch";

const props = defineProps<{ module: ModuleEntry }>();
const emit = defineEmits<{ "update": [patch: Partial<ModuleEntry>] }>();

const libraryBinding = computed(
  () => ((props.module.payload ?? {}) as { var_binding?: string }).var_binding ?? "",
);
const libraryName = computed(() => props.module.meta?.library_name ?? "");
const instance = computed(() => props.module.instance ?? {});
const bindingValue = computed(() => instance.value.variable_binding ?? "");
const nameValue = computed(() => props.module.meta?.name ?? "");

/**
 * "Modified" highlight is purely derived from "current value diverges
 * from library default". This is the visual contract for any field
 * that surfaces an instance override — no separate `mod` badge, just
 * accent border + accent text. When the user types a value back to
 * the library default, the highlight clears automatically because
 * `nameOverridden` / `bindingOverridden` flip to false.
 */
const nameOverridden = computed(() =>
  libraryName.value !== "" && nameValue.value !== libraryName.value,
);
const bindingOverridden = computed(() =>
  bindingValue.value !== "" && bindingValue.value !== libraryBinding.value,
);

function onNameInput(ev: Event): void {
  const next = (ev.target as HTMLInputElement).value;
  emit("update", { meta: { ...props.module.meta, name: next } });
}

function onBindingInput(ev: Event): void {
  const raw = (ev.target as HTMLInputElement).value;
  // Don't auto-clear on exact library match — that snaps the input
  // back to empty mid-typing when users want a name that starts with
  // the library default (e.g. "backdrop" → typing "backdrop-test").
  // The visual `--mod` class is derived from `bindingValue !==
  // libraryBinding`, so an exact match drops the highlight on its
  // own, and the engine treats `instance.variable_binding === payload.var_binding`
  // identically to `null`. Empty input still nulls so the field
  // shows the library default placeholder.
  emit("update", patchInstance(props.module, "variable_binding", raw.length > 0 ? raw : null));
}

/** Per-field reset — restores the field to its library default without
 *  touching anything else. Shows up next to the input only when
 *  `--mod` is active. Pairs with the global "Reset overrides" footer
 *  button: per-field is precise, footer is sweep. */
function onResetName(): void {
  const lib = libraryName.value;
  if (lib === "") return;
  emit("update", { meta: { ...props.module.meta, name: lib } });
}

function onResetBinding(): void {
  emit("update", patchInstance(props.module, "variable_binding", null));
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
          :placeholder="module.meta?.library_name ?? 'module name'"
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

    <div class="id__row">
      <span class="id__key">Variable binding</span>
      <div class="id__input-row">
        <div
          class="id__input-wrap"
          :class="{ 'id__input-wrap--mod': bindingOverridden }"
        >
          <span class="id__input-prefix" data-test="id-binding-prefix">$</span>
          <input
            class="id__input id__input--prefixed"
            :class="{ 'id__input--mod': bindingOverridden }"
            data-test="id-binding"
            type="text"
            :value="bindingValue"
            :placeholder="libraryBinding"
            aria-label="Variable binding"
            @input="onBindingInput"
          />
        </div>
        <button
          v-if="bindingOverridden"
          type="button"
          class="id__reset"
          data-test="id-binding-reset"
          :title="`Restore binding to library default: $${libraryBinding}`"
          aria-label="Reset variable binding to library default"
          @click="onResetBinding"
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
/* "Modified" highlight — diverges from library default. Accent
 * border + accent text, no badge. When the user types the value
 * back to library default the parent computed flips and the class
 * drops automatically. */
.id__input--mod {
  border-color: var(--wp-accent);
  color: var(--wp-accent-text, var(--wp-text));
}
.id__input-wrap {
  display: flex;
  align-items: stretch;
  background: var(--wp-bg-deep, var(--wp-bg));
  border: 1px solid var(--wp-border);
  border-radius: 3px;
  overflow: hidden;
  flex: 1;
}
.id__input-wrap:focus-within { border-color: var(--wp-accent); }
.id__input-wrap--mod { border-color: var(--wp-accent); }

/* Per-field row: input + optional inline reset button. The reset
 * shows up only when the field is in `--mod` state, giving the user
 * a precise way to drop one override without sweeping every other
 * instance change via the footer's Reset overrides. */
.id__input-row {
  display: flex;
  align-items: stretch;
  gap: 6px;
}
.id__input-row .id__input { flex: 1; min-width: 0; }
.id__reset {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: auto;
  background: transparent;
  border: 1px solid var(--wp-border);
  border-radius: 3px;
  color: var(--wp-text-dim, var(--wp-text3));
  cursor: pointer;
  flex-shrink: 0;
}
.id__reset:hover {
  border-color: var(--wp-accent);
  color: var(--wp-accent-text, var(--wp-text));
}
.id__reset .pi { font-size: 10px; }
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
