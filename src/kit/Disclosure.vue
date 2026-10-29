<script setup lang="ts">
/**
 * Disclosure: a "show more" section that folds open under its heading. The
 * heading is a button with `aria-expanded` + `aria-controls` (APG
 * disclosure), the chevron turns when open, and the body grows to its height
 * (no motion with `prefers-reduced-motion`). Works on the canvas and in the
 * manager.
 *
 *   <Disclosure v-model:open="open" label="Advanced">…</Disclosure>
 *   <Disclosure label="Rules" :count="3"><template #summary>…</template>…</Disclosure>
 *
 * Leave out `v-model:open` and it keeps its own state (`default-open` sets
 * where it starts). `#actions` sits at the right end of the heading, outside
 * the button, for controls that should not fold the section; `#lead` sits
 * before the button for the same (a "select all" checkbox lined up with
 * the rows' own). `lazy` builds
 * the body only while it is open.
 */
import { computed, ref, useId, useSlots } from "vue";

const props = withDefaults(defineProps<{
  open?: boolean | undefined;
  /** Where it starts when nobody binds `open`. */
  defaultOpen?: boolean | undefined;
  label?: string | undefined;
  /** A small count after the label. */
  count?: number | string | undefined;
  size?: "sm" | "md" | undefined;
  disabled?: boolean | undefined;
  /** Draw a border and a padded body, for a section that stands alone. */
  boxed?: boolean | undefined;
  /** Build the body only while open (a long list, a costly panel). */
  lazy?: boolean | undefined;
  /** Extra attributes on the heading button, e.g. `data-test`. */
  triggerAttrs?: Record<string, string> | undefined;
}>(), { open: undefined, size: "md", triggerAttrs: undefined });

const emit = defineEmits<{ (e: "update:open", v: boolean): void }>();
const slots = useSlots();

const own = ref(props.defaultOpen);
const isOpen = computed(() => props.open ?? own.value);
const bodyId = `wp-disclosure-${useId()}`;

function toggle(): void {
  if (props.disabled) return;
  const next = !isOpen.value;
  own.value = next;
  emit("update:open", next);
}
</script>

<template>
  <div class="wp-disclosure" :data-size="size" :data-open="isOpen" :data-boxed="boxed || undefined">
    <div class="wp-disclosure__head">
      <div v-if="slots.lead" class="wp-disclosure__lead"><slot name="lead" /></div>
      <button
        v-bind="triggerAttrs ?? {}"
        type="button"
        class="wp-disclosure__trigger"
        :aria-expanded="isOpen"
        :aria-controls="bodyId"
        :disabled="disabled"
        @click="toggle"
      >
        <i class="pi pi-chevron-right wp-disclosure__chev" aria-hidden="true" />
        <slot name="summary">
          <span class="wp-disclosure__label">{{ label }}</span>
        </slot>
        <span v-if="count !== undefined" class="wp-disclosure__count">{{ count }}</span>
      </button>
      <div v-if="slots.actions" class="wp-disclosure__actions"><slot name="actions" /></div>
    </div>
    <div :id="bodyId" class="wp-disclosure__body" :inert="!isOpen || undefined">
      <div class="wp-disclosure__inner">
        <div v-if="isOpen || !lazy" class="wp-disclosure__content"><slot /></div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.wp-disclosure { min-width: 0; }
.wp-disclosure[data-boxed] {
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius-md);
  background: var(--wp-bg-1);
}
.wp-disclosure__head { display: flex; align-items: center; gap: var(--wp-space-3); min-width: 0; }
.wp-disclosure[data-boxed] .wp-disclosure__head { padding: 0 var(--wp-space-3); }
.wp-disclosure__trigger {
  display: inline-flex;
  align-items: center;
  gap: var(--wp-space-3);
  flex: 1;
  min-width: 0;
  min-height: var(--wp-control-h-md);
  margin: 0;
  padding: 0 var(--wp-space-2);
  border: 0;
  border-radius: var(--wp-radius-sm);
  background: transparent;
  color: var(--wp-text);
  font: 600 var(--wp-text-sm)/1.3 var(--wp-font-sans);
  text-align: left;
  cursor: pointer;
}
.wp-disclosure[data-size="sm"] .wp-disclosure__trigger {
  min-height: var(--wp-control-h-sm);
  font-size: var(--wp-text-xs);
  gap: var(--wp-space-2);
}
.wp-disclosure__trigger:hover:not(:disabled) { background: var(--wp-row-hover); }
.wp-disclosure__trigger:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--wp-border-focus); }
.wp-disclosure__trigger:disabled { opacity: 0.45; cursor: not-allowed; }
.wp-disclosure__label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wp-disclosure__chev {
  flex: none;
  font-size: 0.75em;
  color: var(--wp-text-muted);
  transition: transform var(--wp-motion-swap) var(--wp-motion-curve-collapse);
}
.wp-disclosure[data-open="true"] .wp-disclosure__chev { transform: rotate(90deg); }
.wp-disclosure__count {
  padding: 1px 6px;
  border-radius: var(--wp-radius-cap, 999px);
  background: var(--wp-bg-3);
  color: var(--wp-text-muted);
  font-size: var(--wp-text-xs);
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}
.wp-disclosure__lead { display: inline-flex; align-items: center; flex: none; }
.wp-disclosure__actions { display: inline-flex; align-items: center; gap: var(--wp-space-2); flex: none; }
/* Grid rows animate from 0fr to 1fr, so the body grows to its own height
   without measuring it. */
.wp-disclosure__body {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows var(--wp-motion-swap) var(--wp-motion-curve-collapse);
}
.wp-disclosure[data-open="true"] > .wp-disclosure__body { grid-template-rows: 1fr; }
.wp-disclosure__inner { min-height: 0; overflow: hidden; }
.wp-disclosure__content { padding: var(--wp-space-3) 0 var(--wp-space-2) calc(var(--wp-space-2) + 1.1em + var(--wp-space-3)); }
.wp-disclosure[data-size="sm"] .wp-disclosure__content { padding: var(--wp-space-2) 0 var(--wp-space-2) calc(var(--wp-space-2) + 1em); }
.wp-disclosure[data-boxed] .wp-disclosure__content { padding: var(--wp-space-2) var(--wp-space-5) var(--wp-space-5); }
@media (prefers-reduced-motion: reduce) {
  .wp-disclosure__chev, .wp-disclosure__body { transition: none; }
}
</style>
