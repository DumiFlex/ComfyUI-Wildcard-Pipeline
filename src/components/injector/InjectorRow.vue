<script setup lang="ts">
import { valueTypeLook } from "./value-types";
import { computed, ref } from "vue";
import type { InjectorRow } from "../../widgets/_shared";
import Checkbox from "@/kit/Checkbox.vue";
import Input from "@/kit/Input.vue";
import WpIconButton from "@/kit/WpIconButton.vue";
import DragHandle from "@/kit/DragHandle.vue";

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

/** A general-template row: no slot, durable, resolved after all socket
 *  rows. Its binding is edited inline (shared header input); its
 *  template is edited via the InjectorBindingModal, same as socket
 *  rows. Driven by `row.kind`. */
const isGeneral = computed(() => props.row.kind === "general");

const slotLabel = computed(() => props.displayLabel ?? props.row.slot_name);

const emit = defineEmits<{
  (e: "update", patch: Partial<InjectorRow>): void;
  (e: "disconnect"): void;
  (e: "row-drag-start", payload: { fromIdx: number; ev: DragEvent }): void;
  (e: "row-drag-end"): void;
  /** Right-click on the row root. Parent opens a shared ContextMenu
   *  with edit / disable / collapse / move-top / move-bottom /
   *  disconnect entries. ev.clientX/Y feeds the menu anchor. */
  (e: "row-contextmenu", payload: { ev: MouseEvent; idx: number }): void;
}>();

function onContextMenu(ev: MouseEvent): void {
  if (props.index === undefined) return;
  ev.preventDefault();
  ev.stopPropagation();
  emit("row-contextmenu", { ev, idx: props.index });
}

const isEmpty = computed(() => !props.row.binding.trim());

/** Type → pi-* icon mapping. Covers the four engine-native primitive
 *  types (string/int/float/boolean) plus common ComfyUI model & tensor
 *  types — those get stringified server-side, but the icon still helps
 *  the user correlate the wire visually. Falls back to pi-circle for
 *  unknown types so the icon slot never goes empty (consistent row
 *  height). */
const typeIcon = computed(
  () => valueTypeLook(props.valueType).icon,
);

const hasTemplate = computed(() => {
  const t = props.row.template;
  return typeof t === "string" && t.trim().length > 0;
});

/** Send-to-negative: the row carries a Negative. */
const hasNegative = computed(() => {
  const n = props.row.negative;
  return typeof n === "string" && n.trim().length > 0;
});

const summaryTitle = computed(() => {
  if (isGeneral.value) {
    if (isEmpty.value) return "Template row — type a variable name to write the composed value into ctx";
    return `ctx["${props.row.binding}"] ← template "${props.row.template ?? ""}" (composed after socket rows)`;
  }
  if (isEmpty.value) return `Socket ${props.row.slot_name} has no binding — type a variable name to write the wired value into ctx`;
  if (hasTemplate.value) return `ctx["${props.row.binding}"] ← template "${props.row.template}"`;
  const t = props.valueType ? ` (${props.valueType.toLowerCase()})` : "";
  return `ctx["${props.row.binding}"] ← socket ${props.row.slot_name}${t}`;
});

function onBindingInput(ev: Event): void {
  const next = (ev.target as HTMLInputElement).value;
  emit("update", { binding: next });
}

// Drag-to-reorder: dragstart / dragend fire on the source row, so they
// stay here; the list-level target, gap, line, slide and pulse are the
// kit's useRowDrag in InjectorWidget (its classes fall through to this root).
function onDragStart(ev: DragEvent): void {
  if (!props.reorderable || props.index === undefined) return;
  emit("row-drag-start", { fromIdx: props.index, ev });
}
function onDragEnd(): void {
  emit("row-drag-end");
}
</script>

<template>
  <div
    class="wp-inj-row"
    :data-type="(valueType ?? '').toLowerCase()"
    :data-uid="row._uid"
    :data-wp-vars="row.binding.trim() || undefined"
    :data-kind="isGeneral ? 'general' : 'socket'"
    :class="{
      'wp-inj-row--disconnected': props.isConnected === false,
      'wp-inj-row--disabled': !row.enabled,
      'wp-inj-row--has-template': hasTemplate,
      'wp-inj-row--general': isGeneral,
      'wp-conflict-info': conflictSeverity === 'info',
      'wp-conflict-warning': conflictSeverity === 'warning',
      'wp-conflict-error': conflictSeverity === 'error',
    }"
    :draggable="reorderable"
    @dragstart="onDragStart"
    @dragend="onDragEnd"
    @contextmenu="onContextMenu"
  >
    <div class="wp-inj-row-header">
      <span class="wp-drag-handle" aria-hidden="true">
        <DragHandle title="Drag to reorder" />
      </span>
      <WpIconButton
        variant="bare"
        class="wp-collapse-btn"
        draggable="false"
        data-test="inj-row-collapse"
        :icon="row._collapsed ? 'pi-caret-right' : 'pi-caret-down'"
        :label="row._collapsed ? 'Expand row preview' : 'Collapse row preview'"
        :hint="row._collapsed ? 'Expand' : 'Collapse'"
        @click.stop="emit('update', { _collapsed: !row._collapsed })"
      />
      <Checkbox
        size="sm"
        :title="row.enabled ? 'Disable' : 'Enable'"
        draggable="false"
        :model-value="row.enabled"
        data-test="inj-row-enabled"
        :aria-label="`enable injector row ${row._uid}`"
        @update:model-value="(next) => emit('update', { enabled: next })"
      />

      <span class="wp-row-type-icon" aria-hidden="true">
        <i :class="['pi', isGeneral ? 'pi-bolt' : typeIcon]" />
      </span>

      <span
        v-if="isGeneral"
        class="wp-inj-slot wp-inj-slot--general"
        title="Template row — composes a value from sockets and socket-row variables; runs after all socket rows and survives disconnects"
        data-test="inj-row-general-tag"
      >template</span>
      <span
        v-else
        class="wp-inj-slot"
        :title="slotLabel === row.slot_name
          ? `Bound to socket ${row.slot_name}`
          : `Bound to socket ${row.slot_name} (label: ${slotLabel})`"
        data-test="inj-row-slot"
      >{{ slotLabel }}</span>

      <span
        v-if="!isGeneral && valueType"
        class="wp-kind-chip"
        data-test="inj-row-type"
      >{{ valueType.toLowerCase() }}</span>

      <Input
        size="sm"
        mono
        prefix="$"
        class="wp-inj-bind"
        :tone="isEmpty ? 'warn' : undefined"
        data-test="inj-row-binding"
        :model-value="row.binding"
        :aria-label="isGeneral ? 'binding for template row' : `binding for ${row.slot_name}`"
        placeholder="variable_name"
        spellcheck="false"
        draggable="false"
        @input="onBindingInput"
      />

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
        <WpIconButton
          icon="pi-globe"
          tone="accent"
          :pressed="!!row.internal"
          data-test="inj-row-internal"
          draggable="false"
          :label="row.internal ? 'Unmark internal' : 'Mark internal'"
          :hint="row.internal ? 'Internal flag active — hidden from assembler chip strip' : 'Mark internal — hide from assembler chip strip'"
          @click="emit('update', { internal: !row.internal })"
        />
        <WpIconButton
          icon="pi-trash"
          tone="danger"
          data-test="inj-row-remove"
          draggable="false"
          :label="isGeneral ? 'Delete this template row' : `Disconnect ${row.slot_name}`"
          :hint="isGeneral ? 'Delete this template row' : 'Disconnect this input wire'"
          @click="emit('disconnect')"
        />
      </div>
    </div>
    <!-- Collapse-row holds only the shared summary line — identical
         shape for socket + general rows. General rows edit their
         template via the InjectorBindingModal (right-click → Edit),
         same affordance socket rows use; the binding stays inline in
         the header. -->
    <div class="wp-collapse-row" :data-collapsed="row._collapsed ? 'true' : 'false'">
      <div class="wp-summary wp-inj-summary" :title="summaryTitle" data-test="inj-row-summary">
        <span class="wp-summary__main">
          <template v-if="isEmpty"><span class="wp-inj-summary__empty">no binding — type a variable name</span></template>
          <template v-else-if="isGeneral"><span class="wp-inj-summary__prefix">$</span><span class="wp-inj-summary__var">{{ row.binding }}</span><span class="wp-inj-summary__sep"> ← </span><span class="wp-inj-summary__template" data-test="inj-row-summary-template">{{ row.template || "(empty template)" }}</span></template>
          <template v-else-if="hasTemplate"><span class="wp-inj-summary__prefix">$</span><span class="wp-inj-summary__var">{{ row.binding }}</span><span class="wp-inj-summary__sep"> ← </span><span class="wp-inj-summary__template" data-test="inj-row-summary-template">{{ row.template }}</span></template>
          <template v-else><span class="wp-inj-summary__prefix">$</span><span class="wp-inj-summary__var">{{ row.binding }}</span><span class="wp-inj-summary__sep"> ← </span><span class="wp-inj-summary__slot">{{ row.slot_name }}</span><template v-if="valueType"><span class="wp-inj-summary__type"> ({{ valueType.toLowerCase() }})</span></template></template>
        </span>
        <span
          v-if="hasTemplate || isGeneral"
          class="wp-inj-summary__tpl-badge"
          data-test="inj-row-tpl-badge"
          :title="isGeneral
            ? 'Template row — composed after socket rows from sockets + socket-row variables'
            : 'Template active — engine substitutes $slot_name refs before writing to ctx'"
        >tpl</span>
        <span
          v-if="hasNegative"
          class="wp-inj-summary__tpl-badge wp-inj-summary__neg-badge"
          data-test="inj-row-neg-badge"
          :title="row.internal
            ? `Negative: ${row.negative} (internal variable, so it reaches no prompt)`
            : `Negative: ${row.negative} (goes where an Assembler renders $${row.binding})`"
        >neg</span>
      </div>
    </div>
  </div>
</template>

<style scoped src="@/kit/row-drag.css"></style>
<style scoped>
@import "../shared/row-primitives.css";

/* Card-framed row — mirrors .wp-module shape. Type-color left stripe
 * mirrors data-kind border-left from ContextWidget. Root is now
 * flex-column so the optional summary line (`.wp-inj-summary`) can
 * sit below the header without breaking the row's existing layout. */
.wp-inj-row {
  background: var(--wp-bg3);
  border: 1px solid var(--wp-border);
  border-left-width: 3px;
  border-left-color: var(--wp-text3);  /* fallback for unknown type */
  border-radius: var(--wp-radius-sm);
  padding: var(--wp-pad-row, 4px 6px);
  margin-bottom: 4px;  /* gap between rows — mirrors Context module spacing */
  display: flex;
  flex-direction: column;
  /* No flex `gap` on the column. A collapsed `.wp-collapse-row` shrinks to 0
   * height, but a parent flex gap would STILL render between the header and
   * that 0-height child — leaving ~2px of dead space below the header so the
   * row reads as not-vertically-centered when collapsed. The summary supplies
   * its own (collapsible) top padding for the expanded header↔summary gap
   * instead. Mirrors ModuleRow, which has no column gap for the same reason. */
  font: 500 12px var(--wp-font-sans);
  color: var(--wp-text);
  transition: background-color var(--wp-motion-hover), border-color var(--wp-motion-hover),
    margin-top var(--wp-motion-fade) var(--wp-motion-curve-flip),
    margin-bottom var(--wp-motion-fade) var(--wp-motion-curve-flip);
}
.wp-inj-row:last-child { margin-bottom: 0; }
/* The kit's row-drag gap (row-drag.css loads before this block, so the
 * row's own margins above would win without the extra class), also on
 * the last row, whose `:last-child` rule zeroes its margin. */
.wp-inj-row.wp-rowdrag--before { margin-top: var(--wp-rowdrag-gap, 14px); }
.wp-inj-row.wp-rowdrag--after,
.wp-inj-row.wp-rowdrag--end,
.wp-inj-row.wp-rowdrag--after:last-child,
.wp-inj-row.wp-rowdrag--end:last-child { margin-bottom: var(--wp-rowdrag-gap, 14px); }

/* Header row — original flat layout lives here. All header controls
 * stay on one line via flex-row, while the parent row can expand
 * vertically when the summary line appears. */
.wp-inj-row-header {
  display: flex;
  align-items: center;
  gap: var(--wp-row-gap, 6px);
}
/* Drag-to-reorder: the whole row is the drag source (interactive
 * children carry draggable="false"); only `.wp-drag-handle` shows the
 * grab cursor. The dim, gap, line and pulse are the kit's row-drag.css
 * (the `wp-rowdrag--*` classes InjectorWidget binds on this root). */
.wp-inj-row { position: relative; }

/* Enter / leave / flash classes consumed by the kit's flip.ts (@/kit/flip)
 * when InjectorWidget calls withEnterAnimation /
 * withLeaveAnimation / flashRows. Mirror of ModuleRow's
 * .wp-module--* family with injector-tinted accents — visual parity
 * across both row UIs. The `transition: none` on --arriving snaps
 * the row to the from-state without fighting the base row's
 * background transition. */
.wp-inj-row.wp-inj-row--leaving {
  opacity: 0;
  transform: translateX(-12px);
  transition: opacity var(--wp-motion-fade) linear, transform var(--wp-motion-flip) var(--wp-motion-curve-flip);
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
  transition: opacity var(--wp-motion-fade) linear, transform var(--wp-motion-flip) var(--wp-motion-curve-flip);
}
/* Flash — green ring keyframe for library-side mutations (refresh
 * etc). Currently used for drag-drop drop-pulse signal on arrival. */
.wp-inj-row--flash { animation: wp-inj-flash var(--wp-motion-pulse) ease-out; }
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
  border-radius: min(2px, var(--wp-radius-cap, 999px));
  background: color-mix(in oklab, var(--wp-text3) 18%, transparent);
  color: var(--wp-text2);
  flex-shrink: 0;
  max-width: 96px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* Template-active recolor — when a row has a template, the slot chip
 * shares the accent tint with the `tpl` summary badge so a collapsed
 * row (summary hidden) still signals "this row transforms its value".
 * Matches `.wp-inj-summary__tpl-badge` so the two read as the same
 * visual family. */
.wp-inj-row.wp-inj-row--has-template .wp-inj-slot {
  background: color-mix(in srgb, var(--wp-accent) 18%, transparent);
  color: var(--wp-accent);
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
 * → src/components/shared/row-primitives.css.
 * The shared file is imported at the top of this scoped block. */

/* Injector-specific badge truncation. The shared .wp-conflict-badge
 * doesn't truncate by default (Context's row has flex:1 module name
 * absorbing slack). Injector's row layout puts the binding right next
 * to the badge, so a long label can squeeze the binding input. Cap
 * + ellipsis prevents that. */
.wp-conflict-badge {
  max-width: 88px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex-shrink: 1;
}

/* Binding field: takes the row's slack, floored at 80px so siblings
 * (conflict badge, action cluster) can't squash it; the `$` and a few
 * characters stay visible on the narrowest node. */
.wp-inj-row .wp-inj-bind { flex: 1 1 0; min-width: 80px; }

/* Row action cluster — flex row of WpIconButtons. */
.wp-row-actions { display: flex; gap: 1px; flex-shrink: 0; }

/* Summary line — base shape comes from shared `.wp-summary`. Override
 * padding-left so the preview text aligns under the slot tag instead
 * of the default ModuleRow indent (which assumes a wider leading
 * cluster). Injector's leading column = handle (6) + caret (14) +
 * toggle (12) + icon (16) + gaps (~12) ≈ 60px. */
.wp-inj-summary { padding: 2px 4px 2px 50px; }
.wp-inj-summary__prefix { color: var(--wp-accent); font-weight: 700; }
.wp-inj-summary__var    { color: var(--wp-text); font-weight: 600; }
.wp-inj-summary__sep    { color: var(--wp-text3); }
.wp-inj-summary__slot   { color: var(--wp-text2); }
.wp-inj-summary__type   { color: var(--wp-text3); }
.wp-inj-summary__empty  { color: var(--wp-warn); font-style: italic; }
.wp-inj-summary__template {
  color: var(--wp-accent);
  font-family: var(--wp-font-mono, monospace);
  /* A collapsed row summary. One line is the whole contract — a long template
     otherwise stretched the row and broke the list rhythm. */
  display: inline-block;
  max-width: 100%;
  vertical-align: bottom;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Template-active badge — small pill at the trailing edge of the
 * summary line. Mirrors the `mod`/`drift`/`missing` badge family on
 * ModuleRow so the visual language stays consistent. Color picks up
 * `--wp-accent` because template = "this row does something custom",
 * not a problem state. */
.wp-inj-summary__tpl-badge {
  flex-shrink: 0;
  font: 600 9px var(--wp-font-sans);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 1px 5px;
  border-radius: min(2px, var(--wp-radius-cap, 999px));
  background: color-mix(in srgb, var(--wp-accent) 18%, transparent);
  color: var(--wp-accent);
}

/* Send-to-negative badge: same pill, danger tint. */
.wp-inj-summary__neg-badge {
  background: color-mix(in srgb, var(--wp-danger) 18%, transparent);
  color: var(--wp-danger);
}

/* ── General-template rows ──────────────────────────────────────────
 * Accent left-stripe so a general row reads as distinct from the
 * type-colored socket rows at a glance. The `template` tag reuses the
 * slot-chip shape but with an accent tint + the wand icon. */
.wp-inj-row.wp-inj-row--general { border-left-color: var(--wp-accent); }
.wp-inj-row.wp-inj-row--general .wp-row-type-icon { color: var(--wp-accent); }
.wp-inj-slot--general {
  background: color-mix(in srgb, var(--wp-accent) 18%, transparent);
  color: var(--wp-accent);
}
</style>
