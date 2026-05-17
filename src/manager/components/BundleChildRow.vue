<script setup lang="ts">
/**
 * BundleChildRow — single child row mirroring PipelineSteps grammar.
 * 5-col grid: [handle][toggle][kind-icon][main: kind-tag/idx/name+frozen pill][acts: dup, remove].
 *
 * Native HTML5 drag-drop reorder is wired by the parent (BundleEditor)
 * which owns the source-index and drop-target-index refs. This row
 * fires `dragstart`/`dragover`/`drop` events upward — no local reorder
 * state lives here.
 */
import { computed } from "vue";
import { kindIcon } from "../../components/shared/kind-icons";

interface Props {
  child: Record<string, unknown>;
  idx: number;
  selected: boolean;
  /** Parent-computed dirty flag. Drives the SNAPSHOT · EDITED pill.
   *  Parent diffs the row's normalized state against the last-saved
   *  baseline so reverting overrides clears the pill cleanly. */
  edited?: boolean;
}
const props = withDefaults(defineProps<Props>(), { edited: false });

const emit = defineEmits<{
  (e: "toggle"): void;
  (e: "duplicate"): void;
  (e: "remove"): void;
  (e: "select"): void;
  (e: "drag-start", evt: DragEvent): void;
  (e: "drag-over", evt: DragEvent): void;
  (e: "drag-leave"): void;
  (e: "drop", evt: DragEvent): void;
  (e: "drag-end"): void;
}>();

interface KindMeta {
  label: string;
  color: string;
}

/** Display labels + kind tint per child type. Icon comes from the shared
 *  `kindIcon()` map so every surface (Context widget, picker, assembler,
 *  bundle editor) renders the same glyph for a given kind. */
const KIND_META: Record<string, KindMeta> = {
  wildcard:     { label: "Wildcard",   color: "var(--wp-kind-wildcard, #34d399)" },
  fixed_values: { label: "Fixed",      color: "var(--wp-kind-fixed, #22d3ee)" },
  combine:      { label: "Combine",    color: "var(--wp-kind-combine, #fbbf24)" },
  derivation:   { label: "Derivation", color: "var(--wp-kind-derivation, #a78bfa)" },
  constraint:   { label: "Constraint", color: "var(--wp-kind-constraint, #f87171)" },
  bundle:       { label: "Bundle",     color: "var(--wp-bundle-default, #46566B)" },
};

const kind = computed(() => String(props.child.type ?? "module"));
const meta = computed<KindMeta>(
  () => KIND_META[kind.value] ?? { label: kind.value.toUpperCase(), color: "#8b949e" },
);
const iconClass = computed(() => (kind.value === "bundle" ? "pi pi-box" : kindIcon(kind.value)));
const enabled = computed(() => props.child.enabled !== false);
const displayName = computed(() => {
  const m = props.child.meta as { name?: string } | undefined;
  return m?.name ?? (props.child.name as string | undefined) ?? "(unnamed)";
});

// Parent owns the dirty diff (baseline lives there). This row just
// surfaces the flag through the SNAPSHOT · EDITED pill rendering.
const isEdited = computed(() => props.edited);
</script>

<template>
  <div
    class="wp-bchild"
    :data-kind="kind"
    :data-disabled="enabled ? null : 'true'"
    :data-selected="selected ? 'true' : null"
    :data-test="`bundle-child-${idx}`"
    :style="{ '--row-kind': meta.color }"
    draggable="true"
    @dragstart="(e) => emit('drag-start', e)"
    @dragover="(e) => emit('drag-over', e)"
    @dragleave="emit('drag-leave')"
    @drop="(e) => emit('drop', e)"
    @dragend="emit('drag-end')"
  >
    <button
      type="button"
      class="wp-bchild__handle"
      :aria-label="`Drag to reorder ${displayName}`"
      :title="`Drag to reorder ${displayName}`"
      :data-test="`bundle-child-handle-${idx}`"
    >
      <i class="pi pi-bars" aria-hidden="true" />
    </button>

    <button
      type="button"
      class="wp-bchild__toggle"
      :aria-label="enabled ? `Disable ${displayName}` : `Enable ${displayName}`"
      :title="enabled ? `Disable ${displayName}` : `Enable ${displayName}`"
      :aria-pressed="enabled"
      data-test="bundle-child-toggle"
      @click="emit('toggle')"
    >
      <i :class="enabled ? 'pi pi-eye' : 'pi pi-eye-slash'" />
    </button>

    <div
      class="wp-bchild__kindicon"
      :title="meta.label"
      aria-hidden="true"
    >
      <i :class="iconClass" />
    </div>

    <div
      class="wp-bchild__main"
      data-test="bundle-child-main"
      @click="emit('select')"
    >
      <div class="wp-bchild__top">
        <span class="wp-bchild__kind">{{ meta.label.toUpperCase() }}</span>
        <span class="wp-bchild__idx">{{ String(idx + 1).padStart(2, "0") }}</span>
      </div>
      <div class="wp-bchild__name">
        {{ displayName }}
        <span class="wp-bchild__frozen" :data-edited="isEdited ? 'true' : null">
          {{ isEdited ? "SNAPSHOT · EDITED" : "SNAPSHOT" }}
        </span>
      </div>
    </div>

    <div class="wp-bchild__acts">
      <button
        type="button"
        class="wp-bchild__act"
        aria-label="Duplicate child"
        title="Duplicate"
        data-test="bundle-child-duplicate"
        @click="emit('duplicate')"
      >
        <i class="pi pi-clone" />
      </button>
      <button
        type="button"
        class="wp-bchild__act wp-bchild__act--danger"
        aria-label="Remove child"
        title="Remove"
        data-test="bundle-child-remove"
        @click="emit('remove')"
      >
        <i class="pi pi-times" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.wp-bchild {
  display: grid;
  grid-template-columns: 22px 22px 28px 1fr auto;
  align-items: center;
  gap: var(--wp-space-4);
  padding: var(--wp-space-3) var(--wp-space-4);
  background: var(--wp-bg-2);
  border: 1px solid var(--wp-border);
  border-left: 3px solid var(--row-kind, var(--wp-accent-500));
  border-radius: var(--wp-radius, 4px);
  transition: border-color 120ms ease, background 120ms ease, opacity 120ms ease;
  cursor: default;
}
.wp-bchild[data-disabled] { opacity: 0.5; }
.wp-bchild[data-disabled] .wp-bchild__name { text-decoration: line-through; }
.wp-bchild[data-selected="true"] {
  background: color-mix(in oklab, var(--row-kind) 12%, var(--wp-bg-2));
  box-shadow: 0 0 0 1px var(--row-kind);
}
.wp-bchild:hover { background: var(--wp-bg-3); }

.wp-bchild__handle, .wp-bchild__toggle, .wp-bchild__act {
  display: flex; align-items: center; justify-content: center;
  width: 22px; height: 22px;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 4px;
  color: var(--wp-text-dim);
  cursor: pointer;
  padding: 0;
  font-size: var(--wp-text-xs);
}
.wp-bchild__handle { cursor: grab; }
.wp-bchild__handle:active { cursor: grabbing; }
.wp-bchild__toggle:hover, .wp-bchild__act:hover {
  background: var(--wp-bg-3);
  color: var(--wp-text);
  border-color: var(--wp-border);
}
.wp-bchild__act--danger:hover {
  background: color-mix(in oklab, var(--wp-danger, #ef4444) 16%, transparent);
  color: #fca5a5;
  border-color: color-mix(in oklab, var(--wp-danger, #ef4444) 30%, transparent);
}

.wp-bchild__kindicon {
  width: 28px; height: 22px;
  border-radius: 4px;
  display: flex; align-items: center; justify-content: center;
  background: color-mix(in oklab, var(--row-kind) 18%, var(--wp-bg-3));
  color: var(--row-kind);
  font-size: var(--wp-text-sm);
}

.wp-bchild__main { min-width: 0; cursor: pointer; }
.wp-bchild__top {
  display: flex; align-items: center; gap: var(--wp-space-4);
  font-size: 9px; /* audit-exempt: micro uppercase kind label — below scale floor */
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--row-kind);
  font-weight: 600;
}
.wp-bchild__idx {
  margin-left: auto;
  font-family: var(--wp-font-mono, ui-monospace, monospace);
  font-size: 9px; /* audit-exempt: micro mono index badge — below scale floor */
  padding: 1px var(--wp-space-3);
  border-radius: 3px;
  background: var(--wp-bg);
  border: 1px solid var(--wp-border);
  color: var(--wp-text-dim);
}
.wp-bchild__name {
  display: flex; align-items: center; gap: var(--wp-space-3);
  font: 500 12.5px/1.3 var(--wp-font-sans); /* audit-exempt: font-shorthand — out of audit scope; awaiting font-shorthand parser */
  color: var(--wp-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wp-bchild__frozen {
  font-size: 8.5px; /* audit-exempt: micro frozen badge — below scale floor */
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 1px var(--wp-space-3);
  border-radius: 999px;
  background: var(--wp-bg);
  border: 1px solid var(--wp-border);
  color: var(--wp-text-dim);
}
.wp-bchild__frozen[data-edited="true"] {
  background: color-mix(in oklab, var(--row-kind) 18%, transparent);
  border-color: color-mix(in oklab, var(--row-kind) 40%, transparent);
  color: var(--row-kind);
}

.wp-bchild__acts {
  display: flex;
  align-items: center;
  gap: 2px;
}
</style>
