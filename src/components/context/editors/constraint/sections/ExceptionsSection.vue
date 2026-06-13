<script setup lang="ts">
/**
 * Constraint ExceptionsSection — library exception list + extras
 * section. Library rows: checkbox toggles `disabled_exception_keys`,
 * mode chip cycles 4 modes (no "disabled" — that's the row checkbox's
 * job), factor input visible on boost/reduce.
 *
 * Extras section: instance-only rows from `extra_exceptions`. Source
 * and target are editable text inputs with VarAutocompleteInput
 * dropdowns sourcing suggestions from sibling wildcards' option
 * values. 🗑 trash removes a row.
 *
 * "+ Add extra exception" button at bottom appends a blank row
 * defaulting to mode=allow factor=1.
 */
import { computed } from "vue";
import type { ModuleEntry } from "../../../../../widgets/_shared";
import { encodeKey } from "../../instance/keys";
import { patchInstance } from "../../instance/patch";
import VarAutocompleteInput from "../../../../../manager/components/VarAutocompleteInput.vue";
import RichTextPreview from "../../../../../manager/components/RichTextPreview.vue";

type Mode = "allow" | "exclude" | "boost" | "reduce";

/** Mode → glyph + label for the colored mode chips. Glyphs mirror the
 *  matrix's MODE_ICON / cellGlyph convention (boost ↑ / reduce ↓ /
 *  exclude × / allow ·) and the SPA ConstraintEditor `MODE_META`, so the
 *  whole constraint surface speaks one visual language. Colour stays in
 *  the `ex__mode-chip--{mode}` CSS classes (already token-mapped). */
const MODE_META: Record<Mode, { glyph: string; label: string }> = {
  boost: { glyph: "↑", label: "Boost" },
  reduce: { glyph: "↓", label: "Reduce" },
  exclude: { glyph: "×", label: "Exclude" },
  allow: { glyph: "·", label: "Neutral" },
};

/**
 * Engine accepts BOTH legacy (`source` / `target`) and tier 2
 * (`source_value` / `target_value`) library exception shapes — see
 * `engine/modules/constraint_handler.py:154`. UI must mirror the
 * fallback chain so exceptions authored against either shape render
 * correctly + key consistently into instance override maps.
 *
 * Extras are always written by us as tier 2, so they use a stricter
 * shape (matches engine `extra_exceptions` validator).
 */
interface LibraryException {
  source_value?: string;
  target_value?: string;
  source?: string;
  target?: string;
  source_id?: string;
  target_id?: string;
  mode: Mode;
  factor: number;
}

interface ExtraException {
  source_value: string;
  target_value: string;
  mode: Mode;
  factor: number;
}

function excSrc(
  exc: LibraryException | ExtraException,
  sourceOptionsById?: ReadonlyMap<string, string>,
): string {
  const v = exc as LibraryException;
  // Tier-2 (`source_value`) wins → legacy (`source`) → id-resolved
  // fallback. Some library payloads stored only the stable id without
  // re-syncing the value string after an upstream option rename. The
  // canvas modal passes an id→value map so we can recover the human
  // value without surfacing an empty chip.
  if (typeof v.source_value === "string" && v.source_value) return v.source_value;
  if (typeof v.source === "string" && v.source) return v.source;
  if (typeof v.source_id === "string" && sourceOptionsById) {
    return sourceOptionsById.get(v.source_id) ?? "";
  }
  return "";
}
function excTgt(
  exc: LibraryException | ExtraException,
  targetOptionsById?: ReadonlyMap<string, string>,
): string {
  const v = exc as LibraryException;
  if (typeof v.target_value === "string" && v.target_value) return v.target_value;
  if (typeof v.target === "string" && v.target) return v.target;
  if (typeof v.target_id === "string" && targetOptionsById) {
    return targetOptionsById.get(v.target_id) ?? "";
  }
  return "";
}

const props = withDefaults(defineProps<{
  module: ModuleEntry;
  sourceValues: readonly string[];
  targetValues: readonly string[];
  /** True when the source / target wildcard has an is_null option.
   *  Drives the pi-ban chip render on library rows whose source/target
   *  value is the empty string — without this flag the row would
   *  display as blank text. The parent modal computes these by
   *  inspecting the catalog payload. */
  sourceHasNull?: boolean;
  targetHasNull?: boolean;
  /** Per-option id → value lookup used as a fallback when an
   *  exception payload's `source` / `target` strings are missing but
   *  `source_id` / `target_id` are present. Caller builds these from
   *  the catalog payload of the source / target wildcards. */
  sourceOptionsById?: ReadonlyMap<string, string>;
  targetOptionsById?: ReadonlyMap<string, string>;
  /** Wildcard uuid → display name. Used by `RichTextPreview` so
   *  embedded `@{uuid}` nested-ref tokens inside exception values
   *  render as the same purple ref chip the value editor shows — not
   *  raw `@{c0f09840}` text. Built by the parent modal from the
   *  Context's wildcard catalog. */
  uuidToName?: ReadonlyMap<string, string>;
  /** Read-only recovery view: the source/target wildcard was deleted, so
   *  the exception list is a snapshot for understanding only — static
   *  colored chips, values as text, no edit controls. Reattach a live
   *  wildcard (banner above) to edit. Mirrors the SPA ConstraintEditor's
   *  stranded read-only exceptions table. */
  stranded?: boolean;
}>(), {
  sourceHasNull: false,
  targetHasNull: false,
  sourceOptionsById: () => new Map(),
  targetOptionsById: () => new Map(),
  uuidToName: () => new Map(),
  stranded: false,
});
const emit = defineEmits<{ "update": [patch: Partial<ModuleEntry>] }>();

const libraryExceptions = computed<LibraryException[]>(() => {
  const p = (props.module.payload ?? {}) as { exceptions?: LibraryException[] };
  return p.exceptions ?? [];
});

const instance = computed(() => props.module.instance ?? {});

const disabledKeys = computed<Set<string>>(
  () => new Set(instance.value.disabled_exception_keys ?? []),
);
const modeOverrides = computed<Record<string, Mode>>(
  () => (instance.value.exception_mode_overrides as Record<string, Mode> | null) ?? {},
);
const factorOverrides = computed<Record<string, number>>(
  () => (instance.value.exception_factor_overrides as Record<string, number> | null) ?? {},
);
const extras = computed<ExtraException[]>(
  () => (instance.value.extra_exceptions as ExtraException[] | null) ?? [],
);

function libKey(exc: LibraryException): string {
  return encodeKey([excSrc(exc, props.sourceOptionsById), excTgt(exc, props.targetOptionsById)]);
}

function effectiveMode(exc: LibraryException): Mode {
  return modeOverrides.value[libKey(exc)] ?? exc.mode;
}

function effectiveFactor(exc: LibraryException): number {
  return factorOverrides.value[libKey(exc)] ?? exc.factor;
}

const MODE_CYCLE: Record<Mode, Mode> = {
  allow: "exclude",
  exclude: "boost",
  boost: "reduce",
  reduce: "allow",
};

/**
 * Checkbox semantic: checked = enabled (active). Empty
 * `disabled_exception_keys` after Reset overrides → all checked.
 * Engine still reads the disabled set; UI just inverts polarity to
 * match the convention every other enable/disable toggle in the app
 * uses (wildcard option enabled, fixed_values row enabled, …).
 */
function onLibCheckboxChange(exc: LibraryException, checked: boolean): void {
  const key = libKey(exc);
  const set = new Set(instance.value.disabled_exception_keys ?? []);
  if (checked) set.delete(key);
  else set.add(key);
  emit("update", patchInstance(props.module, "disabled_exception_keys",
    set.size === 0 ? null : Array.from(set),
  ));
}

function onLibModeCycle(exc: LibraryException): void {
  const key = libKey(exc);
  const next = MODE_CYCLE[effectiveMode(exc)];
  const map = { ...modeOverrides.value };
  if (next === exc.mode) {
    delete map[key];
  } else {
    map[key] = next;
  }
  emit("update", patchInstance(props.module, "exception_mode_overrides",
    Object.keys(map).length > 0 ? map : null,
  ));
}

function onLibFactorChange(exc: LibraryException, ev: Event): void {
  const raw = Number((ev.target as HTMLInputElement).value);
  if (!Number.isFinite(raw) || raw < 0) return;
  // Snap to 3 decimals so float-fuzz tails (from native arrow step,
  // autofill, etc.) never leak into stored overrides. Honours legit
  // 2-decimal precision a user might explicitly type.
  const value = Math.round(raw * 1000) / 1000;
  const key = libKey(exc);
  const map = { ...factorOverrides.value };
  if (value === exc.factor) {
    delete map[key];
  } else {
    map[key] = value;
  }
  emit("update", patchInstance(props.module, "exception_factor_overrides",
    Object.keys(map).length > 0 ? map : null,
  ));
}

/** Arrow-key / wheel handlers for both the library and extra factor
 *  inputs — route through the rounded `bumpLibFactor` / `bumpExtraFactor`
 *  helpers so native browser float-step doesn't surface fuzz. */
function onLibFactorKeydown(exc: LibraryException, ev: KeyboardEvent): void {
  if (ev.key === "ArrowUp") { ev.preventDefault(); bumpLibFactor(exc, 1); }
  else if (ev.key === "ArrowDown") { ev.preventDefault(); bumpLibFactor(exc, -1); }
}
function onLibFactorWheel(exc: LibraryException, ev: WheelEvent): void {
  const target = ev.target as HTMLInputElement;
  if (document.activeElement !== target) return;
  ev.preventDefault();
  bumpLibFactor(exc, ev.deltaY < 0 ? 1 : -1);
}
function onExtraFactorKeydown(idx: number, ev: KeyboardEvent): void {
  if (ev.key === "ArrowUp") { ev.preventDefault(); bumpExtraFactor(idx, 1); }
  else if (ev.key === "ArrowDown") { ev.preventDefault(); bumpExtraFactor(idx, -1); }
}
function onExtraFactorWheel(idx: number, ev: WheelEvent): void {
  const target = ev.target as HTMLInputElement;
  if (document.activeElement !== target) return;
  ev.preventDefault();
  bumpExtraFactor(idx, ev.deltaY < 0 ? 1 : -1);
}

// ── Extras ─────────────────────────────────────────────────────────

function onExtraFieldChange(idx: number, field: keyof ExtraException, value: string | number): void {
  const next = extras.value.map((e, i) => (i === idx ? { ...e, [field]: value } : e));
  emit("update", patchInstance(props.module, "extra_exceptions",
    next.length > 0 ? next : null,
  ));
}

function onExtraModeCycle(idx: number): void {
  const exc = extras.value[idx];
  if (!exc) return;
  onExtraFieldChange(idx, "mode", MODE_CYCLE[exc.mode]);
}

function onExtraTrash(idx: number): void {
  const next = extras.value.filter((_, i) => i !== idx);
  emit("update", patchInstance(props.module, "extra_exceptions",
    next.length > 0 ? next : null,
  ));
}

function onAddExtra(): void {
  const next: ExtraException[] = [
    ...extras.value,
    { source_value: "", target_value: "", mode: "allow", factor: 1 },
  ];
  emit("update", patchInstance(props.module, "extra_exceptions", next));
}

// Spinner step — match wildcard OptionRow.WEIGHT_STEP. Round to 1
// decimal so 1.0 ± 0.1 doesn't drift to floating-point noise.
const FACTOR_STEP = 0.1;

function bumpLibFactor(exc: LibraryException, dir: 1 | -1): void {
  const next = Math.max(0, Math.round((effectiveFactor(exc) + dir * FACTOR_STEP) * 10) / 10);
  const key = libKey(exc);
  const map = { ...factorOverrides.value };
  if (next === exc.factor) {
    delete map[key];
  } else {
    map[key] = next;
  }
  emit("update", patchInstance(props.module, "exception_factor_overrides",
    Object.keys(map).length > 0 ? map : null,
  ));
}

function bumpExtraFactor(idx: number, dir: 1 | -1): void {
  const exc = extras.value[idx];
  if (!exc) return;
  const next = Math.max(0, Math.round((exc.factor + dir * FACTOR_STEP) * 10) / 10);
  onExtraFieldChange(idx, "factor", next);
}
</script>

<template>
  <section class="ex" data-test="ex-section">
    <div class="ex__label">Exceptions</div>

    <div
      v-for="(exc, i) in libraryExceptions"
      :key="libKey(exc)"
      class="ex__row"
      :class="[
        `ex__row--${effectiveMode(exc)}`,
        { 'ex__row--off': disabledKeys.has(libKey(exc)) },
      ]"
      :data-test="`ex-row-${i}`"
    >
      <!-- Styled checkbox matching OptionRow's wildcard pattern — a
           role-checkbox span with inline SVG tick. Replaces the bare
           native input for visual parity with the wildcard / fixed-
           values edit modals. Hidden when stranded: a broken constraint
           is a read-only snapshot, so the enable/disable toggle is gone. -->
      <span
        v-if="!stranded"
        class="ex__check"
        :class="{ 'ex__check--on': !disabledKeys.has(libKey(exc)) }"
        :data-test="`ex-cb-${i}`"
        role="checkbox"
        :aria-checked="!disabledKeys.has(libKey(exc))"
        tabindex="0"
        aria-label="Enable this exception"
        @click="onLibCheckboxChange(exc, disabledKeys.has(libKey(exc)))"
        @keydown.space.prevent="onLibCheckboxChange(exc, disabledKeys.has(libKey(exc)))"
        @keydown.enter.prevent="onLibCheckboxChange(exc, disabledKeys.has(libKey(exc)))"
      >
        <svg
          v-if="!disabledKeys.has(libKey(exc))"
          class="ex__check-tick"
          width="8"
          height="8"
          viewBox="0 0 12 12"
          aria-hidden="true"
        >
          <path d="M2.5 6.5 L5 9 L9.5 3.5"
                fill="none" stroke="currentColor" stroke-width="2"
                stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </span>
      <span class="ex__pair">
        <span class="ex__src">
          <span
            v-if="excSrc(exc, props.sourceOptionsById) === '' && sourceHasNull"
            class="ex__null-chip"
            aria-label="null option (resolves to empty)"
          >
            <i class="pi pi-ban" aria-hidden="true" />
            <span>null</span>
          </span>
          <RichTextPreview
            v-else
            :value="excSrc(exc, props.sourceOptionsById)"
            :uuid-to-name="uuidToName"
            surface="wildcard"
          />
        </span>
        <span class="ex__arrow">→</span>
        <span class="ex__tgt">
          <span
            v-if="excTgt(exc, props.targetOptionsById) === '' && targetHasNull"
            class="ex__null-chip"
            aria-label="null option (resolves to empty)"
          >
            <i class="pi pi-ban" aria-hidden="true" />
            <span>null</span>
          </span>
          <RichTextPreview
            v-else
            :value="excTgt(exc, props.targetOptionsById)"
            :uuid-to-name="uuidToName"
            surface="wildcard"
          />
        </span>
      </span>
      <!-- Editable: click-to-cycle chip with glyph + label. Read-only
           (stranded): the same colored chip as a static span — no cycle. -->
      <button
        v-if="!stranded"
        type="button"
        class="ex__mode-chip"
        :class="`ex__mode-chip--${effectiveMode(exc)}`"
        :data-test="`ex-mode-${i}`"
        @click="onLibModeCycle(exc)"
      >
        <span class="ex__mode-glyph" aria-hidden="true">{{ MODE_META[effectiveMode(exc)].glyph }}</span>
        {{ MODE_META[effectiveMode(exc)].label }}
      </button>
      <span
        v-else
        class="ex__mode-chip ex__mode-chip--ro"
        :class="`ex__mode-chip--${effectiveMode(exc)}`"
        :data-test="`ex-mode-ro-${i}`"
      >
        <span class="ex__mode-glyph" aria-hidden="true">{{ MODE_META[effectiveMode(exc)].glyph }}</span>
        {{ MODE_META[effectiveMode(exc)].label }}
      </span>
      <!-- Factor: editable spinner when healthy; static ×N text when stranded. -->
      <span
        v-if="stranded && (effectiveMode(exc) === 'boost' || effectiveMode(exc) === 'reduce')"
        class="ex__factor-ro"
        :data-test="`ex-factor-ro-${i}`"
      >×{{ effectiveFactor(exc) }}</span>
      <span
        v-else-if="effectiveMode(exc) === 'boost' || effectiveMode(exc) === 'reduce'"
        class="ex__factor-wrap"
        @wheel.stop
      >
        <input
          type="number"
          step="0.1"
          min="0"
          class="ex__factor-input"
          :data-test="`ex-factor-${i}`"
          aria-label="Exception factor"
          :value="effectiveFactor(exc)"
          @change="(ev) => onLibFactorChange(exc, ev)"
          @keydown="(ev) => onLibFactorKeydown(exc, ev as KeyboardEvent)"
          @wheel="(ev) => onLibFactorWheel(exc, ev as WheelEvent)"
        />
        <span class="ex__spin">
          <button
            type="button"
            class="ex__spin-btn"
            tabindex="-1"
            :aria-label="`Increase factor for ${excSrc(exc, props.sourceOptionsById)} → ${excTgt(exc, props.targetOptionsById)}`"
            @click="bumpLibFactor(exc, 1)"
          ><svg width="6" height="4" viewBox="0 0 8 5" aria-hidden="true">
            <path d="M0 5 L4 0 L8 5 Z" fill="currentColor" />
          </svg></button>
          <button
            type="button"
            class="ex__spin-btn"
            tabindex="-1"
            :aria-label="`Decrease factor for ${excSrc(exc, props.sourceOptionsById)} → ${excTgt(exc, props.targetOptionsById)}`"
            @click="bumpLibFactor(exc, -1)"
          ><svg width="6" height="4" viewBox="0 0 8 5" aria-hidden="true">
            <path d="M0 0 L4 5 L8 0 Z" fill="currentColor" />
          </svg></button>
        </span>
      </span>
    </div>

    <div
      v-for="(exc, i) in extras"
      :key="`extra-${i}`"
      class="ex__row ex__row--extra"
      :class="`ex__row--${exc.mode}`"
      :data-test="`ex-extra-${i}`"
    >
      <span class="ex__extra-badge" data-test="ex-extra-badge">extra</span>
      <!-- Editable inputs when healthy; read-only chips when stranded.
           A stranded constraint is a snapshot, so extras lock alongside
           the library rows (matches the SPA read-only exceptions table). -->
      <template v-if="stranded">
        <span class="ex__pair">
          <span class="ex__src"><RichTextPreview :value="excSrc(exc, props.sourceOptionsById)" :uuid-to-name="uuidToName" surface="wildcard" /></span>
          <span class="ex__arrow">→</span>
          <span class="ex__tgt"><RichTextPreview :value="excTgt(exc, props.targetOptionsById)" :uuid-to-name="uuidToName" surface="wildcard" /></span>
        </span>
        <span
          class="ex__mode-chip ex__mode-chip--ro"
          :class="`ex__mode-chip--${exc.mode}`"
          :data-test="`ex-extra-mode-ro-${i}`"
        >
          <span class="ex__mode-glyph" aria-hidden="true">{{ MODE_META[exc.mode].glyph }}</span>
          {{ MODE_META[exc.mode].label }}
        </span>
        <span
          v-if="exc.mode === 'boost' || exc.mode === 'reduce'"
          class="ex__factor-ro"
        >×{{ exc.factor }}</span>
      </template>
      <template v-else>
      <VarAutocompleteInput
        :model-value="excSrc(exc, props.sourceOptionsById)"
        :suggestions="[...sourceValues]"
        :data-test="`ex-extra-src-${i}`"
        placeholder="source"
        aria-label="Extra exception source"
        @update:model-value="(v) => onExtraFieldChange(i, 'source_value', v)"
      />
      <span class="ex__arrow">→</span>
      <VarAutocompleteInput
        :model-value="excTgt(exc, props.targetOptionsById)"
        :suggestions="[...targetValues]"
        :data-test="`ex-extra-tgt-${i}`"
        placeholder="target"
        aria-label="Extra exception target"
        @update:model-value="(v) => onExtraFieldChange(i, 'target_value', v)"
      />
      <button
        type="button"
        class="ex__mode-chip"
        :class="`ex__mode-chip--${exc.mode}`"
        @click="onExtraModeCycle(i)"
      >
        <span class="ex__mode-glyph" aria-hidden="true">{{ MODE_META[exc.mode].glyph }}</span>
        {{ MODE_META[exc.mode].label }}
      </button>
      <span
        v-if="exc.mode === 'boost' || exc.mode === 'reduce'"
        class="ex__factor-wrap"
        @wheel.stop
      >
        <input
          type="number"
          step="0.1"
          min="0"
          class="ex__factor-input"
          aria-label="Extra factor"
          :value="exc.factor"
          @change="(ev) => onExtraFieldChange(i, 'factor', Math.round((Number((ev.target as HTMLInputElement).value) || 1) * 1000) / 1000)"
          @keydown="(ev) => onExtraFactorKeydown(i, ev as KeyboardEvent)"
          @wheel="(ev) => onExtraFactorWheel(i, ev as WheelEvent)"
        />
        <span class="ex__spin">
          <button
            type="button"
            class="ex__spin-btn"
            tabindex="-1"
            aria-label="Increase extra factor"
            @click="bumpExtraFactor(i, 1)"
          ><svg width="6" height="4" viewBox="0 0 8 5" aria-hidden="true">
            <path d="M0 5 L4 0 L8 5 Z" fill="currentColor" />
          </svg></button>
          <button
            type="button"
            class="ex__spin-btn"
            tabindex="-1"
            aria-label="Decrease extra factor"
            @click="bumpExtraFactor(i, -1)"
          ><svg width="6" height="4" viewBox="0 0 8 5" aria-hidden="true">
            <path d="M0 0 L4 5 L8 0 Z" fill="currentColor" />
          </svg></button>
        </span>
      </span>
      <button
        type="button"
        class="ex__trash"
        :data-test="`ex-extra-trash-${i}`"
        aria-label="Remove extra exception"
        @click="onExtraTrash(i)"
      ><i class="pi pi-trash" /></button>
      </template>
    </div>

    <button
      v-if="!stranded"
      type="button"
      class="ex__add-extra"
      data-test="ex-add-extra"
      @click="onAddExtra"
    ><i class="pi pi-plus" /> Add extra exception</button>

    <!-- Stranded snapshot has no editable list; a hint points to the
         reattach banner above (mirrors the SPA read-only exceptions). -->
    <p v-else class="ex__readonly-hint" data-test="ex-readonly-hint">
      Reattach a live wildcard to edit these exceptions.
    </p>
  </section>
</template>

<style scoped>
.ex {
  padding: 12px 16px;
  background: var(--wp-bg2);
  border-bottom: 1px solid var(--wp-border-soft, var(--wp-border));
}
.ex__label {
  font: 600 9px var(--wp-font-sans);
  text-transform: uppercase;
  letter-spacing: 0.14em;
  color: var(--wp-text-dim, var(--wp-text3));
  margin-bottom: 8px;
}
.ex__row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
  font: 11px var(--wp-font-mono);
  border-bottom: 1px dashed var(--wp-border-soft, var(--wp-border));
}
.ex__row:last-of-type { border-bottom: 0; }
.ex__row--extra {
  background: rgba(251, 146, 60, 0.06);
  border-left: 2px solid var(--wp-status-modified, #fb923c);
  padding-left: 6px;
}

/* ── Per-row mode accent — left bar + faint wash keyed to the row's
 *    effective mode, mirroring the SPA ConstraintEditor `.cn-ex-row`.
 *    Library rows only: the `--extra` orange accent owns its border-left,
 *    so its row keeps the "instance-only" cue. The `allow`/neutral case
 *    intentionally has no accent (no rule worth flagging). */
.ex__row:not(.ex__row--extra) {
  border-left: 3px solid transparent;
  padding-left: 6px;
}
.ex__row--boost:not(.ex__row--extra) {
  border-left-color: color-mix(in srgb, var(--wp-success, #22c55e) 60%, transparent);
  background: color-mix(in srgb, var(--wp-success, #22c55e) 5%, transparent);
}
.ex__row--reduce:not(.ex__row--extra) {
  border-left-color: color-mix(in srgb, var(--wp-warn, #f97316) 60%, transparent);
  background: color-mix(in srgb, var(--wp-warn, #f97316) 5%, transparent);
}
.ex__row--exclude:not(.ex__row--extra) {
  border-left-color: color-mix(in srgb, var(--wp-danger, #ef4444) 60%, transparent);
  background: color-mix(in srgb, var(--wp-danger, #ef4444) 5%, transparent);
}
.ex__pair {
  flex: 1;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
/* Source / target values use the matrix axis palette (purple source,
 * cyan target) so users see the role at a glance — same visual cue
 * the axis tags above the rule matrix use. */
.ex__src {
  color: var(--wp-constraint-source-text);
  background: color-mix(in oklab, var(--wp-constraint-source) 12%, transparent);
  padding: 1px 6px;
  border-radius: 3px;
  border: 1px solid color-mix(in oklab, var(--wp-constraint-source) 30%, transparent);
}
.ex__tgt {
  color: var(--wp-constraint-target-text);
  background: color-mix(in oklab, var(--wp-constraint-target) 12%, transparent);
  padding: 1px 6px;
  border-radius: 3px;
  border: 1px solid color-mix(in oklab, var(--wp-constraint-target) 30%, transparent);
}
.ex__arrow { color: var(--wp-text-dim, var(--wp-text3)); }

/* Styled checkbox — mirror of OptionRow's `.opt__check` pattern so
 * users see one consistent on/off control across wildcard / fixed-
 * values / constraint edit modals. */
.ex__check {
  width: 14px;
  height: 14px;
  border: 1.5px solid var(--wp-border-soft, var(--wp-border));
  border-radius: 3px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: white;
  background: var(--wp-bg);
  flex-shrink: 0;
  cursor: pointer;
}
.ex__check-tick { display: block; }
.ex__check--on {
  background: var(--wp-accent);
  border-color: var(--wp-accent);
}

/* Null-option chip — shown in the src/tgt cell when the exception
 * targets the wildcard's null option (value === ""). Visually distinct
 * from the regular src/tgt tinted spans so the special role reads
 * at a glance. */
.ex__null-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0 4px;
  color: var(--wp-text-muted, var(--wp-text2));
  font-family: var(--wp-font-mono, monospace);
}
.ex__null-chip .pi { font-size: 10px; }

/* Disabled exception — mirrors the wildcard OptionRow `.opt--off` and
 * the fixed-values ValueRow `.row--off` treatment: dimmed src/tgt
 * chips with strike-through, faded mode chip + factor input. The
 * checkbox itself stays full-opacity so it remains the obvious
 * re-enable affordance. */
.ex__row--off .ex__src,
.ex__row--off .ex__tgt {
  opacity: 0.5;
  text-decoration: line-through;
}
.ex__row--off .ex__arrow {
  opacity: 0.5;
}
.ex__row--off .ex__mode-chip {
  opacity: 0.5;
  text-decoration: line-through;
}
.ex__row--off .ex__factor-wrap {
  opacity: 0.5;
}
.ex__mode-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: transparent;
  border: 1px solid var(--wp-border);
  color: var(--wp-text);
  font: 600 9px var(--wp-font-sans);
  text-transform: uppercase;
  padding: 2px 6px;
  border-radius: 3px;
  cursor: pointer;
  white-space: nowrap;
}
/* Glyph mirrors the matrix cell icons (↑ ↓ × ·) — mono so it lines up. */
.ex__mode-glyph {
  font-family: var(--wp-font-mono, monospace);
  font-size: 11px;
  line-height: 1;
}
/* Read-only mode chip (stranded) — a static span, so kill the pointer
 * affordance; colour stays via the shared ex__mode-chip--{mode} class. */
.ex__mode-chip--ro { cursor: default; }
/* Static factor text (stranded) — the ×N the editable spinner would
 * show, rendered inert. */
.ex__factor-ro {
  font: 10px var(--wp-font-mono);
  color: var(--wp-text-muted, var(--wp-text2));
}
/* Mode chip palette mirrors the matrix legend: boost = green,
 * reduce = orange/warn, exclude = red/danger. Allow uses the accent
 * (purple-ish) because it's a "neutral pass-through" — visually distinct
 * from boost's green so users don't confuse `allow ×1` with `boost ×1.5`. */
.ex__mode-chip--allow { background: color-mix(in srgb, var(--wp-accent) 22%, transparent); color: var(--wp-accent-text, var(--wp-text)); }
.ex__mode-chip--exclude { background: color-mix(in srgb, var(--wp-danger, #e05252) 22%, transparent); color: var(--wp-danger, #e05252); }
.ex__mode-chip--boost { background: color-mix(in srgb, var(--wp-success, #6bc96f) 22%, transparent); color: var(--wp-success, #6bc96f); }
.ex__mode-chip--reduce { background: color-mix(in srgb, var(--wp-warn, #f59e0b) 22%, transparent); color: var(--wp-warn, #f59e0b); }
.ex__factor-wrap {
  display: inline-flex;
  align-items: stretch;
  background: var(--wp-bg);
  border: 1px solid var(--wp-border);
  border-radius: 2px;
  width: 64px;
  height: 22px;
  overflow: hidden;
}
.ex__factor-wrap:focus-within { border-color: var(--wp-accent); }
.ex__factor-input {
  flex: 1;
  background: transparent;
  border: 0;
  padding: 0 6px;
  font: 10px var(--wp-font-mono);
  color: var(--wp-text-muted, var(--wp-text2));
  text-align: right;
  width: 100%;
  min-width: 0;
  -moz-appearance: textfield;
}
.ex__factor-input::-webkit-outer-spin-button,
.ex__factor-input::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
.ex__factor-input:focus { outline: none; color: var(--wp-text); }
.ex__spin {
  display: flex;
  flex-direction: column;
  width: 14px;
  flex-shrink: 0;
  border-left: 1px solid var(--wp-border);
  background: var(--wp-bg-deep, var(--wp-bg));
}
.ex__spin-btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 0;
  padding: 0;
  margin: 0;
  color: var(--wp-text-dim, var(--wp-text3));
  cursor: pointer;
  line-height: 0;
}
.ex__spin-btn + .ex__spin-btn {
  border-top: 1px solid var(--wp-border);
}
.ex__spin-btn:hover { color: var(--wp-accent-text, var(--wp-text)); background: rgba(99, 102, 241, 0.10); }
.ex__extra-badge {
  font: 600 8px var(--wp-font-sans);
  text-transform: uppercase;
  padding: 1px 5px;
  border-radius: 2px;
  background: color-mix(in srgb, var(--wp-status-modified, #fb923c) 22%, transparent);
  color: var(--wp-status-modified, #fb923c);
}
.ex__trash {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  background: color-mix(in srgb, var(--wp-text) 3%, transparent);
  border: 1px solid var(--wp-border);
  border-radius: 4px;
  color: var(--wp-text-dim, var(--wp-text3));
  cursor: pointer;
  font-size: 11px;
  flex-shrink: 0;
  transition: background 0.12s, border-color 0.12s, color 0.12s;
}
.ex__trash:hover {
  background: color-mix(in srgb, var(--wp-danger, #e05252) 18%, transparent);
  border-color: color-mix(in srgb, var(--wp-danger, #e05252) 50%, transparent);
  color: var(--wp-danger, #e05252);
}
.ex__trash:active {
  background: color-mix(in srgb, var(--wp-danger, #e05252) 30%, transparent);
}
.ex__trash .pi { font-size: 11px; line-height: 1; }
.ex__add-extra {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  background: transparent;
  border: 1px dashed var(--wp-border);
  color: var(--wp-text-muted, var(--wp-text2));
  padding: 5px 10px;
  font: 11px var(--wp-font-sans);
  border-radius: 3px;
  cursor: pointer;
  margin-top: 8px;
}
.ex__add-extra:hover {
  border-color: var(--wp-accent);
  color: var(--wp-accent-text, var(--wp-text));
}
.ex__add-extra .pi { font-size: 10px; }
.ex__readonly-hint {
  margin: 8px 0 0;
  font: 10px var(--wp-font-sans);
  color: var(--wp-text-dim, var(--wp-text3));
}
</style>
