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
    /** True when the bundle's `inserted_at_hash` differs from the
     *  library entry's current `payload_hash` — i.e. the library
     *  entry has been edited since this bundle was inserted. Distinct
     *  from per-child drift (`driftedCount`): a bundle can be
     *  library-drifted with zero drifted children if a library edit
     *  hasn't yet propagated locally via reset. Resolved by the
     *  caller using the polled `bundleHashes` map. */
    libraryDrifted?: boolean;
    /** Master-toggle state for the children's `instance.internal`
     *  flag. "all" → every child is internal (button shows pressed).
     *  "none" → no child is internal (button shows neutral).
     *  "partial" → mixed; button shows half-pressed and resolving the
     *  click sets all to internal. `null` when the bundle has no
     *  internal-applicable children (e.g. constraint-only bundle) —
     *  the button stays hidden, same pattern as `lockState`. */
    internalState?: "all" | "none" | "partial" | null;
    /** Master-toggle state for `instance.locked_seed` over the
     *  bundle's seed-lockable children (wildcards + pipelines).
     *  Same tri-state semantics as `internalState`. `null` when the
     *  bundle has no lockable children — the lock button stays
     *  hidden in that case so non-applicable bundles don't show a
     *  control that would no-op. */
    lockState?: "all" | "none" | "partial" | null;
  }>(),
  { color: null, driftedCount: 0, libraryDrifted: false, internalState: "none", lockState: null },
);

const emit = defineEmits<{
  (e: "toggle-collapse"): void;
  (e: "toggle-enabled", next: boolean): void;
  (e: "toggle-internal"): void;
  (e: "toggle-lock"): void;
  (e: "remove"): void;
  (e: "contextmenu", ev: MouseEvent): void;
  (e: "dragstart", ev: DragEvent): void;
  (e: "dragend", ev: DragEvent): void;
  (e: "dragover", ev: DragEvent): void;
  (e: "drop", ev: DragEvent): void;
}>();

const frameColor = computed(() =>
  props.color && props.color.length ? props.color : "var(--wp-bundle-default)",
);

const summary = computed(() => {
  const word = props.childCount === 1 ? "mod" : "mods";
  const parts = [`${props.childCount} ${word}`];
  // Library-side drift is surfaced via the `.wp-mod-badge--drift`
  // chip ("library updated") in the markup — re-stating it here would
  // duplicate the same signal. Per-child drift stays in the subtitle
  // because there's no header-level dot for it (each child row owns
  // its own).
  if (props.driftedCount > 0) parts.push(`${props.driftedCount} drifted`);
  return parts.join(" · ");
});

</script>

<template>
  <div
    class="wp-bundle-header"
    :class="{
      'wp-bundle-header--collapsed': instance.collapsed,
      'wp-bundle-header--disabled': !instance.enabled,
    }"
    :style="{ '--b': frameColor }"
    :data-bundle-uid="instance._uid"
    data-bundle-header
    draggable="true"
    @dragstart="(ev) => emit('dragstart', ev)"
    @dragend="(ev) => emit('dragend', ev)"
    @dragover="(ev) => emit('dragover', ev)"
    @drop="(ev) => emit('drop', ev)"
    @contextmenu.stop.prevent="(ev) => emit('contextmenu', ev)"
  >
    <!-- Drag handle — uses the shared `.wp-drag-handle` class from
         row-primitives.css, same 6×12 SVG grip ModuleRow + InjectorRow
         render. Per-state hover/active behavior comes from shared CSS;
         bundle-specific opacity-fade-on-header-hover stays in scoped. -->
    <span class="wp-drag-handle" aria-hidden="true" title="Drag to reorder bundle">
      <svg
        class="wp-drag-handle__grip"
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
      draggable="false"
      :aria-label="instance.collapsed ? 'Expand bundle' : 'Collapse bundle'"
      :title="instance.collapsed ? 'Expand' : 'Collapse'"
      @click.stop="emit('toggle-collapse')"
    >
      <!-- Caret stays pi-caret-down — parent .wp-bundle--collapsed
           rotates -90deg via CSS for the transition (Phase B.1). -->
      <i
        class="pi pi-caret-down"
        aria-hidden="true"
      ></i>
    </button>
    <label class="wp-bundle-enabled" draggable="false" :title="instance.enabled ? 'Disable bundle (cascades to children)' : 'Enable bundle'">
      <input
        type="checkbox"
        :checked="instance.enabled"
        :aria-label="`enable bundle ${name}`"
        @change="(ev) => emit('toggle-enabled', (ev.target as HTMLInputElement).checked)"
      />
      <span class="wp-bundle-enabled-mark"></span>
    </label>
    <span class="wp-row-type-icon wp-bundle-icon" aria-hidden="true">
      <i class="pi pi-box"></i>
    </span>
    <span class="wp-bundle-chip">bundle</span>
    <span class="wp-bundle-name">{{ name }}</span>
    <!-- State dots: reuse the canonical `.wp-mod-dot--drift` /
         `.wp-mod-badge--drift` pair the module rows use, so a bundle
         with library-side drift reads with the same visual grammar as
         a drifted module card. Per-child drift count stays in the
         subtitle ("N drifted") since each child row already carries
         its own dot — re-stacking them at the bundle level would be
         visual noise. -->
    <span v-if="libraryDrifted" class="wp-mod-dots">
      <span class="wp-mod-dot wp-mod-dot--drift"
        title="Library entry has been edited since this bundle was inserted. Right-click → Reset to library."
        aria-hidden="true"></span>
      <span class="wp-mod-badge wp-mod-badge--drift"
        title="Library entry has been edited since this bundle was inserted. Right-click → Reset to library.">library updated</span>
    </span>
    <span class="wp-bundle-summary">{{ summary }}</span>
    <!-- Master toggles: cascade the per-child internal / seed-lock
         flag across every child in the bundle. Tri-state visual:
         pressed = "all", neutral = "none", half-pressed = "partial".
         Click semantics: anything-other-than-all → set all on;
         all → clear all (matches the "click pulls everything to the
         lit state, click again to clear" pattern users already know
         from per-card toggles). Lock button hides when the bundle
         has no lockable children. -->
    <!-- Order mirrors ModuleRow's action bar (lock → internal →
         remove) so users learn one button-row grammar regardless of
         scope. Internal sits between lock and remove on a module row;
         keeping the same placement at bundle scale means a glance
         hits the same control. -->
    <button
      v-if="lockState !== null"
      type="button"
      class="wp-btn--icon-sm wp-btn--warn wp-bundle-action"
      :class="{
        'is-locked': lockState === 'all',
        'is-partial': lockState === 'partial',
      }"
      draggable="false"
      :title="lockState === 'all'
        ? 'Unlock seeds on all lockable children'
        : lockState === 'partial'
          ? 'Lock seeds on all lockable children (some are already locked)'
          : 'Lock seeds on all lockable children — freezes each at its current roll'"
      :aria-label="`toggle seed lock on all lockable children of ${name}`"
      @click.stop="emit('toggle-lock')"
    ><i class="pi pi-lock" aria-hidden="true" /></button>
    <button
      v-if="internalState !== null"
      type="button"
      class="wp-btn--icon-sm wp-btn--accent wp-bundle-action"
      :class="{
        'is-active': internalState === 'all',
        'is-partial': internalState === 'partial',
      }"
      draggable="false"
      :title="internalState === 'all'
        ? 'Clear internal on all children'
        : internalState === 'partial'
          ? 'Mark all children internal (some are already)'
          : 'Mark all children internal — hides them from PromptAssembler'"
      :aria-label="`toggle internal on all children of ${name}`"
      @click.stop="emit('toggle-internal')"
    ><i class="pi pi-globe" aria-hidden="true" /></button>
    <button
      type="button"
      class="wp-btn--icon-sm wp-btn--danger wp-bundle-action"
      draggable="false"
      title="Remove bundle (right-click for more)"
      :aria-label="`remove bundle ${name}`"
      @click.stop="emit('remove')"
    ><i class="pi pi-trash" aria-hidden="true" /></button>
  </div>
</template>

<style>
/* Unscoped — same rationale as ContextWidget.vue's main style block.
 * Every selector here is `.wp-bundle-*` prefixed so collision risk
 * with host CSS or other custom nodes is negligible, and going
 * unscoped means the PlaygroundMockup (settings preview) can render
 * a real-looking bundle header without us replicating the rules in
 * another file. */
@import "../../shared/theme.css";
@import "../../shared/row-primitives.css";

.wp-bundle-header {
  /* The bundle frame box is painted by `.wp-bundle` directly (Batch 2
   * replaced the absolute-positioned overlay with a real DOM wrapper).
   * Header carries only its own bottom divider
   * separating it from the children below — no full border, no
   * radius, no frame walls. When the bundle is collapsed, the
   * bottom divider hides (no children below to separate from).
   *
   * Full border-box parity with `.wp-module` so content (left
   * edge AND right edge / trash button) lines up identically:
   *   - left:   3px transparent  (mirrors `.wp-module`'s 3px kind-stripe)
   *   - right:  1px transparent  (mirrors `.wp-module`'s 1px transparent border)
   *   - top:    1px transparent  (same)
   *   - bottom: 1px solid var(--b)  (visible divider above children) */
  background: color-mix(in srgb, var(--b) 18%, transparent);
  border-top: 1px solid transparent;
  border-right: 1px solid transparent;
  border-bottom: 1px solid var(--b);
  border-left: 3px solid transparent;
  padding: var(--wp-pad-row, 4px 6px);
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
/* Disabled bundle — mirror `.wp-module.wp-disabled`'s diagonal-stripe
 * pattern + 55% opacity. The bundle's tinted bg still shines through
 * via the `--wp-bg2`/`--wp-bg3` stripes mixing with the bundle color
 * underlay, so the disabled state reads as "off" without losing the
 * bundle-color identity. */
.wp-bundle-header--disabled {
  opacity: 0.55;
  background: repeating-linear-gradient(
    45deg,
    var(--wp-bg3),
    var(--wp-bg3) 6px,
    var(--wp-bg2) 6px,
    var(--wp-bg2) 8px
  );
}
/* Drag handle base styles come from shared row-primitives.css
 * (`.wp-drag-handle` + `.wp-drag-handle__grip`). Bundle-specific
 * tweak: hover-on-header reveal (the row-level grip stays subtle
 * until the user looks at the row). */
.wp-bundle-header:hover .wp-drag-handle {
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
  transition: background-color var(--wp-motion-hover), border-color var(--wp-motion-hover);
}
.wp-bundle-enabled input:checked + .wp-bundle-enabled-mark {
  background: var(--b);
  border-color: var(--b);
}
/* Bundle icon base from shared .wp-row-type-icon (16×16 inline-flex).
 * Bundle-specific override: color from bundle frame token, font-size
 * 12 for visual parity with ModuleRow's .wp-row-type-icon density. */
.wp-bundle-icon { color: var(--b); }
.wp-bundle-icon .pi { font-size: 12px; }
.wp-bundle-chip {
  /* line-height 1.2 keeps room for descenders — line-height: 1 clipped
   * the bottom of letters like 'g' / 'p' / 'y' in the rendered chip. */
  font: 600 9px/1.2 var(--wp-font-sans);
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
  font: 600 12px/1.3 var(--wp-font-sans);
  color: var(--wp-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* Master-toggle partial state: bundle has SOME but not all children
 * with the flag on. Reads as "in between" — half-strength accent/warn
 * tint + dashed border. Click resolves the partial state by lighting
 * everyone up; second click clears all. */
.wp-btn--icon-sm.is-partial {
  border-style: dashed !important;
  opacity: 0.75;
}
.wp-btn--icon-sm.wp-btn--accent.is-partial {
  color: var(--wp-accent);
  background: color-mix(in srgb, var(--wp-accent) 7%, transparent);
}
.wp-btn--icon-sm.wp-btn--warn.is-partial {
  color: var(--wp-warn);
  background: color-mix(in srgb, var(--wp-warn) 7%, transparent);
}
.wp-bundle-summary {
  font: 500 10px/1.3 var(--wp-font-sans);
  color: var(--wp-text-dim, var(--wp-text3));
  flex-shrink: 0;
}
/* Bundle action button — base size + shape from shared
 * .wp-btn--icon-sm. Bundle-specific tweak: bg + border tinted with
 * the bundle frame color so the action reads as belonging to THIS
 * bundle (instead of looking like a generic row-level icon button).
 * Hover bumps the bundle-color tint; shared `.wp-btn--danger:hover`
 * adds the red icon + red-tinted border without overriding the
 * bundle's bg — same hover behavior every other danger button gets. */
.wp-bundle-action {
  background: color-mix(in srgb, var(--b) 18%, transparent);
  border-color: var(--b);
}
.wp-bundle-action:hover {
  background: color-mix(in srgb, var(--b) 32%, transparent);
}
</style>
