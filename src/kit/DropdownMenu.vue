<script setup lang="ts">
/**
 * A list of actions behind a button: the "⋯" menu, "More", "Add…". The
 * trigger toggles it; arrows, Home/End and Enter work; Escape or a pick
 * closes it and focus goes back to the trigger. Items are ContextMenu
 * entries (sections, icons, dividers, danger, subtitles), so a row's
 * right-click menu and its ⋯ menu can share one list.
 *
 *   <DropdownMenu :items="rowActions" label="Hair colour actions">
 *     <template #trigger="{ props }"><Button v-bind="props" variant="ghost" icon="pi-ellipsis-h" aria-label="More" /></template>
 *   </DropdownMenu>
 */
import { computed, ref } from "vue";
import ContextMenu, { type ContextMenuEntry, type ContextMenuHeader } from "./ContextMenu.vue";
import type { Placement } from "./floating";

const props = withDefaults(defineProps<{
  items: ContextMenuEntry[];
  header?: ContextMenuHeader | undefined;
  placement?: Placement | undefined;
  /** Names the menu for screen readers when the trigger is an icon. */
  label?: string | undefined;
}>(), { placement: "bottom-start" });

const open = ref(false);
const anchorEl = ref<HTMLElement | null>(null);

function trigger(): HTMLElement | null {
  return (anchorEl.value?.firstElementChild as HTMLElement | null) ?? anchorEl.value;
}

function close(): void {
  if (!open.value) return;
  open.value = false;
  trigger()?.focus();
}

const triggerProps = computed(() => ({
  "aria-haspopup": "menu" as const,
  "aria-expanded": open.value,
  "aria-label": props.label,
  onClick: () => { open.value = !open.value; },
  onKeydown: (ev: KeyboardEvent) => {
    if ((ev.key === "ArrowDown" || ev.key === "ArrowUp") && !open.value) {
      ev.preventDefault();
      open.value = true;
    }
  },
}));
</script>

<template>
  <span ref="anchorEl" class="wp-dropdown-anchor">
    <slot name="trigger" :props="triggerProps" :open="open" />
  </span>
  <ContextMenu
    :visible="open"
    :x="0"
    :y="0"
    :anchor="trigger()"
    :placement="placement"
    :items="items"
    :header="header"
    @close="close"
  />
</template>

<style>
@layer wp-extension {
  .wp-dropdown-anchor { display: inline-flex; }
}
</style>
