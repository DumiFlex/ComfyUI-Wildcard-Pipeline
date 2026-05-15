<script setup lang="ts">
/**
 * PipelineSteps — list of pipeline-step rows that mirrors the locked
 * design reference at `docs/design-handoff/wildcardpipeline/project/`
 * (`screens/editors.jsx:PipelineStepRow` + `styles.css:.wp-pl-row*`).
 *
 * Layout grammar (5-column grid):
 *   [22px handle] [22px toggle] [32px icon] [1fr main] [auto actions]
 *
 * The reference module-switcher is a NATIVE `<select>` styled transparent
 * so the picked module name reads as bold text with a small chevron
 * disclosure on hover. The select is always visible — there is no
 * collapse/expand toggle. Clicking opens the native dropdown of every
 * other module of the same kind, sourced from the live API list passed
 * down via `allModules`.
 *
 * Module list source: parent (`PipelineEditor.vue`) fetches the full
 * library via `api.modules.list({})` on mount and passes it down via
 * `allModules`. We re-group it here per-kind via a single computed so
 * editor doesn't have to send pre-grouped shape — keeps the parent's
 * api.client call exactly as-is and lets this component stay agnostic
 * to where the list came from.
 */
import { computed } from "vue";
import Select from "./ui/Select.vue";
import type { ModuleRow, ModuleType, PipelineStep } from "../api/types";

interface Props {
  steps: PipelineStep[];
  modulesById: Map<string, ModuleRow>;
  /** Flat list of every module the parent fetched from the API. We
   * group by kind internally so the parent doesn't carry the shape. */
  allModules: ModuleRow[];
}

const props = defineProps<Props>();
const emit = defineEmits<{
  (e: "update:steps", steps: PipelineStep[]): void;
  (e: "open-picker"): void;
}>();

interface KindMeta {
  type: ModuleType;
  label: string;
  icon: string;
  routeBase: string;
}

const KIND_META: Record<ModuleType, KindMeta> = {
  wildcard:     { type: "wildcard",     label: "Wildcard",    icon: "pi pi-sparkles",  routeBase: "/wildcards" },
  fixed_values: { type: "fixed_values", label: "Fixed Value", icon: "pi pi-tag",       routeBase: "/fixed-values" },
  combine:      { type: "combine",      label: "Combine",     icon: "pi pi-link", routeBase: "/combines" },
  derivation:   { type: "derivation",   label: "Derivation",  icon: "pi pi-arrow-right-arrow-left",      routeBase: "/derivations" },
  constraint:   { type: "constraint",   label: "Constraint",  icon: "pi pi-filter",   routeBase: "/constraints" },
  pipeline:     { type: "pipeline",     label: "Pipeline",    icon: "pi pi-list",      routeBase: "/pipelines" },
};

// Group the API-supplied module list by kind once, reactive to
// `allModules` updates so the dropdown stays in sync with whatever
// the parent re-fetches.
const modulesByKind = computed<Record<ModuleType, ModuleRow[]>>(() => {
  const groups: Record<ModuleType, ModuleRow[]> = {
    wildcard: [], fixed_values: [], combine: [],
    derivation: [], constraint: [], pipeline: [],
  };
  for (const m of props.allModules) groups[m.type]?.push(m);
  // Stable alphabetical order so the dropdown reads predictably.
  for (const arr of Object.values(groups)) {
    arr.sort((a, b) => a.name.localeCompare(b.name));
  }
  return groups;
});

function toIdent(input: string): string {
  return (input ?? "").toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
}

/**
 * `$var` summary line shown beneath the inline ref-select. Each kind
 * has a different "exported binding" shape — surfacing it lets the
 * user scan resolution order without opening every dropdown.
 *
 *   wildcard      → `$var_binding`
 *   fixed_values  → `$n1, $n2, $n3, +N`  (truncated at 3)
 *   combine       → `$output_var`
 *   derivation    → `N rule(s)`           (matches reference subtitle)
 *   constraint    → `<src> × <tgt>`       (non-$ form)
 *   pipeline      → `N step(s)`
 */
function subtitleFor(mod: ModuleRow | null): string {
  if (!mod) return "(missing reference)";
  const p = (mod.payload ?? {}) as Record<string, unknown>;
  switch (mod.type) {
    case "wildcard": {
      const b = (p.var_binding as string)?.trim() || toIdent(mod.name);
      return b ? `$${b}` : "";
    }
    case "fixed_values": {
      const values = (p.values ?? []) as { name?: string }[];
      const names = values
        .map((v) => (v.name ?? "").replace(/^\$+/, "").trim())
        .filter((n) => !!n);
      const head = names.slice(0, 3).map((n) => `$${n}`).join(", ");
      const extra = names.length > 3 ? `, +${names.length - 3}` : "";
      return head + extra;
    }
    case "combine": {
      const o = (p.output_var as string)?.replace(/^\$+/, "").trim()
        || toIdent(mod.name);
      return o ? `$${o}` : "";
    }
    case "derivation": {
      const rules = (p.rules ?? []) as unknown[];
      return `${rules.length} rule${rules.length === 1 ? "" : "s"}`;
    }
    case "constraint": {
      const src = (p.source_wildcard_id as string) ?? "";
      const tgt = (p.target_wildcard_id as string) ?? "";
      const left = props.modulesById.get(src)?.name ?? "?";
      const right = props.modulesById.get(tgt)?.name ?? "?";
      return `${left} × ${right}`;
    }
    case "pipeline": {
      const stepsCount = ((p.steps ?? []) as unknown[]).length;
      return `${stepsCount} step${stepsCount === 1 ? "" : "s"}`;
    }
    default:
      return "";
  }
}

const rows = computed(() =>
  props.steps.map((step, idx) => {
    const mod = props.modulesById.get(step.module_id) ?? null;
    const kind: ModuleType | null = mod?.type ?? null;
    const meta = kind ? KIND_META[kind] : null;
    const sameKindOptions = kind
      ? (modulesByKind.value[kind] ?? []).map((m) => ({ value: m.id, label: m.name }))
      : [];
    return {
      step,
      idx,
      mod,
      kind,
      meta,
      sameKindOptions,
      subtitle: subtitleFor(mod),
    };
  }),
);

function emitNew(next: PipelineStep[]) {
  emit("update:steps", next);
}

function toggleEnabled(idx: number) {
  const next = props.steps.map((s, i) => (i === idx ? { ...s, enabled: !s.enabled } : s));
  emitNew(next);
}

function changeModule(idx: number, moduleId: string) {
  const next = props.steps.map((s, i) => (i === idx ? { ...s, module_id: moduleId } : s));
  emitNew(next);
}

function duplicate(idx: number) {
  const src = props.steps[idx];
  if (!src) return;
  const copy: PipelineStep = {
    id: `step_${Math.random().toString(16).slice(2, 8)}`,
    module_id: src.module_id,
    enabled: src.enabled,
    ...(src.instance ? { instance: { ...src.instance } } : {}),
  };
  const next = [...props.steps];
  next.splice(idx + 1, 0, copy);
  emitNew(next);
}

function remove(idx: number) {
  const next = props.steps.filter((_, i) => i !== idx);
  emitNew(next);
}

function move(idx: number, dir: -1 | 1) {
  const j = idx + dir;
  if (j < 0 || j >= props.steps.length) return;
  const next = [...props.steps];
  [next[idx], next[j]] = [next[j], next[idx]];
  emitNew(next);
}

// ── Native HTML5 drag-and-drop reorder ──────────────────────────────
// Mirrors the reference: drag handle is the only draggable affordance,
// and we track `dragSourceIdx` + `dragOverIdx` to render the drop-line
// styling between rows. Keyboard fallback (visually-hidden up/down
// buttons + ArrowUp/Down on the focused handle) keeps the feature
// reachable without a mouse.

let dragSourceIdx: number | null = null;
import { ref as makeRef } from "vue";
const dragOverIdx = makeRef<number | null>(null);

function onDragStart(idx: number, evt: DragEvent) {
  dragSourceIdx = idx;
  if (evt.dataTransfer) {
    evt.dataTransfer.effectAllowed = "move";
    // Firefox requires setData for the drag to fire at all.
    evt.dataTransfer.setData("text/plain", String(idx));
  }
}
function onDragOver(idx: number, evt: DragEvent) {
  if (dragSourceIdx === null || dragSourceIdx === idx) return;
  evt.preventDefault();
  if (evt.dataTransfer) evt.dataTransfer.dropEffect = "move";
  if (dragOverIdx.value !== idx) dragOverIdx.value = idx;
}
function onDragLeave() {
  dragOverIdx.value = null;
}
function onDrop(idx: number, evt: DragEvent) {
  evt.preventDefault();
  const from = dragSourceIdx;
  dragSourceIdx = null;
  dragOverIdx.value = null;
  if (from === null || from === idx) return;
  const next = [...props.steps];
  const [moved] = next.splice(from, 1);
  next.splice(idx, 0, moved);
  emitNew(next);
}
function onDragEnd() {
  dragSourceIdx = null;
  dragOverIdx.value = null;
}
</script>

<template>
  <div class="wp-pl-stack" data-test="pipeline-steps">
    <div v-if="!steps.length" class="wp-empty-card">
      <i class="pi pi-list wp-pl-empty__icon" />
      <div class="wp-pl-empty__title">No modules yet</div>
      <div class="wp-pl-empty__hint">Add modules from your library; they'll resolve in order.</div>
    </div>

    <div
      v-for="row in rows"
      :key="row.step.id"
      class="wp-pl-row"
      :data-kind="row.kind ?? 'unknown'"
      :data-disabled="!row.step.enabled || null"
      :data-drag-over="dragOverIdx === row.idx || null"
      :data-test="`pipeline-step-${row.idx}`"
      draggable="true"
      @dragstart="(e) => onDragStart(row.idx, e)"
      @dragover="(e) => onDragOver(row.idx, e)"
      @dragleave="onDragLeave"
      @drop="(e) => onDrop(row.idx, e)"
      @dragend="onDragEnd"
    >
      <button
        type="button"
        class="wp-pl-row__handle"
        :aria-label="`Drag to reorder step ${row.idx + 1}`"
        :data-test="`step-handle-${row.idx}`"
        @keydown.up.prevent="move(row.idx, -1)"
        @keydown.down.prevent="move(row.idx, +1)"
      >
        <i class="pi pi-bars" aria-hidden="true" />
      </button>

      <button
        type="button"
        class="wp-pl-row__toggle"
        :aria-label="row.step.enabled
          ? `Disable step ${row.idx + 1}`
          : `Enable step ${row.idx + 1}`"
        :aria-pressed="row.step.enabled"
        :data-test="`step-toggle-${row.idx}`"
        @click="toggleEnabled(row.idx)"
      >
        <i :class="row.step.enabled ? 'pi pi-eye' : 'pi pi-eye-slash'" />
      </button>

      <div class="wp-pl-row__icon" aria-hidden="true">
        <i :class="row.meta?.icon ?? 'pi pi-circle'" />
      </div>

      <div class="wp-pl-row__main">
        <div class="wp-pl-row__top">
          <span class="wp-pl-row__kind">
            {{ (row.meta?.label ?? "Unknown").toUpperCase() }}
          </span>
          <span class="wp-pl-row__index">
            {{ String(row.idx + 1).padStart(2, "0") }}
          </span>
        </div>

        <!-- Module-switcher dropdown — uses the shared Select component
             so it matches the styling of every other dropdown in the
             editors (Combine, Constraint, Derivation, etc.) instead of
             rolling its own transparent native select. The original
             design reference used a styled native <select>, but for
             cross-editor visual consistency we route through `Select`. -->
        <div class="wp-pl-row__name">
          <Select
            v-if="row.kind"
            size="sm"
            :model-value="row.step.module_id"
            :options="row.sameKindOptions"
            :placeholder="`Pick a ${row.meta?.label.toLowerCase()}`"
            :aria-label="`Pick reference for step ${row.idx + 1}`"
            class="wp-pl-row__refselect"
            :data-test="`step-ref-${row.idx}`"
            @update:model-value="(v) => changeModule(row.idx, v as string)"
          />
          <span v-else class="wp-pl-row__missing">(missing reference)</span>
          <a
            v-if="row.mod && row.meta"
            :href="`#${row.meta.routeBase}/${row.mod.id}/edit`"
            target="_blank"
            rel="noopener"
            class="wp-pl-row__namelink"
            :aria-label="`Open ${row.mod.name} in editor`"
            :data-test="`step-name-link-${row.idx}`"
          >
            <i class="pi pi-external-link" aria-hidden="true" />
          </a>
        </div>

        <div class="wp-pl-row__sub">{{ row.subtitle }}</div>
      </div>

      <div class="wp-pl-row__actions">
        <button
          type="button"
          class="wp-pl-row__act"
          aria-label="Duplicate step"
          :data-test="`step-duplicate-${row.idx}`"
          @click="duplicate(row.idx)"
        >
          <i class="pi pi-clone" />
        </button>
        <button
          type="button"
          class="wp-pl-row__act wp-pl-row__act--danger"
          aria-label="Remove step"
          :data-test="`step-remove-${row.idx}`"
          @click="remove(row.idx)"
        >
          <i class="pi pi-times" />
        </button>
      </div>

      <!-- Visually-hidden keyboard-fallback move buttons. The drag
           handle is the canonical reorder UI but these stay in the DOM
           for screen readers and to keep the existing test-suite click
           selectors working without synthesizing drag events. -->
      <button
        type="button"
        class="wp-visually-hidden"
        :data-test="`step-up-${row.idx}`"
        :disabled="row.idx === 0"
        @click="move(row.idx, -1)"
      >Move up</button>
      <button
        type="button"
        class="wp-visually-hidden"
        :data-test="`step-down-${row.idx}`"
        :disabled="row.idx === steps.length - 1"
        @click="move(row.idx, +1)"
      >Move down</button>
    </div>

    <button
      type="button"
      class="wp-pl-add"
      data-test="pipeline-add-step"
      @click="emit('open-picker')"
    >
      <i class="pi pi-plus" />
      <span>add module</span>
    </button>
  </div>
</template>

<style scoped>
.wp-pl-stack {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.wp-pl-empty__icon  { font-size: 22px; color: var(--wp-text-dim); }
.wp-pl-empty__title { font-size: 13px; font-weight: 500; margin-top: 6px; color: var(--wp-text-muted); }
.wp-pl-empty__hint  { font-size: 12px; color: var(--wp-text-dim); }

.wp-visually-hidden {
  position: absolute;
  width: 1px; height: 1px;
  padding: 0; margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

/* ── Step row (mirrors reference ── 5-col grid) ─────────────────── */

.wp-pl-row {
  display: grid;
  grid-template-columns: 22px 22px 32px 1fr auto;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  background: var(--wp-bg-2);
  border: 1px solid var(--wp-border);
  border-left: var(--wp-kind-stripe-w, 3px) solid var(--step-color, var(--wp-accent-500));
  border-radius: var(--wp-radius);
  transition:
    border-color 120ms ease,
    background 120ms ease,
    transform 120ms ease,
    opacity 120ms ease;
}
.wp-pl-row[data-kind="wildcard"]     { --step-color: var(--wp-kind-wildcard); }
.wp-pl-row[data-kind="fixed_values"] { --step-color: var(--wp-kind-fixed); }
.wp-pl-row[data-kind="combine"]      { --step-color: var(--wp-kind-combine); }
.wp-pl-row[data-kind="derivation"]   { --step-color: var(--wp-kind-derivation); }
.wp-pl-row[data-kind="constraint"]   { --step-color: var(--wp-kind-constraint); }
.wp-pl-row[data-kind="pipeline"]     { --step-color: var(--wp-kind-pipeline); }

.wp-pl-row:hover {
  border-color: var(--wp-border-strong, var(--wp-border));
  background: var(--wp-bg-3);
}
.wp-pl-row[data-disabled] { opacity: 0.5; }
.wp-pl-row[data-disabled] .wp-pl-row__refselect { text-decoration: line-through; }
.wp-pl-row[data-drag-over] {
  box-shadow: 0 -2px 0 var(--wp-accent-500);
}

/* drag handle */
.wp-pl-row__handle {
  display: flex; align-items: center; justify-content: center;
  width: 22px; height: 22px;
  color: var(--wp-text-dim);
  cursor: grab;
  border: none;
  background: transparent;
  border-radius: 4px;
  user-select: none;
  padding: 0;
}
.wp-pl-row__handle:hover { color: var(--wp-text); background: var(--wp-bg-3); }
.wp-pl-row__handle:active { cursor: grabbing; }
.wp-pl-row__handle:focus-visible {
  outline: 2px solid var(--wp-accent-500);
  outline-offset: 1px;
}

/* enable/disable toggle */
.wp-pl-row__toggle {
  width: 22px; height: 22px;
  display: flex; align-items: center; justify-content: center;
  border: 1px solid var(--wp-border);
  background: var(--wp-bg);
  border-radius: 4px;
  color: var(--wp-text-muted);
  cursor: pointer;
  padding: 0;
  font-size: 11px;
  transition: background 120ms ease, color 120ms ease, border-color 120ms ease;
}
.wp-pl-row__toggle:hover {
  background: var(--wp-bg-3);
  color: var(--wp-text);
  border-color: var(--wp-border-strong, var(--wp-border));
}

/* kind icon */
.wp-pl-row__icon {
  width: 32px; height: 32px;
  border-radius: var(--wp-radius-sm, 6px);
  display: flex; align-items: center; justify-content: center;
  background: color-mix(in oklab, var(--step-color, var(--wp-accent-500)) 16%, var(--wp-bg-3));
  color: var(--step-color, var(--wp-text));
  flex-shrink: 0;
  font-size: 14px;
}

/* main column */
.wp-pl-row__main {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.wp-pl-row__top {
  display: flex; align-items: center; gap: 8px;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--wp-text-muted);
  font-weight: 500;
}
.wp-pl-row__kind { color: var(--step-color, var(--wp-text-muted)); }
.wp-pl-row__index {
  margin-left: auto;
  font-family: var(--wp-font-mono, ui-monospace, monospace);
  font-size: 10.5px;
  padding: 1px 5px;
  border-radius: 3px;
  background: var(--wp-bg);
  border: 1px solid var(--wp-border);
  color: var(--wp-text-dim);
}
.wp-pl-row__name {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.wp-pl-row__namelink {
  flex-shrink: 0;
  color: var(--wp-text-dim);
  text-decoration: none;
  width: 18px; height: 18px;
  display: flex; align-items: center; justify-content: center;
  border-radius: 3px;
  font-size: 10px;
}
.wp-pl-row__namelink:hover { color: var(--wp-text); background: var(--wp-bg-3); }
.wp-pl-row__missing {
  color: var(--wp-danger, #ef4444);
  font-style: italic;
  font-size: 13.5px;
}
.wp-pl-row__sub {
  font-size: 11.5px;
  color: var(--wp-text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-family: var(--wp-font-mono, ui-monospace, monospace);
}

/* Shared Select component sits inside .wp-pl-row__name; let it grow to
   fill the main column with `flex: 1` so the picked option label has
   horizontal room to read instead of being cropped. */
.wp-pl-row__refselect {
  flex: 1;
  min-width: 0;
}

/* row actions */
.wp-pl-row__actions {
  display: flex;
  align-items: center;
  gap: 2px;
}
.wp-pl-row__act {
  width: 26px; height: 26px;
  display: flex; align-items: center; justify-content: center;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 4px;
  color: var(--wp-text-muted);
  cursor: pointer;
  font-size: 12px;
  padding: 0;
  transition: background 120ms ease, color 120ms ease, border-color 120ms ease;
}
.wp-pl-row__act:hover {
  background: var(--wp-bg-3);
  color: var(--wp-text);
  border-color: var(--wp-border);
}
.wp-pl-row__act--danger:hover {
  background: color-mix(in oklab, var(--wp-danger, #ef4444) 16%, transparent);
  color: #fca5a5;
  border-color: color-mix(in oklab, var(--wp-danger, #ef4444) 30%, transparent);
}

/* add-step button */
.wp-pl-add {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 12px;
  width: 100%;
  border: 1px dashed var(--wp-border-strong, var(--wp-border));
  border-radius: var(--wp-radius);
  background: transparent;
  color: var(--wp-text-muted);
  font-size: 12.5px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  cursor: pointer;
  margin-top: 4px;
  transition: background-color 120ms ease, border-color 120ms ease, color 120ms ease;
}
.wp-pl-add:hover {
  border-style: solid;
  border-color: var(--wp-accent-500, var(--wp-text-muted));
  color: var(--wp-accent-text, var(--wp-text));
  background: color-mix(in oklab, var(--wp-accent-500) 7%, transparent);
}
.wp-pl-add .pi { font-size: 11px; }
</style>
