<script setup lang="ts">
import { computed, ref } from "vue";
import type { InjectorRow } from "../../widgets/_shared";

const props = defineProps<{
  row: InjectorRow;
  /** Type label from upstream connection (STRING / INT / FLOAT / *). */
  valueType?: string;
  /** True when the underlying ComfyUI socket has a live wire. False
   *  while the row exists but the connection has been severed. */
  isConnected?: boolean;
  /** Conflict severity — drives dot + badge color (info/warning/error).
   *  Mirrors `wp-conflict-dot--*` / `wp-conflict-badge--*` from
   *  ContextWidget so injector + context rows share one design family. */
  conflictSeverity?: "info" | "warning" | "error";
  /** Short label rendered inside the conflict badge (e.g. "duplicate",
   *  "no link", "overrides upstream"). */
  conflictLabel?: string;
  /** Display label for the slot tag — usually the user-customized
   *  socket label, falls back to the row's slot_name (input_N) when
   *  unset. Truncates with ellipsis when too long for the tag. */
  displayLabel?: string;
  /** Index of this row in the parent's `value.rows` array — used as
   *  the dataTransfer payload during drag-to-reorder. */
  index?: number;
  /** When true, the row root is `draggable` and emits the reorder
   *  events. When false (default), drag is a no-op so external
   *  consumers (tests, isolated mounts) aren't surprised by dnd. */
  reorderable?: boolean;
}>();

const slotLabel = computed(() => props.displayLabel ?? props.row.slot_name);

const emit = defineEmits<{
  (e: "update", patch: Partial<InjectorRow>): void;
  (e: "disconnect"): void;
  (e: "row-drag-start", payload: { fromIdx: number }): void;
  /** Fires while a drag is hovering over this row. `edge` tells the
   *  parent which side the drop indicator should highlight (so the
   *  user can preview the insertion point before releasing). */
  (e: "row-drag-over", payload: { overIdx: number; edge: "before" | "after" }): void;
  (e: "row-drop", payload: { overIdx: number; edge: "before" | "after" }): void;
  (e: "row-drag-end"): void;
}>();

const isEmpty = computed(() => !props.row.binding.trim());

/** Type → pi-* icon mapping. Covers the four engine-native primitive
 *  types (string/int/float/boolean) plus common ComfyUI model & tensor
 *  types — those get stringified server-side, but the icon still helps
 *  the user correlate the wire visually. Falls back to pi-circle for
 *  unknown types so the icon slot never goes empty (consistent row
 *  height). */
const TYPE_ICONS: Record<string, string> = {
  // Engine-native primitives
  string: "pi-pencil",
  int: "pi-hashtag",
  float: "pi-percentage",
  boolean: "pi-check-square",
  // Common ComfyUI tensor / model types — stringified by engine but
  // worth surfacing visually so the user reads the wire kind.
  image: "pi-image",
  mask: "pi-clone",
  latent: "pi-cloud",
  conditioning: "pi-comment",
  model: "pi-cube",
  clip: "pi-tag",
  vae: "pi-box",
  audio: "pi-volume-up",
  video: "pi-video",
  noise: "pi-sparkles",
  sigmas: "pi-chart-line",
  guider: "pi-compass",
  sampler: "pi-sliders-h",
};
const typeIcon = computed(
  () => TYPE_ICONS[(props.valueType ?? "").toLowerCase()] ?? "pi-circle",
);

function onBindingInput(ev: Event): void {
  const next = (ev.target as HTMLInputElement).value;
  emit("update", { binding: next });
}

// ─── Drag-to-reorder state. The visible drop indicator is driven by
// `dropEdge` — we recompute it on each dragover based on the cursor's
// Y position relative to the row's midpoint. Cleared on dragleave +
// drop + dragend so a row can't get stuck with a stale indicator.
const isDragging = ref(false);
const dropEdge = ref<"before" | "after" | null>(null);

function onDragStart(ev: DragEvent): void {
  if (!props.reorderable || props.index === undefined) return;
  isDragging.value = true;
  if (ev.dataTransfer) {
    ev.dataTransfer.effectAllowed = "move";
    // Set a payload so the platform considers this a valid drag —
    // some browsers/HiDPI hosts no-op dragstart when dataTransfer
    // is empty. The actual payload is read back via the parent's
    // tracked fromIdx; this is just a marker.
    ev.dataTransfer.setData("text/wp-injector-row", String(props.index));
  }
  emit("row-drag-start", { fromIdx: props.index });
}

function onDragOver(ev: DragEvent): void {
  if (!props.reorderable || props.index === undefined) return;
  const rect = (ev.currentTarget as HTMLElement).getBoundingClientRect();
  const edge: "before" | "after" = ev.clientY < rect.top + rect.height / 2 ? "before" : "after";
  if (dropEdge.value !== edge) dropEdge.value = edge;
  if (ev.dataTransfer) ev.dataTransfer.dropEffect = "move";
  emit("row-drag-over", { overIdx: props.index, edge });
}

function onDragLeave(): void {
  dropEdge.value = null;
}

function onDrop(ev: DragEvent): void {
  if (!props.reorderable || props.index === undefined) return;
  const rect = (ev.currentTarget as HTMLElement).getBoundingClientRect();
  const edge: "before" | "after" = ev.clientY < rect.top + rect.height / 2 ? "before" : "after";
  dropEdge.value = null;
  isDragging.value = false;
  emit("row-drop", { overIdx: props.index, edge });
}

function onDragEnd(): void {
  isDragging.value = false;
  dropEdge.value = null;
  emit("row-drag-end");
}
</script>

<template>
  <div
    class="wp-inj-row"
    :data-type="(valueType ?? '').toLowerCase()"
    :data-uid="row._uid"
    :class="{
      'wp-inj-row--disconnected': props.isConnected === false,
      'wp-inj-row--disabled': !row.enabled,
      'wp-inj-row--dragging': isDragging,
      'wp-inj-row--drop-before': dropEdge === 'before',
      'wp-inj-row--drop-after': dropEdge === 'after',
      'wp-conflict-info': conflictSeverity === 'info',
      'wp-conflict-warning': conflictSeverity === 'warning',
      'wp-conflict-error': conflictSeverity === 'error',
    }"
    :draggable="reorderable"
    title="Drag from the row edge to reorder"
    @dragstart="onDragStart"
    @dragover.prevent="onDragOver"
    @dragleave="onDragLeave"
    @drop.prevent="onDrop"
    @dragend="onDragEnd"
  >
    <span class="wp-drag-handle" aria-hidden="true" title="Drag to reorder">
      <svg class="wp-drag-handle__grip" viewBox="0 0 6 12" width="6" height="12" fill="currentColor" aria-hidden="true" focusable="false">
        <circle cx="1.5" cy="2" r="1" />
        <circle cx="4.5" cy="2" r="1" />
        <circle cx="1.5" cy="6" r="1" />
        <circle cx="4.5" cy="6" r="1" />
        <circle cx="1.5" cy="10" r="1" />
        <circle cx="4.5" cy="10" r="1" />
      </svg>
    </span>
    <label class="wp-inj-toggle" :title="row.enabled ? 'Disable' : 'Enable'" draggable="false">
      <input
        type="checkbox"
        :checked="row.enabled"
        data-test="inj-row-enabled"
        :aria-label="`enable injector row ${row._uid}`"
        @change="(ev) => emit('update', { enabled: (ev.target as HTMLInputElement).checked })"
      />
      <span class="wp-inj-toggle-mark"></span>
    </label>

    <span class="wp-row-type-icon" aria-hidden="true">
      <i :class="['pi', typeIcon]" />
    </span>

    <span
      class="wp-inj-slot"
      :title="slotLabel === row.slot_name
        ? `Bound to socket ${row.slot_name}`
        : `Bound to socket ${row.slot_name} (label: ${slotLabel})`"
      data-test="inj-row-slot"
    >{{ slotLabel }}</span>

    <span
      v-if="valueType"
      class="wp-kind-chip"
      data-test="inj-row-type"
    >{{ valueType.toLowerCase() }}</span>

    <div
      class="wp-vbind-wrap"
      :class="{ 'wp-vbind-wrap--empty': isEmpty }"
      draggable="false"
    >
      <span class="wp-vbind-prefix">$</span>
      <input
        type="text"
        class="wp-vbind-input"
        data-test="inj-row-binding"
        :value="row.binding"
        :aria-label="`binding for ${row.slot_name}`"
        placeholder="variable_name"
        spellcheck="false"
        draggable="false"
        @input="onBindingInput"
      />
    </div>

    <span
      v-if="conflictSeverity"
      class="wp-conflict-dot"
      :class="`wp-conflict-dot--${conflictSeverity}`"
      :title="conflictLabel"
      aria-hidden="true"
    ></span>
    <span
      v-if="conflictSeverity && conflictLabel"
      class="wp-conflict-badge"
      :class="`wp-conflict-badge--${conflictSeverity}`"
      :title="conflictLabel"
      data-test="inj-row-conflict"
    >{{ conflictLabel }}</span>

    <div class="wp-row-actions" draggable="false">
      <button
        type="button"
        class="wp-btn--icon-sm"
        :class="{ 'is-active': row.internal }"
        data-test="inj-row-internal"
        draggable="false"
        :title="row.internal ? 'Internal flag active — hidden from assembler chip strip' : 'Mark internal — hide from assembler chip strip'"
        @click="emit('update', { internal: !row.internal })"
      ><i class="pi pi-globe" aria-hidden="true" /></button>
      <button
        type="button"
        class="wp-btn--icon-sm wp-btn--danger"
        data-test="inj-row-remove"
        draggable="false"
        title="Disconnect this input wire"
        :aria-label="`disconnect ${row.slot_name}`"
        @click="emit('disconnect')"
      ><i class="pi pi-trash" aria-hidden="true" /></button>
    </div>
  </div>
</template>

<style scoped>
@import "../shared/var-binding-input.css";
@import "../shared/theme.css";
@import "../shared/row-primitives.css";

/* Card-framed row — mirrors .wp-module shape. Type-color left stripe
 * mirrors data-kind border-left from ContextWidget. */
.wp-inj-row {
  background: var(--wp-bg3);
  border: 1px solid var(--wp-border);
  border-left-width: 3px;
  border-left-color: var(--wp-text3);  /* fallback for unknown type */
  border-radius: var(--wp-radius-sm);
  padding: var(--wp-pad-row, 4px 6px);
  margin-bottom: 4px;  /* gap between rows — mirrors Context module spacing */
  display: flex;
  align-items: center;
  gap: var(--wp-row-gap, 6px);
  font: 500 12px var(--wp-font-sans);
  color: var(--wp-text);
  transition: background-color 0.15s, border-color 0.15s;
}
.wp-inj-row:last-child { margin-bottom: 0; }
/* Drag-to-reorder. Row root carries `draggable` when reorderable;
 * the row gets a grab cursor on hover so the affordance is
 * discoverable without a separate handle glyph. Interactive
 * children (toggle, binding input, action buttons) carry
 * draggable="false" so click + text-selection still work normally.
 *
 * Dragging row: dimmed via opacity so the user sees their grab.
 * Drop target: 2px accent bar above (before-edge) or below
 * (after-edge) — mirrors the cross-platform "drop here" affordance. */
.wp-inj-row[draggable="true"] { cursor: grab; }
.wp-inj-row[draggable="true"]:active { cursor: grabbing; }
.wp-inj-row--dragging { opacity: 0.4; }
.wp-inj-row--drop-before { box-shadow: inset 0 2px 0 0 var(--wp-accent); }
.wp-inj-row--drop-after  { box-shadow: inset 0 -2px 0 0 var(--wp-accent); }

/* Enter / leave / flash classes consumed by src/components/shared/
 * flip.ts when InjectorWidget calls withEnterAnimation /
 * withLeaveAnimation / flashRows. Mirror of ModuleRow's
 * .wp-module--* family with injector-tinted accents — visual parity
 * across both row UIs. The `transition: none` on --arriving snaps
 * the row to the from-state without fighting the base row's
 * background transition. */
.wp-inj-row.wp-inj-row--leaving {
  opacity: 0;
  transform: translateX(-12px);
  transition: opacity 180ms linear, transform 280ms cubic-bezier(0.22, 1, 0.36, 1);
  pointer-events: none;
}
.wp-inj-row.wp-inj-row--arriving {
  opacity: 0;
  transform: translateX(12px);
  transition: none;
}
.wp-inj-row.wp-inj-row--arrived {
  opacity: 1;
  transform: translateX(0);
  transition: opacity 180ms linear, transform 280ms cubic-bezier(0.22, 1, 0.36, 1);
}
/* Flash — green ring keyframe for library-side mutations (refresh
 * etc). Currently used for drag-drop drop-pulse signal on arrival. */
.wp-inj-row--flash { animation: wp-inj-flash 420ms ease-out; }
@keyframes wp-inj-flash {
  0%   { box-shadow: 0 0 0 0 color-mix(in oklab, var(--wp-green) 60%, transparent); }
  100% { box-shadow: 0 0 0 6px color-mix(in oklab, var(--wp-green) 0%, transparent); }
}

.wp-inj-row[data-type="string"]       { border-left-color: var(--wp-amber); }
.wp-inj-row[data-type="int"]          { border-left-color: var(--wp-green); }
.wp-inj-row[data-type="float"]        { border-left-color: var(--wp-var-7); }
.wp-inj-row[data-type="boolean"]      { border-left-color: var(--wp-var-5); }
.wp-inj-row[data-type="image"]        { border-left-color: var(--wp-var-1); }
.wp-inj-row[data-type="mask"]         { border-left-color: var(--wp-var-6); }
.wp-inj-row[data-type="latent"]       { border-left-color: var(--wp-var-4); }
.wp-inj-row[data-type="conditioning"] { border-left-color: var(--wp-var-2); }
.wp-inj-row[data-type="model"]        { border-left-color: var(--wp-var-8); }
.wp-inj-row[data-type="clip"]         { border-left-color: var(--wp-var-3); }
.wp-inj-row[data-type="vae"]          { border-left-color: var(--wp-var-6); }
.wp-inj-row[data-type="audio"]        { border-left-color: var(--wp-var-7); }
.wp-inj-row[data-type="video"]        { border-left-color: var(--wp-var-4); }
.wp-inj-row[data-type="noise"]        { border-left-color: var(--wp-var-6); }
.wp-inj-row[data-type="sigmas"]       { border-left-color: var(--wp-var-1); }
.wp-inj-row[data-type="guider"]       { border-left-color: var(--wp-var-3); }
.wp-inj-row[data-type="sampler"]      { border-left-color: var(--wp-var-2); }

/* Disabled — mirrors .wp-module.wp-disabled diagonal-stripe + 55% opacity. */
.wp-inj-row--disabled {
  opacity: 0.55;
  background: repeating-linear-gradient(
    45deg,
    var(--wp-bg3),
    var(--wp-bg3) 6px,
    var(--wp-bg2) 6px,
    var(--wp-bg2) 8px
  );
}

/* Conflict frame — mirrors .wp-module.wp-conflict-* (severity color
 * paints the full border; left stripe stays type-color underneath). */
.wp-inj-row.wp-conflict-info    { border-color: var(--wp-accent); }
.wp-inj-row.wp-conflict-warning { border-color: var(--wp-amber); }
.wp-inj-row.wp-conflict-error   { border-color: var(--wp-red); }

/* Disconnected — Injector-specific. Dashed amber left stripe + faint
 * amber wash so the user sees 'row exists but socket has no wire'. */
.wp-inj-row--disconnected {
  border-left-style: dashed;
  border-left-color: var(--wp-warn);
  background: color-mix(in srgb, var(--wp-warn) 4%, var(--wp-bg3));
}

/* Toggle checkbox — same as Context's .wp-toggle */
.wp-inj-toggle { display: flex; align-items: center; cursor: pointer; flex-shrink: 0; }
.wp-inj-toggle input {
  position: absolute;
  opacity: 0;
  width: 0;
  height: 0;
  pointer-events: none;
}
.wp-inj-toggle-mark {
  display: block;
  width: 12px;
  height: 12px;
  border-radius: 2px;
  border: 1px solid var(--wp-border2);
  background: var(--wp-bg2);
  transition: background-color 0.15s, border-color 0.15s;
}
.wp-inj-toggle input:checked + .wp-inj-toggle-mark {
  background: var(--wp-accent);
  border-color: var(--wp-accent);
}
.wp-inj-toggle input:focus-visible + .wp-inj-toggle-mark {
  box-shadow: 0 0 0 2px var(--wp-violet);
}

/* Type icon — base style lives in src/components/shared/row-primitives.css
 * under `.wp-row-type-icon`. Only the per-value-type color overrides
 * are injector-specific and stay here. ContextWidget has its own
 * per-module-kind color rules in its scoped block. */
.wp-inj-row[data-type="string"]       .wp-row-type-icon { color: var(--wp-amber); }
.wp-inj-row[data-type="int"]          .wp-row-type-icon { color: var(--wp-green); }
.wp-inj-row[data-type="float"]        .wp-row-type-icon { color: var(--wp-var-7); }
.wp-inj-row[data-type="boolean"]      .wp-row-type-icon { color: var(--wp-var-5); }
/* ComfyUI tensor / model types — colored from the wp-var palette to
 * stay in the same visual family as the four primitives. */
.wp-inj-row[data-type="image"]        .wp-row-type-icon { color: var(--wp-var-1); }
.wp-inj-row[data-type="mask"]         .wp-row-type-icon { color: var(--wp-var-6); }
.wp-inj-row[data-type="latent"]       .wp-row-type-icon { color: var(--wp-var-4); }
.wp-inj-row[data-type="conditioning"] .wp-row-type-icon { color: var(--wp-var-2); }
.wp-inj-row[data-type="model"]        .wp-row-type-icon { color: var(--wp-var-8); }
.wp-inj-row[data-type="clip"]         .wp-row-type-icon { color: var(--wp-var-3); }
.wp-inj-row[data-type="vae"]          .wp-row-type-icon { color: var(--wp-var-6); }
.wp-inj-row[data-type="audio"]        .wp-row-type-icon { color: var(--wp-var-7); }
.wp-inj-row[data-type="video"]        .wp-row-type-icon { color: var(--wp-var-4); }
.wp-inj-row[data-type="noise"]        .wp-row-type-icon { color: var(--wp-var-6); }
.wp-inj-row[data-type="sigmas"]       .wp-row-type-icon { color: var(--wp-var-1); }
.wp-inj-row[data-type="guider"]       .wp-row-type-icon { color: var(--wp-var-3); }
.wp-inj-row[data-type="sampler"]      .wp-row-type-icon { color: var(--wp-var-2); }

/* Slot tag — kind-chip-shaped pill in muted grey, sans font.
 * Shows either input_N or the user's custom socket label. Cap width
 * so a long custom label can't push the rest of the row out of view;
 * full text remains accessible via the title tooltip. */
.wp-inj-slot {
  font: 600 9px/1.2 var(--wp-font-sans);
  text-transform: lowercase;
  letter-spacing: 0.04em;
  padding: 3px 5px;
  border-radius: 2px;
  background: color-mix(in oklab, var(--wp-text3) 18%, transparent);
  color: var(--wp-text2);
  flex-shrink: 0;
  max-width: 96px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Type chip — base + neutral default come from shared `.wp-kind-chip`
 * (defined in src/components/shared/theme.css). The per-value-type
 * color overrides are injector-specific (vocabulary differs from
 * ModuleRow's wildcard/fixed/combine/... kinds) so they stay here,
 * targeting the shared base class. */
.wp-inj-row[data-type="string"]       .wp-kind-chip { background: color-mix(in oklab, var(--wp-amber)  22%, transparent); color: var(--wp-amber); }
.wp-inj-row[data-type="int"]          .wp-kind-chip { background: color-mix(in oklab, var(--wp-green)  22%, transparent); color: var(--wp-green); }
.wp-inj-row[data-type="float"]        .wp-kind-chip { background: color-mix(in oklab, var(--wp-var-7) 22%, transparent); color: var(--wp-var-7); }
.wp-inj-row[data-type="boolean"]      .wp-kind-chip { background: color-mix(in oklab, var(--wp-var-5) 22%, transparent); color: var(--wp-var-5); }
.wp-inj-row[data-type="image"]        .wp-kind-chip { background: color-mix(in oklab, var(--wp-var-1) 22%, transparent); color: var(--wp-var-1); }
.wp-inj-row[data-type="mask"]         .wp-kind-chip { background: color-mix(in oklab, var(--wp-var-6) 22%, transparent); color: var(--wp-var-6); }
.wp-inj-row[data-type="latent"]       .wp-kind-chip { background: color-mix(in oklab, var(--wp-var-4) 22%, transparent); color: var(--wp-var-4); }
.wp-inj-row[data-type="conditioning"] .wp-kind-chip { background: color-mix(in oklab, var(--wp-var-2) 22%, transparent); color: var(--wp-var-2); }
.wp-inj-row[data-type="model"]        .wp-kind-chip { background: color-mix(in oklab, var(--wp-var-8) 22%, transparent); color: var(--wp-var-8); }
.wp-inj-row[data-type="clip"]         .wp-kind-chip { background: color-mix(in oklab, var(--wp-var-3) 22%, transparent); color: var(--wp-var-3); }
.wp-inj-row[data-type="vae"]          .wp-kind-chip { background: color-mix(in oklab, var(--wp-var-6) 22%, transparent); color: var(--wp-var-6); }
.wp-inj-row[data-type="audio"]        .wp-kind-chip { background: color-mix(in oklab, var(--wp-var-7) 22%, transparent); color: var(--wp-var-7); }
.wp-inj-row[data-type="video"]        .wp-kind-chip { background: color-mix(in oklab, var(--wp-var-4) 22%, transparent); color: var(--wp-var-4); }
.wp-inj-row[data-type="noise"]        .wp-kind-chip { background: color-mix(in oklab, var(--wp-var-6) 22%, transparent); color: var(--wp-var-6); }
.wp-inj-row[data-type="sigmas"]       .wp-kind-chip { background: color-mix(in oklab, var(--wp-var-1) 22%, transparent); color: var(--wp-var-1); }
.wp-inj-row[data-type="guider"]       .wp-kind-chip { background: color-mix(in oklab, var(--wp-var-3) 22%, transparent); color: var(--wp-var-3); }
.wp-inj-row[data-type="sampler"]      .wp-kind-chip { background: color-mix(in oklab, var(--wp-var-2) 22%, transparent); color: var(--wp-var-2); }

/* .wp-conflict-dot + .wp-conflict-badge + severity variants
 * + .wp-btn--icon-sm + variants → src/components/shared/row-primitives.css.
 * The shared file is imported at the top of this scoped block. */

/* Injector-specific badge truncation. The shared .wp-conflict-badge
 * doesn't truncate by default (Context's row has flex:1 module name
 * absorbing slack). Injector's row layout puts vbind-wrap right next
 * to the badge, so a long label can squeeze the binding input. Cap
 * + ellipsis prevents that. */
.wp-conflict-badge {
  max-width: 88px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex-shrink: 1;
}

/* Row action cluster — flex row of icon buttons. Uses the shared
 * .wp-btn--icon-sm for each button's styling. */
.wp-row-actions { display: flex; gap: 1px; flex-shrink: 0; }
</style>
