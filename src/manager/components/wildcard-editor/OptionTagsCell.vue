<script setup lang="ts">
/**
 * One option row's tag cell (§4.3, H2): the capped chip run, its `+N`
 * disclosure and the grouped picker. Membership only — the editor owns the
 * option and applies every toggle.
 */
import TagPickerMenu, { type TagGroup } from "../TagPickerMenu.vue";
import type { VisibleTags } from "../../utils/option-list-ops";

defineProps<{
  optionId: string;
  /** The option's assigned tags. */
  tags: string[];
  /** Which tags show and what folds behind `+N`. */
  view: VisibleTags;
  expanded: boolean;
  pickerOpen: boolean;
  anchor: { top: number; left: number; width: number };
  dropUp: boolean;
  groups: TagGroup[];
  allTags: string[];
  tagStyle: (tag: string) => Record<string, string>;
}>();

const emit = defineEmits<{
  "toggle-tag": [tag: string];
  "toggle-expanded": [];
  "toggle-picker": [ev: MouseEvent];
}>();
</script>

<template>
  <div class="opt-tags" @click.stop>
    <!-- Capped chip run, mirroring the canvas OptionRow: a fully
         tagged option carries 8+ tags and showing them all made a
         single row taller than the rest of the table. `+N` expands
         that row on demand. -->
    <div class="opt-tags__control">
      <span
        v-for="tag in view.visible"
        :key="tag"
        class="opt-tags__chip"
        :style="tagStyle(tag)"
      >
        {{ tag }}
        <button
          type="button"
          class="opt-tags__chip-x"
          :aria-label="`Remove ${tag} from option`"
          @click.stop="emit('toggle-tag', tag)"
        >×</button>
      </span>
      <button
        v-if="view.hiddenCount > 0 || expanded"
        type="button"
        class="opt-tags__more"
        :aria-expanded="expanded"
        :aria-label="expanded
          ? 'Show fewer tags'
          : `Show ${view.hiddenCount} more tags`"
        :data-test="`opt-tags-more-${optionId}`"
        @click.stop="emit('toggle-expanded')"
        :data-match="!expanded && view.hiddenHasMatch ? '' : null"
        :title="view.hiddenHasMatch ? 'More matching tags are folded in here' : undefined"
      >{{ expanded ? "−" : `+${view.hiddenCount}` }}</button>
      <span v-if="!tags.length" class="opt-tags__placeholder">(none)</span>
      <button
        type="button"
        class="opt-tags__chevron"
        :class="{ 'opt-tags__chevron--open': pickerOpen }"
        :aria-label="`Edit sub-categories for option`"
        :aria-expanded="pickerOpen"
        :data-test="`opt-tags-${optionId}`"
        @click.stop="emit('toggle-picker', $event)"
      ><i class="pi pi-chevron-down" aria-hidden="true" /></button>
    </div>

    <!-- Grouped checkbox picker: one section per axis +
         ungrouped. Each toggle gets is-on when selected. -->
    <TagPickerMenu
      :open="pickerOpen"
      :anchor="anchor"
      :drop-up="dropUp"
      :groups="groups"
      :all-tags="allTags"
      :selected="tags"
      :tag-style="tagStyle"
      :test-prefix="`opt-tag-${optionId}`"
      empty-text="No sub-categories yet — add some above."
      @toggle="(t: string) => emit('toggle-tag', t)"
    />
  </div>
</template>

<style scoped>
/* `+N` / `−` disclosure inside an option's tag cell. Dashed so it reads as
   part of the chip run rather than as another removable tag. */
.opt-tags__more {
  display: inline-flex;
  align-items: center;
  padding: 2px 7px;
  border: 1px dashed color-mix(in srgb, var(--wp-text-dim) 55%, transparent);
  border-radius: var(--wp-radius-cap, 999px);
  background: transparent;
  color: var(--wp-text-dim);
  font-size: var(--wp-text-xs);
  line-height: 1.4;
  cursor: pointer;
}
.opt-tags__more:hover { color: var(--wp-text); border-color: var(--wp-accent); }

/* ── Per-option grouped multi-select (H2) ────────────────────────── */
.opt-tags {
  position: relative;
}
.opt-tags__control {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
}
.opt-tags__chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 4px 2px 8px;
  border: 1px solid color-mix(in srgb, var(--chip-hue) 45%, var(--wp-border));
  border-radius: var(--wp-radius-cap, 999px);
  background: color-mix(in srgb, var(--chip-hue) 12%, var(--wp-bg-1));
  color: var(--wp-text);
  font-size: var(--wp-text-xs);
  line-height: 1.4;
}
.opt-tags__chip-x {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 15px;
  height: 15px;
  border: none;
  background: transparent;
  cursor: pointer;
  color: var(--wp-text-dim);
  border-radius: var(--wp-radius-cap, 999px);
  font-size: 12px;
  line-height: 1;
}
.opt-tags__chip-x:hover {
  color: var(--wp-text);
  background: var(--wp-bg-3);
}
.opt-tags__placeholder {
  color: var(--wp-text-dim);
  font-size: var(--wp-text-xs);
  font-style: italic;
}
.opt-tags__chevron {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius-sm);
  background: var(--wp-bg-1);
  cursor: pointer;
  color: var(--wp-text-dim);
  font-size: 11px;
}
.opt-tags__chevron:hover {
  color: var(--wp-text);
  border-color: var(--wp-border-strong);
}
.opt-tags__chevron--open {
  color: var(--wp-accent-text);
  border-color: var(--wp-accent-500);
}

/* The pill admits that a matching tag is folded inside it, so a row never
   looks like it matched for no reason. */
.opt-tags__more[data-match] {
  background: color-mix(in oklab, var(--wp-accent-500) 26%, transparent);
  border-color: var(--wp-accent-500);
  color: var(--wp-accent-300);
}
</style>
