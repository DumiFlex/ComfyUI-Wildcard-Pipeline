<script setup lang="ts">
/** One bookmark row of the dock. In view mode it is just a jump target; in
 *  edit mode it also carries the show / hide eye. */
import Kbd from "../../kit/Kbd.vue";
import WpIconButton from "../../kit/WpIconButton.vue";
import type { BookmarkEntry } from "../../widgets/bookmark";

defineProps<{
  entry: BookmarkEntry;
  index: number;
  current: boolean;
  editing: boolean;
}>();

const emit = defineEmits<{
  (e: "jump"): void;
  (e: "toggle-hidden"): void;
}>();

function onKey(e: KeyboardEvent): void {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    emit("jump");
  }
}
</script>

<template>
  <div
    class="wp-bmrow"
    :class="{ 'is-off': entry.disabled, 'is-hidden': entry.config.hidden, 'is-current': current }"
    :style="entry.config.color ? { '--wp-bm-color': entry.config.color } : undefined"
    role="button"
    tabindex="0"
    :aria-label="`Jump to ${entry.title}`"
    :data-test="`bm-dock-row-${index}`"
    @click="emit('jump')"
    @keydown="onKey"
  >
    <span class="wp-bmrow__num">{{ index + 1 }}</span>
    <i class="pi wp-bmrow__icon" :class="`pi-${entry.config.icon}`" aria-hidden="true" />
    <span class="wp-bmrow__name">{{ entry.title }}</span>
    <i v-if="entry.nested" class="pi pi-sitemap wp-bmrow__sub" title="In a subgraph" aria-label="In a subgraph" />
    <i
      v-if="entry.config.hidden && !editing"
      class="pi pi-eye-slash wp-bmrow__sub"
      title="Hidden on the canvas"
      aria-label="Hidden on the canvas"
    />
    <span v-if="entry.disabled" class="wp-bmrow__off">off</span>
    <Kbd v-else-if="entry.config.shortcut" :keys="entry.config.shortcut" size="sm" />
    <WpIconButton
      v-if="editing"
      :icon="entry.config.hidden ? 'pi-eye-slash' : 'pi-eye'"
      :label="entry.config.hidden ? 'Show on canvas' : 'Hide on canvas'"
      :pressed="entry.config.hidden"
      :data-test="`bm-dock-eye-${index}`"
      @click.stop="emit('toggle-hidden')"
    />
  </div>
</template>

<style scoped>
.wp-bmrow {
  --wp-bm-color: var(--wp-accent);
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 28px;
  padding: 0 4px 0 8px;
  border-radius: min(4px, var(--wp-radius-cap, 999px));
  cursor: pointer;
  box-shadow: inset 2px 0 0 var(--wp-bm-color);
}
.wp-bmrow:hover { background: var(--wp-bg-3, var(--wp-bg-1)); }
.wp-bmrow:focus-visible { outline: 2px solid var(--wp-accent); outline-offset: -2px; }
.wp-bmrow.is-current { background: color-mix(in srgb, var(--wp-bm-color) 14%, transparent); }
.wp-bmrow.is-off { opacity: 0.55; }
.wp-bmrow.is-hidden .wp-bmrow__name { font-style: italic; color: var(--wp-text-dim); }
.wp-bmrow__num {
  min-width: 14px;
  color: var(--wp-text-dim);
  font-variant-numeric: tabular-nums;
  text-align: right;
}
.wp-bmrow__icon { color: var(--wp-bm-color); font-size: 12px; }
.wp-bmrow__name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-weight: 600;
}
.wp-bmrow__sub { color: var(--wp-text-dim); font-size: 11px; }
.wp-bmrow__off { color: var(--wp-text-dim); font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.04em; }
</style>
