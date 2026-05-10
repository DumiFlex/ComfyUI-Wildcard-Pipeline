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

type Mode = "allow" | "exclude" | "boost" | "reduce";

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
  mode: Mode;
  factor: number;
}

interface ExtraException {
  source_value: string;
  target_value: string;
  mode: Mode;
  factor: number;
}

function excSrc(exc: LibraryException | ExtraException): string {
  const v = exc as LibraryException;
  return v.source_value ?? v.source ?? "";
}
function excTgt(exc: LibraryException | ExtraException): string {
  const v = exc as LibraryException;
  return v.target_value ?? v.target ?? "";
}

const props = defineProps<{
  module: ModuleEntry;
  sourceValues: readonly string[];
  targetValues: readonly string[];
}>();
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
  return encodeKey([excSrc(exc), excTgt(exc)]);
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
  const value = Number((ev.target as HTMLInputElement).value);
  if (!Number.isFinite(value) || value < 0) return;
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

    <div v-for="(exc, i) in libraryExceptions" :key="libKey(exc)" class="ex__row" :data-test="`ex-row-${i}`">
      <input
        type="checkbox"
        :data-test="`ex-cb-${i}`"
        aria-label="Enable this exception"
        :checked="!disabledKeys.has(libKey(exc))"
        @change="(ev) => onLibCheckboxChange(exc, (ev.target as HTMLInputElement).checked)"
      />
      <span class="ex__pair">{{ excSrc(exc) }} → {{ excTgt(exc) }}</span>
      <button
        type="button"
        class="ex__mode-chip"
        :class="`ex__mode-chip--${effectiveMode(exc)}`"
        :data-test="`ex-mode-${i}`"
        @click="onLibModeCycle(exc)"
      >{{ effectiveMode(exc) }}</button>
      <span
        v-if="effectiveMode(exc) === 'boost' || effectiveMode(exc) === 'reduce'"
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
        />
        <span class="ex__spin">
          <button
            type="button"
            class="ex__spin-btn"
            tabindex="-1"
            :aria-label="`Increase factor for ${excSrc(exc)} → ${excTgt(exc)}`"
            @click="bumpLibFactor(exc, 1)"
          ><svg width="6" height="4" viewBox="0 0 8 5" aria-hidden="true">
            <path d="M0 5 L4 0 L8 5 Z" fill="currentColor" />
          </svg></button>
          <button
            type="button"
            class="ex__spin-btn"
            tabindex="-1"
            :aria-label="`Decrease factor for ${excSrc(exc)} → ${excTgt(exc)}`"
            @click="bumpLibFactor(exc, -1)"
          ><svg width="6" height="4" viewBox="0 0 8 5" aria-hidden="true">
            <path d="M0 0 L4 5 L8 0 Z" fill="currentColor" />
          </svg></button>
        </span>
      </span>
    </div>

    <div v-for="(exc, i) in extras" :key="`extra-${i}`" class="ex__row ex__row--extra" :data-test="`ex-extra-${i}`">
      <span class="ex__extra-badge" data-test="ex-extra-badge">extra</span>
      <VarAutocompleteInput
        :model-value="excSrc(exc)"
        :suggestions="[...sourceValues]"
        :data-test="`ex-extra-src-${i}`"
        placeholder="source"
        aria-label="Extra exception source"
        @update:model-value="(v) => onExtraFieldChange(i, 'source_value', v)"
      />
      <span class="ex__arrow">→</span>
      <VarAutocompleteInput
        :model-value="excTgt(exc)"
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
      >{{ exc.mode }}</button>
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
          @change="(ev) => onExtraFieldChange(i, 'factor', Number((ev.target as HTMLInputElement).value) || 1)"
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
    </div>

    <button
      type="button"
      class="ex__add-extra"
      data-test="ex-add-extra"
      @click="onAddExtra"
    ><i class="pi pi-plus" /> Add extra exception</button>
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
.ex__pair { flex: 1; }
.ex__arrow { color: var(--wp-text-dim, var(--wp-text3)); }
.ex__mode-chip {
  background: transparent;
  border: 1px solid var(--wp-border);
  color: var(--wp-text);
  font: 600 9px var(--wp-font-sans);
  text-transform: uppercase;
  padding: 2px 6px;
  border-radius: 3px;
  cursor: pointer;
}
.ex__mode-chip--allow { background: color-mix(in srgb, var(--wp-success, #6bc96f) 22%, transparent); color: var(--wp-success, #6bc96f); }
.ex__mode-chip--exclude { background: color-mix(in srgb, var(--wp-danger, #e05252) 22%, transparent); color: var(--wp-danger, #e05252); }
.ex__mode-chip--boost { background: color-mix(in srgb, var(--wp-accent) 22%, transparent); color: var(--wp-accent-text, var(--wp-text)); }
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
  background: transparent;
  border: 0;
  color: var(--wp-text-dim, var(--wp-text3));
  cursor: pointer;
  font-size: 11px;
}
.ex__trash:hover { color: var(--wp-danger, #e05252); }
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
</style>
