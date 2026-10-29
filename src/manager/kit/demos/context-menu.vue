<script setup lang="ts">
import { ref } from "vue";
import ContextMenu, { type ContextMenuEntry } from "@/kit/ContextMenu.vue";

const at = ref<{ x: number; y: number } | null>(null);
const items: ContextMenuEntry[] = [
  { label: "Refresh from library", icon: "pi-refresh", onSelect: () => undefined },
  { label: "Hold this pick", icon: "pi-lock", subtitle: "Keeps \"red\" on every run", onSelect: () => undefined },
  { label: "Remove", icon: "pi-trash", danger: true, divider: true, onSelect: () => undefined },
];
function open(ev: MouseEvent): void {
  at.value = { x: ev.clientX, y: ev.clientY };
}
function openAtSelf(ev: KeyboardEvent): void {
  const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
  at.value = { x: r.left + 16, y: r.top + r.height / 2 };
}
</script>

<template>
  <button type="button" class="wp-kit__target" @contextmenu.prevent="open" @keydown.shift.f10.prevent="openAtSelf">
    Right-click here (or Shift+F10)
  </button>
  <ContextMenu :visible="!!at" :x="at?.x ?? 0" :y="at?.y ?? 0" :items="items" @close="at = null" />
</template>
