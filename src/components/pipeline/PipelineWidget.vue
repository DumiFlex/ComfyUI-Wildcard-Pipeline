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
          'wp-conflict-error': hasConflict(index, 'error'),
          'wp-conflict-warning': hasConflict(index, 'warning'),
        }"
        :title="getConflictTooltip(index)"
        draggable="true"
        @dragstart="onDragStart($event, index)"
        @dragenter.prevent="onDragEnter(index)"
        @dragleave="onDragLeave($event, index)"
        @drop.stop="onDrop($event, index)"
        @dragover.prevent
        @dragend="onDragEnd"
        @contextmenu.prevent="onContextMenu($event, index)"
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

          <!-- Capture label -->
          <div v-if="getCapture(mod)" class="wp-module-capture">
            → ${{ getCapture(mod) }}
            <span
              v-if="getDismissedConflicts(index).length > 0"
              class="wp-dismissed-icon"
              :title="getDismissedTooltip(index)"
            >⚑</span>
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

    <ContextMenu
      :visible="contextMenu.visible"
      :x="contextMenu.x"
      :y="contextMenu.y"
      :items="contextMenu.items"
      @select="handleMenuSelect"
      @close="contextMenu.visible = false"
    />
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import type { ConstrainModule, DismissableConflictType, PipelineModule } from '@/types';
import { DISMISSABLE_CONFLICT_TYPES } from '@/types';
import ModulePickerModal from './ModulePickerModal.vue';
import ContextMenu from './ContextMenu.vue';
import type { ContextMenuItem } from './ContextMenu.vue';
import {
  moveModule,
  moveModuleUp,
  moveModuleDown,
  moveModuleToTop,
  moveModuleToBottom,
  duplicateModule,
} from './actions';
import { useConstraintStore } from '@/stores/constraints';
import type { Conflict, ConflictSeverity } from '@/extension/conflicts';

const props = withDefaults(
  defineProps<{
    modelValue: PipelineModule[];
    conflicts?: Conflict[];
  }>(),
  { conflicts: () => [] },
);
const emit = defineEmits<{
  (e: 'update:modelValue', value: PipelineModule[]): void;
}>();

const localModules = ref<PipelineModule[]>([...props.modelValue]);
const showPicker = ref(false);
const draggedIndex = ref<number | null>(null);
const dragOverIndex = ref<number | null>(null);
const constraintStore = useConstraintStore();

const contextMenu = ref<{
  visible: boolean;
  x: number;
  y: number;
  targetIndex: number;
  items: ContextMenuItem[];
}>({
  visible: false,
  x: 0,
  y: 0,
  targetIndex: -1,
  items: [],
});

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

/* ── Context menu ── */

function onContextMenu(event: MouseEvent, index: number) {
  const last = localModules.value.length - 1;
  const isFirst = index === 0;
  const isLast = index === last;

  const hasMarkable = getActiveConflicts(index).some(
    c => DISMISSABLE_CONFLICT_TYPES.includes(c.type as DismissableConflictType),
  );
  const hasRestoreable = getDismissedConflicts(index).length > 0;

  const items: ContextMenuItem[] = [
    { icon: '↑', label: 'Move Up', action: 'move-up', disabled: isFirst },
    { icon: '↓', label: 'Move Down', action: 'move-down', disabled: isLast },
    { icon: '⤒', label: 'Move to Top', action: 'move-top', disabled: isFirst },
    { icon: '⤓', label: 'Move to Bottom', action: 'move-bottom', disabled: isLast },
    { separator: true, label: '', action: '' },
    { icon: '⎘', label: 'Duplicate', action: 'duplicate' },
    { separator: true, label: '', action: '' },
    { icon: '×', label: 'Delete', action: 'delete' },
  ];

  if (hasMarkable || hasRestoreable) {
    items.push({ separator: true, label: '', action: '' });
    if (hasMarkable) {
      items.push({ icon: '⚑', label: 'Mark as Intended', action: 'mark-intended' });
    }
    if (hasRestoreable) {
      items.push({ icon: '↺', label: 'Restore Warning', action: 'restore-warning' });
    }
  }

  contextMenu.value = {
    visible: true,
    x: event.clientX,
    y: event.clientY,
    targetIndex: index,
    items,
  };
}

function handleMenuSelect(action: string) {
  const idx = contextMenu.value.targetIndex;
  contextMenu.value.visible = false;
  if (idx < 0 || idx >= localModules.value.length) return;
  if (action === 'move-up') {
    localModules.value = moveModuleUp(localModules.value, idx);
    emitUpdate();
  } else if (action === 'move-down') {
    localModules.value = moveModuleDown(localModules.value, idx);
    emitUpdate();
  } else if (action === 'move-top') {
    localModules.value = moveModuleToTop(localModules.value, idx);
    emitUpdate();
  } else if (action === 'move-bottom') {
    localModules.value = moveModuleToBottom(localModules.value, idx);
    emitUpdate();
  } else if (action === 'duplicate') {
    localModules.value = duplicateModule(localModules.value, idx);
    emitUpdate();
  } else if (action === 'delete') {
    removeModule(idx);
  } else if (action === 'mark-intended') {
    const dismissableTypes = getActiveConflicts(idx)
      .map(c => c.type)
      .filter((t): t is DismissableConflictType =>
        DISMISSABLE_CONFLICT_TYPES.includes(t as DismissableConflictType),
      );
    const mod = localModules.value[idx];
    (mod as { __dismissed_conflicts?: DismissableConflictType[] }).__dismissed_conflicts = dismissableTypes;
    emitUpdate();
  } else if (action === 'restore-warning') {
    const mod = localModules.value[idx];
    delete (mod as Record<string, unknown>).__dismissed_conflicts;
    emitUpdate();
  }
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

  localModules.value = moveModule(localModules.value, draggedIndex.value, index);
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

/* ── Conflict helpers ── */

function getConflictsForModule(index: number): Conflict[] {
  return props.conflicts.filter(c => c.moduleIndex === index);
}

function isDismissed(index: number, conflictType: string): boolean {
  const mod = localModules.value[index];
  if (!('__dismissed_conflicts' in mod)) return false;
  const m = mod as { __dismissed_conflicts?: DismissableConflictType[] };
  return m.__dismissed_conflicts?.includes(conflictType as DismissableConflictType) ?? false;
}

function getActiveConflicts(index: number): Conflict[] {
  return getConflictsForModule(index).filter(c => !isDismissed(index, c.type));
}

function getDismissedConflicts(index: number): Conflict[] {
  return getConflictsForModule(index).filter(c => isDismissed(index, c.type));
}

function getDismissedTooltip(index: number): string {
  const dismissed = getDismissedConflicts(index);
  if (!dismissed.length) return '';
  return 'Marked as intended:\n' + dismissed.map(c => c.message).join('\n');
}

function hasConflict(index: number, severity: ConflictSeverity): boolean {
  return getActiveConflicts(index).some(c => c.severity === severity);
}

function getConflictTooltip(index: number): string {
  const conflicts = getActiveConflicts(index);
  if (!conflicts.length) return '';
  return conflicts.map(c => `⚠ ${c.message}`).join('\n');
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

/* ── Conflict highlighting ── */
.wp-module.wp-conflict-warning {
  border-color: var(--wp-amber);
  background: var(--wp-amber-bg);
}
.wp-module.wp-conflict-warning:hover {
  border-color: var(--wp-amber);
}
.wp-module.wp-conflict-error {
  border-color: var(--wp-red);
  background: var(--wp-red-bg);
}
.wp-module.wp-conflict-error:hover {
  border-color: var(--wp-red);
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
  display: flex;
  align-items: center;
  gap: 4px;
}

.wp-dismissed-icon {
  color: var(--wp-amber);
  font-size: 11px;
  cursor: help;
  opacity: 0.7;
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
