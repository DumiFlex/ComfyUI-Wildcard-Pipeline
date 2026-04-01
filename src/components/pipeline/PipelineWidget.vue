<template>
  <div class="wp-pipeline">
    <div
      class="wp-modules"
      @dragover.prevent="onDragOver"
      @drop="onDropList"
    >
      <div
        v-for="(mod, index) in localModules"
        :key="index"
        class="wp-module"
        :class="{
          dragging: draggedIndex === index,
          'drag-over': dragOverIndex === index,
        }"
        draggable="true"
        @dragstart="onDragStart($event, index)"
        @dragenter.prevent="onDragEnter(index)"
        @dragleave="onDragLeave($event, index)"
        @drop.stop="onDrop($event, index)"
        @dragover.prevent
        @dragend="onDragEnd"
      >
        <div class="wp-module-drag" title="Drag to reorder">⠿</div>

        <div class="wp-module-body">
          <div class="wp-module-top">
            <span class="wp-module-tag" :class="'tag-' + mod.type">
              {{ mod.type }}
            </span>
            <span class="wp-module-name">{{ getModuleName(mod) }}</span>
          </div>

          <!-- Wildcard: compact summary -->
          <div v-if="mod.type === 'wildcard'">
            <div v-if="mod.options?.length" class="wp-module-detail wp-module-source">
              {{ mod.options.length }} option{{ mod.options.length !== 1 ? 's' : '' }}
            </div>
          </div>

          <!-- Fixed: show value -->
          <div v-else-if="mod.type === 'fixed'" class="wp-module-detail wp-fixed-value">
            {{ mod.value || '(empty)' }}
          </div>

          <!-- Combine: show template -->
          <div v-else-if="mod.type === 'combine'" class="wp-module-detail wp-combine-tpl">
            {{ mod.template || '(empty)' }}
          </div>

          <!-- Constrain: show target + rule count -->
          <div v-else-if="mod.type === 'constrain'" class="wp-module-detail wp-constrain-info">
            <span v-if="mod.rules?.length">{{ mod.rules.length }} rule{{ mod.rules.length !== 1 ? 's' : '' }}</span>
            <span v-if="getConstraintTargets(mod as ConstrainModule)">→ {{ getConstraintTargets(mod as ConstrainModule) }}</span>
          </div>

          <!-- Condition: show variable check -->
          <div v-else-if="mod.type === 'condition'" class="wp-module-detail wp-condition-info">
            <span v-if="mod.if_equals">if ${{ mod.variable }} = "{{ mod.if_equals }}"</span>
            <span v-else-if="mod.unless_equals">unless ${{ mod.variable }} = "{{ mod.unless_equals }}"</span>
            <span v-else>${{ mod.variable }}</span>
          </div>

          <!-- Export: show variable list -->
          <div v-else-if="mod.type === 'export'" class="wp-module-detail wp-export-info">
            {{ mod.variables?.join(', ') || '(none)' }}
            <span v-if="mod.prefix" class="wp-text-muted"> prefix={{ mod.prefix }}</span>
          </div>

          <!-- Capture label -->
          <div v-if="getCapture(mod)" class="wp-module-capture">
            → ${{ getCapture(mod) }}
          </div>
        </div>

        <button
          class="wp-module-delete"
          type="button"
          @click="removeModule(index)"
          title="Remove module"
        >×</button>
      </div>
    </div>

    <button
      class="wp-add-btn"
      type="button"
      @click="showPicker = true"
    >+ add module</button>

    <ModulePickerModal
      v-model:visible="showPicker"
      @select="onModuleSelected"
    />
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import type { ConstrainModule, PipelineModule } from '@/types';
import ModulePickerModal from './ModulePickerModal.vue';
import { useConstraintStore } from '@/stores/constraints';

const props = defineProps<{ modelValue: PipelineModule[] }>();
const emit = defineEmits<{
  (e: 'update:modelValue', value: PipelineModule[]): void;
}>();

const localModules = ref<PipelineModule[]>([...props.modelValue]);
const showPicker = ref(false);
const draggedIndex = ref<number | null>(null);
const dragOverIndex = ref<number | null>(null);
const constraintStore = useConstraintStore();

onMounted(() => {
  if (constraintStore.items.length === 0) {
    void constraintStore.fetchAll();
  }
});

watch(() => props.modelValue, (newVal) => {
  localModules.value = [...newVal];
}, { deep: true });

const emitUpdate = () => {
  emit('update:modelValue', [...localModules.value]);
};

/* ── Helpers ── */

function getModuleName(mod: PipelineModule): string {
  switch (mod.type) {
    case 'wildcard':
      return mod.capture_as?.replace(/^\$/, '') ?? 'Wildcard';
    case 'fixed':
      return mod.capture_as?.replace(/^\$/, '') ?? 'Fixed';
    case 'combine':
      return mod.capture_as?.replace(/^\$/, '') ?? 'Combine';
    case 'constrain':
      return 'Constrain';
    case 'condition':
      return mod.variable?.replace(/^\$/, '') ?? 'Condition';
    case 'export':
      return mod.variables?.length ? `Export (${mod.variables.length})` : 'Export';
  }
}

function getCapture(mod: PipelineModule): string | undefined {
  if ('capture_as' in mod && mod.capture_as) {
    return mod.capture_as.replace(/^\$/, '');
  }
  return undefined;
}

function getConstraintTargets(mod: ConstrainModule): string {
  let rules = mod.rules;
  if (!rules?.length && mod.source) {
    const found = constraintStore.items.find(c => c.id === mod.source || c.name === mod.source);
    rules = found?.rules;
  }
  if (!rules?.length) return '';
  const targets = [...new Set(rules.map(r => r.target).filter(Boolean))];
  if (!targets.length) return '';
  const shown = targets.slice(0, 3).join(', ');
  return targets.length > 3 ? `${shown}, ...` : shown;
}

/* ── Module actions ── */

function onModuleSelected(mod: PipelineModule) {
  localModules.value.push(mod);
  emitUpdate();
}

function removeModule(index: number) {
  localModules.value.splice(index, 1);
  emitUpdate();
}

/* ── Drag & Drop ── */

function onDragStart(event: DragEvent, index: number) {
  draggedIndex.value = index;
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
  }
}

function onDragEnter(index: number) {
  if (draggedIndex.value !== null && draggedIndex.value !== index) {
    dragOverIndex.value = index;
  }
}

function onDragLeave(event: DragEvent, index: number) {
  const related = event.relatedTarget as Node | null;
  const card = (event.currentTarget as HTMLElement);
  if (related && card.contains(related)) return;
  if (dragOverIndex.value === index) {
    dragOverIndex.value = null;
  }
}

function onDragOver(_event: DragEvent) {
  // Required for drop to work
}

function onDrop(_event: DragEvent, index: number) {
  if (draggedIndex.value === null || draggedIndex.value === index) return;

  const newList = [...localModules.value];
  const [movedItem] = newList.splice(draggedIndex.value, 1);
  newList.splice(index, 0, movedItem);

  localModules.value = newList;
  emitUpdate();
  draggedIndex.value = null;
  dragOverIndex.value = null;
}

function onDropList(_event: DragEvent) {
  draggedIndex.value = null;
  dragOverIndex.value = null;
}

function onDragEnd() {
  draggedIndex.value = null;
  dragOverIndex.value = null;
}
</script>

<style>
@import './widget-theme.css';
</style>

<style scoped>
.wp-pipeline, .wp-pipeline * {
  box-sizing: border-box;
}

.wp-pipeline {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;
  padding-bottom: 8px;
  font-family: var(--wp-font-sans, sans-serif);
  font-size: 12px;
  color: var(--wp-text);
}

.wp-modules {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-height: 20px;
}

/* ── Module card ── */
.wp-module {
  background: var(--wp-bg3);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius-sm);
  padding: 8px 10px;
  display: flex;
  align-items: flex-start;
  gap: 8px;
  cursor: grab;
  transition: all 0.15s;
  position: relative;
  user-select: none;
}
.wp-module:hover {
  border-color: var(--wp-border2);
  background: var(--wp-bg4);
}
.wp-module.dragging {
  opacity: 0.4;
  cursor: grabbing;
}
.wp-module.drag-over {
  border-color: var(--wp-accent);
  background: var(--wp-accent-glow);
}

.wp-module-drag {
  color: var(--wp-text3);
  font-size: 11px;
  line-height: 1;
  padding-top: 2px;
  flex-shrink: 0;
  cursor: grab;
}

.wp-module-body {
  flex: 1;
  min-width: 0;
}

.wp-module-top {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 5px;
}

/* ── Module type tags ── */
.wp-module-tag {
  font-size: 9px;
  font-family: var(--wp-font-mono, monospace);
  padding: 1px 6px;
  border-radius: 3px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  font-weight: 500;
  flex-shrink: 0;
}
.tag-wildcard {
  background: var(--wp-accent-glow);
  color: var(--wp-accent);
  border: 1px solid rgba(124, 106, 247, 0.2);
}
.tag-constrain {
  background: var(--wp-amber-bg);
  color: var(--wp-amber);
  border: 1px solid rgba(251, 191, 36, 0.2);
}
.tag-combine {
  background: var(--wp-teal-bg);
  color: var(--wp-teal);
  border: 1px solid rgba(45, 212, 191, 0.2);
}
.tag-fixed {
  background: rgba(144, 144, 168, 0.08);
  color: var(--wp-text2);
  border: 1px solid rgba(144, 144, 168, 0.15);
}
.tag-condition {
  background: var(--wp-green-bg);
  color: var(--wp-green);
  border: 1px solid rgba(74, 222, 128, 0.2);
}
.tag-export {
  background: var(--wp-pink-bg);
  color: var(--wp-pink);
  border: 1px solid rgba(244, 114, 182, 0.2);
}

.wp-module-name {
  font-size: 12px;
  font-weight: 600;
  color: var(--wp-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ── Module detail lines ── */
.wp-module-detail {
  font-size: 11px;
  font-family: var(--wp-font-mono, monospace);
  padding: 4px 7px;
  border-radius: 4px;
  margin-top: 2px;
  word-break: break-all;
}
.wp-module-source {
  color: var(--wp-accent);
  background: var(--wp-accent-glow);
}
.wp-fixed-value {
  color: var(--wp-text2);
  background: rgba(144, 144, 168, 0.08);
}
.wp-combine-tpl {
  color: var(--wp-teal);
  background: var(--wp-teal-bg);
}
.wp-constrain-info {
  color: var(--wp-amber);
  background: var(--wp-amber-bg);
  display: flex;
  gap: 6px;
}
.wp-condition-info {
  color: var(--wp-green);
  background: var(--wp-green-bg);
}
.wp-export-info {
  color: var(--wp-pink);
  background: var(--wp-pink-bg);
}
.wp-text-muted {
  color: var(--wp-text3);
}

/* ── Capture label ── */
.wp-module-capture {
  margin-top: 4px;
  font-size: 10px;
  font-family: var(--wp-font-mono, monospace);
  color: var(--wp-green);
  padding-left: 2px;
}

/* ── Delete button ── */
.wp-module-delete {
  background: none;
  border: none;
  color: var(--wp-text3);
  cursor: pointer;
  font-size: 14px;
  padding: 0;
  line-height: 1;
  flex-shrink: 0;
  margin-top: 1px;
  transition: color 0.15s;
}
.wp-module-delete:hover {
  color: var(--wp-red);
}

/* ── Add module button ── */
.wp-add-btn {
  background: var(--wp-accent-glow);
  border: 1px solid var(--wp-accent);
  border-radius: var(--wp-radius-sm);
  color: var(--wp-accent);
  font-family: var(--wp-font-sans, sans-serif);
  font-size: 12px;
  font-weight: 600;
  padding: 8px;
  cursor: pointer;
  width: 100%;
  text-align: center;
  transition: all 0.15s;
  letter-spacing: 0.03em;
}
.wp-add-btn:hover {
  background: var(--wp-accent);
  color: #fff;
}
</style>
