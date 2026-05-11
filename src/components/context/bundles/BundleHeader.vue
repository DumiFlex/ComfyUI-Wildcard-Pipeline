<script setup lang="ts">
import { computed } from "vue";
import type { BundleInstance } from "../../../widgets/_shared";

const props = withDefaults(
  defineProps<{
    /** Per-Context bundle instance — drives _uid, color fallback,
     *  enabled state, collapsed state. */
    instance: BundleInstance;
    /** Display name from the bundle library entry. Falls back to
     *  short-uuid when the library entry is missing. */
    name: string;
    /** User-picked bundle color (hex). Empty/null → default token. */
    color?: string | null;
    /** Child module count for the "5 mods" summary text. */
    childCount: number;
    /** Optional "N drifted" suffix appended after the count. Computed
     *  by the caller from per-child drift state — bundle-level UX
     *  doesn't introspect children itself. */
    driftedCount?: number;
  }>(),
  { color: null, driftedCount: 0 },
);

const emit = defineEmits<{
  (e: "toggle-collapse"): void;
  (e: "toggle-enabled", next: boolean): void;
  (e: "remove"): void;
  (e: "contextmenu", ev: MouseEvent): void;
}>();

const frameColor = computed(() =>
  props.color && props.color.length ? props.color : "var(--wp-bundle-default)",
);

const summary = computed(() => {
  const word = props.childCount === 1 ? "mod" : "mods";
  const base = `${props.childCount} ${word}`;
  if (props.driftedCount > 0) return `${base} · ${props.driftedCount} drifted`;
  return base;
});
</script>

<template>
  <div
    class="wp-bundle-header"
    :class="{ 'wp-bundle-header--collapsed': instance.collapsed }"
    :style="{ '--b': frameColor }"
    :data-bundle-uid="instance._uid"
    data-bundle-header
    @contextmenu.stop.prevent="(ev) => emit('contextmenu', ev)"
  >
    <!-- Drag handle — exact same 6×12 SVG dot grid markup the
         standalone module rows use (`.wp-drag-handle`), so the
         visual + size matches across the action surface. -->
    <span class="wp-bundle-handle" aria-hidden="true" title="Drag to reorder bundle">
      <svg
        class="wp-bundle-handle__grip"
        viewBox="0 0 6 12"
        width="6"
        height="12"
        fill="currentColor"
        aria-hidden="true"
        focusable="false"
      >
        <circle cx="1.5" cy="2" r="1" />
        <circle cx="4.5" cy="2" r="1" />
        <circle cx="1.5" cy="6" r="1" />
        <circle cx="4.5" cy="6" r="1" />
        <circle cx="1.5" cy="10" r="1" />
        <circle cx="4.5" cy="10" r="1" />
      </svg>
    </span>
    <button
      type="button"
      class="wp-bundle-collapse"
      :aria-label="instance.collapsed ? 'Expand bundle' : 'Collapse bundle'"
      :title="instance.collapsed ? 'Expand' : 'Collapse'"
      @click.stop="emit('toggle-collapse')"
    >
      <i
        :class="['pi', instance.collapsed ? 'pi-caret-right' : 'pi-caret-down']"
        aria-hidden="true"
      ></i>
    </button>
    <label class="wp-bundle-enabled" :title="instance.enabled ? 'Disable bundle (cascades to children)' : 'Enable bundle'">
      <input
        type="checkbox"
        :checked="instance.enabled"
        :aria-label="`enable bundle ${name}`"
        @change="(ev) => emit('toggle-enabled', (ev.target as HTMLInputElement).checked)"
      />
      <span class="wp-bundle-enabled-mark"></span>
    </label>
    <span class="wp-bundle-icon" aria-hidden="true">
      <i class="pi pi-box"></i>
    </span>
    <span class="wp-bundle-chip">bundle</span>
    <span class="wp-bundle-name">{{ name }}</span>
    <span class="wp-bundle-summary">{{ summary }}</span>
    <button
      type="button"
      class="wp-bundle-action wp-bundle-action--danger"
      title="Remove bundle (right-click for more)"
      :aria-label="`remove bundle ${name}`"
      @click.stop="emit('remove')"
    ><i class="pi pi-trash" aria-hidden="true" /></button>
  </div>
</template>

<style scoped>
@import "../../shared/theme.css";

.wp-bundle-header {
  /* The bundle frame box is painted by `.wp-bundle-overlay` in
   * ContextWidget. Header carries only its own bottom divider
   * separating it from the children below — no full border, no
   * radius, no frame walls. When the bundle is collapsed, the
   * bottom divider hides (no children below to separate from). */
  background: color-mix(in srgb, var(--b) 18%, transparent);
  border-bottom: 1px solid var(--b);
  padding: 6px 8px;
  display: flex;
  align-items: center;
  gap: 6px;
  font: 500 11px/1.4 var(--wp-font-sans);
  color: var(--wp-text);
  cursor: default;
}
.wp-bundle-header--collapsed {
  border-bottom-color: transparent;
}
/* Drag handle — mirror `.wp-drag-handle` from ContextWidget exactly.
 * 6px-wide inline-flex container holding the 6×12 SVG grip; opacity
 * fades on hover, color follows --wp-text2 on hover. */
.wp-bundle-handle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--wp-text3);
  width: 6px;
  flex-shrink: 0;
  cursor: grab;
  opacity: 0.45;
  transition: opacity 0.15s, color 0.15s;
}
.wp-bundle-handle:active { cursor: grabbing; }
.wp-bundle-handle__grip { display: block; }
.wp-bundle-header:hover .wp-bundle-handle {
  opacity: 1;
  color: var(--wp-text2);
}

/* Collapse caret — mirror `.wp-collapse-btn` from ContextWidget
 * exactly. 14px-wide button, 10px caret glyph. */
.wp-bundle-collapse {
  background: none;
  border: none;
  color: var(--wp-text3);
  cursor: pointer;
  padding: 0;
  line-height: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  flex-shrink: 0;
}
.wp-bundle-collapse .pi { font-size: 10px; }
.wp-bundle-collapse:hover { color: var(--wp-text); }
.wp-bundle-enabled { display: inline-flex; align-items: center; cursor: pointer; flex-shrink: 0; }
.wp-bundle-enabled input {
  position: absolute;
  opacity: 0;
  width: 0;
  height: 0;
  pointer-events: none;
}
.wp-bundle-enabled-mark {
  display: block;
  width: 12px;
  height: 12px;
  border-radius: 2px;
  border: 1px solid var(--wp-border2, var(--wp-border));
  background: var(--wp-bg2);
  transition: background-color 0.15s, border-color 0.15s;
}
.wp-bundle-enabled input:checked + .wp-bundle-enabled-mark {
  background: var(--b);
  border-color: var(--b);
}
.wp-bundle-icon {
  width: 16px;
  height: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: var(--b);
}
.wp-bundle-icon .pi { font-size: 12px; }
.wp-bundle-chip {
  font: 600 9px/1 var(--wp-font-sans);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 3px 5px;
  border-radius: 3px;
  background: color-mix(in srgb, var(--b) 28%, transparent);
  color: var(--b);
  flex-shrink: 0;
}
.wp-bundle-name {
  flex: 1;
  font: 600 12px/1 var(--wp-font-sans);
  color: var(--wp-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wp-bundle-summary {
  font: 500 10px/1 var(--wp-font-sans);
  color: var(--wp-text-dim, var(--wp-text3));
  flex-shrink: 0;
}
/* Same size + shape as `.wp-btn--icon-sm` from ContextWidget so the
 * action reads as part of the same family. Difference: the BG +
 * BORDER are tinted with the bundle color (instead of transparent)
 * so the button visually anchors to its bundle, and the icon is
 * white (instead of dim). Hover bumps the tint stronger. */
.wp-bundle-action {
  background: color-mix(in srgb, var(--b) 18%, transparent);
  border: 1px solid var(--b);
  color: var(--wp-text);
  font: 500 11px/1 var(--wp-font-sans);
  padding: 3px;
  border-radius: var(--wp-radius, 4px);
  cursor: pointer;
  width: 20px;
  height: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: background 0.12s, border-color 0.12s, color 0.12s;
}
.wp-bundle-action:hover {
  background: color-mix(in srgb, var(--b) 32%, transparent);
}
.wp-bundle-action .pi {
  font-size: 11px;
}
.wp-bundle-action--danger:hover {
  /* Trash button hover — shift toward danger red so the destructive
   * intent is clear even though the default tint is bundle color. */
  background: color-mix(in srgb, var(--wp-danger) 22%, transparent);
  border-color: var(--wp-danger);
  color: var(--wp-danger);
}
.wp-bundle-action:hover { background: var(--wp-bg3); }
.wp-bundle-action--danger:hover { color: var(--wp-red); }
</style>
