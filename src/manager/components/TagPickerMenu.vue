<script setup lang="ts">
/**
 * The axis-grouped tag menu, in one place.
 *
 * It began as the per-option sub-category picker. The options filter then
 * needed the same thing — search a long tag list, see it grouped by axis, tick
 * several — and a second implementation would have drifted from the first
 * within a release. Same component, two callers, one behaviour.
 *
 * Teleported to <body> because both hosts sit inside `overflow: auto`
 * scrollers that would otherwise clip it. The host owns the anchor: it knows
 * which element the menu belongs to and when that element has moved.
 */
import { computed, ref, watch } from "vue";

export interface TagGroup {
  axis: string;
  tags: string[];
  isOther?: boolean;
}

interface Props {
  open: boolean;
  /** Viewport coordinates, from the trigger's own rect. */
  anchor: { top: number; left: number };
  /** Flip above the trigger when there is no room below. */
  dropUp?: boolean;
  groups: TagGroup[];
  /** Every tag on offer — drives the search placeholder and its threshold. */
  allTags: string[];
  /** Tags currently ticked. */
  selected: string[];
  /** Per-tag colour, so chips match the pills used elsewhere. */
  tagStyle?: (tag: string) => Record<string, string>;
  /** Namespaces the `data-test` hooks so two menus never collide. */
  testPrefix?: string;
  emptyText?: string;
}

const props = withDefaults(defineProps<Props>(), {
  dropUp: false,
  tagStyle: undefined,
  testPrefix: "tagmenu",
  emptyText: "No sub-categories yet.",
});

const emit = defineEmits<{ (e: "toggle", tag: string): void }>();

const query = ref("");
// Cleared on each open, so the menu never comes back pre-filtered by something
// typed minutes ago.
watch(() => props.open, (isOpen) => { if (isOpen) query.value = ""; });

const selectedSet = computed(() => new Set(props.selected));

/** Groups narrowed by the search. An axis left with nothing is dropped rather
 *  than rendered as an empty heading, which would claim the axis has no tags. */
const visibleGroups = computed<TagGroup[]>(() => {
  const q = query.value.trim().toLowerCase();
  if (!q) return props.groups;
  return props.groups
    .map((g) => ({ ...g, tags: g.tags.filter((t) => t.toLowerCase().includes(q)) }))
    .filter((g) => g.tags.length > 0);
});

function styleFor(tag: string): Record<string, string> | undefined {
  return props.tagStyle ? props.tagStyle(tag) : undefined;
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="opt-tags__picker"
      :class="{ 'opt-tags__picker--up': dropUp }"
      :style="{ top: anchor.top + 'px', left: anchor.left + 'px' }"
      role="menu"
      :data-test="`${testPrefix}-menu`"
      @click.stop
    >
      <p v-if="!allTags.length" class="opt-tags__empty">{{ emptyText }}</p>

      <!-- Pinned above the scroller, so it stays visible while the list it
           filters scrolls under it. -->
      <label v-if="allTags.length > 8" class="opt-tags__search">
        <i class="pi pi-search" aria-hidden="true" />
        <input
          v-model="query"
          type="text"
          :placeholder="`Filter ${allTags.length} tags…`"
          :aria-label="`Filter ${allTags.length} tags`"
          spellcheck="false"
          autocomplete="off"
          :data-test="`${testPrefix}-search`"
          @click.stop
        />
      </label>

      <div class="opt-tags__scroll">
        <div v-for="grp in visibleGroups" :key="grp.axis" class="opt-tags__section">
          <span class="opt-tags__section-name">{{ grp.isOther ? "ungrouped" : grp.axis }}</span>
          <button
            v-for="tag in grp.tags"
            :key="tag"
            type="button"
            class="opt-tags__toggle"
            :class="{ 'is-on': selectedSet.has(tag) }"
            :style="styleFor(tag)"
            role="menuitemcheckbox"
            :aria-checked="selectedSet.has(tag)"
            :data-test="`${testPrefix}-toggle-${tag}`"
            @click.stop="emit('toggle', tag)"
          >
            <span class="opt-tags__toggle-box" aria-hidden="true">
              <svg v-if="selectedSet.has(tag)" width="8" height="8" viewBox="0 0 12 12">
                <path
                  d="M2.5 6.5 L5 9 L9.5 3.5" fill="none" stroke="currentColor"
                  stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
                />
              </svg>
            </span>
            {{ tag }}
          </button>
        </div>
        <p
          v-if="allTags.length && !visibleGroups.length"
          class="opt-tags__empty"
          :data-test="`${testPrefix}-nomatch`"
        >No tag matches this search.</p>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* Teleported to <body>, so coordinates are viewport-relative and no ancestor
   can clip it. z-index sits above the editor chrome but below modals. */
.opt-tags__picker {
  position: fixed;
  z-index: 3000;
  min-width: 210px;
  /* Never taller than the space below the trigger. Without this the menu ran
     past the bottom of the window whenever the list behind it was short — an
     empty filter result leaves almost no page to sit on. */
  max-height: calc(100vh - 24px);
  display: flex;
  flex-direction: column;
  gap: var(--wp-space-3);
  padding: var(--wp-space-3);
  background: var(--wp-bg-1);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius);
  box-shadow: var(--wp-shadow-lg);
}
/* Flipped above the trigger. The host sets `top` to the trigger's TOP edge in
   that case, so shifting up by the menu's own height puts its bottom edge
   exactly there — no height measurement needed. */
.opt-tags__picker--up { transform: translateY(-100%); }

/* Only the LIST scrolls, so the search box stays put.
   `overscroll-behavior: contain` stops the page lurching when either end is
   reached. */
.opt-tags__scroll {
  /* `min-height: 0` lets this shrink inside the capped flex column above;
     without it the list keeps its content height and pushes the menu past the
     viewport instead of scrolling. */
  min-height: 0;
  max-height: 240px;
  overflow-y: auto;
  overscroll-behavior: contain;
  display: flex;
  flex-direction: column;
  gap: var(--wp-space-3);
}
.opt-tags__search {
  display: flex;
  align-items: center;
  gap: var(--wp-space-2);
  padding: 3px var(--wp-space-3); /* audit-exempt: compact inline search */
  background: var(--wp-bg-2);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius-sm);
  color: var(--wp-text-dim);
}
.opt-tags__search .pi { font-size: 10px; }
.opt-tags__search input {
  flex: 1;
  min-width: 0;
  background: none;
  border: none;
  outline: none;
  color: var(--wp-text);
  font: 11px var(--wp-font-sans);
}
.opt-tags__section { display: flex; flex-direction: column; gap: 2px; }
.opt-tags__section-name {
  font: 500 9px var(--wp-font-sans);
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--wp-text-dim);
  padding: 0 var(--wp-space-2);
}
/* Each row is tinted by its axis hue, passed in as `--chip-hue`. This is what
   makes the menu read as the same colour clusters as the pills and chips
   elsewhere; a flat grey list loses the one cue that says which axis a tag
   belongs to. Ported from the picker's original rules — rewriting them from
   scratch is how the colour went missing in the first place. */
.opt-tags__toggle {
  display: flex;
  align-items: center;
  gap: var(--wp-space-3);
  padding: 4px var(--wp-space-4);
  background: none;
  border: none;
  border-radius: var(--wp-radius-sm);
  color: var(--wp-text);
  font: 11px var(--wp-font-mono);
  text-align: left;
  cursor: pointer;
}
.opt-tags__toggle:hover { background: var(--wp-bg-3); }
.opt-tags__toggle-box {
  width: 15px;
  height: 15px;
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1.5px solid color-mix(in srgb, var(--chip-hue) 55%, var(--wp-border-strong));
  border-radius: 4px; /* audit-exempt: below the radius scale */
  color: var(--chip-hue);
}
/* Selected: tint the whole row and fill the box, so the "on" state reads
   regardless of how grey that axis's hue happens to be. */
.opt-tags__toggle.is-on {
  background: color-mix(in srgb, var(--chip-hue) 18%, var(--wp-bg-2));
  color: var(--wp-text);
  font-weight: 600;
}
.opt-tags__toggle.is-on .opt-tags__toggle-box {
  background: var(--chip-hue);
  border-color: var(--chip-hue);
  color: var(--wp-bg-1);
}
.opt-tags__empty {
  margin: 0;
  padding: var(--wp-space-3);
  font: 11px var(--wp-font-sans);
  color: var(--wp-text-dim);
  text-align: center;
}
</style>
