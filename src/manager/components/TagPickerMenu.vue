<script setup lang="ts">
/**
 * The axis-grouped tag menu, in one place.
 *
 * It began as the per-option sub-category picker. The options filter then
 * needed the same thing — search a long tag list, see it grouped by axis, tick
 * several — and a second implementation would have drifted from the first
 * within a release. Same component, two callers, one behaviour.
 *
 * The panel is the kit Popover's menu: it hangs off the trigger the host
 * passes in the `trigger` slot, flips above it when there is no room below,
 * follows it while the page scrolls, closes once it scrolls out of view, on
 * Escape (focus goes back to the trigger) and on a click outside.
 */
import SearchInput from "@/kit/SearchInput.vue";
import { computed, ref, watch } from "vue";
import Icon from "@/kit/Icon.vue";
import ListRow from "@/kit/ListRow.vue";
import Popover from "@/kit/Popover.vue";

export interface TagGroup {
  axis: string;
  tags: string[];
  isOther?: boolean;
}

interface Props {
  open: boolean;
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
  tagStyle: undefined,
  testPrefix: "tagmenu",
  emptyText: "No sub-categories yet.",
});

const emit = defineEmits<{
  (e: "toggle", tag: string): void;
  (e: "update:open", open: boolean): void;
}>();

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

/** Comfortable height for a tag list: roughly a dozen rows plus the search.
 *  Popover also caps it at the room on the trigger's side. */
const PREFERRED_MAX = 340;
</script>

<template>
  <Popover
    :open="open"
    variant="menu"
    role="menu"
    :max-height="PREFERRED_MAX"
    :label="`Sub-categories (${allTags.length})`"
    @update:open="(v: boolean) => emit('update:open', v)"
  >
    <template #trigger="{ props: triggerProps }">
      <slot name="trigger" :props="triggerProps" />
    </template>
    <div class="opt-tags__picker" :data-test="`${testPrefix}-menu`">
      <p v-if="!allTags.length" class="opt-tags__empty">{{ emptyText }}</p>

      <!-- Sticks to the top of the panel, so it stays visible while the list
           it filters scrolls under it. -->
      <div v-if="allTags.length > 8" class="opt-tags__searchbar">
        <SearchInput
          v-model="query"
          size="sm"
          :placeholder="`Filter ${allTags.length} tags…`"
          :aria-label="`Filter ${allTags.length} tags`"
          clear-label="Clear filter"
          :data-test="`${testPrefix}-search`"
        />
      </div>

      <div class="opt-tags__list" data-wp-rows>
        <div v-for="grp in visibleGroups" :key="grp.axis" class="opt-tags__section">
          <span class="opt-tags__section-name">{{ grp.isOther ? "ungrouped" : grp.axis }}</span>
          <ListRow
            v-for="tag in grp.tags"
            :key="tag"
            size="sm"
            class="opt-tags__toggle"
            :class="{ 'is-on': selectedSet.has(tag) }"
            :style="styleFor(tag)"
            role="menuitemcheckbox"
            :aria-checked="selectedSet.has(tag)"
            :data-test="`${testPrefix}-toggle-${tag}`"
            @click="emit('toggle', tag)"
          >
            <template #start>
              <span class="opt-tags__toggle-box" aria-hidden="true">
                <Icon v-if="selectedSet.has(tag)" name="check" :size="8" />
              </span>
            </template>
            {{ tag }}
          </ListRow>
        </div>
        <p
          v-if="allTags.length && !visibleGroups.length"
          class="opt-tags__empty"
          :data-test="`${testPrefix}-nomatch`"
        >No tag matches this search.</p>
      </div>
    </div>
  </Popover>
</template>

<style scoped>
/* The panel (placement, flip, cap, layer, look) is the kit Popover's menu. */
.opt-tags__picker {
  min-width: 210px;
  display: flex;
  flex-direction: column;
  gap: var(--wp-space-3);
}
/* The panel scrolls as a whole; the search sticks to its top edge, on the
   panel's colour so rows pass under it. */
.opt-tags__searchbar {
  position: sticky;
  top: -4px; /* the menu's own padding, so nothing peeks above it */
  z-index: 1;
  margin: -4px -4px 0;
  padding: 4px;
  background: var(--wp-bg-2);
}
.opt-tags__list {
  display: flex;
  flex-direction: column;
  gap: var(--wp-space-3);
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
/* A kit ListRow per tag, in the menu's mono type, with its hue box in front. */
.opt-tags__toggle { color: var(--wp-text); font: 11px var(--wp-font-mono); }
.opt-tags__toggle-box {
  width: 15px;
  height: 15px;
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1.5px solid color-mix(in srgb, var(--chip-hue) 55%, var(--wp-border-strong));
  border-radius: min(4px, var(--wp-radius-cap, 999px)); /* audit-exempt: below the radius scale */
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
