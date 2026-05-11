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
    :style="{ '--b': frameColor }"
    :data-bundle-uid="instance._uid"
    @contextmenu.stop.prevent="(ev) => emit('contextmenu', ev)"
  >
    <span class="wp-bundle-handle" title="Drag to reorder bundle">⠿</span>
    <button
      type="button"
      class="wp-bundle-collapse"
      :aria-label="instance.collapsed ? 'Expand bundle' : 'Collapse bundle'"
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
.wp-bundle-handle {
  color: var(--wp-text3);
  font-size: 10px;
  cursor: grab;
  flex-shrink: 0;
}
.wp-bundle-collapse {
  background: transparent;
  border: 0;
  width: 14px;
  height: 14px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--wp-text-dim, var(--wp-text3));
  cursor: pointer;
  padding: 0;
}
.wp-bundle-collapse .pi { font-size: 9px; }
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
.wp-bundle-action {
  width: 18px;
  height: 18px;
  background: transparent;
  border: 1px solid transparent;
  color: var(--wp-text-dim, var(--wp-text3));
  font-size: 10px;
  border-radius: 3px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.wp-bundle-action:hover { background: var(--wp-bg3); }
.wp-bundle-action--danger:hover { color: var(--wp-red); }
</style>
