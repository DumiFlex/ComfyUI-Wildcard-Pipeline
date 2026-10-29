<script setup lang="ts">
/**
 * The on/off switch for canvas widgets and the manager (Toggle.vue wraps it).
 *
 *   <WpSwitch v-model="held" label="Hold across run" />                  track
 *   <WpSwitch v-model="held" variant="chip" icon="pi-link" label="Hold across run" />
 *
 * `variant="track"` is a sliding knob; `variant="chip"` is a labelled chip
 * that lights up when on (the editors' Runtime row). `mixed` draws the
 * "some children on" state of a bulk switch; it still reads as off to a
 * screen reader (a switch has no mixed state).
 *
 * The root is a focusable span, not a button, so the switch can sit inside a
 * clickable header row (derivation rules) without nesting buttons. Space and
 * Enter flip it. A disabled switch stays in the tab order (aria-disabled, as
 * the ARIA guide allows) so its tooltip still says why it is off.
 *
 * One component on both sides means one stylesheet: the scoped block below
 * reads only SHARED_TOKENS, so it wears each side's colours. (Scoped and unlayered on purpose: the manager's Tailwind preflight
 * is unlayered and would beat a layered border.)
 */
const props = withDefaults(
  defineProps<{
    modelValue?: boolean | undefined;
    variant?: "track" | "chip" | undefined;
    size?: "sm" | "md" | "lg" | undefined;
    label?: string | undefined;
    /** PrimeIcons class (e.g. `pi-lock`), drawn before the label. */
    icon?: string | undefined;
    mixed?: boolean | undefined;
    disabled?: boolean | undefined;
    invalid?: boolean | undefined;
  }>(),
  { modelValue: false, variant: "track", size: "sm", label: undefined, icon: undefined },
);

const emit = defineEmits<{ "update:modelValue": [next: boolean] }>();

function flip(): void {
  if (props.disabled) return;
  emit("update:modelValue", !props.modelValue);
}
</script>

<template>
  <span
    class="wp-switch"
    :class="[`wp-switch--${size}`, { 'wp-switch--chip': variant === 'chip', 'wp-switch--mixed': mixed && !modelValue }]"
    role="switch"
    :aria-checked="modelValue === true"
    :aria-disabled="disabled || undefined"
    :aria-invalid="invalid || undefined"
    tabindex="0"
    @click="flip"
    @keydown.space.stop.prevent="flip"
    @keydown.enter.prevent.stop="flip"
  >
    <span v-if="variant === 'track'" class="wp-switch__track" aria-hidden="true"><span class="wp-switch__knob" /></span>
    <i v-else-if="icon" class="pi wp-switch__icon" :class="icon" aria-hidden="true" />
    <slot><span v-if="label" class="wp-switch__label">{{ label }}</span></slot>
  </span>
</template>

<style scoped>
/* Two looks. track: a sliding knob, for a setting that takes effect at once.
 * chip: a labelled chip that lights up when on (Hide from prompt, Lock...).
 * Heights follow the control scale (sm 24 / md 32 / lg 40). */
.wp-switch {
  display: inline-flex;
  align-items: center;
  gap: var(--wp-space-3);
  min-height: 20px;
  flex-shrink: 0;
  color: var(--wp-text-muted);
  font: var(--wp-text-xs) / 1 var(--wp-font-sans);
  cursor: pointer;
  user-select: none;
  outline: none;
  -webkit-tap-highlight-color: transparent;
}
.wp-switch[aria-disabled="true"] { opacity: 0.45; cursor: not-allowed; }
.wp-switch__label { color: var(--wp-text-muted); }
.wp-switch--md, .wp-switch--lg { min-height: 24px; font-size: var(--wp-text-sm); }

/* Track look */
.wp-switch__track {
  --switch-w: 26px;
  --switch-h: 14px;
  position: relative;
  flex-shrink: 0;
  width: var(--switch-w);
  height: var(--switch-h);
  box-sizing: border-box;
  border: 1px solid var(--wp-border-strong);
  border-radius: var(--wp-radius-cap, 999px);
  background: var(--wp-bg-3);
  transition: background var(--wp-motion-quick), border-color var(--wp-motion-quick);
}
.wp-switch--md .wp-switch__track { --switch-w: 32px; --switch-h: 18px; }
.wp-switch--lg .wp-switch__track { --switch-w: 40px; --switch-h: 22px; }
.wp-switch__knob {
  position: absolute;
  top: 1px;
  left: 1px;
  width: calc(var(--switch-h) - 4px);
  height: calc(var(--switch-h) - 4px);
  border-radius: min(50%, var(--wp-radius-cap, 999px));
  background: var(--wp-text-dim);
  transition: transform var(--wp-motion-quick), background var(--wp-motion-quick);
}
.wp-switch:not([aria-disabled="true"]):hover .wp-switch__track { border-color: var(--wp-text-dim); }
.wp-switch[aria-checked="true"] .wp-switch__track { background: var(--wp-accent); border-color: var(--wp-accent); }
.wp-switch[aria-checked="true"] .wp-switch__knob {
  background: white; /* the knob on the accent track, both themes */
  transform: translateX(calc(var(--switch-w) - var(--switch-h)));
}
.wp-switch--mixed .wp-switch__track { border-style: dashed; border-color: var(--wp-accent); }
.wp-switch--mixed .wp-switch__knob {
  background: var(--wp-accent);
  transform: translateX(calc((var(--switch-w) - var(--switch-h)) / 2));
}
.wp-switch:focus-visible .wp-switch__track,
.wp-switch--chip:focus-visible { box-shadow: var(--wp-focus-ring); }
.wp-switch[aria-invalid="true"] .wp-switch__track,
.wp-switch--chip[aria-invalid="true"] { border-color: var(--wp-error-border); }

/* Chip look */
.wp-switch--chip {
  height: var(--wp-control-h-sm);
  min-height: 0;
  gap: var(--wp-space-3);
  padding: 0 var(--wp-space-4);
  box-sizing: border-box;
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius-sm);
  background: var(--wp-bg);
  transition: border-color var(--wp-motion-quick), background var(--wp-motion-quick);
}
.wp-switch--chip.wp-switch--md { height: var(--wp-control-h-md); padding: 0 var(--wp-space-5); }
.wp-switch--chip.wp-switch--lg { height: var(--wp-control-h-lg); padding: 0 var(--wp-space-6); }
.wp-switch--chip .wp-switch__icon { font-size: var(--wp-text-xs); color: var(--wp-text-dim); }
.wp-switch--chip:not([aria-disabled="true"]):hover { border-color: var(--wp-border-strong); }
.wp-switch--chip[aria-checked="true"] {
  border-color: var(--wp-accent);
  color: var(--wp-accent-text);
  background: color-mix(in srgb, var(--wp-accent) 10%, transparent);
}
.wp-switch--chip[aria-checked="true"] .wp-switch__label,
.wp-switch--chip[aria-checked="true"] .wp-switch__icon { color: var(--wp-accent-text); }
.wp-switch--chip.wp-switch--mixed {
  border-style: dashed;
  border-color: var(--wp-accent);
  background: color-mix(in srgb, var(--wp-accent) 6%, transparent);
}
/* accent-text, not the raw accent: the raw ramp sits near 3:1 on light
   Tide / Ember pages. */
.wp-switch--chip.wp-switch--mixed .wp-switch__label,
.wp-switch--chip.wp-switch--mixed .wp-switch__icon { color: var(--wp-accent-text); }

@media (prefers-reduced-motion: reduce) {
  .wp-switch__track, .wp-switch__knob, .wp-switch--chip { transition: none; }
}
</style>
