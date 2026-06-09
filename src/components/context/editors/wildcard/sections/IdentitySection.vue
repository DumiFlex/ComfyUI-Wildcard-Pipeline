<script setup lang="ts">
import { computed } from "vue";
import type { ModuleEntry } from "../../../../../widgets/_shared";
import { patchInstance } from "../../instance/patch";
import { stripNonIdentifierChars } from "../../../../../manager/utils/slug";

const props = withDefaults(
  defineProps<{
    module: ModuleEntry;
    /** Names produced upstream of this Context node. Drives the
     *  binding-collision warning so users see the conflict at edit
     *  time rather than via the canvas badge after save. */
    upstreamVars?: string[];
    /** Names produced by other modules in the SAME Context node. */
    siblingVars?: string[];
  }>(),
  { upstreamVars: () => [], siblingVars: () => [] },
);
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

/** Effective binding the engine will write — override when set, else
 *  library default. Drives the collision check so users see the
 *  conflict whether they typed a name OR left the library default
 *  that happens to match a sibling. */
const effectiveBinding = computed(() => {
  const stripped = bindingValue.value.replace(/^\$+/, "").trim();
  if (stripped) return stripped;
  return libraryBinding.value.replace(/^\$+/, "").trim();
});

/** Surface a collision when this module's effective binding matches a
 *  name produced upstream OR by a sibling in the same Context node.
 *  Last-write-wins at runtime, so the binding still resolves — but
 *  the user is almost certainly looking at a bug. */
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
  const el = ev.target as HTMLInputElement;
  // A binding becomes a `$var`; strip any non-identifier char (comma,
  // space, punctuation) on keystroke so junk can't enter the name. Force
  // the DOM to the sanitized value so the controlled input can't diverge.
  const raw = stripNonIdentifierChars(el.value);
  if (el.value !== raw) el.value = raw;
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
          class="wp-vbind-wrap"
          :class="{
            'wp-vbind-wrap--mod': bindingOverridden,
            'wp-vbind-wrap--collision-warn': collidesWith === 'sibling',
            'wp-vbind-wrap--collision-info': collidesWith === 'upstream',
          }"
        >
          <span class="wp-vbind-prefix" data-test="id-binding-prefix">$</span>
          <input
            class="wp-vbind-input"
            :class="{ 'wp-vbind-input--mod': bindingOverridden }"
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
@import "../../../../shared/var-binding-input.css";

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
/* "Modified" highlight for the display-name field. The binding input
 * migrated to .wp-vbind-* — its --mod rule lives in the shared CSS. */
.id__input--mod {
  border-color: var(--wp-accent);
  color: var(--wp-accent-text, var(--wp-text));
}

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
/* `.id__reset` styling lives in src/components/context/editors/
 * _modal-template-ctrls.css (imported by ContextWidget unscoped).
 * Override the shared 22×22 fixed box here so the button stretches
 * to match the row's tallest sibling. The variable-binding input
 * lives inside `wp-vbind-wrap` (input + `$` prefix in flex), which
 * renders ~26px tall — without this override the reset rendered as
 * a stubby 22px square next to the taller wrap. `min-height` keeps
 * the touch target meeting the design floor when the input shrinks. */
.id__input-row .id__reset {
  height: auto;
  min-height: 22px;
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
