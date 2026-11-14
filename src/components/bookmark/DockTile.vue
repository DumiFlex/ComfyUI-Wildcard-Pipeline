<script setup lang="ts">
/** One bookmark of the dock's grid: its icon large in its colour, the name
 *  under it and the shortcut. A jump target like a list row (DockRow); the
 *  grid is view mode only, so it has no eye. */
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

/** The full name and its marks, since the tile cuts a long name short. */
function tip(): string {
  const e = props.entry;
  return [
    e.title,
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
    <Kbd v-else-if="entry.config.shortcut" :keys="entry.config.shortcut" size="sm" />
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
  gap: 4px;
  min-width: 0;
  box-sizing: border-box;
  padding: 14px 4px 6px;
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
  top: 4px;
  left: 6px;
  color: var(--wp-text-dim);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
}
.wp-bmtile__marks {
  position: absolute;
  top: 4px;
  right: 5px;
  display: flex;
  gap: 3px;
  color: var(--wp-text-dim);
  font-size: 10px;
}
.wp-bmtile__marks .pi { font-size: 10px; }
.wp-bmtile__icon { color: var(--wp-bm-color); font-size: 20px; line-height: 24px; }
/* A Step note's number, in a circle like on the note. */
.wp-bmtile__step {
  display: inline-grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border-radius: var(--wp-radius-cap, 999px);
  background: var(--wp-bm-color);
  color: white;
  font-size: 12px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
/* Two lines, then an ellipsis; the tooltip has the rest. */
.wp-bmtile__name {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  max-width: 100%;
  overflow: hidden;
  overflow-wrap: anywhere;
  font-weight: 600;
  line-height: 1.25;
}
.wp-bmtile__off { color: var(--wp-text-dim); font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.04em; }
</style>
