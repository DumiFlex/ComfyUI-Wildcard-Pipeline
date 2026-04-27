<script setup lang="ts">
import { computed } from "vue";
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
  label: string;
  icon: string;
  routeBase: string;
}

const KIND_META: Record<ModuleType, KindMeta> = {
  wildcard:     { type: "wildcard",     label: "Wildcard",     icon: "pi pi-th-large",  routeBase: "/wildcards" },
  fixed_values: { type: "fixed_values", label: "Fixed Values", icon: "pi pi-tag",       routeBase: "/fixed-values" },
  combine:      { type: "combine",      label: "Combine",      icon: "pi pi-share-alt", routeBase: "/combines" },
  derivation:   { type: "derivation",   label: "Derivation",   icon: "pi pi-code",      routeBase: "/derivations" },
  constraint:   { type: "constraint",   label: "Constraint",   icon: "pi pi-sitemap",   routeBase: "/constraints" },
  pipeline:     { type: "pipeline",     label: "Pipeline",     icon: "pi pi-list",      routeBase: "/pipelines" },
};

const rows = computed(() =>
  props.steps.map((step, idx) => {
    const mod = props.modulesById.get(step.module_id) ?? null;
    const kind: ModuleType | null = mod?.type ?? null;
    const meta = kind ? KIND_META[kind] : null;
    const sameKindOptions = kind
      ? (props.modulesByKind[kind] ?? []).map((m) => ({ value: m.id, label: m.name }))
      : [];
    return { step, idx, mod, kind, meta, sameKindOptions };
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
</script>

<template>
  <div class="wp-pl-stack" data-test="pipeline-steps">
    <div v-if="!steps.length" class="wp-pl-empty">
      <i class="pi pi-list" style="font-size:22px;color:var(--wp-text-dim);" />
      <div class="wp-pl-empty__title">No modules yet</div>
      <div class="wp-pl-empty__hint">Add modules from your library; they'll resolve in order.</div>
    </div>

    <div
      v-for="row in rows"
      :key="row.step.id"
      class="wp-pl-row"
      :class="{ 'wp-pl-row--disabled': !row.step.enabled }"
      :data-kind="row.kind ?? 'unknown'"
      :data-test="`pipeline-step-${row.idx}`"
    >
      <div class="wp-pl-row__moves">
        <button
          type="button"
          class="wp-pl-row__movebtn"
          :aria-label="`Move step ${row.idx + 1} up`"
          :disabled="row.idx === 0"
          :data-test="`step-up-${row.idx}`"
          @click="move(row.idx, -1)"
        >
          <i class="pi pi-chevron-up" />
        </button>
        <button
          type="button"
          class="wp-pl-row__movebtn"
          :aria-label="`Move step ${row.idx + 1} down`"
          :disabled="row.idx === steps.length - 1"
          :data-test="`step-down-${row.idx}`"
          @click="move(row.idx, +1)"
        >
          <i class="pi pi-chevron-down" />
        </button>
      </div>

      <button
        type="button"
        class="wp-pl-row__toggle"
        :aria-label="row.step.enabled ? `Disable step ${row.idx + 1}` : `Enable step ${row.idx + 1}`"
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
          <span class="wp-pl-row__kind">{{ row.meta?.label ?? "Unknown" }}</span>
          <span class="wp-pl-row__index">{{ String(row.idx + 1).padStart(2, "0") }}</span>
        </div>
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
        <div class="wp-pl-row__sub">
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
      </div>

      <div class="wp-pl-row__actions">
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
          <i class="pi pi-trash" />
        </button>
      </div>
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
.wp-pl-empty {
  padding: 28px 16px;
  text-align: center;
  border: 1px dashed var(--wp-border);
  border-radius: var(--wp-radius);
  background: var(--wp-bg);
  color: var(--wp-text2);
}
.wp-pl-empty__title { font-size: 13px; font-weight: 500; margin-top: 6px; }
.wp-pl-empty__hint { font-size: 12px; color: var(--wp-text3); }

.wp-pl-row {
  display: grid;
  grid-template-columns: 26px 26px 32px 1fr auto;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  background: var(--wp-bg2);
  border: 1px solid var(--wp-border);
  border-left: 3px solid var(--step-color, var(--wp-accent-500));
  border-radius: var(--wp-radius);
  transition: background 120ms ease;
}
.wp-pl-row[data-kind="wildcard"]     { --step-color: var(--wp-kind-wildcard); }
.wp-pl-row[data-kind="fixed_values"] { --step-color: var(--wp-kind-fixed); }
.wp-pl-row[data-kind="combine"]      { --step-color: var(--wp-kind-combine); }
.wp-pl-row[data-kind="derivation"]   { --step-color: var(--wp-kind-derivation); }
.wp-pl-row[data-kind="constraint"]   { --step-color: var(--wp-kind-constraint); }
.wp-pl-row[data-kind="pipeline"]     { --step-color: var(--wp-kind-pipeline); }

.wp-pl-row:hover { background: var(--wp-bg3); }
.wp-pl-row--disabled { opacity: 0.55; }
.wp-pl-row--disabled .wp-pl-row__namelink { text-decoration: line-through; }

.wp-pl-row__moves {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.wp-pl-row__movebtn {
  display: flex; align-items: center; justify-content: center;
  width: 22px; height: 14px;
  border: 1px solid var(--wp-border);
  background: var(--wp-bg);
  color: var(--wp-text2);
  border-radius: 3px;
  cursor: pointer;
  font-size: 9px;
  padding: 0;
}
.wp-pl-row__movebtn:hover:not(:disabled) {
  background: var(--wp-bg3);
  color: var(--wp-text);
}
.wp-pl-row__movebtn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.wp-pl-row__toggle {
  width: 26px; height: 26px;
  display: flex; align-items: center; justify-content: center;
  border: 1px solid var(--wp-border);
  background: var(--wp-bg);
  border-radius: 4px;
  color: var(--wp-text2);
  cursor: pointer;
  padding: 0;
  font-size: 12px;
}
.wp-pl-row__toggle:hover {
  background: var(--wp-bg3);
  color: var(--wp-text);
}

.wp-pl-row__icon {
  width: 32px; height: 32px;
  border-radius: var(--wp-radius-sm);
  display: flex; align-items: center; justify-content: center;
  background: color-mix(in oklab, var(--step-color, var(--wp-accent-500)) 16%, var(--wp-bg3));
  color: var(--step-color, var(--wp-text));
  flex-shrink: 0;
  font-size: 14px;
}

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
  color: var(--wp-text2);
  font-weight: 500;
}
.wp-pl-row__kind { color: var(--step-color, var(--wp-text2)); }
.wp-pl-row__index {
  margin-left: auto;
  font-family: var(--wp-font-mono, ui-monospace, monospace);
  font-size: 10.5px;
  padding: 1px 5px;
  border-radius: 3px;
  background: var(--wp-bg);
  border: 1px solid var(--wp-border);
  color: var(--wp-text3);
}
.wp-pl-row__name {
  font-weight: 500;
  font-size: 13.5px;
  color: var(--wp-text);
}
.wp-pl-row__namelink {
  color: var(--wp-text);
  text-decoration: none;
}
.wp-pl-row__namelink:hover { text-decoration: underline; }
.wp-pl-row__missing { color: var(--wp-danger, #ef4444); font-style: italic; }
.wp-pl-row__sub {
  font-size: 11.5px;
  color: var(--wp-text2);
}
.wp-pl-row__id {
  font-family: var(--wp-font-mono, ui-monospace, monospace);
  font-size: 11px;
  color: var(--wp-text3);
}

.wp-pl-row__refselect {
  width: 100%;
  max-width: 320px;
}

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
  color: var(--wp-text2);
  cursor: pointer;
  font-size: 12px;
  padding: 0;
}
.wp-pl-row__act:hover {
  background: var(--wp-bg3);
  color: var(--wp-text);
  border-color: var(--wp-border);
}
.wp-pl-row__act--danger:hover {
  background: color-mix(in oklab, var(--wp-danger, #ef4444) 16%, transparent);
  color: #fca5a5;
  border-color: color-mix(in oklab, var(--wp-danger, #ef4444) 30%, transparent);
}

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
  color: var(--wp-text2);
  font-size: 12.5px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  cursor: pointer;
  margin-top: 4px;
}
.wp-pl-add:hover {
  border-style: solid;
  border-color: var(--wp-accent-500, var(--wp-text2));
  color: var(--wp-text);
  background: var(--wp-bg2);
}
.wp-pl-add .pi { font-size: 11px; }
</style>
