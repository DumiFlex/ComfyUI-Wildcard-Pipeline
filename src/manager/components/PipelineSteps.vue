<script setup lang="ts">
import { computed, reactive } from "vue";
import Select from "./ui/Select.vue";
import type { ModuleRow, ModuleType, PipelineStep } from "../api/types";

interface Props {
  steps: PipelineStep[];
  modulesById: Map<string, ModuleRow>;
  modulesByKind: Record<ModuleType, ModuleRow[]>;
}

const props = defineProps<Props>();
const emit = defineEmits<{
  (e: "update:steps", steps: PipelineStep[]): void;
  (e: "open-picker"): void;
}>();

interface KindMeta {
  type: ModuleType;
  // Singular display label per design ref ("FIXED VALUE" not "FIXED VALUES")
  // — the row already represents one module instance, plural reads odd in
  // the kind-tag chip.
  label: string;
  icon: string;
  routeBase: string;
}

const KIND_META: Record<ModuleType, KindMeta> = {
  wildcard:     { type: "wildcard",     label: "Wildcard",     icon: "pi pi-th-large",  routeBase: "/wildcards" },
  fixed_values: { type: "fixed_values", label: "Fixed Value",  icon: "pi pi-tag",       routeBase: "/fixed-values" },
  combine:      { type: "combine",      label: "Combine",      icon: "pi pi-share-alt", routeBase: "/combines" },
  derivation:   { type: "derivation",   label: "Derivation",   icon: "pi pi-code",      routeBase: "/derivations" },
  constraint:   { type: "constraint",   label: "Constraint",   icon: "pi pi-sitemap",   routeBase: "/constraints" },
  pipeline:     { type: "pipeline",     label: "Pipeline",     icon: "pi pi-list",      routeBase: "/pipelines" },
};

// Per-row expansion state. Collapsed by default — design ref shows the
// reference picker only when the user explicitly expands a row.
const expanded = reactive<Record<string, boolean>>({});

function toIdent(input: string): string {
  return (input ?? "").toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
}

/**
 * Render the row's `$var` summary line beneath the bold name.
 *
 * Each module kind has a different "exported binding" shape — the
 * subtitle surfaces what downstream steps will see appended to ctx so
 * the user can scan the resolution order without expanding every row.
 *
 *   wildcard      → `$var_binding`
 *   fixed_values  → `$name1, $name2, $name3, +N`  (truncated at 3)
 *   combine       → `$output_var`
 *   derivation    → target_var(s) the rules write, truncated at 3
 *   constraint    → `<src_uuid_short> × <tgt_uuid_short>`  (non-$ form)
 *   pipeline      → `N steps`  (no var, just a count)
 */
function subtitleFor(mod: ModuleRow | null): string {
  if (!mod) return "";
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
      const rules = (p.rules ?? []) as Array<{
        branches?: Array<{ action?: { target_var?: string } }>;
        else?: { action?: { target_var?: string } };
      }>;
      const targets = new Set<string>();
      for (const r of rules) {
        for (const b of r.branches ?? []) {
          if (b.action?.target_var) targets.add(b.action.target_var);
        }
        if (r.else?.action?.target_var) targets.add(r.else.action.target_var);
      }
      const arr = [...targets];
      const head = arr.slice(0, 3).map((n) => `$${n}`).join(", ");
      const extra = arr.length > 3 ? `, +${arr.length - 3}` : "";
      return head + extra;
    }
    case "constraint": {
      const src = (p.source_wildcard_id as string) ?? "";
      const tgt = (p.target_wildcard_id as string) ?? "";
      const srcMod = props.modulesById.get(src);
      const tgtMod = props.modulesById.get(tgt);
      const left = srcMod?.name ?? "?";
      const right = tgtMod?.name ?? "?";
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
      ? (props.modulesByKind[kind] ?? []).map((m) => ({ value: m.id, label: m.name }))
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

function toggleExpanded(stepId: string) {
  expanded[stepId] = !expanded[stepId];
}

// ── Native HTML5 drag-and-drop reorder ──────────────────────────────
// The drag handle (≡ icon) is the only draggable affordance. Dragging
// over another row reorders in real time; drop commits via emitNew.
// Keyboard reorder still works via the visually-hidden up/down buttons
// further down in the markup, which preserves test selectors and
// accessibility for non-mouse users.

let dragSourceIdx: number | null = null;

function onDragStart(idx: number, evt: DragEvent) {
  dragSourceIdx = idx;
  if (evt.dataTransfer) {
    evt.dataTransfer.effectAllowed = "move";
    // Some browsers (Firefox) require setData for the drag to fire at all.
    evt.dataTransfer.setData("text/plain", String(idx));
  }
}

function onDragOver(idx: number, evt: DragEvent) {
  if (dragSourceIdx === null || dragSourceIdx === idx) return;
  evt.preventDefault();
  if (evt.dataTransfer) evt.dataTransfer.dropEffect = "move";
}

function onDrop(idx: number, evt: DragEvent) {
  evt.preventDefault();
  const from = dragSourceIdx;
  dragSourceIdx = null;
  if (from === null || from === idx) return;
  const next = [...props.steps];
  const [moved] = next.splice(from, 1);
  next.splice(idx, 0, moved);
  emitNew(next);
}

function onDragEnd() {
  dragSourceIdx = null;
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
      :class="{
        'wp-pl-row--disabled': !row.step.enabled,
        'wp-pl-row--expanded': expanded[row.step.id],
      }"
      :data-kind="row.kind ?? 'unknown'"
      :data-test="`pipeline-step-${row.idx}`"
      @dragover="(e) => onDragOver(row.idx, e)"
      @drop="(e) => onDrop(row.idx, e)"
    >
      <div class="wp-pl-row__head">
        <button
          type="button"
          class="wp-pl-row__handle"
          :aria-label="`Drag to reorder step ${row.idx + 1}`"
          :data-test="`step-handle-${row.idx}`"
          draggable="true"
          @dragstart="(e) => onDragStart(row.idx, e)"
          @dragend="onDragEnd"
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
          <span class="wp-pl-row__kind">
            {{ (row.meta?.label ?? "Unknown").toUpperCase() }}
          </span>
          <div class="wp-pl-row__name">
            <a
              v-if="row.mod && row.meta"
              :href="`#${row.meta.routeBase}/${row.mod.id}/edit`"
              target="_blank"
              rel="noopener"
              class="wp-pl-row__namelink"
              :data-test="`step-name-link-${row.idx}`"
            >{{ row.mod.name }}</a>
            <span v-else class="wp-pl-row__missing">(missing reference)</span>
          </div>
          <div v-if="row.subtitle" class="wp-pl-row__subtitle">
            {{ row.subtitle }}
          </div>
        </div>

        <span class="wp-pl-row__index">
          {{ String(row.idx + 1).padStart(2, "0") }}
        </span>

        <div class="wp-pl-row__actions">
          <button
            type="button"
            class="wp-pl-row__act"
            :aria-label="expanded[row.step.id]
              ? `Collapse step ${row.idx + 1}`
              : `Expand step ${row.idx + 1}`"
            :aria-expanded="!!expanded[row.step.id]"
            :data-test="`step-expand-${row.idx}`"
            @click="toggleExpanded(row.step.id)"
          >
            <i :class="expanded[row.step.id] ? 'pi pi-chevron-up' : 'pi pi-chevron-down'" />
          </button>
          <button
            type="button"
            class="wp-pl-row__act"
            aria-label="Duplicate step"
            :data-test="`step-duplicate-${row.idx}`"
            @click="duplicate(row.idx)"
          >
            <i class="pi pi-copy" />
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
      </div>

      <!-- Expanded body — module switcher. Only rendered when `expanded`
           flips true so collapsed rows stay tight per the design ref. -->
      <div v-if="expanded[row.step.id]" class="wp-pl-row__body">
        <Select
          v-if="row.kind"
          :model-value="row.step.module_id"
          :options="row.sameKindOptions"
          :placeholder="`Pick a ${row.meta?.label.toLowerCase()}`"
          :aria-label="`Pick reference for step ${row.idx + 1}`"
          class="wp-pl-row__refselect"
          :data-test="`step-ref-${row.idx}`"
          @update:model-value="(v) => changeModule(row.idx, v as string)"
        />
        <span v-else class="wp-pl-row__id">{{ row.step.module_id }}</span>
      </div>

      <!-- Visually-hidden keyboard-fallback move buttons. The bars handle
           is the canonical reorder UI but we keep these for screen readers
           and the existing test suite that triggers reorder via clicks
           rather than synthetic drag events. -->
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
      <span>Add module</span>
    </button>
  </div>
</template>

<style scoped>
.wp-pl-stack {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
/* `.wp-empty-card` (global) provides the dashed-card chrome. We keep the
   icon + title + hint slots scoped here so the empty surface still reads
   as "icon → label → caption" rather than a single muted line. */
.wp-pl-empty__icon  { font-size: 22px; color: var(--wp-text-dim); }
.wp-pl-empty__title { font-size: 13px; font-weight: 500; margin-top: 6px; color: var(--wp-text-muted); }
.wp-pl-empty__hint  { font-size: 12px; color: var(--wp-text-dim); }

/* Visually-hidden helper for keyboard-only fallback buttons (move up /
   move down). Keeps them in the accessibility tree + clickable from the
   test suite without taking visual space. */
.wp-visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

/* ── Row chrome ────────────────────────────────────────────────────── */

.wp-pl-row {
  position: relative;
  background: var(--wp-bg-2);
  border: 1px solid var(--wp-border);
  border-left: var(--wp-kind-stripe-w) solid var(--step-color, var(--wp-accent-500));
  border-radius: var(--wp-radius);
  transition: background 120ms ease, border-color 120ms ease;
}
.wp-pl-row[data-kind="wildcard"]     { --step-color: var(--wp-kind-wildcard); }
.wp-pl-row[data-kind="fixed_values"] { --step-color: var(--wp-kind-fixed); }
.wp-pl-row[data-kind="combine"]      { --step-color: var(--wp-kind-combine); }
.wp-pl-row[data-kind="derivation"]   { --step-color: var(--wp-kind-derivation); }
.wp-pl-row[data-kind="constraint"]   { --step-color: var(--wp-kind-constraint); }
.wp-pl-row[data-kind="pipeline"]     { --step-color: var(--wp-kind-pipeline); }

.wp-pl-row:hover { background: var(--wp-bg-3); }
.wp-pl-row--disabled { opacity: 0.55; }
.wp-pl-row--disabled .wp-pl-row__namelink { text-decoration: line-through; }

.wp-pl-row__head {
  display: grid;
  grid-template-columns: 28px 28px 32px 1fr auto auto;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
}

/* Drag handle ─ bars icon + grab cursor. Keyboard ArrowUp/Down still
   works when this button has focus (see @keydown handlers above). */
.wp-pl-row__handle {
  width: 28px; height: 28px;
  display: flex; align-items: center; justify-content: center;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 4px;
  color: var(--wp-text-dim);
  cursor: grab;
  padding: 0;
  font-size: 13px;
}
.wp-pl-row__handle:hover {
  background: var(--wp-bg-3);
  color: var(--wp-text);
}
.wp-pl-row__handle:active {
  cursor: grabbing;
}
.wp-pl-row__handle:focus-visible {
  outline: 2px solid var(--wp-accent-500);
  outline-offset: 1px;
}

.wp-pl-row__toggle {
  width: 28px; height: 28px;
  display: flex; align-items: center; justify-content: center;
  border: 1px solid var(--wp-border);
  background: var(--wp-bg);
  border-radius: 4px;
  color: var(--wp-text-muted);
  cursor: pointer;
  padding: 0;
  font-size: 12px;
}
.wp-pl-row__toggle:hover {
  background: var(--wp-bg-3);
  color: var(--wp-text);
}

.wp-pl-row__icon {
  width: 32px; height: 32px;
  border-radius: var(--wp-radius-sm);
  display: flex; align-items: center; justify-content: center;
  background: color-mix(in oklab, var(--step-color, var(--wp-accent-500)) 16%, var(--wp-bg-3));
  color: var(--step-color, var(--wp-text));
  flex-shrink: 0;
  font-size: 14px;
}

/* Main content column ─ kind label / bold name / $-var subtitle */
.wp-pl-row__main {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.wp-pl-row__kind {
  font-size: 10.5px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--step-color, var(--wp-text-muted));
  font-weight: 500;
}
.wp-pl-row__name {
  font-weight: 600;
  font-size: 14.5px;
  line-height: 1.25;
  color: var(--wp-text);
}
.wp-pl-row__namelink {
  color: var(--wp-text);
  text-decoration: none;
}
.wp-pl-row__namelink:hover { text-decoration: underline; }
.wp-pl-row__missing { color: var(--wp-danger, #ef4444); font-style: italic; }
.wp-pl-row__subtitle {
  font-family: var(--wp-font-mono, ui-monospace, monospace);
  font-size: 11.5px;
  color: var(--wp-text-dim);
  margin-top: 1px;
  /* Truncate gracefully when the var list is long. */
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.wp-pl-row__index {
  font-family: var(--wp-font-mono, ui-monospace, monospace);
  font-size: 10.5px;
  padding: 1px 6px;
  border-radius: 3px;
  background: var(--wp-bg);
  border: 1px solid var(--wp-border);
  color: var(--wp-text-dim);
  align-self: flex-start;
}

.wp-pl-row__actions {
  display: flex;
  align-items: center;
  gap: 2px;
}
.wp-pl-row__act {
  width: 28px; height: 28px;
  display: flex; align-items: center; justify-content: center;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 4px;
  color: var(--wp-text-muted);
  cursor: pointer;
  font-size: 12px;
  padding: 0;
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

/* Expanded body — only rendered when `expanded[stepId]` is true */
.wp-pl-row__body {
  padding: 0 12px 12px 76px;  /* align under the name column */
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.wp-pl-row__refselect {
  width: 100%;
  max-width: 320px;
}
.wp-pl-row__id {
  font-family: var(--wp-font-mono, ui-monospace, monospace);
  font-size: 11px;
  color: var(--wp-text-dim);
}

/* ── Add button ─────────────────────────────────────────────────────── */

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
}
.wp-pl-add:hover {
  border-style: solid;
  border-color: var(--wp-accent-500, var(--wp-text-muted));
  color: var(--wp-text);
  background: var(--wp-bg-2);
}
.wp-pl-add .pi { font-size: 11px; }
</style>
