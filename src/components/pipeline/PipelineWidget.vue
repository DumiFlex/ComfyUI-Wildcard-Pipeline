<template>
  <div class="pipeline-widget">
    <div class="modules-list" @dragover.prevent="onDragOver" @drop="onDropList">
      <div 
        v-for="(mod, index) in localModules" 
        :key="index"
        class="module-card"
        draggable="true"
        @dragstart="onDragStart($event, index)"
        @drop.stop="onDrop($event, index)"
        @dragover.prevent
      >
        <div class="module-header">
          <div class="drag-handle" title="Drag to reorder">≡</div>
          <span class="module-type-label">{{ MODULE_TYPE_LABELS[mod.type] || mod.type }}</span>
          <button class="btn-delete" @click="removeModule(index)" title="Remove module">×</button>
        </div>
        
        <div class="module-body">
          <WildcardModule 
            v-if="mod.type === 'wildcard'" 
            :modelValue="mod" 
            @update:modelValue="updateModule(index, $event)" 
          />
          <FixedModule 
            v-else-if="mod.type === 'fixed'" 
            :modelValue="mod" 
            @update:modelValue="updateModule(index, $event)" 
          />
          <CombineModule 
            v-else-if="mod.type === 'combine'" 
            :modelValue="mod" 
            @update:modelValue="updateModule(index, $event)" 
          />
          <ConstrainModule 
            v-else-if="mod.type === 'constrain'" 
            :modelValue="mod" 
            @update:modelValue="updateModule(index, $event)" 
          />
          <ConditionModule 
            v-else-if="mod.type === 'condition'" 
            :modelValue="mod" 
            @update:modelValue="updateModule(index, $event)" 
          />
          <ExportModule 
            v-else-if="mod.type === 'export'" 
            :modelValue="mod" 
            @update:modelValue="updateModule(index, $event)" 
          />
        </div>
      </div>
    </div>

    <div class="add-module-container">
      <select v-model="selectedNewType" class="type-select">
        <option value="" disabled>+ Add Module...</option>
        <option value="wildcard">Wildcard</option>
        <option value="fixed">Fixed</option>
        <option value="combine">Combine</option>
        <option value="constrain">Constrain</option>
        <option value="condition">Condition</option>
        <option value="export">Export</option>
      </select>
      <button class="btn-add-module" @click="addModule" :disabled="!selectedNewType">Add</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import type { PipelineModule, ModuleType } from '@/types';
import { MODULE_TYPE_LABELS } from '@/types';

import WildcardModule from './modules/WildcardModule.vue';
import FixedModule from './modules/FixedModule.vue';
import CombineModule from './modules/CombineModule.vue';
import ConstrainModule from './modules/ConstrainModule.vue';
import ConditionModule from './modules/ConditionModule.vue';
import ExportModule from './modules/ExportModule.vue';

const props = defineProps<{ modelValue: PipelineModule[] }>();
const emit = defineEmits<{
  (e: 'update:modelValue', value: PipelineModule[]): void
}>();

const localModules = ref<PipelineModule[]>([...props.modelValue]);

watch(() => props.modelValue, (newVal) => {
  localModules.value = [...newVal];
}, { deep: true });

const selectedNewType = ref<ModuleType | ''>('');
const draggedIndex = ref<number | null>(null);

const emitUpdate = () => {
  emit('update:modelValue', [...localModules.value]);
};

const addModule = () => {
  if (!selectedNewType.value) return;

  let newModule: PipelineModule;
  switch (selectedNewType.value) {
    case 'wildcard':
      newModule = { type: 'wildcard', options: [{ value: '', weight: 1 }], capture_as: '' };
      break;
    case 'fixed':
      newModule = { type: 'fixed', value: '', capture_as: '' };
      break;
    case 'combine':
      newModule = { type: 'combine', template: '', capture_as: '' };
      break;
    case 'constrain':
      newModule = { type: 'constrain', target: '', rules: [] };
      break;
    case 'condition':
      newModule = { type: 'condition', variable: '', value: '', capture_as: '', if_equals: '' };
      break;
    case 'export':
      newModule = { type: 'export', variables: [] };
      break;
  }

  localModules.value.push(newModule);
  selectedNewType.value = '';
  emitUpdate();
};

const removeModule = (index: number) => {
  localModules.value.splice(index, 1);
  emitUpdate();
};

const updateModule = (index: number, updatedModule: PipelineModule) => {
  localModules.value[index] = updatedModule;
  emitUpdate();
};

const onDragStart = (event: DragEvent, index: number) => {
  draggedIndex.value = index;
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
  }
};

const onDragOver = (event: DragEvent) => {
  // Required for drop to work
};

const onDrop = (event: DragEvent, index: number) => {
  if (draggedIndex.value === null || draggedIndex.value === index) return;
  
  const newList = [...localModules.value];
  const [movedItem] = newList.splice(draggedIndex.value, 1);
  newList.splice(index, 0, movedItem);
  
  localModules.value = newList;
  emitUpdate();
  draggedIndex.value = null;
};

const onDropList = (event: DragEvent) => {
  // Handle dropping at the end of the list if dropped outside a specific card
  if (draggedIndex.value === null) return;
  // If the event didn't trigger on a card, we can move it to the end
  // But usually dropping on the container works naturally via bubble if not stopped.
  // We'll leave it as is, cards have .stop on drop.
};
</script>

<style scoped>
.pipeline-widget {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
  font-family: sans-serif;
  font-size: 12px;
  color: #e0e0e0;
}

.modules-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-height: 20px;
}

.module-card {
  background: #1a1a1a;
  border: 1px solid #444;
  border-radius: 6px;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  position: relative;
}

.module-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.drag-handle {
  cursor: grab;
  color: #666;
  font-size: 16px;
  user-select: none;
  padding: 0 4px;
}
.drag-handle:active {
  cursor: grabbing;
}

.module-type-label {
  font-size: 10px;
  text-transform: uppercase;
  color: #888;
  font-weight: bold;
  flex: 1;
  margin-left: 4px;
}

.btn-delete {
  background: transparent;
  border: none;
  color: #ff4444;
  font-size: 16px;
  cursor: pointer;
  padding: 0 4px;
  line-height: 1;
}
.btn-delete:hover {
  color: #ff6666;
}

.module-body {
  display: flex;
  width: 100%;
}

.add-module-container {
  display: flex;
  gap: 4px;
  margin-top: 4px;
}

.type-select {
  flex: 1;
  padding: 6px 8px;
  border-radius: 4px;
  border: 1px solid #444;
  background: #2a2a2a;
  color: #e0e0e0;
  font-size: 12px;
  outline: none;
}
.type-select:focus {
  border-color: #4a9eff;
}

.btn-add-module {
  padding: 6px 12px;
  background: #333;
  color: #e0e0e0;
  border: 1px solid #444;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
}
.btn-add-module:not(:disabled):hover {
  background: #444;
  border-color: #4a9eff;
}
.btn-add-module:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
