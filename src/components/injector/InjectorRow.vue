<script setup lang="ts">
import { computed } from "vue";
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
}>();

const slotLabel = computed(() => props.displayLabel ?? props.row.slot_name);

const emit = defineEmits<{
  (e: "update", patch: Partial<InjectorRow>): void;
  (e: "disconnect"): void;
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
</script>

<template>
  <div
    class="wp-inj-row"
    :data-type="(valueType ?? '').toLowerCase()"
    :class="{
      'wp-inj-row--disconnected': props.isConnected === false,
      'wp-inj-row--disabled': !row.enabled,
      'wp-conflict-info': conflictSeverity === 'info',
      'wp-conflict-warning': conflictSeverity === 'warning',
      'wp-conflict-error': conflictSeverity === 'error',
    }"
  >
    <label class="wp-inj-toggle" :title="row.enabled ? 'Disable' : 'Enable'">
      <input
        type="checkbox"
        :checked="row.enabled"
        data-test="inj-row-enabled"
        :aria-label="`enable injector row ${row._uid}`"
        @change="(ev) => emit('update', { enabled: (ev.target as HTMLInputElement).checked })"
      />
      <span class="wp-inj-toggle-mark"></span>
    </label>

    <span class="wp-inj-type-icon" aria-hidden="true">
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
      class="wp-inj-type-chip"
      data-test="inj-row-type"
    >{{ valueType.toLowerCase() }}</span>

    <div
      class="wp-vbind-wrap"
      :class="{ 'wp-vbind-wrap--empty': isEmpty }"
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

    <div class="wp-inj-actions">
      <button
        type="button"
        class="wp-inj-action"
        :class="{ 'is-active': row.internal }"
        data-test="inj-row-internal"
        :title="row.internal ? 'Internal flag active — hidden from assembler chip strip' : 'Mark internal — hide from assembler chip strip'"
        @click="emit('update', { internal: !row.internal })"
      ><i class="pi pi-globe" aria-hidden="true" /></button>
      <button
        type="button"
        class="wp-inj-action wp-inj-action--danger"
        data-test="inj-row-remove"
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

/* Type icon — color-matched to type, mirrors .wp-mod-icon from Context */
.wp-inj-type-icon {
  width: 16px;
  flex-shrink: 0;
  font-size: 11px;
  text-align: center;
  line-height: 1;
  color: var(--wp-text3);
}
.wp-inj-row[data-type="string"]       .wp-inj-type-icon { color: var(--wp-amber); }
.wp-inj-row[data-type="int"]          .wp-inj-type-icon { color: var(--wp-green); }
.wp-inj-row[data-type="float"]        .wp-inj-type-icon { color: var(--wp-var-7); }
.wp-inj-row[data-type="boolean"]      .wp-inj-type-icon { color: var(--wp-var-5); }
/* ComfyUI tensor / model types — colored from the wp-var palette to
 * stay in the same visual family as the four primitives. */
.wp-inj-row[data-type="image"]        .wp-inj-type-icon { color: var(--wp-var-1); }
.wp-inj-row[data-type="mask"]         .wp-inj-type-icon { color: var(--wp-var-6); }
.wp-inj-row[data-type="latent"]       .wp-inj-type-icon { color: var(--wp-var-4); }
.wp-inj-row[data-type="conditioning"] .wp-inj-type-icon { color: var(--wp-var-2); }
.wp-inj-row[data-type="model"]        .wp-inj-type-icon { color: var(--wp-var-8); }
.wp-inj-row[data-type="clip"]         .wp-inj-type-icon { color: var(--wp-var-3); }
.wp-inj-row[data-type="vae"]          .wp-inj-type-icon { color: var(--wp-var-6); }
.wp-inj-row[data-type="audio"]        .wp-inj-type-icon { color: var(--wp-var-7); }
.wp-inj-row[data-type="video"]        .wp-inj-type-icon { color: var(--wp-var-4); }
.wp-inj-row[data-type="noise"]        .wp-inj-type-icon { color: var(--wp-var-6); }
.wp-inj-row[data-type="sigmas"]       .wp-inj-type-icon { color: var(--wp-var-1); }
.wp-inj-row[data-type="guider"]       .wp-inj-type-icon { color: var(--wp-var-3); }
.wp-inj-row[data-type="sampler"]      .wp-inj-type-icon { color: var(--wp-var-2); }
.wp-inj-type-icon .pi { font-size: 11px; }

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

/* Type chip — same shape as Context .wp-kind-chip, color-keyed by type */
.wp-inj-type-chip {
  font: 600 9px/1.2 var(--wp-font-sans);
  text-transform: lowercase;
  letter-spacing: 0.04em;
  padding: 3px 5px;
  border-radius: 2px;
  flex-shrink: 0;
}
.wp-inj-row[data-type="string"]       .wp-inj-type-chip { background: color-mix(in oklab, var(--wp-amber)  22%, transparent); color: var(--wp-amber); }
.wp-inj-row[data-type="int"]          .wp-inj-type-chip { background: color-mix(in oklab, var(--wp-green)  22%, transparent); color: var(--wp-green); }
.wp-inj-row[data-type="float"]        .wp-inj-type-chip { background: color-mix(in oklab, var(--wp-var-7) 22%, transparent); color: var(--wp-var-7); }
.wp-inj-row[data-type="boolean"]      .wp-inj-type-chip { background: color-mix(in oklab, var(--wp-var-5) 22%, transparent); color: var(--wp-var-5); }
.wp-inj-row[data-type="image"]        .wp-inj-type-chip { background: color-mix(in oklab, var(--wp-var-1) 22%, transparent); color: var(--wp-var-1); }
.wp-inj-row[data-type="mask"]         .wp-inj-type-chip { background: color-mix(in oklab, var(--wp-var-6) 22%, transparent); color: var(--wp-var-6); }
.wp-inj-row[data-type="latent"]       .wp-inj-type-chip { background: color-mix(in oklab, var(--wp-var-4) 22%, transparent); color: var(--wp-var-4); }
.wp-inj-row[data-type="conditioning"] .wp-inj-type-chip { background: color-mix(in oklab, var(--wp-var-2) 22%, transparent); color: var(--wp-var-2); }
.wp-inj-row[data-type="model"]        .wp-inj-type-chip { background: color-mix(in oklab, var(--wp-var-8) 22%, transparent); color: var(--wp-var-8); }
.wp-inj-row[data-type="clip"]         .wp-inj-type-chip { background: color-mix(in oklab, var(--wp-var-3) 22%, transparent); color: var(--wp-var-3); }
.wp-inj-row[data-type="vae"]          .wp-inj-type-chip { background: color-mix(in oklab, var(--wp-var-6) 22%, transparent); color: var(--wp-var-6); }
.wp-inj-row[data-type="audio"]        .wp-inj-type-chip { background: color-mix(in oklab, var(--wp-var-7) 22%, transparent); color: var(--wp-var-7); }
.wp-inj-row[data-type="video"]        .wp-inj-type-chip { background: color-mix(in oklab, var(--wp-var-4) 22%, transparent); color: var(--wp-var-4); }
.wp-inj-row[data-type="noise"]        .wp-inj-type-chip { background: color-mix(in oklab, var(--wp-var-6) 22%, transparent); color: var(--wp-var-6); }
.wp-inj-row[data-type="sigmas"]       .wp-inj-type-chip { background: color-mix(in oklab, var(--wp-var-1) 22%, transparent); color: var(--wp-var-1); }
.wp-inj-row[data-type="guider"]       .wp-inj-type-chip { background: color-mix(in oklab, var(--wp-var-3) 22%, transparent); color: var(--wp-var-3); }
.wp-inj-row[data-type="sampler"]      .wp-inj-type-chip { background: color-mix(in oklab, var(--wp-var-2) 22%, transparent); color: var(--wp-var-2); }

/* Conflict dot + badge — same family as ContextWidget */
.wp-conflict-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
  cursor: help;
  border: 1px solid transparent;
}
.wp-conflict-dot--info    { background: color-mix(in oklab, var(--wp-accent) 14%, transparent); border-color: var(--wp-accent); }
.wp-conflict-dot--warning { background: color-mix(in oklab, var(--wp-amber)  14%, transparent); border-color: var(--wp-amber); }
.wp-conflict-dot--error   { background: color-mix(in oklab, var(--wp-red)    14%, transparent); border-color: var(--wp-red); }

.wp-conflict-badge {
  font: 600 9px/1 var(--wp-font-sans);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 3px 5px;
  border-radius: 2px;
  /* Cap + ellipsis so a long badge ("duplicate variable") can't
   * eat the entire binding input width. flex-shrink kicks in past
   * the cap so the row degrades gracefully on narrow nodes. */
  max-width: 88px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex-shrink: 1;
  cursor: help;
}
.wp-conflict-badge--info    { background: color-mix(in oklab, var(--wp-accent) 18%, transparent); color: var(--wp-accent); }
.wp-conflict-badge--warning { background: color-mix(in oklab, var(--wp-amber)  18%, transparent); color: var(--wp-amber); }
.wp-conflict-badge--error   { background: color-mix(in oklab, var(--wp-red)    18%, transparent); color: var(--wp-red); }

/* Actions cluster — same as Context's .wp-btn--icon-sm */
.wp-inj-actions { display: flex; gap: 1px; flex-shrink: 0; }
.wp-inj-action {
  background: transparent;
  border: 1px solid transparent;
  color: var(--wp-text-dim, var(--wp-text3));
  font: 500 11px/1 var(--wp-font-sans);
  padding: 3px;
  border-radius: var(--wp-radius, 4px);
  cursor: pointer;
  width: 20px;
  height: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: background 0.12s, border-color 0.12s, color 0.12s;
}
.wp-inj-action:hover {
  background: var(--wp-bg2);
  border-color: var(--wp-border-soft, var(--wp-border2));
  color: var(--wp-text);
}
.wp-inj-action .pi { font-size: 11px; }
.wp-inj-action.is-active {
  color: var(--wp-accent-text, var(--wp-accent));
  background: color-mix(in srgb, var(--wp-accent) 14%, transparent);
}
/* Danger variant hover — mirror .wp-btn--danger:hover from ModuleRow:
 * red icon + red-tinted border, NO bg flip. Reads as "destructive on
 * this row" without competing with the row's own hover bg. */
.wp-inj-action--danger:hover {
  background: transparent;
  color: var(--wp-danger);
  border-color: color-mix(in srgb, var(--wp-danger) 40%, var(--wp-border-soft, var(--wp-border2)));
}
</style>
