<script setup lang="ts">
/**
 * IconPicker — pick one PrimeIcons glyph, or none.
 *
 * The `icon` column has existed on categories end-to-end (engine column,
 * `wp_api/categories.py` `_UPDATABLE_FIELDS`, `CategoryRow.icon`) with no UI
 * to set it, so every category rendered with the same generic bookmark.
 *
 * The offered glyphs live in `./icon-catalog`, which is verified against the
 * installed `primeicons.css` by a test — an unknown name renders as an empty
 * cell rather than failing, so nothing else would catch a typo.
 *
 * The glyph name is stored WITHOUT the `pi pi-` prefix (e.g. `"user"`), which
 * is what the engine column already holds and what `Icon.vue` expects.
 */
import { computed, ref } from "vue";
import Popover from "./Popover.vue";
import { ICON_GROUPS } from "./icon-catalog";

const props = withDefaults(
  defineProps<{
    /** Current glyph name, unprefixed (`"user"`). Empty / null = none. */
    modelValue: string | null;
    ariaLabel?: string | undefined;
    dataTest?: string | undefined;
    /** Icon only, no name beside it, for a tight table cell. */
    compact?: boolean | undefined;
  }>(),
  { ariaLabel: "Pick an icon", dataTest: undefined, compact: false },
);

const emit = defineEmits<{ "update:modelValue": [v: string | null] }>();

const open = ref(false);
const current = computed<string | null>(() => props.modelValue || null);

/** "arrow-right" → "Arrow right": the closed picker says which icon it holds. */
const currentName = computed(() => {
  const n = current.value;
  if (!n) return "Choose icon";
  const words = n.replace(/-/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
});

function pick(name: string | null): void {
  emit("update:modelValue", name);
  open.value = false;
}
</script>

<template>
  <!-- On the kit Popover: it follows the trigger on scroll, flips to stay on
       screen, and closes on Escape or a click outside with focus back on
       the trigger. -->
  <Popover v-model:open="open" :label="ariaLabel" role="listbox">
    <template #trigger="{ props: triggerProps }">
      <button
        v-bind="triggerProps"
        type="button"
        class="wp-iconpick__trigger"
        :class="{ 'wp-iconpick__trigger--compact': compact }"
        :aria-label="`${ariaLabel}: ${current ? currentName : 'none'}`"
        :data-test="dataTest"
      >
        <!-- Both states share one fixed-size slot: an em-dash and a glyph have
             different intrinsic widths and baselines, so without it the trigger
             resized and the mark shifted the moment an icon was picked. -->
        <span class="wp-iconpick__slot" aria-hidden="true">
          <i v-if="current" :class="`pi pi-${current}`" />
          <span v-else class="wp-iconpick__none">—</span>
        </span>
        <span
          v-if="!compact"
          class="wp-iconpick__name"
          :class="{ 'wp-iconpick__name--empty': !current }"
          aria-hidden="true"
        >{{ currentName }}</span>
        <i class="pi pi-chevron-down wp-iconpick__caret" aria-hidden="true" />
      </button>
    </template>
    <div class="wp-iconpick__panel" :data-test="dataTest ? `${dataTest}-panel` : undefined">
      <button
        type="button"
        class="wp-iconpick__clear"
        data-test="icon-picker-none"
        @click="pick(null)"
      >No icon</button>
      <div v-for="group in ICON_GROUPS" :key="group.label" class="wp-iconpick__group">
        <div class="wp-iconpick__group-label">{{ group.label }}</div>
        <div class="wp-iconpick__grid">
          <button
            v-for="name in group.icons"
            :key="name"
            type="button"
            class="wp-iconpick__cell"
            :class="{ 'wp-iconpick__cell--on': name === current }"
            role="option"
            :aria-selected="name === current"
            :title="name"
            :aria-label="name"
            :data-test="`icon-picker-${name}`"
            @click="pick(name)"
          ><i :class="`pi pi-${name}`" aria-hidden="true" /></button>
        </div>
      </div>
    </div>
  </Popover>
</template>

<style scoped>
.wp-iconpick__trigger {
  display: inline-flex;
  align-items: center;
  gap: var(--wp-space-2);
  height: var(--wp-control-h-md, 32px);
  min-width: 140px;
  max-width: 220px;
  padding: 0 var(--wp-space-4) 0 var(--wp-space-3);
  background: var(--wp-bg-2);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius-sm);
  font: inherit;
  font-size: 12.5px;
  color: var(--wp-text);
  cursor: pointer;
}
.wp-iconpick__trigger:hover { border-color: var(--wp-border-strong); }
.wp-iconpick__trigger:focus-visible { outline: none; border-color: var(--wp-accent-500); box-shadow: var(--wp-focus-ring); }
.wp-iconpick__trigger--compact { min-width: 0; padding: 0 var(--wp-space-3); }
.wp-iconpick__name {
  flex: 1; min-width: 0; text-align: left;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.wp-iconpick__name--empty { color: var(--wp-text-dim); }
/* Fixed square so the glyph is centred in it regardless of the glyph's own
 * advance width, and so swapping "no icon" for an icon doesn't reflow. */
.wp-iconpick__slot {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  font-size: 14px;
  line-height: 1;
}
.wp-iconpick__none { color: var(--wp-text-dim); line-height: 1; }
.wp-iconpick__caret { font-size: 9px; color: var(--wp-text-dim); line-height: 1; }
</style>

<style>
/* Unscoped: the panel is teleported to <body> by Popover, so a scoped selector's
   `[data-v-…]` attribute would never match it. Class names are
   component-specific (`wp-iconpick*`), so global is safe. */
/* Lives inside the kit Popover's panel, which gives the frame and shadow. */
.wp-iconpick__panel {
  width: 212px;
  max-height: 276px;
  overflow-y: auto;
}
.wp-iconpick__clear {
  width: 100%;
  margin-bottom: var(--wp-space-3);
  padding: var(--wp-space-2);
  background: transparent;
  border: 1px dashed var(--wp-border);
  border-radius: var(--wp-radius-sm);
  color: var(--wp-text-muted);
  font-size: var(--wp-text-xs);
  cursor: pointer;
}
.wp-iconpick__clear:hover { color: var(--wp-text); border-color: var(--wp-accent); }
.wp-iconpick__group + .wp-iconpick__group { margin-top: var(--wp-space-3); }
.wp-iconpick__group-label {
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--wp-text-dim);
  margin-bottom: var(--wp-space-2);
}
.wp-iconpick__grid {
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  gap: 2px;
}
.wp-iconpick__cell {
  display: flex;
  align-items: center;
  justify-content: center;
  aspect-ratio: 1;
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--wp-radius-sm);
  color: var(--wp-text-muted);
  cursor: pointer;
  font-size: 13px;
}
/* Kill the icon font's own line box — it otherwise pushes the glyph off the
 * cell's vertical centre even though the cell is a centred flex container. */
.wp-iconpick__cell i { line-height: 1; }
.wp-iconpick__cell:hover {
  background: color-mix(in oklab, var(--wp-accent) 18%, transparent);
  color: var(--wp-text);
}
.wp-iconpick__cell--on {
  border-color: var(--wp-accent);
  color: var(--wp-accent);
}
</style>
