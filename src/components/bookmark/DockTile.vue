<script setup lang="ts">
/** One bookmark of the dock's grid: its icon large in its colour, the name
 *  under it and the shortcut. A jump target like a list row (DockRow); the
 *  grid is view mode only, so it has no eye. */
import { computed } from "vue";
import Kbd from "@/kit/Kbd.vue";
import type { BookmarkEntry } from "../../widgets/bookmark";

const props = defineProps<{
  entry: BookmarkEntry;
  index: number;
  current: boolean;
}>();

const emit = defineEmits<{ (e: "jump"): void }>();

function onKey(e: KeyboardEvent): void {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    emit("jump");
  }
}

/** Shift as ⇧ (everyone knows the arrow), so Ctrl + Shift + 1 fits a tile. */
const keys = computed(() => props.entry.config.shortcut.split(/\+(?!$)/).map((k) => (k === "Shift" ? "⇧" : k)));

/** The full name and its marks, since the tile cuts a long name short. */
function tip(): string {
  const e = props.entry;
  return [
    e.title,
    e.config.shortcut ? e.config.shortcut.replace(/\+/g, " + ") : "",
    e.nested ? "in a subgraph" : "",
    e.config.hidden ? "hidden on the canvas" : "",
    e.disabled ? "muted or bypassed" : "",
  ].filter(Boolean).join(" · ");
}
</script>

<template>
  <div
    class="wp-bmtile"
    :class="{ 'is-off': entry.disabled, 'is-hidden': entry.config.hidden, 'is-current': current }"
    :style="entry.config.color ? { '--wp-bm-color': entry.config.color } : undefined"
    role="button"
    tabindex="0"
    :title="tip()"
    :aria-label="`Jump to ${entry.title}`"
    :data-test="`bm-dock-tile-${index}`"
    @click="emit('jump')"
    @keydown="onKey"
  >
    <span class="wp-bmtile__num">{{ index + 1 }}</span>
    <span class="wp-bmtile__marks">
      <i v-if="entry.nested" class="pi pi-sitemap" aria-label="In a subgraph" />
      <i v-if="entry.config.hidden" class="pi pi-eye-slash" aria-label="Hidden on the canvas" />
    </span>
    <span v-if="entry.config.step" class="wp-bmtile__step" aria-hidden="true">{{ entry.config.step }}</span>
    <i v-else class="pi wp-bmtile__icon" :class="`pi-${entry.config.icon}`" aria-hidden="true" />
    <span class="wp-bmtile__name">{{ entry.title }}</span>
    <span v-if="entry.disabled" class="wp-bmtile__off">off</span>
    <Kbd v-else-if="entry.config.shortcut" class="wp-bmtile__keys" :keys="keys" size="sm" />
  </div>
</template>

<style scoped>
.wp-bmtile {
  --wp-bm-color: var(--wp-accent);
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  gap: 3px;
  min-width: 0;
  box-sizing: border-box;
  padding: 11px 3px 4px;
  border-radius: min(6px, var(--wp-radius-cap, 999px));
  background: color-mix(in srgb, var(--wp-bg-1) 60%, transparent);
  box-shadow: inset 0 2px 0 var(--wp-bm-color);
  cursor: pointer;
  text-align: center;
}
.wp-bmtile:hover { background: var(--wp-bg-3, var(--wp-bg-1)); }
.wp-bmtile:focus-visible { outline: 2px solid var(--wp-accent); outline-offset: -2px; }
.wp-bmtile.is-current { background: color-mix(in srgb, var(--wp-bm-color) 16%, transparent); }
.wp-bmtile.is-off { opacity: 0.55; }
.wp-bmtile.is-hidden .wp-bmtile__name { font-style: italic; color: var(--wp-text-dim); }
.wp-bmtile__num {
  position: absolute;
  top: 2px;
  left: 4px;
  color: var(--wp-text-dim);
  font-size: 9px;
  font-variant-numeric: tabular-nums;
}
.wp-bmtile__marks {
  position: absolute;
  top: 2px;
  right: 4px;
  display: flex;
  gap: 3px;
  color: var(--wp-text-dim);
  font-size: 10px;
}
.wp-bmtile__marks .pi { font-size: 9px; }
.wp-bmtile__icon { color: var(--wp-bm-color); font-size: 15px; line-height: 18px; }
/* A Step note's number, in a circle like on the note. */
.wp-bmtile__step {
  display: inline-grid;
  place-items: center;
  width: 18px;
  height: 18px;
  border-radius: var(--wp-radius-cap, 999px);
  background: var(--wp-bm-color);
  color: white;
  font-size: 10px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.wp-bmtile__name {
  max-width: 100%;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: 11.5px;
  font-weight: 600;
  line-height: 1.2;
}
/* Tighter caps with no plus signs, so Ctrl ⇧ 1 fits the tile; the tooltip
   spells the shortcut out. */
.wp-bmtile__keys { max-width: 100%; gap: 1px; }
.wp-bmtile__keys :deep(.wp-kbd-keys__plus) { display: none; }
.wp-bmtile__keys :deep(.wp-kbd-keys__cap) { min-width: 14px; height: 14px; padding: 0 2px; font-size: 9px; }
.wp-bmtile__off { color: var(--wp-text-dim); font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.04em; }
</style>
