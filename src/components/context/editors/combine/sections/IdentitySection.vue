<script setup lang="ts">
/**
 * Combine IdentitySection — mirrors wildcard's section 1:1 except the
 * library-binding default sources from `payload.output_var` (combine's
 * library-binding key) instead of `payload.var_binding`. Per-field
 * reset semantics, no-auto-clear typing UX, and empty→null collapse
 * are verbatim from wildcard. Seed-lock controls live in
 * RuntimeSection (mirroring wildcard's split).
 */
import { computed } from "vue";
import type { ModuleEntry } from "../../../../../widgets/_shared";
import { patchInstance } from "../../instance/patch";

const props = withDefaults(
  defineProps<{
    module: ModuleEntry;
    /** Names produced upstream of this Context node. Used for the
     *  binding-collision warning so the user sees the conflict at edit
     *  time rather than via the post-save canvas badge. */
    upstreamVars?: string[];
    /** Names produced by other modules in the SAME Context node. */
    siblingVars?: string[];
  }>(),
  { upstreamVars: () => [], siblingVars: () => [] },
);
const emit = defineEmits<{ "update": [patch: Partial<ModuleEntry>] }>();

// Combine's library binding lives on `payload.output_var` (the variable
// this combine produces). Wildcard reads `payload.var_binding` for the
// equivalent — semantically the same role, different field name on the
// payload because both kinds are binding PRODUCERS.
const libraryBinding = computed(
  () => ((props.module.payload ?? {}) as { output_var?: string }).output_var ?? "",
);
const libraryName = computed(() => props.module.meta?.library_name ?? "");
const instance = computed(() => props.module.instance ?? {});
const bindingValue = computed(() => instance.value.variable_binding ?? "");
const nameValue = computed(() => props.module.meta?.name ?? "");

const nameOverridden = computed(() =>
  libraryName.value !== "" && nameValue.value !== libraryName.value,
);
const bindingOverridden = computed(() =>
  bindingValue.value !== "" && bindingValue.value !== libraryBinding.value,
);

/** Effective binding the engine will write — the override when set,
 *  else the library default. Drives the collision check so users see
 *  the conflict whether they typed a name OR left the library default
 *  that happens to match a sibling. */
const effectiveBinding = computed(() => {
  const stripped = bindingValue.value.replace(/^\$+/, "").trim();
  if (stripped) return stripped;
  return libraryBinding.value.replace(/^\$+/, "").trim();
});

/** Surface a collision when this module's effective binding matches a
 *  name produced upstream OR by a sibling in the same Context node.
 *  Last-write-wins at runtime so the binding still resolves, but the
 *  user is almost certainly looking at a bug — surface it at edit time
 *  with an inline warning instead of waiting for the canvas conflict
 *  badge after save. Empty binding never collides (no value to clash). */
const collidesWith = computed<"upstream" | "sibling" | null>(() => {
  const name = effectiveBinding.value;
  if (!name) return null;
  if (props.siblingVars.includes(name)) return "sibling";
  if (props.upstreamVars.includes(name)) return "upstream";
  return null;
});

const collisionMessage = computed(() => {
  if (collidesWith.value === "sibling") {
    return `$${effectiveBinding.value} is already produced by another module in this Context. ` +
           "At runtime, last-write-wins — pick a unique name.";
  }
  if (collidesWith.value === "upstream") {
    return `$${effectiveBinding.value} is already produced upstream. This module will ` +
           "overwrite it for downstream modules.";
  }
  return "";
});

function onNameInput(ev: Event): void {
  const next = (ev.target as HTMLInputElement).value;
  emit("update", { meta: { ...props.module.meta, name: next } });
}

function onBindingInput(ev: Event): void {
  const raw = (ev.target as HTMLInputElement).value;
  emit("update", patchInstance(props.module, "variable_binding", raw.length > 0 ? raw : null));
}

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
          :class="{
            'id__input-wrap--mod': bindingOverridden,
            'id__input-wrap--collision': collidesWith !== null,
            'id__input-wrap--collision-warn': collidesWith === 'sibling',
            'id__input-wrap--collision-info': collidesWith === 'upstream',
          }"
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
    <div
      v-if="collidesWith !== null"
      class="id__collision"
      :class="{
        'id__collision--warn': collidesWith === 'sibling',
        'id__collision--info': collidesWith === 'upstream',
      }"
      data-test="id-binding-collision"
      role="status"
    >
      <i
        :class="[
          'pi',
          collidesWith === 'sibling' ? 'pi-exclamation-triangle' : 'pi-info-circle',
        ]"
        aria-hidden="true"
      />
      {{ collisionMessage }}
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

/* Binding-collision visual: warn (sibling-same-node) is loud,
 * info (upstream-shadow) is muted. Border tint outranks the
 * `--mod` accent so users see the collision before the modified-
 * indicator. Inline message below the input mirrors the conflict-
 * scanner copy so semantics stay consistent across modal + canvas. */
.id__input-wrap--collision-warn {
  border-color: var(--wp-status-modified, #f59e0b);
}
.id__input-wrap--collision-info {
  border-color: var(--wp-accent);
}
.id__collision {
  margin-top: 6px;
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: 5px 8px;
  font: 10px/1.4 var(--wp-font-sans);
  border-radius: 3px;
}
.id__collision--warn {
  color: var(--wp-status-modified, #f59e0b);
  background: color-mix(in srgb, var(--wp-status-modified, #f59e0b) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--wp-status-modified, #f59e0b) 35%, transparent);
}
.id__collision--info {
  color: var(--wp-accent);
  background: color-mix(in srgb, var(--wp-accent) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--wp-accent) 35%, transparent);
}
.id__collision .pi { font-size: 11px; margin-top: 1px; flex-shrink: 0; }
</style>
