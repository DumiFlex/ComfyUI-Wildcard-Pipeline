<script setup lang="ts">
/**
 * Shared checkbox box — the wildcard pool's per-option look (`.opt__check`
 * in OptionRow.vue), extracted so every checkmark box in the *embed/canvas*
 * tree reads the same.
 *
 * Why a component (not the global `.wp-check` class): the canvas bundle only
 * loads a hand-picked CSS set via `src/extension/settings.ts` — it does NOT
 * load the SPA's `manager/styles/tokens.css`, where global `.wp-check` lives.
 * A component's `<style scoped>` is compiled into the component's own chunk,
 * so it ships wherever the component renders — SPA *and* canvas. That's the
 * same reason `.opt__check` / `.row__check` / `.ex__check` are each scoped.
 *
 * Custom toggle BUTTONS (internal flag, seed-lock) stay as their own styled
 * buttons — this is only for true checkmark boxes.
 *
 * `aria-label` / `data-test` fall through to the single root span. Click /
 * Space / Enter toggle. `size="sm"` is the 12px box of the canvas rows' on/off
 * mark (modules, bundles, injector rows). A parent can tint the checked fill
 * with `--check-on` (a bundle header uses its bundle colour).
 */
const props = withDefaults(
  defineProps<{
    /** Checked state — use with `v-model` or `:model-value` + `@update:model-value`. */
    modelValue?: boolean | undefined;
    disabled?: boolean | undefined;
    size?: "sm" | "md" | undefined;
  }>(),
  { modelValue: false, disabled: false, size: "md" },
);

const emit = defineEmits<{ "update:modelValue": [next: boolean] }>();

function toggle(): void {
  if (props.disabled) return;
  emit("update:modelValue", !props.modelValue);
}
</script>

<template>
  <span
    class="wp-check"
    :class="{ 'wp-check--sm': size === 'sm' }"
    role="checkbox"
    :aria-checked="modelValue === true"
    :aria-disabled="disabled || undefined"
    :tabindex="disabled ? -1 : 0"
    @click="toggle"
    @keydown.space.prevent="toggle"
    @keydown.enter.prevent="toggle"
  >
    <!-- 8×8 SVG tick inside the 14px box — identical to OptionRow's
         `.opt__check` so the canvas boxes match the wildcard options. -->
    <svg
      v-if="modelValue"
      width="8"
      height="8"
      viewBox="0 0 12 12"
      aria-hidden="true"
    >
      <path
        d="M2.5 6.5 L5 9 L9.5 3.5"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  </span>
</template>

<style scoped>
/* Verbatim from OptionRow.vue `.opt__check`. Scoped so it ships into the
 * canvas bundle (no global tokens.css there). Vars resolve from the SPA's
 * tokens.css or the canvas theme.css — both define these. */
.wp-check {
  width: 14px;
  height: 14px;
  border: 1.5px solid var(--wp-border-soft, var(--wp-border));
  border-radius: min(3px, var(--wp-radius-cap, 999px));
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: white;
  background: var(--wp-bg);
  flex-shrink: 0;
  cursor: pointer;
}
.wp-check svg { display: block; }
.wp-check--sm { width: 12px; height: 12px; border-width: 1px; border-radius: min(2px, var(--wp-radius-cap, 999px)); }
.wp-check--sm svg { width: 7px; height: 7px; }
.wp-check:focus-visible { outline: none; box-shadow: var(--wp-focus-ring); }
.wp-check[aria-checked="true"] {
  background: var(--check-on, var(--wp-accent));
  border-color: var(--check-on, var(--wp-accent));
}
.wp-check[aria-disabled="true"] {
  cursor: not-allowed;
  opacity: 0.45;
}
</style>
